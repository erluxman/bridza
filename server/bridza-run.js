// bridza-run.js — node-side core of real stage execution: the Bridza git model
// (one branch + one worktree per task), the prompt→result commit timeline, CLI
// tool resolution, the stage runner, and task finalize/merge. Extracted from
// the HTTP bridge so vitest can exercise the whole pipeline against temp repos
// with a stub tool (BRIDZA_TOOL_OVERRIDE).
//
// Worktrees live OUTSIDE the repo (a per-repo cache dir, overridable via
// BRIDZA_WORKTREE_DIR), optionally sparse-checked-out to the pipeline's
// workingDir, so many tasks run and build in parallel with full isolation and
// the user's working tree / HEAD are never touched.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { DATA_DIR, taskBranchName, rel, safeRef, CLI_TOOLS } from "../src/app/store/bridza.js";

export { DATA_DIR, taskBranchName };

const firstLine = (e) => String((e && e.message) || e).split("\n")[0];
const nowISO = () => new Date().toISOString();

// ── git plumbing ────────────────────────────────────────────────────────────

export function git(root, args, opts = {}) {
  // stdio pipe keeps expected failures (rev-parse probes) off the console
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
}
export function isGitRepo(root) { try { git(root, ["rev-parse", "--git-dir"]); return true; } catch (e) { return false; } }
export function hasCommits(root) { try { git(root, ["rev-parse", "--verify", "HEAD"]); return true; } catch (e) { return false; } }
export function branchExists(root, name) {
  try { git(root, ["rev-parse", "--verify", "--quiet", "refs/heads/" + name]); return true; } catch (e) { return false; }
}
export function currentBranch(root) {
  try { return git(root, ["branch", "--show-current"]).trim(); } catch (e) { return ""; }
}
export function isClean(root) {
  try { return git(root, ["status", "--porcelain"]).trim() === ""; } catch (e) { return false; }
}
// The branch new task branches fork from: prefer main/master, else current HEAD.
export function baseBranchName(root) {
  for (const b of ["main", "master"]) if (branchExists(root, b)) return b;
  return currentBranch(root) || "HEAD";
}

export function validRef(ref, label = "ref") {
  if (!ref || typeof ref !== "string" || !ref.trim()) return "missing " + label;
  if (safeRef(ref) === "x" && ref.trim().toLowerCase() !== "x") return label + " needs at least one letter or digit (got " + JSON.stringify(ref) + ")";
  return null;
}

// ── worktree location (beside the repo) ─────────────────────────────────────

// Worktrees live as a VISIBLE sibling of the repo — <repo>.bridza-tasks/<pipeline>/<task>
// — so the task branch is browseable and runnable, not buried in a cache dir.
// BRIDZA_WORKTREE_DIR overrides the base wholesale (tests point it at a temp dir).
export function worktreeBase(root) {
  if (process.env.BRIDZA_WORKTREE_DIR) return process.env.BRIDZA_WORKTREE_DIR;
  const abs = path.resolve(root);
  return path.join(path.dirname(abs), path.basename(abs) + ".bridza-tasks");
}
export function taskWorktree(root, pipeline, task) {
  return path.join(worktreeBase(root), safeRef(pipeline), safeRef(task));
}

// ── task branch + worktree lifecycle ────────────────────────────────────────

export function ensureTaskBranch(root, pipeline, task) {
  const bad = validRef(pipeline, "pipeline") || validRef(task, "task");
  if (bad) return { ok: false, error: bad };
  if (!isGitRepo(root)) return { ok: false, error: "not a git repository" };
  if (!hasCommits(root)) return { ok: false, error: "repo has no commits yet — make an initial commit first" };
  const branch = taskBranchName(pipeline, task);
  try {
    if (!branchExists(root, branch)) git(root, ["branch", branch, baseBranchName(root)]);
  } catch (e) {
    return { ok: false, error: "git rejected branch " + branch + ": " + firstLine(e) };
  }
  return { ok: true, branch };
}

// One worktree per task, a FULL checkout of the task branch — so the branch is
// independently runnable (the user debugs the program in this worktree in
// parallel with other tasks, then merges). workingDir is kept for prompt/output
// scoping only; it no longer sparse-limits the checkout.
export function ensureTaskWorktree(root, pipeline, task, { workingDir = "." } = {}) {
  const t = ensureTaskBranch(root, pipeline, task);
  if (!t.ok) return t;
  const wt = taskWorktree(root, pipeline, task);
  if (!fs.existsSync(path.join(wt, ".git"))) {
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    try { git(root, ["worktree", "prune"]); } catch (e) { /* fine */ }
    git(root, ["worktree", "add", wt, t.branch]);
  } else {
    // un-sparse any worktree created by an older (sparse) version, so the whole
    // tree — every change on the branch — is materialised and runnable.
    try { if (git(wt, ["sparse-checkout", "list"]).trim()) git(wt, ["sparse-checkout", "disable"]); } catch (e) { /* not sparse */ }
  }
  return { ok: true, branch: t.branch, worktree: wt };
}

export function removeTaskWorktree(root, pipeline, task) {
  const wt = taskWorktree(root, pipeline, task);
  const removed = [];
  if (fs.existsSync(wt)) {
    try { git(root, ["worktree", "remove", "--force", wt]); }
    catch (e) { fs.rmSync(wt, { recursive: true, force: true }); }
    removed.push(wt);
  }
  try { git(root, ["worktree", "prune"]); } catch (e) { /* not a repo */ }
  return { ok: true, removed };
}

// Open the task's branch in a new VS Code window. The branch is checked out in
// its worktree (outside the repo); ensure it exists, then launch `code -n` on
// it. Falls back to the macOS app, then to a clear "install the code CLI" error.
export function openWorktree(root, pipeline, task, { workingDir = "." } = {}) {
  const wt = ensureTaskWorktree(root, pipeline, task, { workingDir });
  if (!wt.ok) return wt;
  // refresh the human-readable dashboard from current metadata so opening the
  // worktree always shows up-to-date time/prompts — even for tasks whose runs
  // predate the README feature.
  try {
    const meta = readTaskMeta(wt.worktree, pipeline, task);
    const rp = rel.task(pipeline, task) + "/README.md";
    fs.writeFileSync(path.join(wt.worktree, rp), renderTaskReadme(meta));
    git(wt.worktree, ["add", "--", rp]);
    if (git(wt.worktree, ["diff", "--cached", "--name-only"]).trim())
      git(wt.worktree, ["-c", "user.name=bridza", "-c", "user.email=bridza@local", "commit", "-m", `bridza: refresh ${safeRef(pipeline)}/${safeRef(task)} README`]);
  } catch (e) { /* best-effort */ }
  // open the worktree AND surface the README dashboard in a tab, so the data is
  // visible even if the editor's file tree hasn't refreshed.
  const readmeAbs = path.join(wt.worktree, rel.task(pipeline, task), "README.md");
  const readmeArgs = fs.existsSync(readmeAbs) ? [readmeAbs] : [];
  const tries = [
    ["code", ["-n", wt.worktree, ...readmeArgs]],
    ["open", ["-na", "Visual Studio Code", "--args", "-n", wt.worktree, ...readmeArgs]],
  ];
  for (const [bin, args] of tries) {
    try { execFileSync(bin, args, { timeout: 15000, stdio: "ignore" }); return { ok: true, worktree: wt.worktree, branch: wt.branch }; }
    catch (e) { /* try next */ }
  }
  return { ok: false, error: "couldn't launch VS Code — install the 'code' CLI (VS Code → Cmd+Shift+P → \"Shell Command: Install 'code' command in PATH\")", worktree: wt.worktree };
}

// ── task metadata (the per-task tracking store, lives on the task branch) ─────

function readTaskMeta(wtOrRoot, pipeline, task) {
  const f = path.join(wtOrRoot, rel.taskMeta(pipeline, task));
  if (!fs.existsSync(f)) return { v: 1, pipeline: safeRef(pipeline), task: safeRef(task), tracking: {} };
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!j.tracking || typeof j.tracking !== "object") j.tracking = {};
    return j;
  } catch (e) { return { v: 1, pipeline: safeRef(pipeline), task: safeRef(task), tracking: {} }; }
}
function writeTaskMeta(wtOrRoot, pipeline, task, meta) {
  const f = path.join(wtOrRoot, rel.taskMeta(pipeline, task));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(meta, null, 2) + "\n");
}

// A human-readable mirror of the task metadata, written next to it so the data
// is browsable in any editor (not buried in JSON).
// The task's worktree README — the human story of the task, opened in VS Code.
// Synthesized from a 10-UX-expert pass: one entry file (not many), a progress
// bar + at-a-glance table, then a per-stage Asked→Output narrative with the
// opencode session id. Machine detail (runs[], hashes) stays in metadata.json.
function fmtSecs(sec) { sec = Math.round(Number(sec) || 0); if (!sec) return "—"; const m = Math.floor(sec / 60), s = sec % 60; return m ? `${m}m ${s}s` : `${s}s`; }
const STAGE_GLYPH = { done: "✅", running: "🔄", failed: "❌", idle: "⏳" };
const glyph = (s) => STAGE_GLYPH[s] || "⏳";
function renderTaskReadme(meta) {
  const tracking = meta.tracking || {};
  const id = meta.id || meta.task || "task";
  const branch = meta.branch || (meta.pipeline && (meta.task || meta.id) ? "bridza/" + meta.pipeline + "/" + (meta.task || meta.id) : "");
  // union of declared stages and any stage that has tracking, so the story
  // shows everything that ran even if the metadata's `stages` list is stale.
  const stageIds = [...new Set([...(meta.stages || []), ...Object.keys(tracking)])];
  const st = (sid) => tracking[sid] || {};
  const done = stageIds.filter((s) => st(s).status === "done").length;
  const totalSec = stageIds.reduce((a, s) => a + (st(s).seconds || 0), 0);
  const allDone = stageIds.length > 0 && done === stageIds.length;
  const filled = stageIds.length ? Math.round((done / stageIds.length) * 16) : 0;
  const bar = "█".repeat(filled) + "░".repeat(16 - filled);
  const overall = meta.finalized ? "✨ finalized → main" : (allDone ? "🎉 all stages done" : (meta.status || "in-progress"));
  const titleGlyph = meta.finalized ? "✨" : (allDone ? "✅" : (stageIds.some((s) => st(s).status === "running") ? "🔄" : "⏳"));

  const L = [
    `# ${titleGlyph} ${meta.title || id}`,
    "",
    `\`${branch}\`${meta.pipeline ? "  ·  pipeline `" + meta.pipeline + "`" : ""}`,
    "",
    `\`${bar}\`  **${done}/${stageIds.length}** stages  ·  ${fmtSecs(totalSec)} tracked  ·  ${overall}`,
    "",
    "## At a glance",
    "",
    "| # | Stage | Status | Time | Output | Runs |",
    "|--:|-------|--------|------|--------|-----:|",
  ];
  stageIds.forEach((sid, i) => {
    const tr = st(sid);
    const runs = tr.runs || [];
    const nFiles = ((runs[runs.length - 1] || {}).files || []).length;
    L.push(`| ${i + 1} | ${sid} | ${glyph(tr.status)} ${tr.status || "idle"} | ${fmtSecs(tr.seconds)} | ${nFiles ? nFiles + " file" + (nFiles === 1 ? "" : "s") : "—"} | ${runs.length || "—"} |`);
  });

  L.push("", "## The story", "");
  stageIds.forEach((sid, i) => {
    const tr = st(sid);
    const runs = tr.runs || [];
    const last = runs[runs.length - 1] || {};
    L.push(`### ${i + 1}. ${sid} — ${glyph(tr.status)} ${tr.status || "idle"}${tr.seconds ? " · " + fmtSecs(tr.seconds) : ""}${runs.length > 1 ? " · " + runs.length + " runs" : ""}`);
    if (!runs.length) { L.push("", "_not run yet_", ""); return; }
    if (last.prompt) L.push("", "**Asked** — " + last.prompt.replace(/\s+/g, " ").trim().slice(0, 300));
    if (last.files && last.files.length) L.push("", "**Output** — " + last.files.map((f) => "`" + f + "`").join(", "));
    const trail = [];
    if (last.tool) trail.push(last.tool + (last.model ? "/" + last.model : ""));
    if (last.sessionId) trail.push("session `" + last.sessionId + "`");
    trail.push("exit " + (last.exit == null ? "?" : last.exit));
    L.push("", "<sub>" + trail.join(" · ") + "</sub>", "");
  });

  L.push("---", "", "<sub>✅ done · 🔄 running · ⏳ pending · ❌ failed — auto-generated from `metadata.json`, the same data Bridza shows.</sub>", "");
  return L.join("\n");
}

function commitWorktree(wt, message) {
  git(wt, ["add", "-A"]);
  const staged = git(wt, ["diff", "--cached", "--name-only"]).trim();
  if (!staged) return { committed: false, files: [] };
  git(wt, ["-c", "user.name=bridza", "-c", "user.email=bridza@local", "commit", "-m", message]);
  return { committed: true, sha: git(wt, ["rev-parse", "HEAD"]).trim(), files: staged.split("\n") };
}

// ── live run registry ───────────────────────────────────────────────────────
// The in-process truth of what is running RIGHT NOW. Committed metadata can say
// "running" forever after a crashed run; this registry can't — entries exist
// only while runStage is actually executing in this server process.
const ACTIVE_RUNS = new Map();
export function listActiveRuns() { return [...ACTIVE_RUNS.values()]; }

// ── CLI tool detection + the stage runner ───────────────────────────────────

export function toolAvailable(bin) {
  try { execFileSync("which", [bin], { stdio: "pipe" }); return true; } catch (e) { return false; }
}
export function resolveTool(toolId) {
  if (process.env.BRIDZA_TOOL_OVERRIDE) {
    try { const o = JSON.parse(process.env.BRIDZA_TOOL_OVERRIDE); return { id: toolId, bin: o.bin, args: () => o.args, stream: o.stream }; }
    catch (e) { /* fall through */ }
  }
  return CLI_TOOLS.find((t) => t.id === toolId) || null;
}

// Run one stage. Emits NDJSON-shaped events through `emit` and resolves with
// the final end event (never rejects). The timeline:
//   1. PROMPT commit — the run record (prompt, tool, model, startedAt) is
//      written into the task metadata and committed before the tool runs.
//   2. the tool runs in the task worktree, then any cmd.shell gates.
//   3. RESULT commit — outputs + the completed run record (exit, status,
//      finishedAt, seconds) are committed. Committed on success AND failure so
//      the timeline records what actually happened; a re-run appends a new
//      prompt/result pair (history is never lost).
// Events: {t:"meta"} {t:"out",d} {t:"cmd",cmd} {t:"commit",phase,sha} {t:"end",…}
export function runStage(root, body, emit) {
  return new Promise((resolve) => {
    let ended = false;
    let runKey = null;
    // keep the tail of everything the tool printed, so the run record can carry
    // WHY a run failed (persisted into the task metadata on the result commit)
    let outTail = "";
    const rawEmit = emit;
    emit = (ev) => { if (ev.t === "out" && typeof ev.d === "string") outTail = (outTail + ev.d).slice(-4000); rawEmit(ev); };
    const end = (obj) => { if (ended) return; ended = true; if (runKey) ACTIVE_RUNS.delete(runKey); emit({ t: "end", ...obj }); resolve(obj); };
    const { pipeline, task, stage, tool: toolId, prompt, system, shell = [], workingDir = ".", stageContext, stageName, taskTitle, wallSeconds } = body || {};
    const model = (body && body.model) || process.env["BRIDZA_" + String(toolId).toUpperCase() + "_MODEL"] || "";
    const tool = resolveTool(toolId);
    if (!tool) return end({ exit: 1, errorKind: "unknown-tool", error: "unknown tool: " + toolId });
    const bad = validRef(pipeline, "pipeline") || validRef(task, "task") || validRef(stage, "stage");
    if (bad) return end({ exit: 1, errorKind: "bad-ref", error: bad });
    runKey = safeRef(pipeline) + "/" + safeRef(task) + "/" + safeRef(stage) + "#" + Date.now();
    ACTIVE_RUNS.set(runKey, { pipeline: safeRef(pipeline), task: safeRef(task), stage: safeRef(stage), tool: toolId, startedAt: nowISO() });

    let wt;
    try { wt = ensureTaskWorktree(root, pipeline, task, { workingDir }); }
    catch (e) { return end({ exit: 1, errorKind: "git", error: firstLine(e) }); }
    if (!wt.ok) return end({ exit: 1, errorKind: "git", error: wt.error });
    const W = wt.worktree;
    emit({ t: "meta", branch: wt.branch, worktree: W, pipeline: safeRef(pipeline), task: safeRef(task), stage: safeRef(stage) });

    // ---- 1. prompt commit ----------------------------------------------------
    const startedAt = nowISO();
    const startMs = Date.now();
    const sid = safeRef(stage);
    let promptSha = null;
    let sessionId = null; // opencode session id, captured from the run's JSON events
    try {
      // stage scaffold: context.md (NL) + outputs/ (.gitkeep so the empty dir
      // is real on first run; the agent fills it)
      fs.mkdirSync(path.join(W, rel.stageOutputs(pipeline, task, sid)), { recursive: true });
      const gk = path.join(W, rel.stageOutputs(pipeline, task, sid), ".gitkeep");
      if (!fs.existsSync(gk)) fs.writeFileSync(gk, "");
      if (typeof stageContext === "string") fs.writeFileSync(path.join(W, rel.stageContext(pipeline, task, sid)), stageContext);

      const meta = readTaskMeta(W, pipeline, task);
      // self-heal the task metadata so the README/app always have identity
      if (taskTitle && !meta.title) meta.title = taskTitle;
      if (!meta.branch) meta.branch = wt.branch;
      if (!Array.isArray(meta.stages)) meta.stages = [];
      if (!meta.stages.includes(sid)) meta.stages.push(sid);
      if (!meta.status) meta.status = "in-progress";
      const track = meta.tracking[sid] || (meta.tracking[sid] = { status: "idle", seconds: 0, runs: [] });
      track.status = "running";
      track.runs.push({ tool: toolId, model: model || null, prompt: prompt || "", startedAt, status: "running" });
      writeTaskMeta(W, pipeline, task, meta);
      const pLines = [`bridza(${safeRef(pipeline)}/${safeRef(task)}/${sid}): prompt · ${toolId}`, "", `Stage: ${stageName || sid}`];
      if (taskTitle) pLines.push(`Task: ${taskTitle}`);
      if (model) pLines.push(`Model: ${model}`);
      if (prompt && prompt.trim()) pLines.push("", "Prompt:", prompt.trim());
      const c = commitWorktree(W, pLines.join("\n"));
      promptSha = c.sha || null;
      if (c.committed) emit({ t: "commit", phase: "prompt", sha: c.sha });
    } catch (e) { return end({ exit: 1, errorKind: "git", error: "prompt commit failed: " + firstLine(e) }); }

    // ---- 2 + 3. run, then result commit -------------------------------------
    const resultCommit = (exit, status, errorKind, error) => {
      try {
        // stage first so the changed-files list (minus scaffolding) can be
        // recorded INTO the metadata that this same commit will carry.
        git(W, ["add", "-A"]);
        const metaRel = rel.taskMeta(pipeline, task);
        const staged = git(W, ["diff", "--cached", "--name-only"]).trim();
        // the agent's output files — exclude bookkeeping (metadata, readme, gitkeep)
        const files = staged ? staged.split("\n").filter((f) => !f.endsWith(".gitkeep") && f !== metaRel && !f.endsWith("/README.md")) : [];
        const meta = readTaskMeta(W, pipeline, task);
        const track = meta.tracking[sid] || (meta.tracking[sid] = { status, seconds: 0, runs: [] });
        track.status = status;
        // record the REAL time spent: max of accumulated run-duration and the
        // live wall-clock the UI tracked for this stage (so the committed
        // metadata reflects what the app shows, not just the agent's runtime).
        track.seconds = Math.max((track.seconds || 0) + Math.round((Date.now() - startMs) / 1000), Math.floor(Number(wallSeconds) || 0));
        const r = track.runs[track.runs.length - 1] || {};
        Object.assign(r, { finishedAt: nowISO(), exit, status, promptCommit: promptSha, files, sessionId, error: error || null, log: outTail.trim() || null });
        writeTaskMeta(W, pipeline, task, meta);
        try { fs.writeFileSync(path.join(W, rel.task(pipeline, task), "README.md"), renderTaskReadme(meta)); } catch (e) { /* readme is best-effort */ }
        const rLines = [
          `bridza(${safeRef(pipeline)}/${safeRef(task)}/${sid}): result · ${status} · exit ${exit}`,
          "", `Stage: ${stageName || sid}`, `Tool: ${toolId}${model ? " · " + model : ""}`,
        ];
        if (sessionId) rLines.push(`opencode-session: ${sessionId}`);
        rLines.push(files.length ? `Files (${files.length}): ${files.slice(0, 12).join(", ")}${files.length > 12 ? ", …" : ""}` : "No file changes");
        if (error) rLines.push("", "Error: " + error);
        const c = commitWorktree(W, rLines.join("\n"));
        if (c.committed) emit({ t: "commit", phase: "result", sha: c.sha });
        end({ exit, status, errorKind, error, branch: wt.branch, promptCommit: promptSha, resultCommit: c.sha || null, files, sessionId });
      } catch (e) { end({ exit: exit || 1, status: "failed", errorKind: "git", error: "result commit failed: " + firstLine(e), branch: wt.branch }); }
    };

    const childEnv = { ...process.env, PWD: W };
    const runShell = (i) => {
      if (i >= shell.length) return resultCommit(0, "done");
      const cmd = String(shell[i] || "").trim();
      if (!cmd) return runShell(i + 1);
      emit({ t: "cmd", cmd });
      const c = spawn("sh", ["-c", cmd], { cwd: W, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      c.stdout.on("data", (d) => emit({ t: "out", d: d.toString() }));
      c.stderr.on("data", (d) => emit({ t: "out", d: d.toString() }));
      c.on("error", (e) => resultCommit(1, "failed", "shell", "shell `" + cmd + "` failed: " + firstLine(e)));
      c.on("close", (code) => code ? resultCommit(code, "failed", "shell", "shell `" + cmd + "` exited with code " + code) : runShell(i + 1));
    };

    // opencode streams one JSON event per line (tool.stream==="json"): surface the
    // assistant text + tool activity, and capture the opencode sessionID for the log.
    // CRUCIAL: opencode exits 0 even when the run died on a provider error — the
    // failure only appears as a {type:"error"} event. Capture it so the stage is
    // marked failed with the real reason instead of silently "done".
    let toolError = null;
    const onJsonEvent = (ev) => {
      if (!ev || typeof ev !== "object") return;
      if (ev.sessionID && !sessionId) { sessionId = ev.sessionID; emit({ t: "session", tool: toolId, sessionId }); }
      const p = ev.part || {};
      if (ev.type === "text" && typeof p.text === "string") emit({ t: "out", d: p.text + "\n" });
      else if (ev.type === "tool") emit({ t: "out", d: "· " + (p.tool || p.name || "tool") + (p.state && p.state.status ? " (" + p.state.status + ")" : "") + "\n" });
      else if (ev.type === "step_finish" && p.tokens) emit({ t: "out", d: "· step · " + p.tokens.total + " tokens\n" });
      else if (ev.type === "error") {
        const e = ev.error || {};
        toolError = (e.data && e.data.message) || e.message || e.name || "tool reported an error";
        emit({ t: "out", d: "✖ " + toolError + "\n" });
      }
    };
    let jbuf = "";
    const onStdout = (d) => {
      if (tool.stream !== "json") return emit({ t: "out", d: d.toString() });
      jbuf += d.toString();
      let nl;
      while ((nl = jbuf.indexOf("\n")) >= 0) {
        const line = jbuf.slice(0, nl); jbuf = jbuf.slice(nl + 1);
        if (!line.trim()) continue;
        try { onJsonEvent(JSON.parse(line)); } catch (e) { emit({ t: "out", d: line + "\n" }); }
      }
    };
    const args = tool.args({ prompt, system, model });
    const child = spawn(tool.bin, args, { cwd: W, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", onStdout);
    child.stderr.on("data", (d) => emit({ t: "out", d: d.toString() }));
    child.on("error", (e) => resultCommit(1, "failed", "spawn", String(e.message || e)));
    child.on("close", (code) => {
      if (code) return resultCommit(code, "failed", "exit", "tool exited with code " + code);
      if (toolError) return resultCommit(1, "failed", "tool-error", toolError);
      runShell(0);
    });
  });
}

// ── automate: run every stage of a task back-to-back ────────────────────────
// `body.stages` is an ORDERED array of run/stage bodies (the client assembles
// each stage's prompt/system/tool). Each stage runs only if the previous one
// finished `done`/exit 0 — a failure stops the chain and reports where. Inner
// stage events are forwarded (tagged `_stage`); the chain emits its own
// {t:"automate"} progress events plus a single final {t:"end", automate:true}.
export async function automateTask(root, body, emit) {
  const stages = Array.isArray(body && body.stages) ? body.stages : [];
  if (!stages.length) { emit({ t: "end", automate: true, exit: 1, error: "no stages to run" }); return { ok: false, results: [] }; }
  emit({ t: "automate", phase: "start", count: stages.length });
  const results = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i] || {};
    const st = safeRef(s.stage);
    emit({ t: "automate", phase: "stage", index: i, count: stages.length, stage: st, name: s.stageName || st });
    const res = await runStage(root, s, (ev) => { if (ev.t !== "end") emit({ ...ev, _stage: st }); });
    results.push({ stage: st, status: res.status, exit: res.exit, sessionId: res.sessionId || null, resultCommit: res.resultCommit || null });
    emit({ t: "automate", phase: "stage-done", index: i, stage: st, status: res.status, exit: res.exit, sessionId: res.sessionId || null });
    if (res.status !== "done" || res.exit !== 0) {
      emit({ t: "end", automate: true, exit: res.exit || 1, stoppedAt: st, error: res.error || ("stage " + st + " failed"), results });
      return { ok: false, results };
    }
  }
  emit({ t: "end", automate: true, exit: 0, results });
  return { ok: true, results };
}

// ── reopen: roll a task back to a stage so it can be revised ────────────────
// Resets the given stage AND every later stage to idle (kanban puts the task
// back in that column; auto-advance re-runs from there). Run history, prompts
// and time are all KEPT — only the status rolls back. Un-finalizes the task so
// the revision can be finalized again. Works after every stage is done.
export function reopenStage(root, pipeline, task, stage) {
  const bad = validRef(pipeline, "pipeline") || validRef(task, "task") || validRef(stage, "stage");
  if (bad) return { ok: false, error: bad };
  const wt = ensureTaskWorktree(root, pipeline, task);
  if (!wt.ok) return wt;
  const W = wt.worktree;
  const sid = safeRef(stage);
  const meta = readTaskMeta(W, pipeline, task);
  const stages = [...new Set([...(meta.stages || []), ...Object.keys(meta.tracking || {})])];
  if (!stages.includes(sid)) return { ok: false, error: "unknown stage " + sid };
  const reset = stages.slice(stages.indexOf(sid));
  for (const s of reset) {
    const tr = meta.tracking[s];
    if (tr && tr.status && tr.status !== "idle") tr.status = "idle";
  }
  meta.status = "in-progress";
  meta.finalized = false;
  writeTaskMeta(W, pipeline, task, meta);
  try { fs.writeFileSync(path.join(W, rel.task(pipeline, task), "README.md"), renderTaskReadme(meta)); } catch (e) { /* best-effort */ }
  const c = commitWorktree(W, `bridza(${safeRef(pipeline)}/${safeRef(task)}/${sid}): reopen · ${reset.join(", ")} reset for revision`);
  return { ok: true, branch: wt.branch, reset, committed: c.committed, sha: c.sha || null };
}

// ── finalize: merge the task branch into main ───────────────────────────────

// style: "squash" (default) | "rebase" | "merge". When `into` is the branch the
// user has checked out in the main repo, the merge happens there (finalize is
// an explicit user action — landing the work is the point). Otherwise it runs
// in a throwaway worktree so the user's checkout is untouched.
// Ask opencode (fallback claude) to write a one-line commit message from a
// worktree's pending diff. Returns null if no tool / it fails (caller defaults).
function aiCommitMessage(wt) {
  let diff;
  try { diff = git(wt, ["diff", "--cached"]); } catch (e) { return null; }   // staged: includes new files
  if (!diff.trim()) return null;
  if (diff.length > 8000) diff = diff.slice(0, 8000) + "\n…(truncated)";
  const prompt = "Write ONLY a single concise git commit message line (max 72 chars, imperative mood) summarizing this diff. No quotes, no body, no preamble:\n\n" + diff;
  for (const id of ["opencode", "claude"]) {
    const tool = resolveTool(id);
    if (!tool) continue;
    try {
      const out = execFileSync(tool.bin, tool.args({ prompt, system: "", model: "" }), { cwd: wt, encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
      const line = out.split("\n").map((s) => s.trim()).filter(Boolean).pop();
      if (line) return line.replace(/^["'`]+|["'`]+$/g, "").slice(0, 100);
    } catch (e) { /* try next tool */ }
  }
  return null;
}

export function finalizeTask(root, pipeline, task, { style = "merge", into, resolveMain, mainCommitMessage } = {}) {
  const branch = taskBranchName(pipeline, task);
  if (!isGitRepo(root)) return { ok: false, error: "not a git repository" };
  if (!branchExists(root, branch)) return { ok: false, error: "task branch does not exist — run a stage first" };
  const target = into || baseBranchName(root);
  if (!branchExists(root, target)) return { ok: false, error: "target branch " + target + " does not exist" };
  const ident = ["-c", "user.name=bridza", "-c", "user.email=bridza@local"];

  // 1) commit any uncommitted work in the task's worktree (the user's debugging
  //    edits) to the branch, with a message opencode writes from the diff.
  let autocommit = null;
  const twt = taskWorktree(root, pipeline, task);
  try {
    if (fs.existsSync(path.join(twt, ".git")) && git(twt, ["status", "--porcelain"]).trim()) {
      git(twt, ["add", "-A"]);                                          // stage (incl. new files) so the message diff is complete
      const msg = aiCommitMessage(twt) || "bridza: commit pending changes before finalize";
      git(twt, [...ident, "commit", "-m", msg]);
      autocommit = { committed: true, message: msg };
    }
  } catch (e) { /* if autocommit fails, still try to merge what's committed */ }

  // 2) resolve a dirty target checkout (the in-place merge target). Instead of
  //    erroring, tell the UI to show a diff dialog; it re-calls with resolveMain
  //    = "stash" or "commit" (optionally a message — else opencode writes one).
  const inPlace = currentBranch(root) === target;
  let mainResolved = null;
  if (inPlace && !isClean(root)) {
    if (resolveMain === "stash") {
      try { git(root, ["stash", "push", "-u", "-m", "bridza: stashed before finalize"]); mainResolved = { action: "stash" }; }
      catch (e) { return { ok: false, error: "stash failed: " + firstLine(e), autocommit }; }
    } else if (resolveMain === "commit") {
      try {
        git(root, ["add", "-A"]);
        const msg = (mainCommitMessage && String(mainCommitMessage).trim()) || aiCommitMessage(root) || "bridza: commit before finalize";
        git(root, [...ident, "commit", "-m", msg]);
        mainResolved = { action: "commit", message: msg };
      } catch (e) { return { ok: false, error: "commit failed: " + firstLine(e), autocommit }; }
    } else {
      return { ok: false, needsResolve: true, target, autocommit };
    }
  }

  // 3) merge the branch into the target.
  let mwt = root, cleanup = null;
  try {
    if (!inPlace) {
      mwt = path.join(worktreeBase(root), "_finalize");
      fs.mkdirSync(path.dirname(mwt), { recursive: true });
      if (fs.existsSync(mwt)) { try { git(root, ["worktree", "remove", "--force", mwt]); } catch (e) { fs.rmSync(mwt, { recursive: true, force: true }); } }
      git(root, ["worktree", "add", mwt, target]);
      cleanup = () => { try { git(root, ["worktree", "remove", "--force", mwt]); } catch (e) { /* */ } };
    }
    const msg = `bridza: finalize ${safeRef(pipeline)}/${safeRef(task)}`;
    if (style === "squash") {
      git(mwt, ["merge", "--squash", branch]);
      if (git(mwt, ["diff", "--cached", "--name-only"]).trim())
        git(mwt, [...ident, "commit", "-m", msg]);
    } else if (style === "rebase") {
      git(mwt, [...ident, "rebase", target, branch]);
      git(mwt, ["merge", "--ff-only", branch]);
    } else {
      git(mwt, [...ident, "merge", "--no-ff", "-m", msg, branch]);
    }
    const head = git(mwt, ["rev-parse", target]).trim();
    if (cleanup) cleanup();
    return { ok: true, target, style, head, autocommit, mainResolved };
  } catch (e) {
    if (cleanup) cleanup();
    return { ok: false, error: firstLine(e), autocommit };
  }
}

// Parse a unified `git diff` patch into files → hunks → lines (with old/new
// line numbers), so the UI can render a VS Code / lazygit-style diff.
export function parseDiff(patch) {
  const files = [];
  let f = null, h = null, oldNo = 0, newNo = 0;
  const push = () => { if (f) files.push(f); };
  for (const ln of (patch || "").split("\n")) {
    if (ln.startsWith("diff --git")) {
      push(); f = { path: "", add: 0, del: 0, binary: false, hunks: [] }; h = null;
      const m = ln.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (m) f.path = m[2];
      continue;
    }
    if (!f) continue;
    if (ln.startsWith("Binary files")) { f.binary = true; continue; }
    if (ln.startsWith("--- ")) continue;
    if (ln.startsWith("+++ ")) { const m = ln.match(/^\+\+\+ b\/(.+)$/); if (m) f.path = m[1]; continue; }
    if (ln.startsWith("@@")) {
      const m = ln.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      oldNo = m ? +m[1] : 0; newNo = m ? +m[2] : 0;
      h = { header: (m && m[3].trim()) || "", lines: [] }; f.hunks.push(h);
      continue;
    }
    if (!h) continue;
    const t = ln[0];
    if (t === "+") { f.add++; h.lines.push({ t: "+", text: ln.slice(1), oldNo: null, newNo: newNo++ }); }
    else if (t === "-") { f.del++; h.lines.push({ t: "-", text: ln.slice(1), oldNo: oldNo++, newNo: null }); }
    else if (t === " ") { h.lines.push({ t: " ", text: ln.slice(1), oldNo: oldNo++, newNo: newNo++ }); }
    // "\ No newline at end of file" and others: ignore
  }
  push();
  return files;
}

// The diff a single commit introduced (against its parent) — the file changes a
// stage run produced. Read from the branch; never touches the working tree.
export function commitDiff(root, sha) {
  if (!isGitRepo(root)) return { ok: false, error: "not a git repository" };
  if (!sha || !/^[0-9a-fA-F]{4,40}$/.test(sha)) return { ok: false, error: "bad commit" };
  let patch, subject;
  try {
    subject = git(root, ["log", "-1", "--format=%s", sha]).trim();
    try { patch = git(root, ["diff", sha + "^", sha, "--no-color", "--unified=3"]); }
    catch (e) { patch = git(root, ["show", sha, "--no-color", "--format=", "--unified=3"]); }   // root commit
  } catch (e) { return { ok: false, error: "no such commit" }; }
  if (patch.length > 400000) patch = patch.slice(0, 400000) + "\n@@ … (diff truncated) @@\n";
  return { ok: true, sha, subject, files: parseDiff(patch) };
}

// The WHOLE task branch's changes in one place — the cumulative diff of the
// branch vs the base (everything the task produced since it forked from main),
// not commit-by-commit.
export function branchDiff(root, pipeline, task) {
  const branch = taskBranchName(pipeline, task);
  if (!isGitRepo(root)) return { ok: false, error: "not a git repository", files: [] };
  if (!branchExists(root, branch)) return { ok: false, error: "no task branch yet — run a stage first", files: [] };
  const base = baseBranchName(root);
  const range = branchExists(root, base) ? base + "..." + branch : branch;   // three-dot: changes since the merge-base
  let patch;
  try { patch = git(root, ["diff", range, "--no-color", "--unified=3"]); }
  catch (e) { return { ok: false, error: firstLine(e), files: [] }; }
  if (patch.length > 600000) patch = patch.slice(0, 600000) + "\n@@ … (diff truncated) @@\n";
  return { ok: true, branch, base, files: parseDiff(patch) };
}

// The uncommitted changes in a checkout (main's working tree), so the finalize
// dialog can show what's in the way and let the user stash or commit it.
export function workingDiff(root) {
  if (!isGitRepo(root)) return { ok: false, error: "not a git repository", files: [], untracked: [] };
  let patch = "";
  try { patch = git(root, ["diff", "HEAD", "--no-color", "--unified=3"]); } catch (e) { /* no HEAD / no diff */ }
  if (patch.length > 400000) patch = patch.slice(0, 400000) + "\n@@ … (diff truncated) @@\n";
  let untracked = [];
  try { untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).trim().split("\n").filter(Boolean); } catch (e) { /* */ }
  return { ok: true, base: baseBranchName(root), files: parseDiff(patch), untracked };
}

// ── blast radius: reverse import-graph closure of the task's changed files ──
// gitGraph semantics: the blast radius of a change is every file that
// TRANSITIVELY IMPORTS a changed file — "what breaks if this changes", found by
// BFS along reverse import edges. distance 0 = changed (red), 1..n = impacted
// (orange, fading with distance), everything else = untouched (green).

const IMPORT_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".dart", ".py", ".vue", ".svelte", ".css", ".scss"]);
const IMPORT_RES = [
  /\bimport\s+[^"'\n]*?["']([^"'\n]+)["']/g,                     // import x from "y" / import "y" / css @import "y"
  /\bexport\s+[^"'\n]*?\bfrom\s+["']([^"'\n]+)["']/g,            // export … from "y"
  /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,                   // require("y")
  /(?:^|\n)\s*from\s+(\.[.\w/]*)\s+import\b/g,                   // python relative
];

export function extractImports(src) {
  const out = [];
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) out.push(m[1]);
  }
  return out;
}

// Resolve a RELATIVE import specifier to a real file in the repo (package
// imports are skipped — the blast radius is about this repo's own files).
const RESOLVE_SUFFIXES = ["", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".dart", ".py", ".vue", ".svelte", ".css", ".scss",
  "/index.js", "/index.jsx", "/index.ts", "/index.tsx"];
export function resolveImport(fromFile, spec, fileSet) {
  if (!spec.startsWith("./") && !spec.startsWith("../") && !spec.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec.replace(/^\.$/, "./")));
  for (const suf of RESOLVE_SUFFIXES) {
    const cand = base + suf;
    if (fileSet.has(cand)) return cand;
    // python "from .x import" arrives dot-form: also try slash-form
    const py = base.replace(/\./g, "/") + suf;
    if (fileSet.has(py)) return py;
  }
  return null;
}

// Build reverse import edges (file → the files that import it) for a set of
// repo-relative source files. `read` returns a file's content ("" on failure).
export function buildReverseImportGraph(files, read) {
  const fileSet = new Set(files);
  const incoming = new Map();
  for (const f of files) {
    if (!IMPORT_EXTS.has(path.posix.extname(f))) continue;
    const src = read(f);
    if (!src) continue;
    for (const spec of extractImports(src)) {
      const dep = resolveImport(f, spec, fileSet);
      if (!dep || dep === f) continue;
      if (!incoming.has(dep)) incoming.set(dep, new Set());
      incoming.get(dep).add(f);
    }
  }
  return incoming;
}

// BFS along reverse edges from the changed files; each node visited once, so
// import cycles are safe. Returns Map<file, hop-distance>.
export function reverseClosure(incoming, seeds) {
  const dist = new Map();
  const queue = [];
  for (const s of seeds) if (!dist.has(s)) { dist.set(s, 0); queue.push(s); }
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur);
    for (const n of incoming.get(cur) || []) {
      if (!dist.has(n)) { dist.set(n, d + 1); queue.push(n); }
    }
  }
  return dist;
}

export function blastRadius(root, pipeline, task) {
  const branch = taskBranchName(pipeline, task);
  if (!isGitRepo(root)) return { ok: false, error: "not a git repository" };
  if (!branchExists(root, branch)) return { ok: false, error: "no task branch yet", seeds: [], impacted: [] };
  const base = baseBranchName(root);
  const range = branchExists(root, base) ? base + "..." + branch : branch;
  // changed files with churn (seeds), bookkeeping excluded
  const numstat = git(root, ["diff", "--numstat", range]).trim();
  const seeds = [];
  for (const ln of numstat ? numstat.split("\n") : []) {
    const m = ln.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const p = m[3];
    if (/\/metadata\.json$|\/README\.md$|\.gitkeep$/.test(p) || p.startsWith(".bridza/")) continue;
    seeds.push({ path: p, add: m[1] === "-" ? 0 : +m[1], del: m[2] === "-" ? 0 : +m[2] });
  }
  if (!seeds.length) return { ok: true, seeds: [], impacted: [], sourceFiles: 0 };
  // repo source files at the branch tip; contents read from the task worktree
  // (a full checkout of the branch) or, failing that, the main working tree.
  const all = git(root, ["ls-tree", "-r", "--name-only", branch]).trim().split("\n").filter(Boolean);
  const files = all.filter((f) => IMPORT_EXTS.has(path.posix.extname(f)) && !f.startsWith(".bridza/") && !f.includes("node_modules/")).slice(0, 5000);
  const wt = taskWorktree(root, pipeline, task);
  const readRoot = fs.existsSync(path.join(wt, ".git")) ? wt : root;
  const read = (f) => { try { return fs.readFileSync(path.join(readRoot, f), "utf8"); } catch (e) { return ""; } };
  const incoming = buildReverseImportGraph(files, read);
  const dist = reverseClosure(incoming, seeds.map((s) => s.path));
  const impacted = [...dist.entries()].filter(([, d]) => d > 0).map(([p, d]) => ({ path: p, distance: d })).sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path));
  return { ok: true, branch, seeds, impacted, sourceFiles: files.length };
}

// The task branch timeline: the prompt/result commits, newest first. Each
// commit carries its file changes (--numstat: per-file +/− line counts) plus
// the stage + kind (prompt/result) parsed from the bridza commit subject, so
// the UI can render a change timeline with churn — not just subjects.
export function taskTimeline(root, pipeline, task) {
  const branch = taskBranchName(pipeline, task);
  if (!isGitRepo(root) || !branchExists(root, branch)) return { ok: false, error: "no task branch yet", commits: [] };
  const base = baseBranchName(root);
  const range = branchExists(root, base) ? base + ".." + branch : branch;
  // \x01 separates commits, \x1f separates header fields; numstat lines follow each header
  const log = git(root, ["log", "--numstat", "--format=%x01%H%x1f%an%x1f%s%x1f%cI", range]);
  const commits = [];
  for (const rec of log.split("\x01")) {
    if (!rec.trim()) continue;
    const lines = rec.split("\n");
    const [sha, author, subject, date] = lines[0].split("\x1f");
    if (!sha) continue;
    const files = [];
    let add = 0, del = 0;
    for (const ln of lines.slice(1)) {
      const m = ln.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const a = m[1] === "-" ? 0 : +m[1], d = m[2] === "-" ? 0 : +m[2];
      files.push({ path: m[3], add: a, del: d, binary: m[1] === "-" });
      add += a; del += d;
    }
    const sm = subject.match(/^bridza\(([^/)]+)\/([^/)]+)\/([^)]+)\):\s*(prompt|result)/);
    commits.push({ sha, author, subject, date, stage: sm ? sm[3] : null, kind: sm ? sm[4] : null, files, add, del });
  }
  return { ok: true, branch, commits };
}
