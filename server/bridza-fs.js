// bridza-fs.js — Vite dev-server plugin: the project file bridge.
//
// Bridza is a local client for any folder/repo (ADR-0002): open a folder, and
// if it has (or gets) a `.bridza/` that data is loaded and edited (ADR-0001).
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

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DATA_DIR, CLI_TOOLS } from "../src/app/store/bridza.js";
import { readProject, createPipeline, savePipeline, createTask, saveContext, taskTime, mergeTime, addInbox, promoteInbox, discardInbox, readPlan, savePlan } from "./bridza-store.js";
import { runStage, automateTask, finalizeTask, taskTimeline, commitDiff, branchDiff, workingDiff, openWorktree, toolAvailable, listActiveRuns, blastRadius, reopenStage, listModels, termRun } from "./bridza-run.js";

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
  if (process.platform !== "darwin") return { canceled: true, error: "picker only on macOS — type a path instead" };
  try {
    // route the dialog through System Events and activate it first — a bare
    // `choose folder` from a background dev-server process opens BEHIND every
    // window (or is refused with -1713 when the process has no GUI session).
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

export default function bridzaFs() {
  return {
    name: "bridza-fs",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/bridza/")) return next();
        const url = new URL(req.url, "http://localhost");
        const root = repoRoot(url.searchParams.get("dir"));
        const need = () => { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "no project folder" })); };
        res.setHeader("Content-Type", "application/json");
        const P = url.pathname, M = req.method;
        try {
          if (M === "GET" && P === "/api/bridza/state") {
            if (!root) return void res.end(JSON.stringify({ available: false }));
            return void res.end(JSON.stringify({ available: true, repo: root, dataDir: path.join(root, DATA_DIR), running: listActiveRuns(), ...readProject(root) }));
          }
          if (M === "POST" && P === "/api/bridza/pick-folder") return void res.end(JSON.stringify(pickFolder()));
          if (M === "POST" && P === "/api/bridza/reveal") return void res.end(JSON.stringify(revealInFinder((await json(req) || {}).path)));
          if (M === "GET" && P === "/api/bridza/tools") {
            const override = !!process.env.BRIDZA_TOOL_OVERRIDE;
            return void res.end(JSON.stringify({ tools: CLI_TOOLS.map((t) => ({ id: t.id, label: t.label, available: override || toolAvailable(t.bin), stub: override })) }));
          }
          if (M === "POST" && P === "/api/bridza/pipeline") {
            if (!root) return need();
            return void res.end(JSON.stringify(createPipeline(root, (await json(req)) || {})));
          }
          if (M === "POST" && P === "/api/bridza/pipeline/save") {
            if (!root) return need();
            return void res.end(JSON.stringify(savePipeline(root, (await json(req)) || {})));
          }
          if (M === "POST" && P === "/api/bridza/task") {
            if (!root) return need();
            return void res.end(JSON.stringify(createTask(root, (await json(req)) || {})));
          }
          if (M === "POST" && P === "/api/bridza/context") {
            if (!root) return need();
            return void res.end(JSON.stringify(saveContext(root, (await json(req)) || {})));
          }
          if (M === "POST" && P === "/api/bridza/inbox") {
            if (!root) return need();
            return void res.end(JSON.stringify(addInbox(root, (await json(req)) || {})));
          }
          if (M === "POST" && P === "/api/bridza/inbox/promote") {
            if (!root) return need();
            return void res.end(JSON.stringify(promoteInbox(root, (await json(req)) || {})));
          }
          if (M === "POST" && P === "/api/bridza/inbox/discard") {
            if (!root) return need();
            return void res.end(JSON.stringify(discardInbox(root, ((await json(req)) || {}).id)));
          }
          if (M === "GET" && P === "/api/bridza/models") {
            return void res.end(JSON.stringify({ ok: true, models: listModels(url.searchParams.get("tool")) }));
          }
          if (M === "GET" && P === "/api/bridza/plan") {
            if (!root) return need();
            return void res.end(JSON.stringify({ ok: true, plan: readPlan(root) }));
          }
          if (M === "POST" && P === "/api/bridza/plan") {
            if (!root) return need();
            return void res.end(JSON.stringify(savePlan(root, (await json(req)) || {})));
          }
          if (M === "GET" && P === "/api/bridza/timeline") {
            if (!root) return need();
            return void res.end(JSON.stringify(taskTimeline(root, url.searchParams.get("pipeline"), url.searchParams.get("task"))));
          }
          if (M === "GET" && P === "/api/bridza/diff") {
            if (!root) return need();
            return void res.end(JSON.stringify(commitDiff(root, url.searchParams.get("commit"))));
          }
          if (M === "GET" && P === "/api/bridza/blast") {
            if (!root) return need();
            return void res.end(JSON.stringify(blastRadius(root, url.searchParams.get("pipeline"), url.searchParams.get("task"))));
          }
          if (M === "GET" && P === "/api/bridza/branch-diff") {
            if (!root) return need();
            return void res.end(JSON.stringify(branchDiff(root, url.searchParams.get("pipeline"), url.searchParams.get("task"))));
          }
          if (M === "GET" && P === "/api/bridza/working-diff") {
            if (!root) return need();
            return void res.end(JSON.stringify(workingDiff(root)));
          }
          if (M === "GET" && P === "/api/bridza/time") {
            if (!root) return need();
            return void res.end(JSON.stringify({ ok: true, time: taskTime(root, url.searchParams.get("pipeline"), url.searchParams.get("task")) }));
          }
          if (M === "POST" && P === "/api/bridza/time") {
            if (!root) return need();
            const b = (await json(req)) || {};
            return void res.end(JSON.stringify(mergeTime(root, b.pipeline, b.task, b.time)));
          }
          if (M === "POST" && P === "/api/bridza/open") {
            if (!root) return need();
            const b = (await json(req)) || {};
            return void res.end(JSON.stringify(openWorktree(root, b.pipeline, b.task, { workingDir: b.workingDir })));
          }
          if (M === "POST" && P === "/api/bridza/stage/reopen") {
            if (!root) return need();
            const b = (await json(req)) || {};
            return void res.end(JSON.stringify(reopenStage(root, b.pipeline, b.task, b.stage)));
          }
          if (M === "POST" && P === "/api/bridza/finalize") {
            if (!root) return need();
            const b = (await json(req)) || {};
            return void res.end(JSON.stringify(finalizeTask(root, b.pipeline, b.task, { style: b.style, into: b.into, resolveMain: b.resolveMain, mainCommitMessage: b.mainCommitMessage })));
          }
          if (M === "POST" && P === "/api/bridza/run/stage") {
            if (!root) return need();
            const body = (await json(req)) || {};
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Cache-Control", "no-cache");
            await runStage(root, body, (obj) => res.write(JSON.stringify(obj) + "\n"));
            return void res.end();
          }
          if (M === "POST" && P === "/api/bridza/automate") {
            if (!root) return need();
            const body = (await json(req)) || {};
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Cache-Control", "no-cache");
            await automateTask(root, body, (obj) => res.write(JSON.stringify(obj) + "\n"));
            return void res.end();
          }
          if (M === "POST" && P === "/api/bridza/term/run") {
            if (!root) return need();
            const body = (await json(req)) || {};
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Cache-Control", "no-cache");
            const h = termRun(root, body, (obj) => { try { res.write(JSON.stringify(obj) + "\n"); } catch (e) { /* client gone */ } });
            // ⌃C / closing the panel aborts the fetch. NOTE: req's "close" fires
            // when the request BODY ends (long before any abort) — the RESPONSE's
            // "close" is what fires when the connection drops mid-stream.
            res.on("close", h.kill);
            await h.done;
            return void res.end();
          }
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, error: "unknown endpoint" }));
        } catch (e) {
          console.error("[bridza]", e);
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
        }
      });
    },
  };
}
