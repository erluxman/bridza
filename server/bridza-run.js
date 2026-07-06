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
import { DATA_DIR, taskBranchName, rel, safeRef, CLI_TOOLS, STARTER_PIPELINES, pipelineFlows, gateSatisfied } from "../core/domain.js";

export { DATA_DIR, taskBranchName };

const firstLine = (e) => String((e && e.message) || e).split("\n")[0];
const nowISO = () => new Date().toISOString();
// Kill a spawned tool and everything under it: the whole process group (the
// child is spawned detached = its own group), falling back to the child alone.
const killTree = (c) => {
  try { process.kill(-c.pid, "SIGTERM"); } catch (e) { try { c.kill("SIGTERM"); } catch (e2) { /* gone */ } }
};

// ── git plumbing ────────────────────────────────────────────────────────────

export function git(root, args, opts = {}) {
  // stdio pipe keeps expected failures (rev-parse probes) off the console.
  // timeout: every call here runs SYNCHRONOUSLY on the server's event loop —
  // one OS-level-hung git child would wedge every request, forever.
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 15000, ...opts });
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

// ── single-file editor (read + save one output file) ─────────────────────────
// #1 — read a task file's current content from its worktree (branch-tip state)
// and save an edit as EITHER an amend of the branch tip OR a fresh commit. The
// path is validated to stay inside the worktree — no traversal, no absolute.
function safeWorktreePath(W, relPath) {
  const p = String(relPath || "").replace(/\\/g, "/");
  if (!p || p.startsWith("/") || p.split("/").includes("..")) return null;
  const abs = path.resolve(W, p);
  return abs === W || abs.startsWith(W + path.sep) ? abs : null;
}

export function readTaskFile(root, { pipeline, task, path: relPath }) {
  const wt = ensureTaskWorktree(root, pipeline, task);
  if (!wt.ok) return { ok: false, error: wt.error };
  const abs = safeWorktreePath(wt.worktree, relPath);
  if (!abs) return { ok: false, error: "bad path" };
  try {
    if (!fs.existsSync(abs)) return { ok: true, exists: false, content: "" };
    const st = fs.statSync(abs);
    if (st.isDirectory()) return { ok: false, error: "that path is a directory" };
    if (st.size > 2 * 1024 * 1024) return { ok: false, error: "file too large to edit (" + Math.round(st.size / 1024) + " KB)" };
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) return { ok: false, error: "binary file — not editable" };
    return { ok: true, exists: true, content: buf.toString("utf8") };
  } catch (e) { return { ok: false, error: firstLine(e) }; }
}

export function saveTaskFile(root, { pipeline, task, path: relPath, content, amend, message }) {
  const wt = ensureTaskWorktree(root, pipeline, task);
  if (!wt.ok) return { ok: false, error: wt.error };
  const W = wt.worktree;
  const abs = safeWorktreePath(W, relPath);
  if (!abs) return { ok: false, error: "bad path" };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content == null ? "" : String(content));
    git(W, ["add", "--", relPath]);
    // no actual change → no-op (never create an empty commit or a pointless amend)
    if (!git(W, ["diff", "--cached", "--name-only"]).trim())
      return { ok: true, committed: false, unchanged: true, branch: wt.branch };
    const author = ["-c", "user.name=bridza", "-c", "user.email=bridza@local"];
    if (amend) git(W, [...author, "commit", "--amend", "--no-edit"]);
    else git(W, [...author, "commit", "-m", String(message || "").trim() || ("bridza: edit " + relPath)]);
    return { ok: true, committed: true, amended: !!amend, sha: git(W, ["rev-parse", "HEAD"]).trim(), branch: wt.branch };
  } catch (e) { return { ok: false, error: firstLine(e) }; }
}

// ── live run registry ───────────────────────────────────────────────────────
// The in-process truth of what is running RIGHT NOW. Committed metadata can say
// "running" forever after a crashed run; this registry can't — entries exist
// only while runStage is actually executing in this server process. Each entry
// keeps a kill handle so the user can stop a run from the app.
const ACTIVE_RUNS = new Map();
export function listActiveRuns() {
  return [...ACTIVE_RUNS.values()].map(({ kill, ...r }) => r);
}

// Stop the live run(s) of a task (optionally one stage). SIGTERM the tool's
// process; runStage's close handler then records the run as "stopped" and
// commits the result, so the timeline shows the stop — not a phantom crash.
export function stopRuns(pipeline, task, stage) {
  const p = safeRef(pipeline), t = safeRef(task), s = stage ? safeRef(stage) : null;
  let stopped = 0;
  for (const r of ACTIVE_RUNS.values()) {
    if (r.pipeline !== p || r.task !== t || (s && r.stage !== s)) continue;
    if (typeof r.kill === "function") { try { r.kill(); stopped++; } catch (e) { /* already gone */ } }
  }
  return { ok: stopped > 0, stopped, error: stopped ? undefined : "no live run for that task" };
}

// ── focused context: linked tickets injected into the stage prompt ──────────
// plan.json carries links: { "<pipeline>/<task>": ["<pipeline>/<task>", …] } —
// the tickets the user attached to a task as context. Each linked ticket's
// title + context.md is folded into the prompt so it shapes the work directly.
function readTaskField(root, pipeline, task, relPath) {
  const branch = taskBranchName(pipeline, task);
  if (branchExists(root, branch)) {
    try { return git(root, ["show", branch + ":" + relPath]); } catch (e) { /* fall through */ }
  }
  try { return fs.readFileSync(path.join(root, relPath), "utf8"); } catch (e) { return ""; }
}
export function focusedContext(root, pipeline, task) {
  let plan;
  try { plan = JSON.parse(fs.readFileSync(path.join(root, rel.plan()), "utf8")); } catch (e) { return ""; }
  const links = (plan && plan.links && plan.links[safeRef(pipeline) + "/" + safeRef(task)]) || [];
  if (!Array.isArray(links) || !links.length) return "";
  let refs = {};
  try { refs = JSON.parse(fs.readFileSync(path.join(root, DATA_DIR, "refs.json"), "utf8")).refs || {}; } catch (e) { /* none yet */ }
  const blocks = [];
  for (const key of links.slice(0, 8)) {
    const [lp, lt] = String(key).split("/");
    if (!lp || !lt) continue;
    let title = lt, ref = refs[key] ? "#" + refs[key] + " " : "";
    try {
      const m = JSON.parse(readTaskField(root, lp, lt, rel.taskMeta(lp, lt)) || "{}");
      if (m.title) title = m.title;
      if (!ref && m.ref) ref = "#" + m.ref + " ";
    } catch (e) { /* no metadata — use the id */ }
    const ctx = (readTaskField(root, lp, lt, rel.taskContext(lp, lt)) || "").trim();
    blocks.push(`### ${ref}${title} (${key})\n${ctx || "(no written context)"}`);
  }
  if (!blocks.length) return "";
  return "## Focused context — linked tickets (weigh these heavily in this work)\n\n" + blocks.join("\n\n");
}

// ── CLI tool detection + the stage runner ───────────────────────────────────

// Sent to the tool when a stage is run with no typed prompt — the stage still
// works off its system prompt + upstream outputs instead of erroring on "".
export const DEFAULT_STAGE_PROMPT = "Continue this stage from the output of previous stages.";

export function toolAvailable(bin) {
  try { execFileSync("which", [bin], { stdio: "pipe" }); return true; } catch (e) { return false; }
}

// Models a tool can run, for the per-run model picker. Empty selection always
// means "the tool's own default" — Bridza never forces a model. Cached for the
// server's lifetime (opencode's list is ~200 entries and costs ~0.5s).
const MODEL_CACHE = new Map();
export function listModels(toolId) {
  if (MODEL_CACHE.has(toolId)) return MODEL_CACHE.get(toolId);
  let models = [];
  try {
    if (toolId === "opencode")
      models = execFileSync("opencode", ["models"], { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] })
        .split("\n").map((s) => s.trim()).filter(Boolean);
    else if (toolId === "claude") models = ["sonnet", "opus", "haiku"];   // --model aliases; no list command
  } catch (e) { /* no list → the picker still offers "tool default" + free text */ }
  MODEL_CACHE.set(toolId, models);
  return models;
}
export function resolveTool(toolId) {
  if (process.env.BRIDZA_TOOL_OVERRIDE) {
    try { const o = JSON.parse(process.env.BRIDZA_TOOL_OVERRIDE); return { id: toolId, bin: o.bin, args: () => o.args, stream: o.stream }; }
    catch (e) { /* fall through */ }
  }
  return CLI_TOOLS.find((t) => t.id === toolId) || null;
}

// Resolve the tool a stage will ACTUALLY run with. A pipeline can pin a tool
// (e.g. "opencode") that isn't installed on this machine; spawning it dies with
// ENOENT and stops the Automate chain. So substitute the first installed CLI
// agent instead of failing. Returns { tool, toolId, fellBackFrom? } or { error }.
// `isAvailable` is injectable for tests; BRIDZA_TOOL_OVERRIDE always resolves.
export function resolveRunnableTool(toolId, isAvailable = toolAvailable) {
  const tool = resolveTool(toolId);
  if (!tool) return { error: "unknown tool: " + toolId };
  if (process.env.BRIDZA_TOOL_OVERRIDE || isAvailable(tool.bin)) return { tool, toolId };
  const alt = CLI_TOOLS.find((t) => isAvailable(t.bin));
  if (!alt) return { error: "no CLI agent installed — install one of: " + CLI_TOOLS.map((t) => t.bin).join(", ") };
  return { tool: resolveTool(alt.id), toolId: alt.id, fellBackFrom: toolId };
}

// ── AI pipeline recommender ─────────────────────────────────────────────────
// ── plan-gate enforcement ────────────────────────────────────────────────────
// A task is DONE for gating purposes when it's finalized, or every one of its
// stages is tracked done. Tracking lives on the task's branch tip (runs commit
// there, not to main), so read the branch first; fall back to the working tree.
function taskDoneForGate(root, key) {
  const [p, t] = key.split("/");
  let meta;
  try { meta = JSON.parse(readTaskField(root, p, t, rel.taskMeta(p, t))); }
  catch (e) { return false; }
  if (meta.finalized) return true;
  const stages = [...new Set([...(meta.stages || []), ...Object.keys(meta.tracking || {})])];
  return stages.length > 0 && stages.every((s) => meta.tracking && meta.tracking[s] && meta.tracking[s].status === "done");
}

// Non-null = a human-readable reason this task may not run yet.
export function blockedByPlan(root, pipeline, task) {
  let deps;
  try { deps = JSON.parse(fs.readFileSync(path.join(root, rel.plan()), "utf8")).deps || {}; }
  catch (e) { return null; }   // no plan file → nothing gated
  const gate = deps[safeRef(pipeline) + "/" + safeRef(task)];
  if (!gate) return null;
  const keys = [...new Set([...(gate.all || []), ...(gate.any || [])])];
  const done = new Set(keys.filter((k) => taskDoneForGate(root, k)));
  if (gateSatisfied(gate, done)) return null;
  const waiting = keys.filter((k) => !done.has(k));
  return "blocked by the plan — waiting on: " + waiting.join(", ") + " (finish those tasks first, or remove the dependency in Plan)";
}

// Given a free-text project description, ask the available CLI tool to pick
// the most relevant starter pipelines. Returns an array of
// { id, label, reason, score } sorted by relevance.
// derived from STARTER_PIPELINES so the recommender can never drift from the
// actual catalog (flow names + stage sequences straight from the source)
const CATALOG_SUMMARY = STARTER_PIPELINES.map((p) => ({
  id: p.id, label: p.label,
  summary: pipelineFlows(p).map((f) => f.name + " (" + f.stages.map((s) => s.name).join("→") + ")").join(", "),
}));

const DESC_MAX = 2000;

export function recommendPipelines(raw) {
  const description = String(raw || "").trim().slice(0, DESC_MAX);
  if (!description) return [];
  const catalog = CATALOG_SUMMARY.map((p) => `  - "${p.id}" = ${p.label}: ${p.summary}`).join("\n");
  const prompt = [
    "You are a pipeline recommender for Bridza. Each pipeline bundles stage flows (ordered sequences of AI-driven stages like Research → Design → Build → Review).",
    "",
    "Available pipelines:",
    catalog,
    "",
    "The user describes what they are building. Recommend which pipelines fit. Consider:",
    "- What business functions does the project need? (engineering, marketing, sales, support...)",
    "- What kind of work will the team do regularly?",
    "- Which stage flows match their workflow?",
    "",
    "---BEGIN USER DESCRIPTION---",
    description,
    "---END USER DESCRIPTION---",
    "",
    "Respond ONLY with a JSON array of objects:",
    '  [ { "id": "<pipeline-id>", "reason": "<one-sentence why>", "score": <1-10> } ]',
    "Example:",
    '  [{"id":"engineering","reason":"Building a software product from scratch","score":9},{"id":"product","reason":"Defining the product vision and requirements","score":7}]',
    "Return [] if none fit. No preamble, no explanation, no markdown fences — pure JSON array.",
  ].join("\n");

  for (const id of ["opencode", "claude"]) {
    const tool = resolveTool(id);
    if (!tool) continue;
    try {
      const out = execFileSync(tool.bin, tool.args({ prompt, system: "", model: "" }), { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
      // Find the first `[` and last `]` on their own lines to extract JSON
      const lines = out.split("\n");
      const start = lines.findIndex((l) => l.trim().startsWith("["));
      const end = lines.findLastIndex((l) => l.trim().endsWith("]"));
      const json = start >= 0 && end >= start ? lines.slice(start, end + 1).join("\n") : out.trim();
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((r) => r && r.id && CATALOG_SUMMARY.some((c) => c.id === r.id))
        .map((r) => {
          const id = r.id;
          const entry = CATALOG_SUMMARY.find((c) => c.id === id);
          const reason = String(r.reason || "").replace(/^["'`]+|["'`]+$/g, "").slice(0, 200);
          const score = r.score != null ? Math.min(10, Math.max(1, Math.round(Number(r.score)))) : 5;
          return { id, label: entry.label, reason, score };
        })
        .sort((a, b) => b.score - a.score);
    } catch (e) { /* try next tool */ }
  }
  return [];
}

// ── one-commit-per-stage helpers ────────────────────────────────────────────
// The task branch is a clean sequence: [base] → spec → build → review, ONE
// commit per stage. These find "the last commit that is still valid" when a
// stage (re)runs or is reopened: the newest commit that belongs to an EARLIER
// stage (or isn't a stage commit at all — the fork point / task scaffold).

const stageOfSubject = (s) => { const m = String(s || "").match(/^bridza\([^)]*\/([^/)]+)\):/); return m ? m[1] : null; };
export const stageOrderOf = (meta) => [...new Set([...(meta.stages || []), ...Object.keys(meta.tracking || {})])];

export function lastValidCommitBefore(W, order, sid) {
  const idx = order.indexOf(sid);
  if (idx < 0) return null;
  let log;
  try { log = git(W, ["log", "--format=%H%x1f%s"]).trim(); } catch (e) { return null; }
  for (const line of log ? log.split("\n") : []) {
    const [sha, subject] = line.split("\x1f");
    const st = stageOfSubject(subject);
    const sIdx = st ? order.indexOf(st) : -1;
    if (st && sIdx >= idx) continue;   // this stage's commit or a later stage's → to be dropped
    return sha;                        // earlier stage / non-stage commit — still valid
  }
  return null;
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
    emit = (ev) => {
      if (ev.t === "out" && typeof ev.d === "string") outTail = (outTail + ev.d).slice(-4000);
      else if (ev.t === "cmd" && typeof ev.cmd === "string") outTail = (outTail + "$ " + ev.cmd + "\n").slice(-4000);
      rawEmit(ev);
    };
    const end = (obj) => { if (ended) return; ended = true; if (runKey) ACTIVE_RUNS.delete(runKey); emit({ t: "end", ...obj }); resolve(obj); };
    const { pipeline, task, stage, prompt, system, shell = [], workingDir = ".", stageContext, stageName, taskTitle, wallSeconds } = body || {};
    const picked = resolveRunnableTool(body && body.tool);
    if (picked.error) return end({ exit: 1, errorKind: picked.error.startsWith("unknown") ? "unknown-tool" : "no-tool", error: picked.error });
    const tool = picked.tool;
    const toolId = picked.toolId;
    if (picked.fellBackFrom) emit({ t: "out", d: "· " + picked.fellBackFrom + " not installed — falling back to " + toolId + "\n" });
    const model = (body && body.model) || process.env["BRIDZA_" + String(toolId).toUpperCase() + "_MODEL"] || "";
    const bad = validRef(pipeline, "pipeline") || validRef(task, "task") || validRef(stage, "stage");
    if (bad) return end({ exit: 1, errorKind: "bad-ref", error: bad });
    // plan gate: a task wired behind others (a flow handoff, or hand-drawn
    // deps) can't run any stage until its upstream tasks are done
    const blocked = blockedByPlan(root, pipeline, task);
    if (blocked) return end({ exit: 1, status: "blocked", errorKind: "plan-gate", error: blocked });
    runKey = safeRef(pipeline) + "/" + safeRef(task) + "/" + safeRef(stage) + "#" + Date.now();
    const runEntry = { pipeline: safeRef(pipeline), task: safeRef(task), stage: safeRef(stage), tool: toolId, startedAt: nowISO(), kill: null };
    ACTIVE_RUNS.set(runKey, runEntry);
    // set true when the user stops the run — the close handler records
    // "stopped" instead of "failed" so the timeline tells the real story
    let stopRequested = false;

    let wt;
    try { wt = ensureTaskWorktree(root, pipeline, task, { workingDir }); }
    catch (e) { return end({ exit: 1, errorKind: "git", error: firstLine(e) }); }
    if (!wt.ok) return end({ exit: 1, errorKind: "git", error: wt.error });
    const W = wt.worktree;
    emit({ t: "meta", branch: wt.branch, worktree: W, pipeline: safeRef(pipeline), task: safeRef(task), stage: safeRef(stage) });

    // ---- 1. prepare the run (NO commit yet — one commit per stage, at the end)
    const startedAt = nowISO();
    const startMs = Date.now();
    const sid = safeRef(stage);
    let sessionId = null; // opencode session id, captured from the run's JSON events
    try {
      // ONE COMMIT PER STAGE: a re-run collapses the stage's previous commit
      // with a SOFT reset — history shrinks back to the last valid commit, but
      // the working tree (previous outputs, run records, prompts.md) is kept,
      // so iterative prompts like "fix the file you wrote" still work. The
      // final commit below then REPLACES the stage's commit.
      const preMeta = readTaskMeta(W, pipeline, task);
      const target = lastValidCommitBefore(W, stageOrderOf(preMeta), sid);
      if (target && git(W, ["rev-parse", "HEAD"]).trim() !== target) git(W, ["reset", "--soft", target]);

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
      // EVERY "Run stage" press appends the typed prompt to a human-readable
      // file next to the stage — .bridza/pipelines/<p>/<t>/<stage>/prompts.md —
      // carried by the stage's single commit, readable/greppable/diffable.
      const plog = path.join(W, rel.stage(pipeline, task, sid), "prompts.md");
      const entry = `## ${startedAt} · run ${track.runs.length} · ${toolId}${model ? " · " + model : ""}\n\n${(prompt && prompt.trim()) || "_(no prompt text — stage defaults)_"}\n\n`;
      if (!fs.existsSync(plog))
        fs.writeFileSync(plog, `# Prompt history — ${stageName || sid}\n\nOne entry per "Run stage" press (oldest first). The same text is in each\nrun record in metadata.json and in the stage's commit message.\n\n` + entry);
      else fs.appendFileSync(plog, entry);
    } catch (e) { return end({ exit: 1, errorKind: "git", error: "run setup failed: " + firstLine(e) }); }

    // ---- 2. run, then the stage's ONE commit ---------------------------------
    // one commit per run: 'exit' (stop path) and 'close' can BOTH fire — the
    // second call must not write a second stage commit.
    let resultDone = false;
    const resultCommit = (exit, status, errorKind, error) => {
      if (resultDone || ended) return;
      resultDone = true;
      // Only a fully-complete stage earns a commit. A failed/stopped run is
      // surfaced live (events + flash) but never committed, so the timeline
      // stays a clean sequence of done stages instead of accumulating error
      // commits. Drop the failed run's untracked partial output so it can't leak
      // into the next stage's commit; `clean -fd` only removes untracked files —
      // prior done output is tracked/staged and left intact (no data loss).
      if (status !== "done") {
        try { git(W, ["clean", "-fd"]); } catch (e) { /* best-effort scrub */ }
        return end({ exit, status, errorKind, error, branch: wt.branch, resultCommit: null, files: [], sessionId });
      }
      try {
        // stage first so the changed-files list (minus scaffolding) can be
        // recorded INTO the metadata that this same commit will carry.
        git(W, ["add", "-A"]);
        const metaRel = rel.taskMeta(pipeline, task);
        const staged = git(W, ["diff", "--cached", "--name-only"]).trim();
        // the agent's output files — exclude bookkeeping (metadata, readme, gitkeep, prompts)
        const files = staged ? staged.split("\n").filter((f) => !f.endsWith(".gitkeep") && f !== metaRel && !f.endsWith("/README.md") && !f.endsWith("/prompts.md")) : [];
        const meta = readTaskMeta(W, pipeline, task);
        const track = meta.tracking[sid] || (meta.tracking[sid] = { status, seconds: 0, runs: [] });
        track.status = status;
        // record the REAL time spent: max of accumulated run-duration and the
        // live wall-clock the UI tracked for this stage (so the committed
        // metadata reflects what the app shows, not just the agent's runtime).
        track.seconds = Math.max((track.seconds || 0) + Math.round((Date.now() - startMs) / 1000), Math.floor(Number(wallSeconds) || 0));
        const r = track.runs[track.runs.length - 1] || {};
        Object.assign(r, { finishedAt: nowISO(), exit, status, files, sessionId, error: error || null, log: outTail.trim() || null });
        writeTaskMeta(W, pipeline, task, meta);
        try { fs.writeFileSync(path.join(W, rel.task(pipeline, task), "README.md"), renderTaskReadme(meta)); } catch (e) { /* readme is best-effort */ }
        const rLines = [
          `bridza(${safeRef(pipeline)}/${safeRef(task)}/${sid}): ${status} · ${toolId} · exit ${exit}`
            + (files.length ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""),
          "", `Stage: ${stageName || sid}`, `Tool: ${toolId}${model ? " · " + model : ""}`,
        ];
        if (taskTitle) rLines.splice(3, 0, `Task: ${taskTitle}`);
        if (sessionId) rLines.push(`opencode-session: ${sessionId}`);
        if (prompt && prompt.trim()) rLines.push("", "Prompt:", prompt.trim().slice(0, 2000));
        rLines.push("", files.length ? `Files (${files.length}): ${files.slice(0, 12).join(", ")}${files.length > 12 ? ", …" : ""}` : "No file changes");
        if (error) rLines.push("", "Error: " + error);
        const c = commitWorktree(W, rLines.join("\n"));
        // record the stage's commit on the run record (needs a second metadata
        // write + amend so the sha lives inside the commit it names — skip the
        // amend dance; the UI resolves diffs from the timeline instead)
        if (c.committed) emit({ t: "commit", phase: "result", sha: c.sha });
        end({ exit, status, errorKind, error, branch: wt.branch, resultCommit: c.sha || null, files, sessionId });
      } catch (e) { end({ exit: exit || 1, status: "failed", errorKind: "git", error: "stage commit failed: " + firstLine(e), branch: wt.branch }); }
    };

    const childEnv = { ...process.env, PWD: W };
    const runShell = (i) => {
      if (i >= shell.length) return resultCommit(0, "done");
      const cmd = String(shell[i] || "").trim();
      if (!cmd) return runShell(i + 1);
      emit({ t: "cmd", cmd });
      const c = spawn("sh", ["-c", cmd], { cwd: W, env: childEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
      runEntry.kill = () => { stopRequested = true; killTree(c); };
      c.stdout.on("data", (d) => emit({ t: "out", d: d.toString() }));
      c.stderr.on("data", (d) => emit({ t: "out", d: d.toString() }));
      c.on("error", (e) => resultCommit(1, "failed", "shell", "shell `" + cmd + "` failed: " + firstLine(e)));
      // on a user stop, act on 'exit' — grandchildren may hold the stdio pipes
      // open long after the tool itself died, and 'close' waits for them.
      c.on("exit", () => { if (stopRequested) resultCommit(1, "stopped", "stopped", "stopped by user"); });
      c.on("close", (code) => stopRequested ? resultCommit(code || 1, "stopped", "stopped", "stopped by user")
        : code ? resultCommit(code, "failed", "shell", "shell `" + cmd + "` exited with code " + code) : runShell(i + 1));
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
    // focused context (linked tickets) rides along in the prompt — the linked
    // tasks' intent plays a bigger role in shaping this stage's work.
    const focus = focusedContext(root, pipeline, task);
    // An empty stage prompt must NOT error the tool: a stage with no typed input
    // still runs off its system prompt + upstream outputs. Default the text sent
    // to the tool (the stored run record keeps showing "no prompt — defaults").
    const basePrompt = (prompt && prompt.trim()) ? prompt : DEFAULT_STAGE_PROMPT;
    const fullPrompt = focus ? String(basePrompt) + "\n\n" + focus : basePrompt;
    const args = tool.args({ prompt: fullPrompt, system, model });
    // show EXACTLY what gets executed (long args abbreviated for readability —
    // the full prompt text is in <stage>/prompts.md). Also flags when NO model
    // flag is passed, i.e. the tool's own configured default decides.
    const shownArgs = args.map((a) => {
      const s = String(a);
      const short = s.length > 160 ? s.slice(0, 157) + "…" : s;
      return /\s|"/.test(short) ? JSON.stringify(short) : short;
    });
    emit({ t: "cmd", cmd: [tool.bin, ...shownArgs].join(" ") });
    if (!model) emit({ t: "out", d: "· model: TOOL DEFAULT (no --model/-m flag — " + toolId + "'s own config decides)\n" });
    // detached → own process group, so a stop kills the tool AND its children
    const child = spawn(tool.bin, args, { cwd: W, env: childEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
    runEntry.kill = () => { stopRequested = true; killTree(child); };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", (d) => emit({ t: "out", d: d.toString() }));
    child.on("error", (e) => resultCommit(1, "failed", "spawn", String(e.message || e)));
    child.on("exit", () => { if (stopRequested) resultCommit(1, "stopped", "stopped", "stopped by user"); });
    child.on("close", (code) => {
      if (stopRequested) return resultCommit(code || 1, "stopped", "stopped", "stopped by user");
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
    // RESUME, never restart: the truth about what's done is the branch tip at
    // THIS moment, not the client's snapshot (which can be stale — a stage that
    // just finished, another window, a reopened task). Skip completed stages.
    try {
      const wt = ensureTaskWorktree(root, s.pipeline, s.task);
      if (wt.ok) {
        const meta = readTaskMeta(wt.worktree, s.pipeline, s.task);
        if ((((meta.tracking || {})[st]) || {}).status === "done") {
          emit({ t: "automate", phase: "skip", index: i, count: stages.length, stage: st, name: s.stageName || st });
          results.push({ stage: st, status: "done", exit: 0, skipped: true, sessionId: null, resultCommit: null });
          continue;
        }
      }
    } catch (e) { /* can't read → just run the stage normally */ }
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

// ── web terminal: run a shell command where the work lives ──────────────────
// Streams a single command's output (NDJSON events like a stage run). cwd is
// the task's worktree when pipeline+task are given (created on demand — so you
// can build/test the branch directly), else the repo root. The caller gets a
// kill handle; the HTTP layer wires it to client disconnect, so closing the
// panel (or ⌃C in it) stops the process.
export function termRun(root, { pipeline, task, cmd } = {}, emit) {
  const c = String(cmd || "").trim();
  if (!c) { emit({ t: "end", exit: 0 }); return { kill() { }, done: Promise.resolve() }; }
  let cwd = root;
  if (pipeline && task) {
    const wt = ensureTaskWorktree(root, pipeline, task);
    if (!wt.ok) { emit({ t: "end", exit: 1, error: wt.error }); return { kill() { }, done: Promise.resolve() }; }
    cwd = wt.worktree;
  }
  emit({ t: "cwd", dir: cwd });
  // detached = own process GROUP, so kill(-pid) reaps the whole tree — killing
  // just `sh` would orphan whatever it spawned (sleep, builds, opencode…).
  const child = spawn("sh", ["-c", c], { cwd, env: { ...process.env, PWD: cwd }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const done = new Promise((resolve) => {
    let ended = false;
    const end = (obj) => { if (ended) return; ended = true; emit({ t: "end", ...obj }); resolve(); };
    child.stdout.on("data", (d) => emit({ t: "out", d: d.toString() }));
    child.stderr.on("data", (d) => emit({ t: "out", d: d.toString() }));
    child.on("error", (e) => end({ exit: 1, error: String((e && e.message) || e) }));
    child.on("close", (code, signal) => end({ exit: code == null ? 1 : code, signal: signal || undefined }));
  });
  const kill = () => {
    try { process.kill(-child.pid, "SIGTERM"); }
    catch (e) { try { child.kill("SIGTERM"); } catch (e2) { /* already gone */ } }
  };
  return { kill, done };
}

// ── reopen: roll the task branch BACK to before a stage ─────────────────────
// Going back to a stage removes that stage's commit and every later one: the
// branch is HARD-reset to the last still-valid commit, so HEAD, the metadata
// and the files all match the moment before the stage first ran. The dropped
// stages' outputs, run records and prompts go with their commits — that's the
// point of the rollback. Works after every stage is done (un-finalized state
// is what the older commit already carries).
export function reopenStage(root, pipeline, task, stage) {
  const bad = validRef(pipeline, "pipeline") || validRef(task, "task") || validRef(stage, "stage");
  if (bad) return { ok: false, error: bad };
  const wt = ensureTaskWorktree(root, pipeline, task);
  if (!wt.ok) return wt;
  const W = wt.worktree;
  const sid = safeRef(stage);
  const meta = readTaskMeta(W, pipeline, task);
  const order = stageOrderOf(meta);
  if (!order.includes(sid)) return { ok: false, error: "unknown stage " + sid };
  const target = lastValidCommitBefore(W, order, sid);
  if (!target) return { ok: false, error: "no valid commit to roll back to" };
  const head = git(W, ["rev-parse", "HEAD"]).trim();
  const removed = head === target ? 0 : parseInt(git(W, ["rev-list", "--count", target + ".." + head]).trim(), 10) || 0;
  if (removed) git(W, ["reset", "--hard", target]);
  const reset = order.slice(order.indexOf(sid));
  return { ok: true, branch: wt.branch, reset, removed, head: target };
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
    // a descriptive merge subject: who this task IS (#ref + title), not just ids
    const key = safeRef(pipeline) + "/" + safeRef(task);
    let title = "", refNum = null;
    try { const m = JSON.parse(git(root, ["show", branch + ":" + rel.taskMeta(pipeline, task)])); if (m.title && m.title !== safeRef(task)) title = m.title; } catch (e) { /* no metadata */ }
    try { refNum = (JSON.parse(fs.readFileSync(path.join(root, DATA_DIR, "refs.json"), "utf8")).refs || {})[key] || null; } catch (e) { /* no refs yet */ }
    const msg = [
      `bridza: finalize ${key}${refNum ? ` · #${refNum}` : ""}${title ? ` "${title.slice(0, 50)}"` : ""} → ${target}`,
      "",
      `Merges task branch ${branch} into ${target} (${style}).`,
    ].join("\n");
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
    // new model: one commit per stage, subject "…): done|failed · tool · exit N"
    // (old branches may still carry prompt/result pairs — parse those too)
    const sm = subject.match(/^bridza\(([^/)]+)\/([^/)]+)\/([^)]+)\):\s*(prompt|result|done|failed)/);
    commits.push({ sha, author, subject, date, stage: sm ? sm[3] : null, kind: sm ? sm[4] : null, files, add, del });
  }
  return { ok: true, branch, commits };
}
