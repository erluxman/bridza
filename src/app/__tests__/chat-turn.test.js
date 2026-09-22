// chat-turn.test.js — the server half of the task chat. A chat turn is a unit of
// work (same agent, same worktree, same branch, its own commit) but it is NOT a
// stage: the contract these tests pin is that it never touches stage state. Run
// against real temp git repos with a stub tool (BRIDZA_TOOL_OVERRIDE), so the
// whole path — worktree, prompt, commit, thread.md, the one-live-run rule —
// executes without LLM cost.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { vi } from "vitest";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
import { runChatTurn, runStage, git, taskTimeline, listActiveRuns, stopRuns, chatRouting, taskWorktree } from "../../../server/bridza-run.js";
import { rel, CHAT_STAGE } from "../../../core/domain.js";

let root, wtBase;
const dirs = [];
const tmp = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), tag)); dirs.push(d); return d; };

function makeRepo() {
  const d = tmp("bridza-chat-");
  execFileSync("git", ["init", "-b", "main"], { cwd: d });
  fs.writeFileSync(path.join(d, "README.md"), "seed\n");
  execFileSync("git", ["add", "-A"], { cwd: d });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"], { cwd: d });
  return d;
}
const stub = (script) => { process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", script] }); };

const P = "eng", T = "task-1";
const chat = (body = {}) => {
  const events = [];
  return runChatTurn(root, { tool: "claude", pipeline: P, task: T, message: "make the header smaller", ...body }, (e) => events.push(e))
    .then((end) => ({ events, end }));
};
// a finished stage to talk "after" — the case the whole feature exists for
const seedStage = () => {
  stub('echo "wrote it"; mkdir -p .bridza/pipelines/eng/task-1/spec/outputs; echo spec > .bridza/pipelines/eng/task-1/spec/outputs/spec.md');
  return runStage(root, { tool: "claude", pipeline: P, task: T, stage: "spec", stageName: "Spec", taskTitle: "A task", prompt: "write it" }, () => { });
};
const meta = () => {
  const f = path.join(root, ".git", "..");   // read through the branch, not the checkout
  const txt = git(root, ["show", `bridza/${P}/${T}:` + rel.taskMeta(P, taskDir())]);
  return JSON.parse(txt);
};
const taskDir = () => {
  const ls = git(root, ["ls-tree", "--name-only", `bridza/${P}/${T}:.bridza/pipelines/${P}`]).trim().split("\n");
  return ls.find((x) => x.includes(T)) || T;
};
const thread = () => git(root, ["show", `bridza/${P}/${T}:` + rel.chatThread(P, taskDir())]);

beforeEach(() => {
  root = makeRepo();
  wtBase = tmp("bridza-wt-");
  process.env.BRIDZA_WORKTREE_DIR = wtBase;
});
afterEach(() => {
  delete process.env.BRIDZA_TOOL_OVERRIDE;
  delete process.env.BRIDZA_WORKTREE_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("a chat turn commits its own work", () => {
  it("lands one commit named for the turn, with the changed files", async () => {
    await seedStage();
    stub('echo "Made the header 13px."; echo "hdr" > header.txt');
    const { end } = await chat();
    expect(end.status).toBe("done");
    expect(end.exit).toBe(0);
    expect(end.resultCommit).toBeTruthy();
    expect(end.files).toContain("header.txt");

    const tl = taskTimeline(root, P, T);
    const top = tl.commits[0];
    expect(top.subject).toMatch(/^bridza\(eng\/task-1\/chat\): turn 1 · claude · exit 0 · \d+ files?$/);
    // the timeline names the turn, so the app can open that turn's diff
    expect(top.kind).toBe("chat");
    expect(top.turn).toBe(1);
  });

  it("records the turn in metadata and appends thread.md", async () => {
    await seedStage();
    stub('echo "Made the header 13px."; echo hdr > header.txt');
    await chat({ message: "make the header smaller" });
    const turns = meta().chat.turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ seq: 1, tool: "claude", message: "make the header smaller", status: "done", exit: 0 });
    expect(turns[0].answer).toMatch(/Made the header 13px/);
    expect(turns[0].files).toContain("header.txt");

    const t = thread();
    expect(t).toMatch(/# Chat —/);
    expect(t).toMatch(/## .+ · turn 1 · claude/);
    expect(t).toMatch(/\*\*You:\*\* make the header smaller/);
    expect(t).toMatch(/\*\*Agent:\*\* Made the header 13px\./);
  });

  it("keeps only the agent's prose as the answer — tool chatter is activity, not speech", async () => {
    await seedStage();
    stub('echo "· Read header.txt"; echo "I made it smaller."; echo "· done · 2 turns"');
    const { end } = await chat();
    expect(end.answer).toBe("I made it smaller.");
  });

  it("numbers turns in order across a conversation", async () => {
    await seedStage();
    stub('echo "one"; echo a > a.txt');
    await chat({ message: "first" });
    stub('echo "two"; echo b > b.txt');
    await chat({ message: "second" });
    const turns = meta().chat.turns;
    expect(turns.map((t) => [t.seq, t.message])).toEqual([[1, "first"], [2, "second"]]);
  });
});

describe("a chat turn is not a stage", () => {
  it("never writes tracking, meta.stages, outputs/ or prompts.md", async () => {
    await seedStage();
    const before = meta();
    stub('echo "done"; echo x > x.txt');
    await chat();
    const after = meta();
    expect(after.tracking).toEqual(before.tracking);
    expect(after.stages).toEqual(before.stages);
    expect(Object.keys(after.tracking)).not.toContain(CHAT_STAGE);
    expect(Object.keys(after.tracking)).not.toContain("chat");
    // the stage's own files are untouched by the turn
    const files = git(root, ["show", "--name-only", "--format=", `bridza/${P}/${T}`]).trim().split("\n");
    expect(files.some((f) => f.endsWith("/prompts.md"))).toBe(false);
    expect(files.some((f) => f.includes("/spec/outputs/"))).toBe(false);
  });

  it("leaves the stage's commit in place — it appends, never replaces", async () => {
    await seedStage();
    const stageSha = taskTimeline(root, P, T).commits[0].sha;
    stub('echo "ok"; echo x > x.txt');
    await chat();
    const tl = taskTimeline(root, P, T).commits;
    expect(tl).toHaveLength(2);
    expect(tl[1].sha).toBe(stageSha);          // the stage commit is still there…
    expect(tl[1].stage).toBe("spec");          // …still reading as the stage it was
  });
});

describe("one live run per task", () => {
  it("registers under the reserved __chat__ id while it runs", async () => {
    await seedStage();
    stub('sleep 0.4; echo "ok"');
    const p = chat();
    await new Promise((r) => setTimeout(r, 150));
    const live = listActiveRuns(root);
    expect(live.map((r) => r.stage)).toContain(CHAT_STAGE);
    await p;
    expect(listActiveRuns(root)).toHaveLength(0);
  });

  it("refuses a second turn while one is running, and a stage run says chat is the reason", async () => {
    await seedStage();
    stub('sleep 0.5; echo "ok"');
    const p = chat();
    await new Promise((r) => setTimeout(r, 150));

    const second = await chat({ message: "again" });
    expect(second.end.status).toBe("busy");
    expect(second.end.error).toMatch(/chat turn/);

    const stage = await runStage(root, { tool: "claude", pipeline: P, task: T, stage: "build", prompt: "go" }, () => { });
    expect(stage.status).toBe("busy");
    expect(stage.error).toMatch(/chat turn/);
    await p;
  });

  it("is stopped by the task's Stop, recorded stopped, and commits nothing", async () => {
    await seedStage();
    const commitsBefore = taskTimeline(root, P, T).commits.length;
    stub('echo hdr > header.txt; sleep 5');
    const p = chat();
    await new Promise((r) => setTimeout(r, 250));
    expect(stopRuns(root, P, T).ok).toBe(true);
    const { end } = await p;
    expect(end.status).toBe("stopped");
    expect(end.resultCommit).toBeNull();
    expect(taskTimeline(root, P, T).commits).toHaveLength(commitsBefore);
  });
});

describe("guards", () => {
  it("refuses an empty message", async () => {
    const { end } = await chat({ message: "   " });
    expect(end.error).toMatch(/type a message/);
  });

  it("refuses a finalized task with a reason a person can act on", async () => {
    await seedStage();
    // mark the task finalized on its branch, the way finalize does
    stub('echo ok');
    const wt = taskWorktree(root, P, T);
    const f = path.join(wt, rel.taskMeta(P, taskDir()));
    const m = JSON.parse(fs.readFileSync(f, "utf8"));
    m.finalized = true;
    fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
    execFileSync("git", ["add", "-A"], { cwd: wt });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "finalize"], { cwd: wt });

    const { end } = await chat();
    expect(end.status).toBe("finalized");
    expect(end.error).toMatch(/finalized/);
  });

  it("does not commit a failed turn", async () => {
    await seedStage();
    const before = taskTimeline(root, P, T).commits.length;
    stub('echo "half a file" > partial.txt; exit 3');
    const { end } = await chat();
    expect(end.status).toBe("failed");
    expect(end.exit).toBe(3);
    expect(end.resultCommit).toBeNull();
    expect(taskTimeline(root, P, T).commits).toHaveLength(before);
  });
});

describe("chatRouting — the agent a turn defaults to", () => {
  it("is the one the task last ran a stage with", async () => {
    await seedStage();
    expect(chatRouting(root, P, T).tool).toBe("claude");
  });

  it("then sticks to the agent the conversation itself used", async () => {
    await seedStage();
    stub('echo "ok"; echo x > x.txt');
    await chat({ tool: "opencode" });
    expect(chatRouting(root, P, T).tool).toBe("opencode");
  });
});
