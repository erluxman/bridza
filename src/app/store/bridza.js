// bridza.js — pure helpers for the Bridza model, shared by the browser UI and
// the node bridge. No fs / git here — only naming, on-disk path layout, the CLI
// tool registry, and prompt assembly. Self-contained (no old-store imports).
//
// Hierarchy:  project (a repo + .bridza/) → pipeline → task → stage
//
// Git model (one branch + one worktree per TASK; stages are sequential commits
// on that one branch — a timeline, not a branch-per-stage fan-out):
//
//   bridza/<pipeline>/<task>     ← created when the task is created; every
//                                  stage run appends a prompt-commit then a
//                                  result-commit onto it.
//
// On disk under <repo>/.bridza/ (config = metadata.json, natural language =
// .md, content = outputs/):
//
//   .metadata/metadata.json            business config (merge style, defaults)
//   .metadata/company-principles.md    \ natural-language global context
//   .metadata/universal-rules.md       /
//   pipelines/.metadata/metadata.json  config shared by all pipelines
//   pipelines/<p>/.metadata/metadata.json   pipeline stage-flow + workingDir
//   pipelines/<p>/<task>/metadata.json hard config + ALL tracking (per-stage
//                                      time, run records, commit shas)
//   pipelines/<p>/<task>/context.md    NL intent for the whole task
//   pipelines/<p>/<task>/<stage>/context.md   NL intent for the stage
//   pipelines/<p>/<task>/<stage>/outputs/     the ONLY content files

export const DATA_DIR = ".bridza";

// Slug for git refs and on-disk dir names. No dots: git forbids "..",
// components starting with ".", and ".lock" suffixes — dropping dots entirely
// keeps every generated name legal.
export function safeRef(s) {
  return String(s).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

// One branch per task. Pipeline + task both slugged; nesting under bridza/
// namespaces them and avoids collisions across pipelines.
export function taskBranchName(pipeline, task) {
  return "bridza/" + safeRef(pipeline) + "/" + safeRef(task);
}

// Relative paths (POSIX, repo-root-relative) for every entity. Callers join
// these onto a repo root or a worktree root. Slugging here keeps the on-disk
// names legal and stable regardless of the human-facing ids.
export const rel = {
  business: () => DATA_DIR + "/.metadata/metadata.json",
  inbox: () => DATA_DIR + "/inbox.json",
  plan: () => DATA_DIR + "/plan.json",
  principles: () => DATA_DIR + "/.metadata/company-principles.md",
  rules: () => DATA_DIR + "/.metadata/universal-rules.md",
  pipelines: () => DATA_DIR + "/pipelines",
  pipelinesMeta: () => DATA_DIR + "/pipelines/.metadata/metadata.json",
  pipeline: (p) => DATA_DIR + "/pipelines/" + safeRef(p),
  pipelineMeta: (p) => DATA_DIR + "/pipelines/" + safeRef(p) + "/.metadata/metadata.json",
  task: (p, t) => DATA_DIR + "/pipelines/" + safeRef(p) + "/" + safeRef(t),
  taskMeta: (p, t) => rel.task(p, t) + "/metadata.json",
  taskContext: (p, t) => rel.task(p, t) + "/context.md",
  stage: (p, t, s) => rel.task(p, t) + "/" + safeRef(s),
  stageContext: (p, t, s) => rel.stage(p, t, s) + "/context.md",
  stageOutputs: (p, t, s) => rel.stage(p, t, s) + "/outputs",
};

// AND/OR dependency gate for the plan network. A task's gate is
// { all: [taskKey…], any: [taskKey…] } where taskKey = "<pipeline>/<task>".
// Satisfied when EVERY `all` dep is done AND (any is empty OR at least ONE
// `any` dep is done) — an AND gate and an OR gate wired in series.
export function gateSatisfied(gate, doneSet) {
  const g = gate || {};
  const all = Array.isArray(g.all) ? g.all : [];
  const any = Array.isArray(g.any) ? g.any : [];
  return all.every((k) => doneSet.has(k)) && (any.length === 0 || any.some((k) => doneSet.has(k)));
}

// Critical path over the AND/OR dependency network (CPM adapted to gates):
// cost(task) = weight(task) + gate cost, where the gate cost is
//   max over `all` deps (every one must finish — the slowest rules)
//   min over `any` deps (one is enough — you'd take the fastest option)
// combined as max(allMax, anyMin). Returns the heaviest chain: its total cost
// and the ordered path of task keys. Cycle-guarded. weightOf lets callers count
// only remaining work (done → 0) or plug in time estimates.
export function criticalPath(keys, gateOf, weightOf) {
  const memo = new Map(), via = new Map(), visiting = new Set();
  const cost = (k) => {
    if (memo.has(k)) return memo.get(k);
    if (visiting.has(k)) return 0;   // cycle: treat as no upstream cost
    visiting.add(k);
    const g = gateOf(k) || {};
    let best = 0, from = null;
    for (const d of g.all || []) { const c = cost(d); if (c > best) { best = c; from = d; } }
    if ((g.any || []).length) {
      let mn = Infinity, mf = null;
      for (const d of g.any) { const c = cost(d); if (c < mn) { mn = c; mf = d; } }
      if (mn > best) { best = mn; from = mf; }
    }
    visiting.delete(k);
    const total = (weightOf ? weightOf(k) : 1) + best;
    memo.set(k, total);
    via.set(k, from);
    return total;
  };
  let end = null, max = 0;
  for (const k of keys) { const c = cost(k); if (c > max) { max = c; end = k; } }
  const path = [];
  const seen = new Set();
  for (let cur = end; cur && !seen.has(cur); cur = via.get(cur)) { seen.add(cur); path.unshift(cur); }
  return { length: max, path };
}

// The prompt handed to the CLI tool. The stage contract IS the prompt: task
// identity, this stage's goal, the artifacts it must produce, attached files,
// and the user's own prompt text. The system prompt (from the pipeline's stage
// definition) rides separately via the tool's system-prompt channel.
export function buildStagePrompt({ task, stage, outputsRel = "", outputs = [], inputs = [], files = [], userPrompt = "" }) {
  const lines = [
    `Task ${task.ref || task.id} — ${task.title || ""}`.trim(),
    `Stage: ${stage.name}${stage.hint ? " (" + stage.hint + ")" : ""}`,
  ];
  if (inputs.length) lines.push("Inputs from the previous stage: " + inputs.map((a) => a.name).join(", "));
  if (outputs.length) lines.push("Produce these outputs: " + outputs.map((a) => a.name + (a.note ? " — " + a.note : "")).join("; "));
  if (outputsRel) lines.push("Write your output files into: " + outputsRel);
  if (files.length) lines.push("Files to consider: " + files.join(", "));
  // Headless runs auto-reject permission prompts, so an agent that wanders
  // outside its worktree dies silently — tell it where it is and to stay put.
  lines.push("You are in an isolated git worktree for this task. Work ONLY inside the current working directory; never read or write outside it.");
  lines.push("");
  lines.push(userPrompt.trim() || "Complete this stage. Work only from the inputs above; keep the change minimal and reviewable.");
  return lines.join("\n");
}

// Starter pipeline templates offered when a project has no pipelines yet. Each
// is the stage-flow written into pipelines/<id>/.metadata/metadata.json; the
// systemPrompt is what every task's stage of that id reads (no duplication).
export const STARTER_PIPELINES = [
  {
    id: "sdlc", label: "Agile SDLC", workingDir: ".",
    // A complete agile software lifecycle. Every stage is opencode-only and reads
    // the PREVIOUS stages' artifacts from the worktree, so requirements precede
    // design precede code — no stage may skip ahead or write code early.
    stages: [
      { id: "vision", name: "Vision", tool: "opencode", gate: "vision approved",
        systemPrompt: "You are a product strategist. Using ONLY the task intent, write the product vision: the problem, the SPECIFIC target users, their jobs-to-be-done, the value proposition, and measurable success criteria. Write it to docs/vision.md. Do NOT write requirements, designs, or any code yet.",
        outputs: [{ name: "docs/vision.md", note: "problem, users, value, success metrics" }] },
      { id: "requirements", name: "Requirements", tool: "opencode", gate: "requirements signed off",
        systemPrompt: "You are a business analyst. Read docs/vision.md. Produce detailed product requirements and user stories with acceptance criteria (Given/When/Then). Cover functional AND non-functional needs (responsive desktop & mobile, offline-friendly, performance). Write docs/requirements.md and docs/user-stories.md. Do NOT design UI or write any code.",
        outputs: [{ name: "docs/requirements.md" }, { name: "docs/user-stories.md" }] },
      { id: "design", name: "Design & Architecture", tool: "opencode", gate: "design approved",
        systemPrompt: "You are a product designer and software architect. Read docs/vision.md and docs/requirements.md. Define the UX (screen list, navigation, and RESPONSIVE layout rules for BOTH desktop and mobile), the data model, and the Flutter app architecture (folder structure, state management, packages). Write docs/design.md and docs/architecture.md. Do NOT write application code yet.",
        outputs: [{ name: "docs/design.md" }, { name: "docs/architecture.md" }] },
      { id: "planning", name: "Sprint Planning", tool: "opencode", gate: "backlog ready",
        systemPrompt: "You are an agile lead. Read the docs/ design and requirements. Break the work into a prioritized product backlog and a first-sprint plan of concrete, small tasks mapped to user stories. Write docs/backlog.md and docs/sprint-plan.md. Do NOT write code.",
        outputs: [{ name: "docs/backlog.md" }, { name: "docs/sprint-plan.md" }] },
      { id: "implementation", name: "Implementation", tool: "opencode", gate: "builds & runs",
        systemPrompt: "You are a senior Flutter engineer. Read ALL docs/. If the Flutter app is not yet scaffolded, run `flutter create . --platforms=macos,web`. Then implement the features from docs/sprint-plan.md and docs/backlog.md, following docs/architecture.md, with a RESPONSIVE UI that adapts between desktop and mobile widths. Run `flutter pub get` and `flutter analyze` and fix problems. Write clean, idiomatic Dart. Implement only what the plan calls for.",
        outputs: [{ name: "lib/", note: "the responsive Flutter app" }] },
      { id: "testing", name: "Testing", tool: "opencode", gate: "tests pass",
        systemPrompt: "You are a QA engineer. Read docs/ and the implemented code. Write widget and unit tests covering the core features and the acceptance criteria in docs/user-stories.md. Run `flutter test` and fix failures. Summarize results in docs/test-report.md.",
        outputs: [{ name: "test/" }, { name: "docs/test-report.md" }] },
      { id: "review", name: "Review & Release", tool: "opencode", gate: "approved for release",
        systemPrompt: "You are a tech lead. Review the implementation against docs/requirements.md and the acceptance criteria in docs/user-stories.md. Note any gaps, write a short retrospective and release notes. Write docs/review.md and CHANGELOG.md. Do NOT change application code.",
        outputs: [{ name: "docs/review.md" }, { name: "CHANGELOG.md" }] },
    ],
  },
  {
    id: "marketing", label: "Marketing", workingDir: ".",
    stages: [
      { id: "research", name: "Research", tool: "claude", gate: "reviewed",
        systemPrompt: "You are a market researcher. Produce a crisp brief from the task intent only.",
        outputs: [{ name: "brief.md", note: "problem + audience" }] },
      { id: "planning", name: "Planning", tool: "claude", gate: "reviewed",
        systemPrompt: "You are a campaign planner. Turn the brief into a concrete plan.",
        outputs: [{ name: "plan.md" }] },
      { id: "spec", name: "Spec", tool: "claude", gate: "reviewed",
        systemPrompt: "You are a copy/spec writer. Produce the final deliverable spec from the plan.",
        outputs: [{ name: "spec.md" }] },
    ],
  },
  {
    id: "dev", label: "Dev", workingDir: ".",
    stages: [
      { id: "spec", name: "Spec", tool: "claude", gate: "reviewed",
        systemPrompt: "You are a senior engineer. Write spec.md + acceptance.md from the task intent only.",
        outputs: [{ name: "spec.md" }, { name: "acceptance.md" }] },
      { id: "build", name: "Build", tool: "claude", gate: "tests pass", shell: [],
        systemPrompt: "You are an implementer. Implement strictly to the spec; keep the change minimal.",
        outputs: [{ name: "diff" }] },
      { id: "review", name: "Review", tool: "claude", gate: "approved",
        systemPrompt: "You are a reviewer. Check the implementation against acceptance.md.",
        outputs: [{ name: "review.md" }] },
    ],
  },
];

// CLI tool registry — how each supported command-line tool is invoked. v1:
// claude (Claude Code) and opencode. API tools come later behind the same
// interface. `model` (optional) overrides the tool's own default — set per run,
// or server-wide via BRIDZA_CLAUDE_MODEL / BRIDZA_OPENCODE_MODEL.
export const CLI_TOOLS = [
  {
    id: "claude",
    label: "Claude Code",
    bin: "claude",
    args: ({ prompt, system, model }) => {
      const a = ["-p", prompt, "--permission-mode", "acceptEdits"];
      if (model) a.push("--model", model);
      if (system) a.push("--append-system-prompt", system);
      return a;
    },
  },
  {
    id: "opencode",
    label: "opencode",
    bin: "opencode",
    stream: "json", // --format json: one JSON event per line, parsed for text + sessionID
    // opencode has no system-prompt flag — fold it into the message.
    // --dangerously-skip-permissions: unattended runs (the Automate flow) must not
    // block on tool-approval prompts. This is Bridza's own subprocess, by design.
    args: ({ prompt, system, model }) => [
      "run", "--format", "json", "--dangerously-skip-permissions",
      ...(model ? ["-m", model] : []),
      (system ? "System instructions:\n" + system + "\n\n" : "") + prompt,
    ],
  },
];
