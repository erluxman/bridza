// bridge.js — the Bridza project bridge, transport-agnostic.
//
// This is the single source of truth for the /api/bridza/* HTTP surface and the
// /api/bridza/pty WebSocket. It is consumed by TWO hosts:
//   • server/bridza-fs.js — a Vite dev-server plugin (browser dev)
//   • electron/main.js     — the packaged desktop app's local http server
//
// The bridge is stateless — the client owns which project is open. Endpoints
// all take ?dir=<folder>, falling back to $BRIDZA_REPO.
//
//   GET  /api/bridza/state        parsed project state (pipelines + tasks)
//   POST /api/bridza/pick-folder  native folder picker (macOS osascript)
//   POST /api/bridza/reveal       open a folder in the OS file manager
//   GET  /api/bridza/tools        available CLI tools (claude/opencode)
//   POST /api/bridza/pipeline     create a pipeline
//   POST /api/bridza/task         create a task (+ its branch)
//   POST /api/bridza/context      edit task/stage natural-language context
//   POST /api/bridza/run/stage    run a stage (ndjson timeline stream)
//   GET  /api/bridza/timeline     the task branch commit timeline
//   POST /api/bridza/finalize     merge a task branch into main
//   POST /api/bridza/conflict/*   open / finish / abort a paused conflict merge

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DATA_DIR, CLI_TOOLS, pipelineFlows } from "../core/domain.js";
import { readProject, createPipeline, savePipeline, archivePipeline, saveKanbanOrder, deletePipeline, createTask, deleteTask, readContext, saveContext, taskTime, mergeTime, addInbox, promoteInbox, discardInbox, readPlan, savePlan, assignRefs, readPipelineDef, setTaskArchived, createTag, updateTag, setTaskTags } from "./bridza-store.js";
import { runStage, automateTask, finalizeTask, finishConflict, abortConflict, openDir, conflictedFiles, taskTimeline, commitDiff, branchDiff, workingDiff, openWorktree, toolAvailable, listActiveRuns, stopRuns, blastRadius, reopenStage, retargetTask, setTaskReuse, setStageRouting, listModels, termRun, ensureTaskWorktree, recommendPipelines, readTaskFile, saveTaskFile, listBranches, createPR } from "./bridza-run.js";

function resolveDir(raw) {
  if (!raw) return null;
  const p = path.resolve(String(raw).replace(/^~(?=$|\/)/, process.env.HOME || "~"));
  let dir;
  try { dir = fs.statSync(p).isDirectory() ? p : null; } catch (e) { return null; }
  if (!dir) return null;
  // A Bridza project is the whole repo: resolve any subdir up to the git toplevel
  // so data (.bridza) and git (branch/worktree/merge) share one root.
  try { return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || dir; }
  catch (e) { return dir; }
}
function repoRoot(dirParam) { return resolveDir(dirParam) || resolveDir(process.env.BRIDZA_REPO); }

function pickFolder() {
  if (process.platform === "darwin") {
    try {
      // route the dialog through System Events and activate it first — a bare
      // `choose folder` from a background process opens BEHIND every window
      // (or is refused with -1713 when the process has no GUI session).
      const out = execFileSync("osascript",
        ["-e", 'tell application "System Events"\nactivate\nset f to POSIX path of (choose folder with prompt "Open project folder — Bridza")\nend tell\nf'],
        { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
      return { path: out.trim().replace(/\/$/, "") };
    } catch (e) {
      const msg = String((e && e.stderr) || (e && e.message) || e);
      if (msg.includes("-128")) return { canceled: true };   // the user hit Cancel — stay silent
      return { canceled: true, error: "couldn't open the folder picker (" + (msg.split("\n").find((l) => l.trim()) || "unknown error").trim() + ") — paste the path instead" };
    }
  }
  if (process.platform === "linux") {
    // zenity (GTK) or kdialog (Qt) — both exit 1 on Cancel, ENOENT when absent.
    const pickers = [
      ["zenity", ["--file-selection", "--directory", "--title", "Open project folder — Bridza"]],
      ["kdialog", ["--getexistingdirectory", process.env.HOME || ".", "--title", "Open project folder — Bridza"]],
    ];
    for (const [bin, args] of pickers) {
      try {
        const out = execFileSync(bin, args, { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
        return { path: out.trim().replace(/\/$/, "") };
      } catch (e) {
        if (e && e.code === "ENOENT") continue;              // not installed — try the next one
        return { canceled: true };                            // nonzero exit = the user hit Cancel
      }
    }
    return { canceled: true, error: "no folder picker found (install zenity or kdialog) — paste the path instead" };
  }
  // win32: the Electron host overrides this with a native dialog (see
  // electron/main.js). In the browser dev host there is no native picker.
  return { canceled: true, error: "no native picker on this platform — type a path instead" };
}

function revealInFinder(raw) {
  const dir = resolveDir(raw);
  if (!dir) return { ok: false, error: "no such folder" };
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try { execFileSync(cmd, [dir], { timeout: 10000 }); return { ok: true, path: dir }; }
  catch (e) {
    if (process.platform === "win32") return { ok: true, path: dir };
    return { ok: false, error: String((e && e.message) || e).split("\n")[0] };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => { buf += c; });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}
async function json(req) { try { return JSON.parse(await readBody(req)); } catch (e) { return null; } }

// A host may override the native folder picker (Electron supplies a real dialog
// on every platform, including Windows where the shell has none).
let pickFolderImpl = pickFolder;
export function setPickFolder(fn) { pickFolderImpl = fn || pickFolder; }

// ── interactive PTY over WebSocket ───────────────────────────────────────────
// A REAL shell (your $SHELL, zsh/bash) in the browser via xterm.js. cwd = the
// task's worktree when pipeline+task are given, else the repo root. node-pty +
// ws load lazily so plain builds never touch the native module.
const SESSIONS = new Map(); // cwd -> { pty, buffer, ws, timer, shell }
const REAP_TIMEOUT = 30 * 60 * 1000;
const MAX_BUFFER = 256 * 1024;

let wssP = null;
const getWss = () => wssP || (wssP = import("ws").then(({ WebSocketServer }) => new WebSocketServer({ noServer: true })));

// Attach to an http.Server "upgrade" event. Returns without acting for URLs it
// doesn't own, so a Vite host's HMR upgrade still works.
export async function handleUpgrade(req, socket, head) {
  if (!req.url || !req.url.startsWith("/api/bridza/pty")) return;
  try {
    const wss = await getWss();
    wss.handleUpgrade(req, socket, head, async (ws) => {
      // The client speaks (its opening `resize`, then keystrokes) as soon as
      // the socket opens, but the first attach still has to resolve the
      // worktree and load node-pty — and a `message` with no listener is
      // dropped. So listen right away and queue until there is a PTY to feed.
      let cwd = null, sess = null, closed = false;
      const pending = [];
      const apply = (m) => {
        if (m.t === "in" && typeof m.d === "string") sess.pty.write(m.d);
        else if (m.t === "resize" && m.cols > 1 && m.rows > 1) sess.pty.resize(m.cols | 0, m.rows | 0);
        else if (m.t === "kill") { try { sess.pty.kill(); } catch (e) {} SESSIONS.delete(cwd); }
      };
      // Detach: the shell keeps running, minus a viewer, until reattached or reaped.
      const detach = () => {
        if (sess.ws !== ws) return;             // already taken over by a newer client
        sess.ws = null;
        if (SESSIONS.get(cwd) !== sess) return; // killed, or exited on its own — nothing left to reap
        sess.timer = setTimeout(() => {
          if (SESSIONS.get(cwd) === sess && !sess.ws) {
            try { sess.pty.kill(); } catch (e) {}
            SESSIONS.delete(cwd);
          }
        }, REAP_TIMEOUT);
      };
      ws.on("message", (buf) => {
        try {
          const m = JSON.parse(String(buf));
          if (sess) apply(m); else pending.push(m);
        } catch (e) { /* ignore malformed frames */ }
      });
      ws.on("close", () => { closed = true; if (sess) detach(); });

      const url = new URL(req.url, "http://localhost");
      const root = repoRoot(url.searchParams.get("dir"));
      if (!root) return void ws.close(1008, "no project folder");
      cwd = root;
      const pl = url.searchParams.get("pipeline"), tk = url.searchParams.get("task");
      if (pl && tk) {
        const wt = ensureTaskWorktree(root, pl, tk);
        if (wt.ok) cwd = wt.worktree;
      }

      sess = SESSIONS.get(cwd);
      if (sess) {
        clearTimeout(sess.timer);
        if (sess.ws && sess.ws.readyState === 1) sess.ws.close();
        sess.ws = ws;
        ws.send(JSON.stringify({ t: "cwd", d: cwd, shell: sess.shell }));
        if (sess.buffer.length > 0) ws.send(JSON.stringify({ t: "out", d: sess.buffer }));
      } else {
        let ptyMod;
        try { ptyMod = await import("node-pty"); }
        catch (e) { ws.send(JSON.stringify({ t: "err", d: "node-pty isn't installed — run `pnpm install` and reload" })); return void ws.close(); }
        const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
        let p;
        try {
          const args = process.platform === "win32" ? [] : ["-l"];
          p = ptyMod.spawn(shell, args, { name: "xterm-256color", cols: 80, rows: 24, cwd, env: { ...process.env, PWD: cwd } });
        } catch (e) { ws.send(JSON.stringify({ t: "err", d: "couldn't spawn " + shell + ": " + String((e && e.message) || e) })); return void ws.close(); }
        sess = { pty: p, buffer: "", ws, timer: null, shell };
        SESSIONS.set(cwd, sess);
        ws.send(JSON.stringify({ t: "cwd", d: cwd, shell }));
        p.onData((d) => {
          sess.buffer = (sess.buffer + d).slice(-MAX_BUFFER);
          if (sess.ws && sess.ws.readyState === 1) sess.ws.send(JSON.stringify({ t: "out", d }));
        });
        p.onExit(({ exitCode }) => {
          if (sess.ws && sess.ws.readyState === 1) { sess.ws.send(JSON.stringify({ t: "exit", code: exitCode })); sess.ws.close(); }
          SESSIONS.delete(cwd);
        });
      }

      for (const m of pending.splice(0)) apply(m);
      if (closed) detach(); // client gave up while we were spawning
    });
  } catch (e) { socket.destroy(); }
}

// Handle an /api/bridza/* request. Returns true when it owned the request,
// false when the URL isn't ours (the host should fall through to next()).
export async function handleApi(req, res) {
  if (!req.url || !req.url.startsWith("/api/bridza/")) return false;
  const url = new URL(req.url, "http://localhost");
  const root = repoRoot(url.searchParams.get("dir"));
  const need = () => { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "no project folder" })); };
  res.setHeader("Content-Type", "application/json");
  const P = url.pathname, M = req.method;
  try {
    if (M === "GET" && P === "/api/bridza/state") {
      if (!root) return void res.end(JSON.stringify({ available: false })), true;
      const proj = readProject(root);
      // self-heal #refs: tasks that arrived without a number (older projects,
      // agent-created tasks on branches) get one now.
      const missing = proj.pipelines.flatMap((p) => p.tasks.filter((t) => !t.ref).map((t) => ({ t, key: p.id + "/" + t.id })));
      if (missing.length) {
        const refs = assignRefs(root, missing.map((m) => m.key));
        missing.forEach((m) => { m.t.ref = refs[m.key] || null; });
      }
      res.end(JSON.stringify({ available: true, repo: root, dataDir: path.join(root, DATA_DIR), running: listActiveRuns(), ...proj }));
      return true;
    }
    if (M === "POST" && P === "/api/bridza/recommend-pipelines") {
      const b = (await json(req)) || {};
      const desc = String(b.description || "").trim().slice(0, 5000);
      if (!desc) { res.end(JSON.stringify({ ok: false, error: "description is required" })); return true; }
      res.end(JSON.stringify({ ok: true, recommendations: recommendPipelines(desc) })); return true;
    }
    if (M === "POST" && P === "/api/bridza/pick-folder") { res.end(JSON.stringify(await pickFolderImpl())); return true; }
    if (M === "POST" && P === "/api/bridza/reveal") { res.end(JSON.stringify(revealInFinder((await json(req) || {}).path))); return true; }
    if (M === "GET" && P === "/api/bridza/tools") {
      const override = !!process.env.BRIDZA_TOOL_OVERRIDE;
      res.end(JSON.stringify({ tools: CLI_TOOLS.map((t) => ({ id: t.id, label: t.label, available: override || toolAvailable(t.bin), stub: override })) })); return true;
    }
    if (M === "GET" && P === "/api/bridza/branches") {
      if (!root) return void need(), true;
      res.end(JSON.stringify({ ok: true, branches: listBranches(root) })); return true;
    }
    if (M === "POST" && P === "/api/bridza/pipeline") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(createPipeline(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/pipeline/save") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(savePipeline(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/pipeline/archive") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(archivePipeline(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/pipeline/kanban-order") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(saveKanbanOrder(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/pipeline/delete") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(deletePipeline(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/task") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(createTask(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/task/delete") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(deleteTask(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/task/retarget") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      let flow, flowName, stages;
      if (b.flow) {
        const fl = pipelineFlows(readPipelineDef(root, b.pipeline)).find((f) => f.id === b.flow);
        if (!fl) { res.end(JSON.stringify({ ok: false, error: "unknown flow " + b.flow })); return true; }
        flow = fl.id; flowName = fl.name; stages = fl.stages.map((s) => s.id);
      }
      res.end(JSON.stringify(retargetTask(root, b.pipeline, b.task, { flow, flowName, stages, type: b.type, target: b.target }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/task/reuse") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(setTaskReuse(root, b.pipeline, b.task, !!b.on))); return true;
    }
    if (M === "POST" && P === "/api/bridza/task/routing") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(setStageRouting(root, b.pipeline, b.task, b.stage, { tool: b.tool, model: b.model }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/task/archive") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(setTaskArchived(root, b.pipeline, b.task, !!b.archived))); return true;
    }
    if (M === "POST" && P === "/api/bridza/tag/create") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(createTag(root, { name: b.name, color: b.color }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/tag/update") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(updateTag(root, { id: b.id, color: b.color }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/task/tags") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(setTaskTags(root, b.pipeline, b.task, b.tags))); return true;
    }
    if (M === "POST" && P === "/api/bridza/run/stop") {
      const b = (await json(req)) || {};
      res.end(JSON.stringify(stopRuns(b.pipeline, b.task, b.stage))); return true;
    }
    if (M === "GET" && P === "/api/bridza/context") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(readContext(root, {
        pipeline: url.searchParams.get("pipeline"), task: url.searchParams.get("task"), stage: url.searchParams.get("stage") || "",
      }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/context") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(saveContext(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/inbox") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(addInbox(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/inbox/promote") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(promoteInbox(root, (await json(req)) || {}))); return true;
    }
    if (M === "POST" && P === "/api/bridza/inbox/discard") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(discardInbox(root, ((await json(req)) || {}).id))); return true;
    }
    if (M === "GET" && P === "/api/bridza/models") {
      res.end(JSON.stringify({ ok: true, models: listModels(url.searchParams.get("tool")) })); return true;
    }
    if (M === "GET" && P === "/api/bridza/plan") {
      if (!root) return void need(), true;
      res.end(JSON.stringify({ ok: true, plan: readPlan(root) })); return true;
    }
    if (M === "POST" && P === "/api/bridza/plan") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(savePlan(root, (await json(req)) || {}))); return true;
    }
    if (M === "GET" && P === "/api/bridza/timeline") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(taskTimeline(root, url.searchParams.get("pipeline"), url.searchParams.get("task")))); return true;
    }
    if (M === "GET" && P === "/api/bridza/diff") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(commitDiff(root, url.searchParams.get("commit")))); return true;
    }
    if (M === "GET" && P === "/api/bridza/blast") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(blastRadius(root, url.searchParams.get("pipeline"), url.searchParams.get("task")))); return true;
    }
    if (M === "GET" && P === "/api/bridza/branch-diff") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(branchDiff(root, url.searchParams.get("pipeline"), url.searchParams.get("task")))); return true;
    }
    if (M === "GET" && P === "/api/bridza/working-diff") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(workingDiff(root))); return true;
    }
    if (M === "GET" && P === "/api/bridza/file") {
      if (!root) return void need(), true;
      res.end(JSON.stringify(readTaskFile(root, { pipeline: url.searchParams.get("pipeline"), task: url.searchParams.get("task"), path: url.searchParams.get("path") }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/file/save") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(saveTaskFile(root, b))); return true;
    }
    if (M === "GET" && P === "/api/bridza/time") {
      if (!root) return void need(), true;
      res.end(JSON.stringify({ ok: true, time: taskTime(root, url.searchParams.get("pipeline"), url.searchParams.get("task")) })); return true;
    }
    if (M === "POST" && P === "/api/bridza/time") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(mergeTime(root, b.pipeline, b.task, b.time))); return true;
    }
    if (M === "POST" && P === "/api/bridza/open") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(openWorktree(root, b.pipeline, b.task, { workingDir: b.workingDir }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/stage/reopen") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(reopenStage(root, b.pipeline, b.task, b.stage))); return true;
    }
    if (M === "POST" && P === "/api/bridza/finalize") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(finalizeTask(root, b.pipeline, b.task, { style: b.style, into: b.into, resolveMain: b.resolveMain, mainCommitMessage: b.mainCommitMessage }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/pr") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(createPR(root, b.pipeline, b.task, b.target))); return true;
    }
    if (M === "POST" && P === "/api/bridza/conflict/open") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      if (!b.dir) { res.end(JSON.stringify({ ok: false, error: "no directory given" })); return true; }
      // open the conflicted files as tabs too, so the editor shows the Accept
      // Current / Incoming / Both CodeLens right on the markers
      res.end(JSON.stringify(openDir(b.dir, conflictedFiles(b.dir)))); return true;
    }
    if (M === "POST" && P === "/api/bridza/conflict/finish") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(finishConflict(root, { dir: b.dir, pipeline: b.pipeline, task: b.task, target: b.target, message: b.message }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/conflict/abort") {
      if (!root) return void need(), true;
      const b = (await json(req)) || {};
      res.end(JSON.stringify(abortConflict(root, { dir: b.dir }))); return true;
    }
    if (M === "POST" && P === "/api/bridza/run/stage") {
      if (!root) return void need(), true;
      const body = (await json(req)) || {};
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      await runStage(root, body, (obj) => res.write(JSON.stringify(obj) + "\n"));
      res.end(); return true;
    }
    if (M === "POST" && P === "/api/bridza/automate") {
      if (!root) return void need(), true;
      const body = (await json(req)) || {};
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      await automateTask(root, body, (obj) => res.write(JSON.stringify(obj) + "\n"));
      res.end(); return true;
    }
    if (M === "POST" && P === "/api/bridza/term/run") {
      if (!root) return void need(), true;
      const body = (await json(req)) || {};
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      const h = termRun(root, body, (obj) => { try { res.write(JSON.stringify(obj) + "\n"); } catch (e) { /* client gone */ } });
      // ⌃C / closing the panel aborts the fetch. NOTE: req's "close" fires when
      // the request BODY ends (long before any abort) — the RESPONSE's "close"
      // is what fires when the connection drops mid-stream.
      res.on("close", h.kill);
      await h.done;
      res.end(); return true;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "unknown endpoint" }));
    return true;
  } catch (e) {
    console.error("[bridza]", e);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
}
