// bridza-store.js — node-side read/write of the .bridza on-disk layout (JSON
// config + .md natural language + outputs/). Enumeration reads the checked-out
// working tree; a task's live tracking is read from its branch tip (where
// runStage commits it). Structural creates (pipeline, task) commit only their
// own .bridza paths to the current branch, never the user's other changes.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, rel, safeRef } from "../src/app/store/bridza.js";
import { git, isGitRepo, branchExists, ensureTaskBranch, taskBranchName } from "./bridza-run.js";

const BIDENT = ["-c", "user.name=bridza", "-c", "user.email=bridza@local"];

// ── small fs helpers ────────────────────────────────────────────────────────

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== ".metadata")
    .map((e) => e.name);
}

// Commit only the given repo-relative paths to the current branch (leaves the
// user's other working-tree changes untouched).
export function commitPaths(root, paths, message) {
  if (!isGitRepo(root)) return { committed: false };
  git(root, ["add", "--", ...paths]);
  const staged = git(root, ["diff", "--cached", "--name-only", "--", ...paths]).trim();
  if (!staged) return { committed: false };
  git(root, [...BIDENT, "commit", "-m", message, "--", ...paths]);
  return { committed: true, files: staged.split("\n") };
}

// ── scaffold ────────────────────────────────────────────────────────────────

// Create .bridza/.metadata the moment a project opens, so the user sees where
// data lives. Idempotent; does NOT commit (the first create action does).
const README_MANIFEST = `# .bridza — this folder IS the database

Bridza stores everything as files, versioned in git. Where each thing lives:

| You see in the app | On disk |
|---|---|
| Pipelines & their stage flow (stages, **system prompts**, outputs, gates) | \`pipelines/<pipeline>/.metadata/metadata.json\` |
| A task's config + **all tracking** (per-stage status, **time**, every run's **prompt**, tool, exit, changed files, commit sha) | \`pipelines/<pipeline>/<task>/metadata.json\` |
| Human-readable summary of a task (status, time, prompts, files) | \`pipelines/<pipeline>/<task>/README.md\` (auto-generated) |
| Task / stage intent (natural language) | \`<task>/context.md\`, \`<task>/<stage>/context.md\` |
| Files a stage produced | \`<task>/<stage>/outputs/\` — for code tasks, product-code edits land in the working dir and show in the commit diff |
| Live wall-clock time per stage (the ticking clock) | \`.cache/time.json\` (gitignored — local only) |
| Global context injected into every prompt | \`.metadata/company-principles.md\`, \`.metadata/universal-rules.md\` |
| The project inbox (captured ideas/bugs/requests before they become tasks) | \`inbox.json\` |

**A task's work lives on its git branch \`bridza/<pipeline>/<task>\`, not on main**, until you Finalize (merge). Open a task's branch in your editor with **"Open in VS Code"** in the app — that checks out the branch in a worktree so you see all of the above.
`;

export function ensureDataDir(root) {
  const dir = path.join(root, DATA_DIR);
  const created = !fs.existsSync(dir);
  if (!fs.existsSync(path.join(root, rel.business())))
    writeJSON(path.join(root, rel.business()), { v: 1, name: path.basename(root), merge: "merge", defaults: { tool: "claude" } });
  for (const [f, seed] of [[rel.principles(), "# Company principles\n"], [rel.rules(), "# Universal rules\n"]])
    if (!fs.existsSync(path.join(root, f))) writeText(path.join(root, f), seed);
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme)) writeText(readme, README_MANIFEST);
  // .bridza/.cache holds the live wall-clock store — local, never committed.
  const gi = path.join(dir, ".gitignore");
  if (!fs.existsSync(gi)) writeText(gi, ".cache/\n");
  return created;
}

// ── per-stage wall-clock time store (.bridza/.cache/time.json, gitignored) ────
// Tracks the time you SPEND on each stage (live 1s clock on the active stage),
// separate from agent run-duration in the branch metadata. Kept out of git so
// the every-10s flush never dirties main; the rail shows max(this, run-seconds).
const timeFile = (root) => path.join(root, DATA_DIR, ".cache", "time.json");
const timeKey = (pipeline, task) => safeRef(pipeline) + "/" + safeRef(task);

export function readTime(root) {
  const j = readJSON(timeFile(root));
  return j && j.tasks ? j : { v: 1, tasks: {} };
}
export function taskTime(root, pipeline, task) { return readTime(root).tasks[timeKey(pipeline, task)] || {}; }

export function mergeTime(root, pipeline, task, map) {
  if (!pipeline || !task) return { ok: false, error: "pipeline + task required" };
  const cur = readTime(root);
  const key = timeKey(pipeline, task);
  const clean = {};
  for (const [k, v] of Object.entries(map || {})) { const n = Math.floor(Number(v)); if (Number.isFinite(n) && n > 0) clean[k] = n; }
  cur.tasks[key] = { ...(cur.tasks[key] || {}), ...clean };
  writeJSON(timeFile(root), cur);
  return { ok: true, time: cur.tasks[key] };
}

// ── reads ───────────────────────────────────────────────────────────────────

// A task's metadata: prefer the branch tip (live tracking written by runStage),
// fall back to the working-tree stub (just created, no branch yet).
export function readTaskMeta(root, pipeline, task) {
  const branch = taskBranchName(pipeline, task);
  const relPath = rel.taskMeta(pipeline, task);
  if (branchExists(root, branch)) {
    try { const j = JSON.parse(git(root, ["show", branch + ":" + relPath])); j._live = true; return j; }
    catch (e) { /* branch exists but no metadata yet — fall through */ }
  }
  const disk = readJSON(path.join(root, relPath));
  return disk || { v: 1, id: safeRef(task), pipeline: safeRef(pipeline), tracking: {} };
}

export function readPipelineDef(root, pipeline) {
  return readJSON(path.join(root, rel.pipelineMeta(pipeline))) || { id: safeRef(pipeline), stages: [] };
}

// Full project state for the UI. Read-only — never writes to the working tree
// (scaffolding happens on the first explicit create, not on open).
export function readProject(root) {
  const business = readJSON(path.join(root, rel.business())) || { v: 1, name: path.basename(root) };
  const pipelinesRoot = path.join(root, rel.pipelines());
  const pipelines = listDirs(pipelinesRoot).map((pid) => {
    const def = readPipelineDef(root, pid);
    const tasks = listDirs(path.join(pipelinesRoot, pid)).map((tid) => {
      const meta = readTaskMeta(root, pid, tid);
      const stages = meta.stages || (def.stages || []).map((s) => s.id);
      const tr = meta.tracking || {};
      const done = stages.filter((s) => tr[s] && tr[s].status === "done").length;
      return {
        id: meta.id || tid, pipeline: pid, title: meta.title || tid,
        status: meta.status || "in-progress", finalized: !!meta.finalized,
        stages, tracking: tr, branch: taskBranchName(pid, tid),
        progress: stages.length ? Math.round((done / stages.length) * 100) : 0,
        live: !!meta._live,
      };
    });
    return { id: def.id || pid, label: def.label || pid, workingDir: def.workingDir || ".", stages: def.stages || [], tasks };
  });
  return { initialized: pipelines.length > 0, business, pipelines, inbox: readInbox(root) };
}

// ── writes (structural creates) ─────────────────────────────────────────────

export function createPipeline(root, { id, label, workingDir = ".", stages = [] }) {
  if (!id) return { ok: false, error: "pipeline id required" };
  const pid = safeRef(id);
  const metaPath = rel.pipelineMeta(pid);
  if (fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "pipeline already exists" };
  ensureDataDir(root);   // materialise .bridza/.metadata now, committed below
  writeJSON(path.join(root, metaPath), { v: 1, id: pid, label: label || id, workingDir, stages });
  const commit = commitPaths(root, [DATA_DIR + "/.gitignore", DATA_DIR + "/README.md", rel.business(), rel.principles(), rel.rules(), metaPath], `bridza: add pipeline ${pid}`);
  return { ok: true, id: pid, committed: commit.committed };
}

// Edit a pipeline's stage flow (the stage definitions: name, system prompt,
// outputs, gate, tool, shell, auto). Stage ids are kept stable on rename so
// existing tasks (keyed by stage id) stay valid; only NEW tasks pick up the new
// flow. Commits just the pipeline's metadata.json.
export function savePipeline(root, { id, label, workingDir, stages }) {
  if (!id) return { ok: false, error: "pipeline id required" };
  const pid = safeRef(id);
  const metaPath = rel.pipelineMeta(pid);
  if (!fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "pipeline not found" };
  const cur = readPipelineDef(root, pid);
  const next = {
    ...cur, id: pid,
    label: label != null ? label : cur.label,
    workingDir: workingDir != null ? workingDir : (cur.workingDir || "."),
    stages: Array.isArray(stages) ? stages.map((s, i) => ({
      id: safeRef(s.id || "stage-" + (i + 1)),
      name: s.name || s.id || "Stage " + (i + 1),
      hint: s.hint || "",
      tool: s.tool || "claude",
      systemPrompt: s.systemPrompt || "",
      outputs: Array.isArray(s.outputs) ? s.outputs.map((o) => ({ name: o.name || "", type: o.type || "doc", note: o.note || "" })) : [],
      shell: Array.isArray(s.shell) ? s.shell.filter((c) => String(c).trim()) : [],
      gate: s.gate || "",
      auto: !!s.auto,
    })) : cur.stages,
  };
  writeJSON(path.join(root, metaPath), next);
  const commit = commitPaths(root, [metaPath], `bridza: edit pipeline ${pid} stage flow`);
  return { ok: true, id: pid, committed: commit.committed, pipeline: next };
}

export function createTask(root, { pipeline, id, title = "", type = "", outputMode = "docs", stages }) {
  const bad = !pipeline ? "pipeline required" : !id ? "task id required" : null;
  if (bad) return { ok: false, error: bad };
  const pid = safeRef(pipeline), tid = safeRef(id);
  const def = readPipelineDef(root, pid);
  const stageIds = stages && stages.length ? stages.map(safeRef) : (def.stages || []).map((s) => s.id);
  const metaPath = rel.taskMeta(pid, tid), ctxPath = rel.taskContext(pid, tid);
  if (fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "task already exists" };
  ensureDataDir(root);   // self-heal the .bridza/README.md map + .gitignore for older projects
  writeJSON(path.join(root, metaPath), {
    v: 1, id: tid, pipeline: pid, title: title || tid, type, outputMode,
    branch: taskBranchName(pid, tid), stages: stageIds, routing: {},
    status: "in-progress", finalized: false, tracking: {},
  });
  writeText(path.join(root, ctxPath), (title ? "# " + title + "\n\n" : "") + "Describe the intent of this task.\n");
  const commit = commitPaths(root, [DATA_DIR + "/README.md", DATA_DIR + "/.gitignore", metaPath, ctxPath], `bridza: add task ${pid}/${tid}`);
  // create the task branch off the just-committed stub so its history starts clean
  const b = ensureTaskBranch(root, pid, tid);
  return { ok: true, id: tid, pipeline: pid, branch: b.branch, committed: commit.committed };
}

// ── plan (the task dependency network + milestones, project-level) ──────────
// Planning data is PROJECT-level, not per-task-branch: it lives in one
// committed file (.bridza/plan.json) on the current branch, so editing the
// network never touches task branches. Shape:
//   deps:       { "<pipeline>/<task>": { all: [key…], any: [key…] } }  AND/OR gate
//   milestones: [{ id, title, due, tasks: [key…], needs: [milestoneId…] }]
//               (a task belongs to AT MOST ONE milestone; needs = milestones
//                that must be fully done before this one can proceed)
//   pos:        { "<pipeline>/<task>": { x, y } }   manual board positions
const KEY_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
const cleanKeys = (a) => [...new Set((Array.isArray(a) ? a : []).filter((k) => typeof k === "string" && KEY_RE.test(k)))];

export function readPlan(root) {
  const j = readJSON(path.join(root, rel.plan()));
  return {
    v: 1,
    deps: (j && j.deps && typeof j.deps === "object") ? j.deps : {},
    milestones: (j && Array.isArray(j.milestones)) ? j.milestones : [],
    pos: (j && j.pos && typeof j.pos === "object") ? j.pos : {},
  };
}

export function savePlan(root, { deps, milestones, pos } = {}) {
  ensureDataDir(root);
  const cur = readPlan(root);
  const nextDeps = {};
  for (const [key, g] of Object.entries(deps != null ? deps : cur.deps)) {
    if (!KEY_RE.test(key)) continue;
    const all = cleanKeys(g && g.all).filter((k) => k !== key);
    const any = cleanKeys(g && g.any).filter((k) => k !== key);
    if (all.length || any.length) nextDeps[key] = { all, any };
  }
  const msIn = (milestones != null ? milestones : cur.milestones).filter((m) => m && m.id && String(m.title || "").trim());
  const msIds = new Set(msIn.map((m) => safeRef(m.id)));
  const claimed = new Set();   // a task may live in only ONE milestone — first wins
  const nextMs = msIn.map((m) => {
    const id = safeRef(m.id);
    const tasks = cleanKeys(m.tasks).filter((k) => !claimed.has(k));
    tasks.forEach((k) => claimed.add(k));
    const needs = [...new Set((Array.isArray(m.needs) ? m.needs : []).map(safeRef).filter((n) => n !== id && msIds.has(n)))];
    return { id, title: String(m.title).slice(0, 80), due: String(m.due || "").slice(0, 40), tasks, needs };
  });
  const nextPos = {};
  for (const [k, v] of Object.entries(pos != null ? pos : cur.pos)) {
    if (KEY_RE.test(k) && v && Number.isFinite(+v.x) && Number.isFinite(+v.y)) nextPos[k] = { x: Math.round(+v.x), y: Math.round(+v.y) };
  }
  const next = { v: 1, deps: nextDeps, milestones: nextMs, pos: nextPos };
  writeJSON(path.join(root, rel.plan()), next);
  const c = commitPaths(root, [DATA_DIR + "/README.md", DATA_DIR + "/.gitignore", rel.plan()], "bridza: edit plan (dependencies/milestones)");
  return { ok: true, plan: next, committed: c.committed };
}

// ── inbox (one triage queue per project) ────────────────────────────────────
// Ideas / bugs / requests land here, then get routed into a pipeline as a task
// (promote) or dropped (discard). Stored as one JSON file, committed.

export function readInbox(root) {
  const j = readJSON(path.join(root, rel.inbox()));
  return j && Array.isArray(j.items) ? j.items : [];
}
function writeInbox(root, items) { writeJSON(path.join(root, rel.inbox()), { v: 1, items }); }

export function addInbox(root, { kind = "idea", text = "" }) {
  if (!String(text).trim()) return { ok: false, error: "empty item" };
  ensureDataDir(root);
  const items = readInbox(root);
  const item = { id: "in-" + Math.random().toString(36).slice(2, 8), kind: ["idea", "bug", "feature"].includes(kind) ? kind : "idea", text: String(text).trim(), time: new Date().toISOString() };
  items.unshift(item);
  writeInbox(root, items);
  const c = commitPaths(root, [DATA_DIR + "/README.md", DATA_DIR + "/.gitignore", rel.inbox()], `bridza: inbox capture (${item.kind})`);
  return { ok: true, item, committed: c.committed };
}

export function discardInbox(root, id) {
  const items = readInbox(root);
  if (!items.some((i) => i.id === id)) return { ok: false, error: "item not found" };
  writeInbox(root, items.filter((i) => i.id !== id));
  commitPaths(root, [rel.inbox()], `bridza: inbox discard ${id}`);
  return { ok: true };
}

// Route an inbox item into a pipeline as a new task (carrying its text into the
// task's context.md), then remove it from the inbox.
export function promoteInbox(root, { id, pipeline }) {
  const items = readInbox(root);
  const item = items.find((i) => i.id === id);
  if (!item) return { ok: false, error: "item not found" };
  if (!pipeline) return { ok: false, error: "pick a pipeline" };
  const title = (item.text || "").split("\n")[0].slice(0, 80).trim() || item.kind;
  const taskId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || id;
  const r = createTask(root, { pipeline, id: taskId, title, type: item.kind });
  if (!r.ok) return r;
  try { saveContext(root, { pipeline, task: r.id, text: (title ? "# " + title + "\n\n" : "") + (item.text || "") + "\n" }); } catch (e) { /* best-effort */ }
  writeInbox(root, items.filter((i) => i.id !== id));
  commitPaths(root, [rel.inbox()], `bridza: inbox promote ${id} → ${safeRef(pipeline)}/${r.id}`);
  return { ok: true, task: r };
}

// Edit the natural-language context for a task or a stage.
export function saveContext(root, { pipeline, task, stage, text }) {
  const p = stage ? rel.stageContext(pipeline, task, stage) : rel.taskContext(pipeline, task);
  writeText(path.join(root, p), String(text ?? ""));
  return { ok: true, ...commitPaths(root, [p], `bridza: edit ${stage ? "stage " + safeRef(stage) : "task"} context ${safeRef(pipeline)}/${safeRef(task)}`) };
}
