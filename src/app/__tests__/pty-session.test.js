// pty-session.test.js — the PTY session map behind the ⌨ Terminal: a real
// shell over a real WebSocket, driven through attach → detach → reattach.
// Sessions are keyed by resolved cwd and live in the bridge process, so the
// observable contract is exercised end-to-end rather than by poking internals:
// a reattach must find the SAME shell (its variables, its background output),
// an explicit kill must drop it, and a shell that exits must drop itself.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WebSocket } from "ws";
import { handleUpgrade } from "../../../server/bridge.js";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

let server, port, shell;
const dirs = [];

function makeRepo(tag) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), tag)));
  execFileSync("git", ["init", "-b", "main"], { cwd: d });
  dirs.push(d);
  return d;
}

// An attached client: resolves once the socket is open, collecting PTY output
// (replay included) into `.text` and the exit code into `.exit`.
function attach(dir) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/bridza/pty?dir=${encodeURIComponent(dir)}`);
    const c = {
      ws, text: "", exit: null,
      send: (m) => ws.send(JSON.stringify(m)),
      type: (s) => ws.send(JSON.stringify({ t: "in", d: s })),
      detach: () => new Promise((r) => { ws.once("close", r); ws.close(); }),
    };
    ws.on("message", (b) => {
      let m; try { m = JSON.parse(String(b)); } catch (e) { return; }
      if (m.t === "out") c.text += m.d;
      else if (m.t === "exit") c.exit = m.code;
    });
    ws.on("error", reject);
    ws.on("open", () => resolve(c));
  });
}

const waitFor = async (fn, what) => {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for " + what);
};

// A marker command, waited for by its output — the shell is only "ready" when
// it has actually run something for us. The command is written so that the
// tty's echo of the typed line can't be mistaken for the line it prints.
async function ask(c, cmd, token) {
  const before = c.text.length;
  c.type(cmd + "\n");
  await waitFor(() => c.text.slice(before).includes("<" + token + ":"), token);
  return c.text.slice(before).match(new RegExp("<" + token + ":([^>]*)>"))[1];
}
const echo = (token, expr) => `printf '<%s:%s>\\n' ${token} "${expr}"`;

beforeAll(async () => {
  shell = process.env.SHELL;
  process.env.SHELL = "/bin/sh"; // a login $SHELL here would source the dev's rc files
  server = http.createServer();
  server.on("upgrade", (req, socket, head) => handleUpgrade(req, socket, head));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});

afterAll(async () => {
  // Leave no PTY (and no 30-minute reap timer) behind holding the event loop.
  for (const d of dirs) {
    try { const c = await attach(d); c.send({ t: "kill" }); await c.detach(); } catch (e) { /* already gone */ }
  }
  // close() resolves only once every socket is gone, and a WebSocket upgraded
  // off this server is not always one it will hang up for us — waiting on it
  // unbounded hangs the hook (and the whole run) instead of ending the suite.
  server.closeAllConnections();
  server.unref();
  await Promise.race([new Promise((r) => server.close(r)), new Promise((r) => setTimeout(r, 2000))]);
  if (shell === undefined) delete process.env.SHELL; else process.env.SHELL = shell;
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("pty sessions survive detach", () => {
  it("reattaching to the same cwd finds the same shell, replayed", async () => {
    const dir = makeRepo("bridza-pty-a-");
    const a = await attach(dir);
    expect(await ask(a, "MARK=alpha; " + echo("one", "$MARK"), "one")).toBe("alpha");

    // output printed while nobody is attached still lands in the replay buffer
    a.type(`(sleep 0.3; ${echo("late", "$MARK")}) &\n`);
    await a.detach();
    await new Promise((r) => setTimeout(r, 900));

    const b = await attach(dir);
    await waitFor(() => b.text.includes("<late:alpha>"), "replayed background output");
    expect(b.text).toContain("<one:alpha>");                          // scrollback from before the detach
    expect(await ask(b, echo("two", "$MARK"), "two")).toBe("alpha");  // same process, same environment
  });

  it("an explicit kill drops the session — the next attach is a fresh shell", async () => {
    const dir = makeRepo("bridza-pty-b-");
    const a = await attach(dir);
    expect(await ask(a, "MARK=beta; " + echo("one", "$MARK"), "one")).toBe("beta");
    a.send({ t: "kill" });
    await a.detach();

    const b = await attach(dir);
    expect(await ask(b, echo("two", "${MARK:-none}"), "two")).toBe("none");
    expect(b.text).not.toContain("<one:beta>"); // nothing replayed: a new session's buffer is empty
  });

  it("a shell that exits reports its code and is not reattached to", async () => {
    const dir = makeRepo("bridza-pty-c-");
    const a = await attach(dir);
    expect(await ask(a, "MARK=gamma; " + echo("one", "$MARK"), "one")).toBe("gamma");
    a.type("exit 3\n");
    await waitFor(() => a.exit !== null, "exit frame");
    expect(a.exit).toBe(3);

    const b = await attach(dir);
    expect(await ask(b, echo("two", "${MARK:-none}"), "two")).toBe("none");
  });

  it("different cwds are different sessions", async () => {
    const one = makeRepo("bridza-pty-d1-"), two = makeRepo("bridza-pty-d2-");
    const a = await attach(one);
    expect(await ask(a, "MARK=delta; " + echo("one", "$MARK"), "one")).toBe("delta");
    const b = await attach(two);
    expect(await ask(b, echo("two", "${MARK:-none}"), "two")).toBe("none");
    // and neither killed the other
    expect(await ask(a, echo("three", "$MARK"), "three")).toBe("delta");
  });
});
