// bridza-store.js — node-side read/write of the .bridza on-disk layout (JSON
// config + .md natural language + outputs/). Enumeration reads the checked-out
// working tree; a task's live tracking is read from its branch tip (where
// runStage commits it). Structural creates (pipeline, task) commit only their
// own .bridza paths to the current branch, never the user's other changes.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, rel, safeRef } from "../src/app/store/bridza.js";
import { git, isGitRepo, branchExists, ensureTaskBranch, taskBranchName, removeTaskWorktree, stopRuns } from "./bridza-run.js";

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
| **Every prompt ever typed into "Run stage"** (append-only history) | \`<task>/<stage>/prompts.md\` |
| Files a stage produced | \`<task>/<stage>/outputs/\` — for code tasks, product-code edits land in the working dir and show in the commit diff |
| Live wall-clock time per stage (the ticking clock) | \`.cache/time.json\` (gitignored — local only) |
| Global context injected into every prompt | \`.metadata/company-principles.md\`, \`.metadata/universal-rules.md\` |
| The project inbox (captured ideas/bugs/requests before they become tasks) | \`inbox.json\` |

**A task's work lives on its git branch \`bridza/<pipeline>/<task>\`, not on main**, until you Finalize (merge). Open a task's branch in your editor with **"Open in VS Code"** in the app — that checks out the branch in a worktree so you see all of the above.
`;

// The creation guide: HOW a task/ticket/milestone is created on disk, so an
// agent asked to create work items (e.g. a feature-dissection stage) reads this
// and produces entries Bridza picks up — file layout, metadata requirements.
const CREATION_GUIDE = `# How to create Bridza work items (for agents)

Read this before creating any task, ticket or milestone. Bridza discovers items
from files — create the right files and they appear in the app immediately
(task branches are scanned too, so you may create these inside a task worktree).

## Create a task / ticket

Under \`.bridza/pipelines/<pipeline>/<task-id>/\` (task-id: lowercase, a-z0-9 and
dashes only, max 40 chars):

1. \`metadata.json\` — required:
   \`{ "v": 1, "id": "<task-id>", "pipeline": "<pipeline>", "title": "<human title>",
      "type": "<feature|bug|design|subtask|…>", "status": "in-progress",
      "finalized": false, "stages": [<stage ids from the pipeline's stage flow>],
      "tracking": {} }\`
   Stage ids come from \`.bridza/pipelines/<pipeline>/.metadata/metadata.json\`.
   Do NOT invent stage ids; reuse the pipeline's flow (or a template's subset).
2. \`context.md\` — required: the intent. First line \`# <title>\`, then WHAT and
   WHY, acceptance criteria if known. This is the prompt seed for every stage.

Commit both files. Do not create branches or worktrees — Bridza does that when
a stage first runs. Do not write a \`ref\` number — Bridza assigns it.

## Split a feature into sub-tasks (dissection)

Create one task per sub-feature as above (type: "subtask"), each with its own
context.md. Then record ordering in \`.bridza/plan.json\` under \`deps\`:
\`{ "deps": { "<pipeline>/<child>": { "all": ["<pipeline>/<parent-or-sibling>"], "any": [] } } }\`
Merge into the existing file — never overwrite other entries.

## Create a milestone

Append to \`milestones\` in \`.bridza/plan.json\`:
\`{ "id": "ms-<slug>", "title": "<title>", "due": "YYYY-MM-DD or empty", "tasks": ["<pipeline>/<task>", …], "needs": [] }\`
A task may belong to at most ONE milestone.
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
  const guide = path.join(dir, ".metadata", "creation-guide.md");
  if (!fs.existsSync(guide)) writeText(guide, CREATION_GUIDE);
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

// ── task refs (#numbers) ─────────────────────────────────────────────────────
// Every task gets a stable project-wide #number so it can be addressed directly
// ("#12"). One committed file (.bridza/refs.json): { v, next, refs: { "<p>/<t>": n } }.
// Numbers are never reused — deleting a task retires its number.
const refsFile = (root) => path.join(root, DATA_DIR, "refs.json");

export function readRefs(root) {
  const j = readJSON(refsFile(root));
  return {
    v: 1,
    next: (j && Number.isInteger(j.next) && j.next > 0) ? j.next : 1,
    refs: (j && j.refs && typeof j.refs === "object") ? j.refs : {},
    // tombstones: deleted tasks stay deleted even if their dir still exists on
    // some task branch (branch scanning would otherwise resurrect them)
    deleted: (j && Array.isArray(j.deleted)) ? j.deleted : [],
  };
}

// Assign #numbers to the given task keys that don't have one yet. Commits once.
export function assignRefs(root, keys) {
  const cur = readRefs(root);
  const assigned = [];
  for (const k of keys) {
    if (!KEY_RE.test(k) || cur.refs[k]) continue;
    cur.refs[k] = cur.next++;
    assigned.push(`#${cur.refs[k]} → ${k}`);
  }
  if (assigned.length) {
    writeJSON(refsFile(root), cur);
    commitPaths(root, [DATA_DIR + "/refs.json"],
      `bridza: assign task #ref${assigned.length === 1 ? "" : "s"} ${assigned.slice(0, 6).join(", ")}${assigned.length > 6 ? ` (+${assigned.length - 6} more)` : ""}`);
  }
  return cur.refs;
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

// Tasks that exist only on bridza/* branches (created by an agent inside a task
// worktree, not yet merged to main). Scanning branch tips makes them visible in
// the app INSTANTLY — no branch switching or juggling.
//
// The scan is CACHED on the branch-tip shas: the UI polls /state every few
// seconds, and each ls-tree/show is a synchronous git spawn — rescanning only
// when some bridza branch tip actually moved keeps the poll at one git call.
let BRANCH_SCAN = { root: null, key: null, found: new Map(), metas: new Map() };
function scanBranches(root) {
  let refs = "";
  try { refs = git(root, ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/bridza/"]).trim(); }
  catch (e) { refs = ""; }
  if (BRANCH_SCAN.root === root && BRANCH_SCAN.key === refs) return BRANCH_SCAN;
  const found = new Map();   // pipelineId → Set<taskId> discovered at branch tips
  const branches = refs ? refs.split("\n").map((l) => l.split(" ")[0]) : [];
  for (const b of branches) {
    let out = "";
    try { out = git(root, ["ls-tree", "-d", "--name-only", b, DATA_DIR + "/pipelines/"]); } catch (e) { continue; }
    for (const pdir of out.trim().split("\n").filter(Boolean)) {
      const pid = path.posix.basename(pdir);
      if (pid === ".metadata") continue;
      let tdirs = "";
      try { tdirs = git(root, ["ls-tree", "-d", "--name-only", b, pdir + "/"]); } catch (e) { continue; }
      for (const tdir of tdirs.trim().split("\n").filter(Boolean)) {
        const tid = path.posix.basename(tdir);
        if (tid === ".metadata") continue;
        if (!found.has(pid)) found.set(pid, new Set());
        found.get(pid).add(tid);
      }
    }
  }
  BRANCH_SCAN = { root, key: refs, found, metas: new Map(), branches };
  return BRANCH_SCAN;
}

// A task's metadata: its own branch tip, else the working-tree file, else ANY
// bridza branch carrying it (a task an agent created on another task's branch).
// Memoized in the scan until some bridza branch tip moves — every run/reopen/
// create commits to a branch, so tip movement IS the invalidation signal.
function readTaskMetaFromAnyBranch(root, scan, pipeline, task) {
  const key = safeRef(pipeline) + "/" + safeRef(task);
  if (scan.metas.has(key)) return scan.metas.get(key);
  const own = readTaskMeta(root, pipeline, task);
  if (own._live || own.title || (own.stages && own.stages.length)) {
    scan.metas.set(key, own);
    return own;
  }
  const relPath = rel.taskMeta(pipeline, task);
  for (const b of scan.branches || []) {
    try {
      const j = JSON.parse(git(root, ["show", b + ":" + relPath]));
      j._live = true; j._onBranch = b;
      scan.metas.set(key, j);
      return j;
    } catch (e) { /* next branch */ }
  }
  scan.metas.set(key, own);
  return own;
}

// Full project state for the UI. Read-only — never writes to the working tree
// (scaffolding happens on the first explicit create, not on open).
export function readProject(root) {
  const business = readJSON(path.join(root, rel.business())) || { v: 1, name: path.basename(root) };
  const pipelinesRoot = path.join(root, rel.pipelines());
  const refsAll = readRefs(root);
  const refs = refsAll.refs;
  const tombstones = new Set(refsAll.deleted);
  const scan = scanBranches(root);
  const pids = [...new Set([...listDirs(pipelinesRoot), ...scan.found.keys()])];
  const pipelines = pids.map((pid) => {
    const def = readPipelineDef(root, pid);
    const tids = [...new Set([...listDirs(path.join(pipelinesRoot, pid)), ...(scan.found.get(pid) || [])])]
      .filter((tid) => !tombstones.has(pid + "/" + tid));
    const tasks = tids.map((tid) => {
      const meta = readTaskMetaFromAnyBranch(root, scan, pid, tid);
      const defStages = (def.stages || []).map((s) => s.id);
      // template tasks keep their own (subset) flow; otherwise show the FULL
      // pipeline flow — upcoming steps are visible even before they run.
      const stages = meta.template && (meta.stages || []).length
        ? meta.stages
        : [...new Set([...(meta.stages || []), ...defStages])];
      const tr = meta.tracking || {};
      const done = stages.filter((s) => tr[s] && tr[s].status === "done").length;
      return {
        id: meta.id || tid, pipeline: pid, title: meta.title || tid,
        ref: refs[pid + "/" + tid] || meta.ref || null,
        type: meta.type || "", template: meta.template || "",
        status: meta.status || "in-progress", finalized: !!meta.finalized,
        stages, tracking: tr, branch: taskBranchName(pid, tid),
        progress: stages.length ? Math.round((done / stages.length) * 100) : 0,
        live: !!meta._live, onBranch: meta._onBranch || null,
      };
    });
    return { id: def.id || pid, label: def.label || pid, workingDir: def.workingDir || ".", stages: def.stages || [], templates: def.templates || [], tasks };
  });
  return { initialized: pipelines.length > 0, business, pipelines, inbox: readInbox(root) };
}

// ── writes (structural creates) ─────────────────────────────────────────────

// Task templates: a pipeline can carry several (bugfix, design, feature,
// dissection…). Each picks a SUBSET of the pipeline's stage pool for new tasks.
const normTemplates = (templates) => (Array.isArray(templates) ? templates : [])
  .filter((t) => t && t.id)
  .map((t) => ({ id: safeRef(t.id), label: t.label || t.id, description: String(t.description || ""), stages: (Array.isArray(t.stages) ? t.stages : []).map(safeRef) }));

export function createPipeline(root, { id, label, workingDir = ".", stages = [], templates = [] }) {
  if (!id) return { ok: false, error: "pipeline id required" };
  const pid = safeRef(id);
  const metaPath = rel.pipelineMeta(pid);
  if (fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "pipeline already exists" };
  ensureDataDir(root);   // materialise .bridza/.metadata now, committed below
  const tpls = normTemplates(templates);
  writeJSON(path.join(root, metaPath), { v: 1, id: pid, label: label || id, workingDir, stages, templates: tpls });
  const flow = (stages || []).map((s) => s.name || s.id).join(" → ");
  const msg = [
    `bridza: add pipeline "${label || id}" (${pid}) · ${stages.length} stage${stages.length === 1 ? "" : "s"}`,
    "",
    `Stage flow: ${flow || "(none)"}`,
    `Working dir: ${workingDir}`,
    ...(tpls.length ? [`Templates: ${tpls.map((t) => t.label).join(", ")}`] : []),
  ].join("\n");
  const commit = commitPaths(root, [DATA_DIR + "/.gitignore", DATA_DIR + "/README.md", DATA_DIR + "/.metadata/creation-guide.md", rel.business(), rel.principles(), rel.rules(), metaPath], msg);
  return { ok: true, id: pid, committed: commit.committed };
}

// Edit a pipeline's stage flow (the stage definitions: name, system prompt,
// outputs, gate, tool, shell, auto). Stage ids are kept stable on rename so
// existing tasks (keyed by stage id) stay valid; only NEW tasks pick up the new
// flow. Commits just the pipeline's metadata.json.
export function savePipeline(root, { id, label, workingDir, stages, templates }) {
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
    templates: templates != null ? normTemplates(templates) : (cur.templates || []),
  };
  writeJSON(path.join(root, metaPath), next);
  const msg = [
    `bridza: edit pipeline "${next.label || pid}" (${pid}) stage flow · ${next.stages.length} stage${next.stages.length === 1 ? "" : "s"}`,
    "",
    `Stage flow: ${next.stages.map((s) => s.name || s.id).join(" → ") || "(none)"}`,
    ...(next.templates.length ? [`Templates: ${next.templates.map((t) => t.label).join(", ")}`] : []),
  ].join("\n");
  const commit = commitPaths(root, [metaPath], msg);
  return { ok: true, id: pid, committed: commit.committed, pipeline: next };
}

export function createTask(root, { pipeline, id, title = "", type = "", outputMode = "docs", stages, template = "" }) {
  const bad = !pipeline ? "pipeline required" : !id ? "task id required" : null;
  if (bad) return { ok: false, error: bad };
  const pid = safeRef(pipeline), tid = safeRef(id);
  const def = readPipelineDef(root, pid);
  // stage flow: explicit stages > the chosen template's subset > the pipeline flow
  const tpl = template ? (def.templates || []).find((t) => t.id === safeRef(template)) : null;
  const stageIds = stages && stages.length ? stages.map(safeRef)
    : tpl && tpl.stages.length ? tpl.stages
      : (def.stages || []).map((s) => s.id);
  const metaPath = rel.taskMeta(pid, tid), ctxPath = rel.taskContext(pid, tid);
  if (fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "task already exists" };
  ensureDataDir(root);   // self-heal the .bridza/README.md map + .gitignore for older projects
  // recreating a previously-deleted id lifts its tombstone (it gets a NEW #ref)
  const refsCur = readRefs(root);
  if (refsCur.deleted.includes(pid + "/" + tid)) {
    refsCur.deleted = refsCur.deleted.filter((k) => k !== pid + "/" + tid);
    writeJSON(refsFile(root), refsCur);
  }
  const ref = assignRefs(root, [pid + "/" + tid])[pid + "/" + tid];
  writeJSON(path.join(root, metaPath), {
    v: 1, id: tid, pipeline: pid, title: title || tid, ref, type: type || (tpl ? tpl.id : ""), template: tpl ? tpl.id : "", outputMode,
    branch: taskBranchName(pid, tid), stages: stageIds, routing: {},
    status: "in-progress", finalized: false, tracking: {},
  });
  writeText(path.join(root, ctxPath), (title ? "# " + title + "\n\n" : "") + "Describe the intent of this task.\n");
  const msg = [
    `bridza: add task #${ref} "${(title || tid).slice(0, 50)}" (${pid}/${tid})`,
    "",
    `Branch: ${taskBranchName(pid, tid)}`,
    `Stages: ${stageIds.join(" → ")}`,
    ...(tpl ? [`Template: ${tpl.label || tpl.id}`] : []),
    ...(type && (!tpl || type !== tpl.id) ? [`Type: ${type}`] : []),
  ].join("\n");
  const commit = commitPaths(root, [DATA_DIR + "/README.md", DATA_DIR + "/.gitignore", DATA_DIR + "/.metadata/creation-guide.md", metaPath, ctxPath], msg);
  // create the task branch off the just-committed stub so its history starts clean
  const b = ensureTaskBranch(root, pid, tid);
  return { ok: true, id: tid, pipeline: pid, ref, branch: b.branch, committed: commit.committed };
}

// ── delete a task ────────────────────────────────────────────────────────────
// Completely removes the task from the database (.bridza task dir, its refs
// entry, plan wiring, worktree) while MAINTAINING git history: the removal is
// itself a commit, and the task's branch (its full prompt→result history) is
// kept unless deleteBranch is set. Any live run is stopped first.
export function deleteTask(root, { pipeline, task, deleteBranch = false }) {
  if (!pipeline || !task) return { ok: false, error: "pipeline + task required" };
  const pid = safeRef(pipeline), tid = safeRef(task);
  const key = pid + "/" + tid;
  // identity for the commit message, captured BEFORE anything is removed
  const meta = readTaskMeta(root, pid, tid);
  const refNum = readRefs(root).refs[key] || meta.ref || null;
  const who = `${refNum ? "#" + refNum + " " : ""}"${(meta.title || tid).slice(0, 50)}"`;
  try { stopRuns(pid, tid); } catch (e) { /* nothing running */ }
  try { removeTaskWorktree(root, pid, tid); } catch (e) { /* no worktree */ }

  // 1) the task dir on the current branch — committed so history shows the delete
  const taskDir = path.join(root, rel.task(pid, tid));
  let committed = false;
  if (fs.existsSync(taskDir)) {
    fs.rmSync(taskDir, { recursive: true, force: true });
    committed = commitPaths(root, [rel.task(pid, tid)], [
      `bridza: delete task ${who} (${key}) — task info removed`,
      "",
      "Removed from the database (.bridza task dir). Git history is kept" + (deleteBranch ? "," : ` on branch ${taskBranchName(pid, tid)},`),
      "and this commit itself records the deletion.",
    ].join("\n")).committed;
  }

  // 2) retire its #ref (the number is never reused) + tombstone it so branch
  //    scanning can't resurrect it from another task's branch tip
  const refs = readRefs(root);
  delete refs.refs[key];
  if (!refs.deleted.includes(key)) refs.deleted.push(key);
  writeJSON(refsFile(root), refs);
  commitPaths(root, [DATA_DIR + "/refs.json"], `bridza: retire ${refNum ? "#" + refNum : "the #ref"} of deleted task ${key} — numbers are never reused`);

  // 3) unwire it from the plan (deps in BOTH directions, links, milestones, pos)
  const plan = readPlan(root);
  let planTouched = false;
  const scrub = (arr) => { const n = (arr || []).filter((k) => k !== key); if (n.length !== (arr || []).length) planTouched = true; return n; };
  if (plan.deps[key]) { delete plan.deps[key]; planTouched = true; }
  for (const g of Object.values(plan.deps)) { g.all = scrub(g.all); g.any = scrub(g.any); }
  if (plan.links[key]) { delete plan.links[key]; planTouched = true; }
  for (const [k, list] of Object.entries(plan.links)) plan.links[k] = scrub(list);
  plan.milestones.forEach((m) => { m.tasks = scrub(m.tasks); });
  if (plan.pos[key]) { delete plan.pos[key]; planTouched = true; }
  if (planTouched) savePlan(root, plan);

  // 4) optionally drop the branch (default: keep — that's the git history)
  let branchDeleted = false;
  const branch = taskBranchName(pid, tid);
  if (deleteBranch && branchExists(root, branch)) {
    try { git(root, ["branch", "-D", branch]); branchDeleted = true; } catch (e) { /* leave it */ }
  }
  return { ok: true, key, committed, branchDeleted, branchKept: !branchDeleted && branchExists(root, branch) };
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
    links: (j && j.links && typeof j.links === "object") ? j.links : {},
  };
}

export function savePlan(root, { deps, milestones, pos, links } = {}) {
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
  // focused-context links: task → the tickets attached to it as context
  const nextLinks = {};
  for (const [k, list] of Object.entries(links != null ? links : cur.links)) {
    if (!KEY_RE.test(k)) continue;
    const clean = cleanKeys(list).filter((x) => x !== k);
    if (clean.length) nextLinks[k] = clean;
  }
  const next = { v: 1, deps: nextDeps, milestones: nextMs, pos: nextPos, links: nextLinks };
  writeJSON(path.join(root, rel.plan()), next);
  const nD = Object.keys(nextDeps).length, nM = nextMs.length, nL = Object.keys(nextLinks).length;
  const msg = [
    `bridza: edit plan · ${nD} dep gate${nD === 1 ? "" : "s"}, ${nM} milestone${nM === 1 ? "" : "s"}, ${nL} context link${nL === 1 ? "" : "s"}`,
    "",
    ...(nM ? [`Milestones: ${nextMs.map((m) => m.title).join(", ").slice(0, 200)}`] : []),
  ].join("\n");
  const c = commitPaths(root, [DATA_DIR + "/README.md", DATA_DIR + "/.gitignore", DATA_DIR + "/.metadata/creation-guide.md", rel.plan()], msg);
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
  const snip = item.text.replace(/\s+/g, " ").slice(0, 48) + (item.text.length > 48 ? "…" : "");
  const c = commitPaths(root, [DATA_DIR + "/README.md", DATA_DIR + "/.gitignore", DATA_DIR + "/.metadata/creation-guide.md", rel.inbox()], `bridza: inbox capture (${item.kind}) · "${snip}"`);
  return { ok: true, item, committed: c.committed };
}

export function discardInbox(root, id) {
  const items = readInbox(root);
  const item = items.find((i) => i.id === id);
  if (!item) return { ok: false, error: "item not found" };
  writeInbox(root, items.filter((i) => i.id !== id));
  const snip = (item.text || "").replace(/\s+/g, " ").slice(0, 48);
  commitPaths(root, [rel.inbox()], `bridza: inbox discard (${item.kind}) · "${snip}"`);
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
  commitPaths(root, [rel.inbox()], `bridza: inbox promote (${item.kind}) "${title.slice(0, 40)}" → task ${r.ref ? "#" + r.ref + " " : ""}${safeRef(pipeline)}/${r.id}`);
  return { ok: true, task: r };
}

// Edit the natural-language context for a task or a stage.
export function saveContext(root, { pipeline, task, stage, text }) {
  const p = stage ? rel.stageContext(pipeline, task, stage) : rel.taskContext(pipeline, task);
  writeText(path.join(root, p), String(text ?? ""));
  const snip = String(text ?? "").trim().split("\n")[0].replace(/^#\s*/, "").slice(0, 48);
  return { ok: true, ...commitPaths(root, [p], `bridza: edit ${stage ? "stage " + safeRef(stage) : "task"} context of ${safeRef(pipeline)}/${safeRef(task)}${snip ? ` · "${snip}"` : ""}`) };
}
