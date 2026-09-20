// bridza-store.js — node-side read/write of the .bridza on-disk layout (JSON
// config + .md natural language + outputs/). Enumeration reads the checked-out
// working tree; a task's live tracking is read from its branch tip (where
// runStage commits it). Structural creates (pipeline, task) commit only their
// own .bridza paths to the current branch, never the user's other changes.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, rel, safeRef, shortTitle, taskSlug, taskDirName, parseTaskDir, pipelineFlows, flattenFlows } from "../core/domain.js";
import { git, isGitRepo, branchExists, baseBranchName, ensureTaskBranch, taskBranchName, taskDirOn, taskDirAt, removeTaskWorktree, stopRuns, healTaskFlow, validRef } from "./bridza-run.js";

const BEMAIL = "bridza@local";
const BIDENT = ["-c", "user.name=bridza", "-c", "user.email=" + BEMAIL];

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
function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (e) { return ""; }
}
function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== ".metadata")
    .map((e) => e.name);
}
// Task folders are named "<padded-ref>-<id>" under the naming contract and
// bare "<id>" for tasks that predate it. Everything above the filesystem —
// refs.json, plan.json, branch names, the UI — speaks the plain id, so strip
// the prefix the moment a listing crosses that line.
function listTaskIds(dir) {
  return listDirs(dir).map((d) => parseTaskDir(d).id);
}

// ── one commit per user action ──────────────────────────────────────────────
// Every write helper below commits for itself, and the high-level actions are
// built by COMPOSING those helpers — so one click used to produce 4–5 commits
// (promoting an inbox item = assign #ref + add task + edit plan + edit context
// + drop from inbox). Two things fold those back into one:
//
//   withAction(root, fn)      — the writes of ONE user action: the first one
//     commits, every later one amends that commit, and each helper's own
//     message stays as a line in the commit body. The path the action took is
//     kept; the commit count is not.
//   commitPaths(…, { fold })  — repeats of the SAME edit outside an action
//     (drag a kanban column four times, add context links one by one) amend
//     bridza's last commit while it is still fresh and carries the same key.
//
// A commit is only ever rewritten when it is safe: bridza's own (never the
// user's), still the branch tip, nothing else pointing at or past it (a task
// branch forked off it, a remote-tracking ref, a tag), and with no unrelated
// staged changes of the user's that an amend would swallow.
const FOLD_TRAILER = "Bridza-fold:";
const FOLD_WINDOW_MS = 5 * 60 * 1000;

let ACTION = null;

// `fn` must be synchronous — every store write is, and the scope is process-wide.
function withAction(root, fn) {
  if (ACTION) return fn();                 // nested — the outermost scope owns the commit
  const scope = ACTION = { root, title: "", steps: [], sha: null, after: [] };
  try {
    return fn();
  } finally {
    ACTION = null;
    // queued work must see the action's FINAL commit (see afterAction)
    for (const f of scope.after) { try { f(); } catch (e) { /* best-effort */ } }
  }
}

// Name the in-flight action once its details are known (the #ref is assigned
// mid-action, for instance) — the step that best describes the whole action
// hands its message in and its first line becomes the commit subject. Unnamed,
// the action is titled by its first step. No-op outside an action scope.
function nameAction(message) { if (ACTION && message) ACTION.title = String(message).split("\n")[0]; }

// Defer work that must run against the action's final commit — forking a task
// branch off it, say: done inline it would pin the pre-amend commit and be left
// behind by the fold. Runs immediately when there is no action in flight.
function afterAction(root, fn) {
  if (ACTION && ACTION.root === root) { ACTION.after.push(fn); return; }
  fn();
}

// title + one block per folded step — "this is the path the action took"
function scopeMessage(scope) {
  const [first, ...rest] = scope.steps;
  const subject = scope.title || first.split("\n")[0];
  if (!rest.length) return [subject, ...first.split("\n").slice(1)].join("\n").trimEnd();
  return [
    subject,
    "",
    "Folded into one commit — the steps this action took:",
    "",
    ...scope.steps.map((m) => m.split("\n").map((l, i) => (i === 0 ? "- " + l : l ? "  " + l : "")).join("\n")),
  ].join("\n").trimEnd();
}

const foldMessage = (message, fold) => (fold ? message.trimEnd() + "\n\n" + FOLD_TRAILER + " " + fold : message);

// %at (author date) survives an amend, so the fold window is measured from the
// FIRST write of a run of edits — folding can't keep extending itself forever.
function headCommit(root) {
  try {
    const [sha, email, at, ...body] = git(root, ["log", "-1", "--format=%H%n%ae%n%at%n%B"]).split("\n");
    return { sha, email, at: Number(at) * 1000, body: body.join("\n") };
  } catch (e) { return null; }   // no commits yet
}

// Rewriting a commit is only safe while the current branch is the sole ref
// reaching it — anything else (a forked task branch, origin/…, a tag) would be
// left behind pointing at the version we are about to replace.
function onlyHeadReaches(root, sha) {
  try {
    const head = git(root, ["symbolic-ref", "-q", "HEAD"]).trim();
    const refs = git(root, ["for-each-ref", "--contains", sha, "--format=%(refname)"]).trim();
    return refs.split("\n").filter(Boolean).every((r) => r === head);
  } catch (e) { return false; }
}

// The commit this write may fold into, or null for a fresh commit.
function foldTarget(root, scope, fold) {
  const head = headCommit(root);
  if (!head || head.email !== BEMAIL) return null;
  if (scope) {
    if (scope.sha !== head.sha) return null;                     // someone committed in between
  } else {
    if (!fold || !head.body.includes(FOLD_TRAILER + " " + fold)) return null;
    if (Date.now() - head.at > FOLD_WINDOW_MS) return null;      // a fresh repeat, not a new session
  }
  return onlyHeadReaches(root, head.sha) ? head : null;
}

// Staged changes of the user's that are NOT ours: amending commits the whole
// index, so their presence rules the fold out (a plain commit -- <paths> can't
// touch them).
function foreignStaged(root, paths) {
  const mine = paths.map((p) => String(p).replace(/\/+$/, ""));
  return git(root, ["diff", "--cached", "--name-only"]).trim().split("\n").filter(Boolean)
    .filter((f) => !mine.some((p) => f === p || f.startsWith(p + "/")));
}

// Commit only the given repo-relative paths to the current branch (leaves the
// user's other working-tree changes untouched), folding into the commit already
// in flight when that is safe — see the note above.
export function commitPaths(root, paths, message, { fold = "" } = {}) {
  if (!isGitRepo(root)) return { committed: false };
  git(root, ["add", "--", ...paths]);
  const staged = git(root, ["diff", "--cached", "--name-only", "--", ...paths]).trim();
  if (!staged) return { committed: false };
  const files = staged.split("\n");
  const scope = ACTION && ACTION.root === root ? ACTION : null;
  const into = foldTarget(root, scope, fold);
  const amend = !!into && !foreignStaged(root, paths).length;
  if (scope) scope.steps = amend ? [...scope.steps, message] : [message];
  const msg = scope ? scopeMessage(scope) : foldMessage(message, fold);
  if (amend) git(root, [...BIDENT, "commit", "--amend", "-m", msg]);
  else git(root, [...BIDENT, "commit", "-m", msg, "--", ...paths]);
  if (scope) scope.sha = git(root, ["rev-parse", "HEAD"]).trim();
  return { committed: true, amended: amend, files };
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
context.md. Then record ordering in \`.bridza/plan.json\` under \`deps\`.

## The model in one picture (read this first) <!-- plan-guide-v3 -->

The plan board is a NETWORK DIAGRAM. Think of it as:
- Each TASK is a node.
- A DEPENDENCY is a directed edge "B waits on A" (A must finish before B runs).
  Where several edges meet a task, they pass through an AND gate (all required)
  or an OR gate (any one is enough).
- A MILESTONE is a box drawn around a set of tasks; \`needs\` sequences boxes.
- An ESTIMATE (hours) is the weight on a node; it sizes the critical path.

You only ever describe THREE things per task: what it waits on (deps), how big
it is (est), and which milestone it belongs to. Bridza draws the whole diagram,
computes the critical path, and enforces the gates automatically — you never
lay out or connect anything by hand.

## Wire dependencies (the AND & OR network)

\`.bridza/plan.json\` \`deps\` is the gate network the board renders and ENFORCES
(a task's stages refuse to run until its gate opens):
\`{ "deps": { "<pipeline>/<task>": { "all": ["<key>", …], "any": ["<key>", …] } } }\`
- \`all\` = AND: every listed task must be done first.
- \`any\` = OR: at least one listed task must be done (use for alternatives).
- Keys are "<pipeline>/<task>" and may CROSS pipelines freely. Independent work
  gets NO deps; never invent ordering the work doesn't require.
Merge into the existing file — never overwrite entries you didn't create.

## Estimate the cost of each task

\`.bridza/plan.json\` \`est\` maps task → estimated HOURS of work (numbers):
\`{ "est": { "<pipeline>/<task>": 4, … } }\`
Estimate every task you create; the board weights the critical path with it.

## Create a milestone

Append to \`milestones\` in \`.bridza/plan.json\`:
\`{ "id": "ms-<slug>", "title": "<title>", "due": "YYYY-MM-DD or empty", "tasks": ["<pipeline>/<task>", …], "needs": ["<other-milestone-id>", …] }\`
A task belongs to at most ONE milestone, but a milestone's tasks may SPAN
pipelines (a launch touching engineering + content + marketing). \`needs\` orders
milestones. Bridza keeps the one-milestone-per-task rule for you.

## Worked example — three tasks, one milestone

\`\`\`json
{
  "deps": {
    "eng/build-api":  { "all": ["eng/design-schema"], "any": [] },
    "eng/build-ui":   { "all": ["eng/design-schema"], "any": [] },
    "eng/ship":       { "all": ["eng/build-api", "eng/build-ui"], "any": [] }
  },
  "est": { "eng/design-schema": 4, "eng/build-api": 8, "eng/build-ui": 8, "eng/ship": 2 },
  "milestones": [
    { "id": "ms-v1", "title": "v1 launch", "due": "", "tasks": ["eng/build-api", "eng/build-ui", "eng/ship"], "needs": [] }
  ]
}
\`\`\`
This renders as: schema → (api, ui in parallel) → AND gate → ship, all inside the
"v1 launch" box; the critical path is schema→build→ship (14h).

Tip: when the follow-on relationship is simple, you don't need to touch
plan.json at all — creating a task with a \`dependsOn\` key auto-wires the AND-dep,
the context link, its \`est\`, and its \`milestone\`. Use plan.json directly only for
the richer multi-parent / OR / cross-pipeline structure above.

## Pipeline-level sequence (only when truly ordered)

\`pipeDeps\` orders WHOLE pipelines: \`{ "pipeDeps": [{ "from": "<pipeline>", "to": "<pipeline>" }] }\`
Every NEW task in \`to\` is auto-gated on \`from\`'s open tasks. Pipelines are NOT
all sequential: some block another, some are fully independent (no edge), and
one may feed several others (multiple edges). Add an edge only where the order
is real; prefer task-level \`deps\` for anything finer-grained.

## The planning contract

A planning/breakdown stage is done ONLY when its output is on the plan board:
tasks created as files, deps + est + milestones merged into \`.bridza/plan.json\`.
Docs alone don't count. The user will review, rearrange, re-estimate or delete
items on the board afterwards — structure generously, but keep every item real.
`;

export function ensureDataDir(root) {
  const dir = path.join(root, DATA_DIR);
  const created = !fs.existsSync(dir);
  if (!fs.existsSync(path.join(root, rel.business())))
    writeJSON(path.join(root, rel.business()), { v: 1, name: path.basename(root), merge: "merge", defaults: { tool: "opencode" } });
  for (const [f, seed] of [[rel.principles(), "# Company principles\n"], [rel.rules(), "# Universal rules\n"]])
    if (!fs.existsSync(path.join(root, f))) writeText(path.join(root, f), seed);
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme)) writeText(readme, README_MANIFEST);
  // refresh the guide when it predates the plan-board contract (v2 marker)
  const guide = path.join(dir, ".metadata", "creation-guide.md");
  let guideCur = ""; try { guideCur = fs.readFileSync(guide, "utf8"); } catch (e) { /* absent */ }
  if (!guideCur.includes("plan-guide-v3")) writeText(guide, CREATION_GUIDE);
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
  const prev = cur.tasks[key] || {};
  // #14 — total wall-clock per stage lives at the top level; the IDLE portion
  // (stage open, no typing, no run) rides along under a reserved __idle sub-map,
  // so work = total − idle. Extra keys are ignored by the per-stage readers.
  const clean = {};
  let idleIn = null;
  for (const [k, v] of Object.entries(map || {})) {
    if (k === "__idle") { if (v && typeof v === "object") idleIn = v; continue; }
    const n = Math.floor(Number(v)); if (Number.isFinite(n) && n > 0) clean[k] = n;
  }
  const nextIdle = { ...(prev.__idle || {}) };
  if (idleIn) for (const [k, v] of Object.entries(idleIn)) { const n = Math.floor(Number(v)); if (Number.isFinite(n) && n > 0) nextIdle[k] = n; }
  cur.tasks[key] = { ...prev, ...clean };
  if (Object.keys(nextIdle).length) cur.tasks[key].__idle = nextIdle;   // keep the common case clean
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
    // board-wide archive state, key → bool. Lives HERE (root, base branch) and
    // not in the task's metadata.json, because a task's metadata is read from
    // its bridza/* branch tip — which is never pushed, so it can't cross to
    // another computer. Explicit `false` is kept so that unarchiving also wins
    // over a legacy `archived: true` left in an old task metadata.json.
    archived: (j && j.archived && typeof j.archived === "object" && !Array.isArray(j.archived)) ? j.archived : {},
    tags: (j && j.tags && typeof j.tags === "object" && !Array.isArray(j.tags)) ? j.tags : {},
    taskTags: (j && j.taskTags && typeof j.taskTags === "object" && !Array.isArray(j.taskTags)) ? j.taskTags : {},
  };
}

export const TAG_PALETTE = ["violet", "indigo", "blue", "emerald", "amber", "rose", "cyan", "orange"];

export function createTag(root, { name, color }) {
  if (!name || typeof name !== "string" || !name.trim()) return { ok: false, error: "name required" };
  if (!TAG_PALETTE.includes(color)) return { ok: false, error: "invalid color" };
  // lowercased before slugging: "Billing" and "billing" are the SAME tag, so
  // typing it again on another card reuses the entry instead of duplicating it
  const id = safeRef(name.trim().toLowerCase());
  const refs = readRefs(root);
  if (refs.tags[id]) return { ok: true, id, tag: refs.tags[id], created: false };
  refs.tags[id] = { name: name.trim(), color };
  writeJSON(refsFile(root), refs);
  commitPaths(root, [DATA_DIR + "/refs.json"], `bridza: create tag "${name.trim()}" (${id})`);
  return { ok: true, id, tag: refs.tags[id], created: true };
}

export function setTaskTags(root, pipeline, task, tagIds) {
  const bad = validRef(pipeline, "pipeline") || validRef(task, "task");
  if (bad) return { ok: false, error: bad };
  if (!Array.isArray(tagIds)) return { ok: false, error: "tagIds must be an array" };
  const key = safeRef(pipeline) + "/" + safeRef(task);
  const refs = readRefs(root);
  const validIds = [...new Set(tagIds)].filter((id) => refs.tags[id]);
  if (validIds.length === 0) delete refs.taskTags[key];
  else refs.taskTags[key] = validIds;
  writeJSON(refsFile(root), refs);
  commitPaths(root, [DATA_DIR + "/refs.json"], `bridza: set tags on task ${key}`);
  return { ok: true, tags: validIds };
}

// Archive/restore a task. Board-level display state → committed at the repo
// root on the base branch (like pipeline archive and kanban order), so a
// `git push` of that branch carries it to every other device.
export function setTaskArchived(root, pipeline, task, archived) {
  const bad = validRef(pipeline, "pipeline") || validRef(task, "task");
  if (bad) return { ok: false, error: bad };
  const key = safeRef(pipeline) + "/" + safeRef(task);
  const refs = readRefs(root);
  refs.archived[key] = !!archived;
  writeJSON(refsFile(root), refs);
  const commit = commitPaths(root, [DATA_DIR + "/refs.json"],
    `bridza: ${archived ? "archive" : "unarchive"} task ${key}`);
  return { ok: true, archived: !!archived, committed: commit.committed };
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
  const relPath = rel.taskMeta(pipeline, taskDirAt(root, branch, pipeline, task));
  if (branchExists(root, branch)) {
    try { const j = healTaskFlow(JSON.parse(git(root, ["show", branch + ":" + relPath])), readJSON(path.join(root, relPath))); j._live = true; return j; }
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
let BRANCH_SCAN = { root: null, key: null, found: new Map(), taskToBranch: new Map(), metas: new Map() };
function scanBranches(root) {
  let refs = "";
  try { refs = git(root, ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/bridza/"]).trim(); }
  catch (e) { refs = ""; }
  if (BRANCH_SCAN.root === root && BRANCH_SCAN.key === refs) return BRANCH_SCAN;
  const found = new Map();   // pipelineId → Set<taskId> discovered at branch tips
  const taskToBranch = new Map(); // "pipeline/task" → branch name
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
        // branch trees carry the FOLDER name; the board speaks the plain id
        const tid = parseTaskDir(path.posix.basename(tdir)).id;
        if (tid === ".metadata") continue;
        if (!found.has(pid)) found.set(pid, new Set());
        found.get(pid).add(tid);
        taskToBranch.set(pid + "/" + tid, b);
      }
    }
  }
  BRANCH_SCAN = { root, key: refs, found, taskToBranch, metas: new Map(), branches };
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
  const b = scan.taskToBranch && scan.taskToBranch.get(key);
  if (b) {
    try {
      const j = JSON.parse(git(root, ["show", b + ":" + rel.taskMeta(pipeline, taskDirAt(root, b, pipeline, task))]));
      j._live = true; j._onBranch = b;
      scan.metas.set(key, j);
      return j;
    } catch (e) { /* ignore */ }
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
  const archivedFlags = refsAll.archived;
  const base = baseBranchName(root);
  const scan = scanBranches(root);
  const pids = [...new Set([...listDirs(pipelinesRoot), ...scan.found.keys()])];
  const pipelines = pids.map((pid) => {
    const def = readPipelineDef(root, pid);
    const flows = pipelineFlows(def);
    // the id→def lookup tasks resolve against: every flow's stages, plus any
    // legacy pool stages not in a flow (first occurrence of an id wins)
    const allStages = flattenFlows([...flows, { stages: def.stages || [] }]);
    const tids = [...new Set([...listTaskIds(path.join(pipelinesRoot, pid)), ...(scan.found.get(pid) || [])])]
      .filter((tid) => !tombstones.has(pid + "/" + tid));
    const tasks = tids.map((tid) => {
      const meta = readTaskMetaFromAnyBranch(root, scan, pid, tid);
      const defStages = allStages.map((s) => s.id);
      // flow/template tasks keep their own (subset) stage list; otherwise show
      // the FULL pipeline — upcoming steps are visible even before they run.
      const stages = (meta.flow || meta.template) && (meta.stages || []).length
        ? meta.stages
        : [...new Set([...(meta.stages || []), ...defStages])];
      const tr = meta.tracking || {};
      const done = stages.filter((s) => tr[s] && tr[s].status === "done").length;
      return {
        id: meta.id || tid, pipeline: pid, title: meta.title || tid,
        ref: refs[pid + "/" + tid] || meta.ref || null,
        type: meta.type || "", template: meta.template || "", flow: meta.flow || meta.template || "",
        status: meta.status || "in-progress", finalized: !!meta.finalized, reuseSession: !!meta.reuseSession,
        // root refs.json wins; a legacy flag in the task's own metadata (written
        // by the old branch-local archive) still counts when there's no entry
        archived: archivedFlags[pid + "/" + tid] === undefined ? !!meta.archived : !!archivedFlags[pid + "/" + tid],
        tags: (refsAll.taskTags && refsAll.taskTags[pid + "/" + tid] ? refsAll.taskTags[pid + "/" + tid] : [])
          .map((id) => refsAll.tags && refsAll.tags[id] ? { id, name: refsAll.tags[id].name, color: refsAll.tags[id].color } : null)
          .filter(Boolean),
        stages, tracking: tr, routing: meta.routing || {}, branch: taskBranchName(pid, tid),
        target: meta.target || base,
        progress: stages.length ? Math.round((done / stages.length) * 100) : 0,
        live: !!meta._live, onBranch: meta._onBranch || null,
      };
    });
    return { id: def.id || pid, label: def.label || pid, workingDir: def.workingDir || ".", stages: allStages, flows, templates: def.templates || [], archived: !!def.archived, kanbanOrder: def.kanbanOrder || [], tags: refsAll.tags || {}, tasks };
  });
  return { initialized: pipelines.length > 0, business, pipelines, inbox: readInbox(root) };
}

// ── writes (structural creates) ─────────────────────────────────────────────

// Task templates: a pipeline can carry several (bugfix, design, feature,
// dissection…). Each picks a SUBSET of the pipeline's stage pool for new tasks.
const normTemplates = (templates) => (Array.isArray(templates) ? templates : [])
  .filter((t) => t && t.id)
  .map((t) => ({ id: safeRef(t.id), label: t.label || t.id, description: String(t.description || ""), stages: (Array.isArray(t.stages) ? t.stages : []).map(safeRef) }));

export function createPipeline(root, opts = {}) {
  return withAction(root, () => createPipelineIn(root, opts));
}

function createPipelineIn(root, { id, label, workingDir = ".", stages = [], flows = [], templates = [] }) {
  if (!id) return { ok: false, error: "pipeline id required" };
  const pid = safeRef(id);
  const metaPath = rel.pipelineMeta(pid);
  if (fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "pipeline already exists" };
  ensureDataDir(root);   // materialise .bridza/.metadata now, committed below
  const tpls = normTemplates(templates);
  // whatever form the caller speaks (flows / stage list / template subsets),
  // the pipeline is stored in the flows form + the flattened stage union
  const fl = pipelineFlows({ id: pid, label: label || id, stages, flows, templates: tpls })
    .map((f, fi) => normFlow(f, fi, label || id));
  const allStages = flattenFlows(fl);
  writeJSON(path.join(root, metaPath), { v: 1, id: pid, label: label || id, workingDir, flows: fl, stages: allStages, templates: tpls });
  const msg = [
    `bridza: add pipeline "${label || id}" (${pid}) · ${allStages.length} stage${allStages.length === 1 ? "" : "s"}`,
    "",
    ...fl.map((f) => `Flow "${f.name}": ${f.stages.map((s) => s.name || s.id).join(" → ") || "(none)"}`),
    `Working dir: ${workingDir}`,
    ...(tpls.length ? [`Templates: ${tpls.map((t) => t.label).join(", ")}`] : []),
  ].join("\n");
  const commit = commitPaths(root, [DATA_DIR + "/.gitignore", DATA_DIR + "/README.md", DATA_DIR + "/.metadata/creation-guide.md", rel.business(), rel.principles(), rel.rules(), metaPath], msg);
  // Materialize the template's ADVISORY ordering into the plan board (the
  // editable source of truth): every flow handoff (`next`) whose two ends now
  // both exist becomes a pipeline edge from→to. Both directions are checked —
  // this pipeline pointing at installed ones, and installed flows pointing here.
  const edges = [];
  for (const f of fl) if (f.next && fs.existsSync(path.join(root, rel.pipelineMeta(f.next.pipeline)))) edges.push({ from: pid, to: f.next.pipeline });
  for (const other of listDirs(path.join(root, rel.pipelines()))) {
    if (other === pid) continue;
    for (const f of pipelineFlows(readPipelineDef(root, other))) {
      if (f.next && f.next.pipeline === pid) edges.push({ from: other, to: pid });
    }
  }
  if (edges.length) {
    const plan = readPlan(root);
    savePlan(root, { ...plan, pipeDeps: [...plan.pipeDeps, ...edges] });   // savePlan dedupes
  }
  return { ok: true, id: pid, committed: commit.committed };
}

const normStageDef = (s, i) => ({
  id: safeRef(s.id || "stage-" + (i + 1)),
  name: s.name || s.id || "Stage " + (i + 1),
  hint: s.hint || "",
  tool: s.tool || "opencode",
  systemPrompt: s.systemPrompt || "",
  outputs: Array.isArray(s.outputs) ? s.outputs.map((o) => ({ name: o.name || "", type: o.type || "doc", note: o.note || "" })) : [],
  specs: Array.isArray(s.specs) ? s.specs.map((v) => ({ key: String((v && v.key) || "").trim(), value: String((v && v.value) || "") })).filter((v) => v.key) : [],
  shell: Array.isArray(s.shell) ? s.shell.filter((c) => String(c).trim()) : [],
  gate: s.gate || "",
  auto: s.auto !== false,
  judge: !!s.judge,
});

// One normalizer for a stored flow, shared by create + save: slugged id,
// named (falling back to the pipeline label), normalized stages, valid handoff.
const normFlow = (f, fi, fallbackName) => ({
  id: safeRef(f.id || "flow-" + (fi + 1)),
  name: f.name || fallbackName,
  stages: (Array.isArray(f.stages) ? f.stages : []).map(normStageDef),
  next: f.next && f.next.pipeline && f.next.flow ? { pipeline: safeRef(f.next.pipeline), flow: safeRef(f.next.flow) } : null,
});

// Edit a pipeline's stage flows (the stage definitions: name, system prompt,
// outputs, gate, tool, shell, auto). Stage ids are kept stable on rename so
// existing tasks (keyed by stage id) stay valid; only NEW tasks pick up the new
// flows. `flows` is the multi-flow form; a bare `stages` array (older clients)
// still works as a single unnamed flow. `stages` is always re-derived as the
// flattened id→def union. Commits just the pipeline's metadata.json.
export function savePipeline(root, { id, label, workingDir, stages, flows, templates }) {
  if (!id) return { ok: false, error: "pipeline id required" };
  const pid = safeRef(id);
  const metaPath = rel.pipelineMeta(pid);
  if (!fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "pipeline not found" };
  const cur = readPipelineDef(root, pid);
  const nextFlows = Array.isArray(flows) && flows.length
    ? flows.map((f, fi) => normFlow(f, fi, label || cur.label || pid))
    : Array.isArray(stages) ? [{ id: "main", name: label || cur.label || pid, stages: stages.map(normStageDef) }]
      : pipelineFlows(cur);
  const next = {
    ...cur, id: pid,
    label: label != null ? label : cur.label,
    workingDir: workingDir != null ? workingDir : (cur.workingDir || "."),
    flows: nextFlows,
    stages: flattenFlows(nextFlows),
    templates: templates != null ? normTemplates(templates) : (cur.templates || []),
  };
  writeJSON(path.join(root, metaPath), next);
  const msg = [
    `bridza: edit pipeline "${next.label || pid}" (${pid}) stage flows · ${next.flows.length} flow${next.flows.length === 1 ? "" : "s"}, ${next.stages.length} stage${next.stages.length === 1 ? "" : "s"}`,
    "",
    ...next.flows.map((f) => `Flow "${f.name}": ${f.stages.map((s) => s.name || s.id).join(" → ") || "(none)"}`),
    ...(next.templates.length ? [`Templates: ${next.templates.map((t) => t.label).join(", ")}`] : []),
  ].join("\n");
  const commit = commitPaths(root, [metaPath], msg);
  return { ok: true, id: pid, committed: commit.committed, pipeline: next };
}

// Archive / unarchive a pipeline: it disappears from the main sidebar list but
// ALL its data (.bridza dir, tasks, branches, history) stays — nothing is
// deleted. Just a flag in the pipeline's metadata, committed like any edit.
export function archivePipeline(root, { id, archived = true }) {
  if (!id) return { ok: false, error: "pipeline id required" };
  const pid = safeRef(id);
  const metaPath = rel.pipelineMeta(pid);
  if (!fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "pipeline not found" };
  const def = readPipelineDef(root, pid);
  def.archived = !!archived;
  writeJSON(path.join(root, metaPath), def);
  const commit = commitPaths(root, [metaPath], `bridza: ${archived ? "archive" : "unarchive"} pipeline "${def.label || pid}" (${pid})\n\nData is kept — only hidden from the pipeline list.`);
  return { ok: true, id: pid, archived: !!archived, committed: commit.committed };
}

// The pipeline's own Kanban column order (stage ids + the Delivered column),
// set by dragging column headers. Per pipeline, committed like any edit.
export function saveKanbanOrder(root, { id, order }) {
  if (!id) return { ok: false, error: "pipeline id required" };
  if (!Array.isArray(order) || !order.every((o) => typeof o === "string")) return { ok: false, error: "order must be an array of strings" };
  const pid = safeRef(id);
  const metaPath = rel.pipelineMeta(pid);
  if (!fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "pipeline not found" };
  const def = readPipelineDef(root, pid);
  def.kanbanOrder = order;
  writeJSON(path.join(root, metaPath), def);
  // one call per drag — consecutive drags of the same board are one edit
  const commit = commitPaths(root, [metaPath], `bridza: reorder kanban columns of pipeline "${def.label || pid}" (${pid})`, { fold: "kanban:" + pid });
  return { ok: true, id: pid, kanbanOrder: order, committed: commit.committed };
}

// Permanently removes a whole pipeline (all its flows + tasks) from the
// database, MAINTAINING git history the same way deleteTask does: the removal
// is a commit, and each task's branch is kept. Refs are retired, and the
// project plan is unwired from every one of its tasks.
export function deletePipeline(root, opts = {}) {
  return withAction(root, () => deletePipelineIn(root, opts));
}

function deletePipelineIn(root, { id }) {
  if (!id) return { ok: false, error: "pipeline id required" };
  const pid = safeRef(id);
  const metaPath = rel.pipelineMeta(pid);
  if (!fs.existsSync(path.join(root, metaPath))) return { ok: false, error: "pipeline not found" };
  const def = readPipelineDef(root, pid);
  const who = `"${def.label || pid}" (${pid})`;
  nameAction(`bridza: delete pipeline ${who}`);
  const pipeDir = path.join(root, rel.pipeline(pid));
  const taskIds = fs.existsSync(pipeDir) ? listTaskIds(pipeDir) : [];
  for (const tid of taskIds) {
    try { stopRuns(pid, tid); } catch (e) { /* nothing running */ }
    try { removeTaskWorktree(root, pid, tid); } catch (e) { /* no worktree */ }
  }

  // 1) drop the whole pipeline dir — committed so history shows the delete
  let committed = false;
  if (fs.existsSync(pipeDir)) {
    fs.rmSync(pipeDir, { recursive: true, force: true });
    committed = commitPaths(root, [rel.pipeline(pid)], [
      `bridza: delete pipeline ${who} — all flows & tasks removed`,
      "",
      "Removed from the database (.bridza). Git history is kept on task branches,",
      "and this commit itself records the deletion.",
    ].join("\n")).committed;
  }

  // 2) retire every task's #ref (never reused) + tombstone so branch scans
  //    can't resurrect them
  const refs = readRefs(root);
  let refsTouched = false;
  for (const tid of taskIds) {
    const key = pid + "/" + tid;
    if (refs.refs[key] != null) { delete refs.refs[key]; refsTouched = true; }
    if (refs.archived[key] !== undefined) { delete refs.archived[key]; refsTouched = true; }
    if (!refs.deleted.includes(key)) { refs.deleted.push(key); refsTouched = true; }
  }
  if (refsTouched) { writeJSON(refsFile(root), refs); commitPaths(root, [DATA_DIR + "/refs.json"], `bridza: retire #refs of deleted pipeline ${who} — numbers are never reused`); }

  // 3) unwire from the plan (deps both ways, links, milestones, pos, pipeDeps)
  const plan = readPlan(root);
  const mine = (k) => k === pid || (typeof k === "string" && k.startsWith(pid + "/"));
  let planTouched = false;
  const scrub = (arr) => { const n = (arr || []).filter((k) => !mine(k)); if (n.length !== (arr || []).length) planTouched = true; return n; };
  for (const k of Object.keys(plan.deps)) if (mine(k)) { delete plan.deps[k]; planTouched = true; }
  for (const g of Object.values(plan.deps)) { g.all = scrub(g.all); g.any = scrub(g.any); }
  for (const k of Object.keys(plan.links)) if (mine(k)) { delete plan.links[k]; planTouched = true; }
  for (const [k, list] of Object.entries(plan.links)) plan.links[k] = scrub(list);
  plan.milestones.forEach((m) => { m.tasks = scrub(m.tasks); });
  for (const k of Object.keys(plan.pos || {})) if (mine(k)) { delete plan.pos[k]; planTouched = true; }
  const pd = (plan.pipeDeps || []).filter((e) => e.from !== pid && e.to !== pid);
  if (pd.length !== (plan.pipeDeps || []).length) { plan.pipeDeps = pd; planTouched = true; }
  if (planTouched) savePlan(root, plan);

  return { ok: true, id: pid, committed, tasks: taskIds.length };
}

// One action: the #ref, the task files, its plan wiring and its branch are all
// one commit (createTaskIn is the body — see withAction).
export function createTask(root, opts = {}) {
  return withAction(root, () => createTaskIn(root, opts));
}

function createTaskIn(root, { pipeline, id, title = "", type = "", outputMode = "docs", target, stages, flow = "", template = "", dependsOn = "", dependsOnAny = [], est = 0, milestone = null, context = "" }) {
  const bad = !pipeline ? "pipeline required" : !id ? "task id required" : null;
  if (bad) return { ok: false, error: bad };
  const pid = safeRef(pipeline), tid = safeRef(id);
  const def = readPipelineDef(root, pid);
  // the branch this task's work lands on: fork base, review base, finalize into.
  // An explicit target must exist; default = the repo's default branch.
  const rawTarget = target == null ? "" : String(target).trim();
  if (rawTarget && !branchExists(root, rawTarget)) return { ok: false, error: "target branch " + rawTarget + " does not exist" };
  const taskTargetResolved = rawTarget || baseBranchName(root);
  const flows = pipelineFlows(def);
  // Every task belongs to ONE flow. When the pipeline has several, the choice
  // is mandatory (the client enforces it; template is the legacy alias).
  const chosen = flows.find((f) => f.id === safeRef(flow || template)) || (flows.length === 1 ? flows[0] : null);
  if (!chosen && flows.length > 1 && !(stages && stages.length)) {
    return { ok: false, error: "this pipeline has " + flows.length + " stage flows — pick one: " + flows.map((f) => f.id).join(", ") };
  }
  const tpl = template ? (def.templates || []).find((t) => t.id === safeRef(template)) : null;
  // stage list: explicit stages > the chosen flow > the flattened pipeline pool
  const stageIds = stages && stages.length ? stages.map(safeRef)
    : chosen ? chosen.stages.map((s) => s.id)
      : flattenFlows(flows).map((s) => s.id);
  // the existence check resolves the folder the same way every read does, so a
  // legacy bare-slug task and a padded one are both caught before a #ref is
  // spent on a duplicate
  if (fs.existsSync(path.join(root, rel.taskMeta(pid, taskDirOn(root, pid, tid))))) return { ok: false, error: "task already exists" };
  ensureDataDir(root);   // self-heal the .bridza/README.md map + .gitignore for older projects
  // recreating a previously-deleted id lifts its tombstone (it gets a NEW #ref)
  const refsCur = readRefs(root);
  if (refsCur.deleted.includes(pid + "/" + tid)) {
    refsCur.deleted = refsCur.deleted.filter((k) => k !== pid + "/" + tid);
    writeJSON(refsFile(root), refsCur);
  }
  const ref = assignRefs(root, [pid + "/" + tid])[pid + "/" + tid];
  // ORDER MATTERS: the folder carries the #ref, so it can only be named once
  // the ref is assigned. The id inside metadata.json, the refs.json/plan.json
  // keys and the branch name all stay the PLAIN id — only the folder is padded.
  const tdir = taskDirName(pid, tid, ref);
  const metaPath = rel.taskMeta(pid, tdir), ctxPath = rel.taskContext(pid, tdir);
  writeJSON(path.join(root, metaPath), {
    v: 1, id: tid, pipeline: pid, title: title || tid, ref, type: type || (tpl ? tpl.id : ""), flow: chosen ? chosen.id : "", template: tpl ? tpl.id : "", outputMode,
    branch: taskBranchName(pid, tid), target: taskTargetResolved, stages: stageIds, routing: {},
    status: "in-progress", finalized: false, tracking: {},
  });
  // #17 — dependencies can be auto-wired at creation: dependsOn (string OR
  // array → AND gate) and dependsOnAny (array → OR gate). The FIRST AND-dep also
  // seeds the handoff manifest below. A valid key is "<pipeline>/<task>", ≠ self.
  const isKey = (d) => /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(d) && d !== pid + "/" + tid;
  const andKeys = [...new Set((Array.isArray(dependsOn) ? dependsOn : [dependsOn]).map((d) => String(d || "").trim()).filter(isKey))];
  const anyKeys = [...new Set((Array.isArray(dependsOnAny) ? dependsOnAny : []).map((d) => String(d || "").trim()).filter(isKey))];
  // handoff manifest: a follow-on task's context.md opens with WHO it follows
  // and the files that task produced — the concrete inputs to this one.
  const dep = andKeys[0] || "";
  const depOk = !!dep;
  let manifest = "";
  if (depOk) {
    const [up, ut] = dep.split("/");
    let umeta;
    try { umeta = JSON.parse(git(root, ["show", taskBranchName(up, ut) + ":" + rel.taskMeta(up, ut)])); }
    catch (e) { umeta = readTaskMeta(root, up, ut); }
    const files = [...new Set(Object.values(umeta.tracking || {}).flatMap((tr) => (tr.runs || []).flatMap((r) => r.files || [])))];
    manifest = [
      `Follow-on from ${umeta.ref ? "#" + umeta.ref + " " : ""}"${umeta.title || ut}" (${dep}).`,
      "",
      files.length ? "Inputs produced by the upstream task (in this repo once it finalizes):" : "The upstream task has no tracked output files yet.",
      ...files.slice(0, 40).map((f) => "- " + f),
      "",
    ].join("\n");
  }
  // The brief. A caller that already HAS it (promoteInbox carries the inbox
  // item's text) hands it in here, so the task is born with it — writing the
  // placeholder first and overwriting it a moment later cost a second commit
  // and left a dead blob in history.
  const brief = String(context || "").trim();
  writeText(path.join(root, ctxPath), brief
    ? manifest + brief + "\n"
    : (title ? "# " + title + "\n\n" : "") + manifest + "Describe the intent of this task.\n");
  const msg = [
    `bridza: add task #${ref} "${(title || tid).slice(0, 50)}" (${pid}/${tid})`,
    "",
    `Branch: ${taskBranchName(pid, tid)}`,
    `Target: ${taskTargetResolved}`,
    `Stages: ${stageIds.join(" → ")}`,
    ...(chosen ? [`Flow: ${chosen.name}`] : []),
    ...(tpl ? [`Template: ${tpl.label || tpl.id}`] : []),
    ...(type && (!tpl || type !== tpl.id) ? [`Type: ${type}`] : []),
  ].join("\n");
  nameAction(msg);   // "add task #N …" names the action, not the #ref assignment that opened it
  const commit = commitPaths(root, [DATA_DIR + "/README.md", DATA_DIR + "/.gitignore", DATA_DIR + "/.metadata/creation-guide.md", metaPath, ctxPath], msg);
  // dependency wiring — its stages refuse to run until the gate opens:
  //   1. explicit handoff (dependsOn) → an AND-dep + a focused-context link,
  //      so the upstream ticket rides into every stage prompt of this task
  //   2. pipeline sequence edges (plan.pipeDeps) → auto-gate on every OPEN
  //      task of each upstream pipeline (snapshot at creation; done tasks
  //      satisfy the gate automatically at run time)
  const key = pid + "/" + tid;
  const plan = readPlan(root);
  const g = plan.deps[key] || { all: [], any: [] };
  let planTouched = false;
  for (const d of andKeys) if (!g.all.includes(d)) { g.all.push(d); planTouched = true; }
  for (const d of anyKeys) if (!g.any.includes(d)) { g.any.push(d); planTouched = true; }
  if (depOk && !(plan.links[key] || []).includes(dep)) { plan.links[key] = [...(plan.links[key] || []), dep]; planTouched = true; }
  // #17 — cost estimate + milestone assignment, wired the same automatic way
  if (Number(est) > 0) { plan.est = { ...(plan.est || {}), [key]: Number(est) }; planTouched = true; }
  if (milestone) {
    const mid = safeRef(typeof milestone === "string" ? milestone : (milestone.id || ""));
    const mtitle = typeof milestone === "object" ? String(milestone.title || mid) : mid;
    if (mid) {
      let m = plan.milestones.find((x) => safeRef(x.id) === mid);
      if (!m) { m = { id: mid, title: mtitle, due: "", tasks: [], needs: [] }; plan.milestones.push(m); }
      // one milestone per task — drop the key from every other milestone first
      plan.milestones.forEach((x) => { if (safeRef(x.id) !== mid) x.tasks = (x.tasks || []).filter((k) => k !== key); });
      if (!(m.tasks || []).includes(key)) m.tasks = [...(m.tasks || []), key];
      planTouched = true;
    }
  }
  for (const e of plan.pipeDeps.filter((d) => d && d.to === pid)) {
    if (readPipelineDef(root, e.from).archived) continue;   // hidden pipelines don't gate new work
    for (const ut of listTaskIds(path.join(root, rel.pipeline(e.from)))) {
      const uk = e.from + "/" + ut;
      if (uk === key || g.all.includes(uk)) continue;
      if (readTaskMeta(root, e.from, ut).finalized) continue;   // delivered — nothing to wait on
      g.all.push(uk); planTouched = true;
    }
  }
  if (planTouched) {
    if (g.all.length || g.any.length) plan.deps[key] = g;
    savePlan(root, plan);
  }
  // create the task branch off the just-committed stub so its history starts
  // clean — once the action has closed, so it forks off the FINAL commit and
  // not off a version later folded away
  afterAction(root, () => ensureTaskBranch(root, pid, tid));
  return { ok: true, id: tid, pipeline: pid, ref, branch: taskBranchName(pid, tid), target: taskTargetResolved, committed: commit.committed };
}

// ── delete a task ────────────────────────────────────────────────────────────
// Completely removes the task from the database (.bridza task dir, its refs
// entry, plan wiring, worktree) while MAINTAINING git history: the removal is
// itself a commit, and the task's branch (its full prompt→result history) is
// kept unless deleteBranch is set. Any live run is stopped first.
export function deleteTask(root, opts = {}) {
  return withAction(root, () => deleteTaskIn(root, opts));
}

function deleteTaskIn(root, { pipeline, task, deleteBranch = false }) {
  if (!pipeline || !task) return { ok: false, error: "pipeline + task required" };
  const pid = safeRef(pipeline), tid = safeRef(task);
  const key = pid + "/" + tid;
  // identity for the commit message, captured BEFORE anything is removed
  const meta = readTaskMeta(root, pid, tid);
  const refNum = readRefs(root).refs[key] || meta.ref || null;
  const who = `${refNum ? "#" + refNum + " " : ""}"${(meta.title || tid).slice(0, 50)}"`;
  nameAction(`bridza: delete task ${who} (${key})`);
  try { stopRuns(pid, tid); } catch (e) { /* nothing running */ }
  try { removeTaskWorktree(root, pid, tid); } catch (e) { /* no worktree */ }

  // 1) the task dir on the current branch — committed so history shows the
  //    delete. Resolve the folder BEFORE removing it: once it is gone the
  //    padded name can no longer be read off disk, and the commit needs it.
  const tdir = taskDirOn(root, pid, tid);
  const taskDir = path.join(root, rel.task(pid, tdir));
  let committed = false;
  if (fs.existsSync(taskDir)) {
    fs.rmSync(taskDir, { recursive: true, force: true });
    committed = commitPaths(root, [rel.task(pid, tdir)], [
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
  delete refs.archived[key];
  delete refs.taskTags[key];
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
    sizes: (j && j.sizes && typeof j.sizes === "object") ? j.sizes : {},
    links: (j && j.links && typeof j.links === "object") ? j.links : {},
    pipeDeps: (j && Array.isArray(j.pipeDeps)) ? j.pipeDeps : [],
    est: (j && j.est && typeof j.est === "object") ? j.est : {},
    archive: (j && j.archive && typeof j.archive === "object") ? j.archive : null,
  };
}

export function savePlan(root, { deps, milestones, pos, sizes, links, pipeDeps, est, archive } = {}) {
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
  // per-task card sizes on the plan board (#13) — bounded so a bad drag can't
  // make a node vanish or swallow the canvas
  const nextSizes = {};
  for (const [k, v] of Object.entries(sizes != null ? sizes : cur.sizes)) {
    if (KEY_RE.test(k) && v && Number.isFinite(+v.w) && Number.isFinite(+v.h))
      nextSizes[k] = { w: Math.min(600, Math.max(120, Math.round(+v.w))), h: Math.min(240, Math.max(38, Math.round(+v.h))) };
  }
  // focused-context links: task → the tickets attached to it as context
  const nextLinks = {};
  for (const [k, list] of Object.entries(links != null ? links : cur.links)) {
    if (!KEY_RE.test(k)) continue;
    const clean = cleanKeys(list).filter((x) => x !== k);
    if (clean.length) nextLinks[k] = clean;
  }
  // pipeline-level sequence edges: { from, to } pipeline ids. The plan board
  // is the source of truth; every new task in `to` is auto-gated on `from`'s
  // open tasks (see createTask) — order enforced by blockedByPlan at run time.
  const seenPD = new Set();
  const nextPD = (pipeDeps != null ? pipeDeps : cur.pipeDeps).map((d) => d && ({ from: safeRef(d.from), to: safeRef(d.to) }))
    .filter((d) => d && d.from && d.to && d.from !== d.to && d.from !== "x" && d.to !== "x")
    .filter((d) => { const k = d.from + "→" + d.to; if (seenPD.has(k)) return false; seenPD.add(k); return true; });
  // per-task cost estimates in HOURS — weight the critical path, shown on nodes
  const nextEst = {};
  for (const [k, v] of Object.entries(est != null ? est : cur.est)) {
    const h = Number(v);
    if (KEY_RE.test(k) && Number.isFinite(h) && h > 0) nextEst[k] = Math.round(h * 10) / 10;
  }
  const av = archive != null ? archive : cur.archive;
  const nextArchive = (av && Number.isFinite(+av.x) && Number.isFinite(+av.y)) ? { x: Math.round(+av.x), y: Math.round(+av.y) } : null;
  const next = { v: 1, deps: nextDeps, milestones: nextMs, pos: nextPos, sizes: nextSizes, links: nextLinks, pipeDeps: nextPD, est: nextEst, archive: nextArchive };
  writeJSON(path.join(root, rel.plan()), next);
  const nD = Object.keys(nextDeps).length, nM = nextMs.length, nL = Object.keys(nextLinks).length;
  const msg = [
    `bridza: edit plan · ${nD} dep gate${nD === 1 ? "" : "s"}, ${nM} milestone${nM === 1 ? "" : "s"}, ${nL} context link${nL === 1 ? "" : "s"}`,
    "",
    ...(nM ? [`Milestones: ${nextMs.map((m) => m.title).join(", ").slice(0, 200)}`] : []),
  ].join("\n");
  // the UI saves on every interaction (no debounce) — wiring 8 context links one
  // by one is 8 calls, which fold into one commit
  const c = commitPaths(root, [DATA_DIR + "/README.md", DATA_DIR + "/.gitignore", DATA_DIR + "/.metadata/creation-guide.md", rel.plan()], msg, { fold: "plan" });
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
export function promoteInbox(root, { id, pipeline, flow = "", title: titleIn = "", description = null }) {
  const items = readInbox(root);
  const item = items.find((i) => i.id === id);
  if (!item) return { ok: false, error: "item not found" };
  if (!pipeline) return { ok: false, error: "pick a pipeline" };
  // Title: what the user typed in the promote dialog, else a dozen-word
  // headline off the item. Body: the FULL item text (edits included) — it is
  // the task's brief, so nothing the user captured is ever dropped.
  const body = String(description == null ? item.text || "" : description).trim();
  const title = shortTitle(titleIn, { words: 24, chars: 120 }) || shortTitle(body) || item.kind;
  const taskId = taskSlug(title) || id;
  const label = (r) => `bridza: inbox promote (${item.kind}) "${title.slice(0, 40)}" → task ${r.ref ? "#" + r.ref + " " : ""}${safeRef(pipeline)}/${r.id}`;
  return withAction(root, () => {
    // the item's text IS the task's brief — handed to createTask so the task is
    // created with it in place (one commit, no superseded placeholder)
    const r = createTask(root, { pipeline, id: taskId, title, type: item.kind, flow, context: "# " + title + "\n\n" + body + "\n" });
    if (!r.ok) return r;
    nameAction(label(r));
    writeInbox(root, items.filter((i) => i.id !== id));
    commitPaths(root, [rel.inbox()], label(r));
    return { ok: true, task: { ...r, title } };
  });
}

// The natural-language context (the brief) for a task or a stage. Read like
// task metadata: the working tree first, then any bridza branch carrying it —
// a task created on another task's branch has no working-tree copy.
export function readContext(root, { pipeline, task, stage }) {
  if (!pipeline || !task) return { ok: false, error: "pipeline and task required" };
  const td = taskDirOn(root, pipeline, task);
  const p = stage ? rel.stageContext(pipeline, td, stage) : rel.taskContext(pipeline, td);
  const own = readText(path.join(root, p));
  if (own.trim()) return { ok: true, text: own };
  for (const b of scanBranches(root).branches || []) {
    try {
      const t = git(root, ["show", b + ":" + p]);
      if (t && t.trim()) return { ok: true, text: t };
    } catch (e) { /* next branch */ }
  }
  return { ok: true, text: own };
}

// Edit the natural-language context for a task or a stage.
export function saveContext(root, { pipeline, task, stage, text }) {
  const td = taskDirOn(root, pipeline, task);
  const p = stage ? rel.stageContext(pipeline, td, stage) : rel.taskContext(pipeline, td);
  writeText(path.join(root, p), String(text ?? ""));
  const snip = String(text ?? "").trim().split("\n")[0].replace(/^#\s*/, "").slice(0, 48);
  // successive saves of the same brief are one edit, not one commit each
  return { ok: true, ...commitPaths(root, [p], `bridza: edit ${stage ? "stage " + safeRef(stage) : "task"} context of ${safeRef(pipeline)}/${safeRef(task)}${snip ? ` · "${snip}"` : ""}`, { fold: "context:" + p }) };
}
