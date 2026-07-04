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

// ── stage flows: a pipeline carries one or MORE named stage flows ────────────
// Each flow is an independent stage sequence { id, name, stages } (name
// defaults to the pipeline's). Every task belongs to exactly one flow. Older
// pipelines are normalized here: templates become flows (each template's
// stage-id subset resolved against the stage pool); a plain stage list becomes
// a single flow named after the pipeline.
export function pipelineFlows(def) {
  if (Array.isArray(def.flows) && def.flows.length) {
    return def.flows.map((f, i) => ({
      id: f.id || "flow-" + (i + 1),
      name: f.name || def.label || def.id || "Flow " + (i + 1),
      stages: Array.isArray(f.stages) ? f.stages : [],
    }));
  }
  const pool = def.stages || [];
  const tpls = (def.templates || []).filter((t) => t && t.id);
  if (tpls.length) return tpls.map((t) => ({
    id: t.id, name: t.label || t.id,
    stages: (t.stages || []).map((sid) => pool.find((s) => s.id === sid)).filter(Boolean),
  }));
  return [{ id: "main", name: def.label || def.id || "Flow", stages: pool }];
}

// One flat stage-def list across all flows (first occurrence of an id wins) —
// the lookup table tasks resolve their stage ids against.
export function flattenFlows(flows) {
  const seen = new Set(), out = [];
  for (const f of flows || []) for (const s of f.stages || []) {
    if (!s || !s.id || seen.has(s.id)) continue;
    seen.add(s.id); out.push(s);
  }
  return out;
}

// The flow's fit-JUDGE stage: where a mis-filed task is caught. NOT the first
// stage — early on there's no research/requirements to judge by; the task runs
// through those, and at implementation time (when the docs are in the
// worktree) the flow decides single-task vs multi-task feature. The stage
// flagged `judge: true` wins; unflagged flows fall back to the first
// implementation-looking stage by name.
export function judgeStageId(flow) {
  const st = (flow && flow.stages) || [];
  const flagged = st.find((s) => s && s.judge);
  if (flagged) return flagged.id;
  const impl = st.find((s) => /implement|build|fix|code|dev/i.test((s.name || "") + " " + (s.id || "")));
  return impl ? impl.id : null;
}

// Fit check — appended to the JUDGE stage's run prompt when the pipeline has
// several flows. By now the earlier stages' outputs are on the branch, so the
// judgement is informed: is this really one task of this flow, or e.g. a
// multi-ticket feature that must be broken down under a different flow?
export function flowFitCheck(flowName, otherFlows) {
  const others = (otherFlows || []).filter((f) => f && f.name);
  if (!others.length) return "";
  return "Fit check — this task was filed under the \"" + flowName + "\" flow. The earlier stages' outputs (research, requirements, design…) are in the worktree — read them, then judge whether this really is a single \"" + flowName + "\" task. The pipeline's other flows: "
    + others.map((f) => "\"" + f.name + "\" (" + (f.stages || []).map((s) => s.name || s.id).join(" → ") + ")").join("; ")
    + ". If it belongs in a different flow (e.g. it's a multi-task feature that must be broken down, not implemented in one go), STOP: write flow-fit.md naming the right flow and why — the earlier stages' work stays on this branch — and do NO implementation. If it fits, proceed normally.";
}

// ── stage-flow files: one flow, portable ─────────────────────────────────────
// A single stage flow can leave a pipeline (export/email) and enter another
// (import) as a small self-describing JSON document.
export const FLOW_FILE_KIND = "bridza-stage-flow";
export function exportFlow(flow) {
  return { kind: FLOW_FILE_KIND, v: 1, name: flow.name || "", stages: flow.stages || [] };
}
export function parseFlowFile(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return { error: "that file isn't valid JSON" }; }
  if (!j || j.kind !== FLOW_FILE_KIND || !Array.isArray(j.stages) || !j.stages.length) {
    return { error: "not a Bridza stage-flow file (expected kind \"" + FLOW_FILE_KIND + "\" with stages)" };
  }
  return { flow: { name: String(j.name || "Imported flow"), stages: j.stages } };
}

// ── pipeline files: the WHOLE pipeline (all flows), portable ─────────────────
export const PIPELINE_FILE_KIND = "bridza-pipeline";
export function exportPipeline(p) {
  return { kind: PIPELINE_FILE_KIND, v: 1, label: p.label || p.id || "", workingDir: p.workingDir || ".", flows: pipelineFlows(p) };
}
export function parsePipelineFile(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return { error: "that file isn't valid JSON" }; }
  if (!j || j.kind !== PIPELINE_FILE_KIND || !Array.isArray(j.flows) || !j.flows.length) {
    return { error: "not a Bridza pipeline file (expected kind \"" + PIPELINE_FILE_KIND + "\" with flows)" };
  }
  return { pipeline: { label: String(j.label || "Imported pipeline"), workingDir: String(j.workingDir || "."), flows: j.flows } };
}

// ── stage specs: named requirement variables ────────────────────────────────
// A stage carries specs: [{ key, value }] — hard requirement variables (which
// OS, form factors, target age…) that ride into every run's system prompt.
// SPEC_CATALOG is the predefined menu (grouped for nested dropdowns); each item
// suggests values but any value — and any custom key — is allowed.
export const SPEC_CATALOG = [
  { group: "Platform", items: [
    { key: "target-os", label: "Target OS", values: ["macOS", "Windows", "Linux", "iOS", "Android", "Web", "cross-platform"] },
    { key: "form-factors", label: "Form factors", values: ["phone", "tablet", "desktop", "watch", "TV", "foldable", "responsive web"] },
    { key: "min-os-version", label: "Min OS version", values: ["iOS 16+", "Android 10+", "macOS 13+", "Windows 11+"] },
    { key: "browsers", label: "Browser support", values: ["evergreen only", "Chrome + Safari + Firefox", "incl. mobile Safari", "incl. legacy Edge"] },
    { key: "offline", label: "Offline support", values: ["required", "read-only offline", "not needed"] },
    { key: "distribution", label: "Distribution", values: ["App Store", "Play Store", "web", "direct download", "enterprise/MDM"] },
  ] },
  { group: "Audience", items: [
    { key: "potential-userbase", label: "Potential userbase", values: ["<1k", "1k–10k", "10k–100k", "100k–1M", "1M+"] },
    { key: "target-age", label: "Target age", values: ["kids (<13)", "teens (13–17)", "adults (18–45)", "seniors (45+)", "all ages"] },
    { key: "user-expertise", label: "User expertise", values: ["non-technical", "prosumer", "developer", "domain expert"] },
    { key: "locales", label: "Languages / locales", values: ["English only", "EN + 2–5 locales", "fully localized", "RTL support"] },
    { key: "accessibility", label: "Accessibility", values: ["WCAG 2.1 AA", "WCAG 2.2 AAA", "screen-reader first", "best effort"] },
  ] },
  { group: "Product", items: [
    { key: "monetization", label: "Monetization", values: ["free", "freemium", "subscription", "one-time purchase", "ads", "B2B licensing"] },
    { key: "release-scope", label: "Release scope", values: ["MVP", "beta", "GA / production", "internal tool"] },
    { key: "platform-parity", label: "Platform parity", values: ["identical everywhere", "mobile-first", "desktop-first"] },
    { key: "branding", label: "Branding", values: ["follow brand guide", "minimal / unbranded", "playful", "enterprise-sober"] },
  ] },
  { group: "Quality & compliance", items: [
    { key: "performance-budget", label: "Performance budget", values: ["<100ms interactions", "<3s cold start", "60fps animations", "low-end devices"] },
    { key: "compliance", label: "Compliance", values: ["GDPR", "HIPAA", "SOC 2", "COPPA", "PCI-DSS", "none"] },
    { key: "privacy", label: "Privacy posture", values: ["no tracking", "anonymized analytics", "full telemetry ok"] },
    { key: "test-coverage", label: "Test coverage", values: ["unit only", "unit + widget", "unit + integration + e2e", "critical paths only"] },
    { key: "security", label: "Security bar", values: ["OWASP top 10", "pen-test ready", "internal baseline"] },
  ] },
  { group: "Tech", items: [
    { key: "framework", label: "Framework / language", values: ["Flutter", "React", "React Native", "SwiftUI", "Kotlin", "Vue", "Svelte"] },
    { key: "backend", label: "Backend", values: ["none / local-only", "Firebase", "Supabase", "REST API", "GraphQL", "self-hosted"] },
    { key: "data-store", label: "Data store", values: ["SQLite", "Postgres", "IndexedDB / local", "cloud sync"] },
    { key: "auth", label: "Auth", values: ["none", "email + password", "OAuth / social", "SSO / SAML", "passkeys"] },
  ] },
];

export const specLabel = (key) => {
  for (const g of SPEC_CATALOG) for (const it of g.items) if (it.key === key) return it.label;
  return key;
};
export const specValues = (key) => {
  for (const g of SPEC_CATALOG) for (const it of g.items) if (it.key === key) return it.values;
  return [];
};

// Append a stage's specs to the run PROMPT (never the system prompt — that
// stays exactly as authored). Every run (manual or automate) carries them, so
// the agent treats them as hard requirements, not suggestions.
export function withSpecs(prompt, specs) {
  const lines = (specs || [])
    .filter((s) => s && s.key && String(s.value || "").trim())
    .map((s) => "- " + specLabel(s.key) + ": " + String(s.value).trim());
  if (!lines.length) return prompt || "";
  return (prompt ? prompt + "\n\n" : "") + "Stage specs — treat each as a hard requirement:\n" + lines.join("\n");
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

// Starter pipeline templates offered when a project has no pipelines yet.
// A pipeline is a business CATEGORY; inside it live several stage flows sized
// by urgency/scope/type. Stage ids are unique across all flows of a category
// (tasks resolve stage defs by id). More flows land inside each category over
// time — flows are also importable one by one from the Stage flows screen.
export const STARTER_PIPELINES = [
  {
    id: "engineering", label: "Engineering", workingDir: ".",
    flows: [
      // The complete agile lifecycle for building a product from scratch.
      // Every stage reads the PREVIOUS stages' artifacts from the worktree, so
      // requirements precede design precede code.
      { id: "full-sdlc", name: "Full product SDLC", stages: [
        { id: "vision", name: "Vision", tool: "opencode", gate: "vision approved",
          systemPrompt: "You are a product strategist. Using ONLY the task intent, write the product vision: the problem, the SPECIFIC target users, their jobs-to-be-done, the value proposition, and measurable success criteria. Write it to docs/vision.md. Do NOT write requirements, designs, or any code yet.",
          outputs: [{ name: "docs/vision.md", note: "problem, users, value, success metrics" }],
          specs: [{ key: "potential-userbase", value: "" }, { key: "target-age", value: "" }] },
        { id: "requirements", name: "Requirements", tool: "opencode", gate: "requirements signed off",
          systemPrompt: "You are a business analyst. Read docs/vision.md. Produce detailed product requirements and user stories with acceptance criteria (Given/When/Then). Cover functional AND non-functional needs, honoring every stage spec (OS, form factors, offline…) as a hard constraint. Write docs/requirements.md and docs/user-stories.md. Do NOT design UI or write any code.",
          outputs: [{ name: "docs/requirements.md" }, { name: "docs/user-stories.md" }],
          specs: [{ key: "target-os", value: "" }, { key: "form-factors", value: "" }, { key: "offline", value: "" }] },
        { id: "architecture", name: "Design & Architecture", tool: "opencode", gate: "design approved",
          systemPrompt: "You are a product designer and software architect. Read docs/vision.md and docs/requirements.md. Define the UX (screen list, navigation, layout rules for every required form factor), the data model, and the app architecture (folder structure, state management, key libraries) for the stack in the specs — or the repo's existing stack if none is specified. Prefer the platform's native capabilities over extra dependencies. Write docs/design.md and docs/architecture.md. Do NOT write application code yet.",
          outputs: [{ name: "docs/design.md" }, { name: "docs/architecture.md" }],
          specs: [{ key: "framework", value: "" }] },
        { id: "planning", name: "Sprint Planning", tool: "opencode", gate: "backlog ready",
          systemPrompt: "You are an agile lead. Read the docs/ design and requirements. Break the work into a prioritized product backlog and a first-sprint plan of concrete, small tasks mapped to user stories. Write docs/backlog.md and docs/sprint-plan.md. Do NOT write code.",
          outputs: [{ name: "docs/backlog.md" }, { name: "docs/sprint-plan.md" }] },
        { id: "implementation", name: "Implementation", tool: "opencode", gate: "builds & runs", judge: true,
          systemPrompt: "You are a senior engineer. Read ALL docs/. Scaffold the project only if it isn't already, using the stack from docs/architecture.md. Implement the features from docs/sprint-plan.md following docs/architecture.md. Work lazily-well: reuse what the codebase already has before writing new code, prefer the standard library and platform features over new dependencies, no speculative abstractions — the smallest change that satisfies the plan. Run the project's build/lint and fix problems. Implement only what the plan calls for.",
          outputs: [{ name: "src/", note: "the implemented app" }] },
        { id: "testing", name: "Testing", tool: "opencode", gate: "tests pass",
          systemPrompt: "You are a QA engineer. Read docs/ and the implemented code. Write tests covering the core features and the acceptance criteria in docs/user-stories.md, using the project's existing test runner and conventions. Run the tests and fix failures. Summarize results in docs/test-report.md.",
          outputs: [{ name: "test/" }, { name: "docs/test-report.md" }] },
        { id: "release", name: "Review & Release", tool: "opencode", gate: "approved for release",
          systemPrompt: "You are a tech lead. Review the implementation against docs/requirements.md and the acceptance criteria in docs/user-stories.md. Note any gaps, write a short retrospective and release notes. Write docs/review.md and CHANGELOG.md. Do NOT change application code.",
          outputs: [{ name: "docs/review.md" }, { name: "CHANGELOG.md" }] },
      ] },
      { id: "feature", name: "Feature", stages: [
        { id: "spec", name: "Spec", tool: "claude", gate: "reviewed",
          systemPrompt: "You are a senior engineer. Write spec.md + acceptance.md from the task intent only. The smallest spec that answers what, why, and how we'll know it works — no speculative requirements, no 'nice to have' scope.",
          outputs: [{ name: "spec.md" }, { name: "acceptance.md" }] },
        { id: "build", name: "Build", tool: "claude", gate: "tests pass", shell: [], judge: true,
          systemPrompt: "You are an implementer. Implement strictly to the spec; the shortest working diff wins. Reuse what the codebase already has, prefer the standard library over new dependencies, no abstractions with a single caller.",
          outputs: [{ name: "diff" }] },
        { id: "review", name: "Review", tool: "claude", gate: "approved",
          systemPrompt: "You are a reviewer. Check the implementation against acceptance.md. Also flag over-engineering: unused flexibility, reinvented stdlib, abstractions with one caller — name what to delete.",
          outputs: [{ name: "review.md" }] },
      ] },
      { id: "bugfix", name: "Bugfix", stages: [
        { id: "repro", name: "Reproduce", tool: "claude", gate: "bug reproduced",
          systemPrompt: "You are a debugger. Reproduce the reported bug: find the failing path, capture exact steps/inputs and the observed vs expected behavior, and identify the root cause. Write repro.md. Do NOT fix anything yet.",
          outputs: [{ name: "repro.md", note: "steps + root cause" }] },
        { id: "fix", name: "Fix", tool: "claude", gate: "bug gone, tests pass", judge: true,
          systemPrompt: "You are an implementer. Read repro.md and fix the root cause with the smallest correct change — check every caller of the code you touch and fix at the shared path, not per call site. Add a regression test where feasible.",
          outputs: [{ name: "diff" }] },
        { id: "fix-review", name: "Review", tool: "claude", gate: "approved",
          systemPrompt: "You are a reviewer. Verify the fix addresses the root cause in repro.md, check for regressions in sibling callers, and confirm the regression test fails without the fix.",
          outputs: [{ name: "review.md" }] },
      ] },
      { id: "ui-design", name: "UI design", stages: [
        { id: "design-spec", name: "Spec", tool: "claude", gate: "reviewed",
          systemPrompt: "You are a senior engineer. Write spec.md + acceptance.md from the task intent only. The smallest spec that answers what, why, and how we'll know it works.",
          outputs: [{ name: "spec.md" }, { name: "acceptance.md" }] },
        { id: "design", name: "Design", tool: "claude", gate: "design approved", judge: true,
          systemPrompt: "You are a product designer. From the task intent (and spec.md if present), define the UX and visual design: screens, states, layout rules, component inventory. Write design.md. Do NOT write application code.",
          outputs: [{ name: "design.md" }] },
      ] },
      { id: "dissection", name: "Feature dissection", stages: [
        { id: "dissect", name: "Dissect", tool: "claude", gate: "sub-tasks reviewed",
          systemPrompt: "You are a tech lead. Split the feature described in the task intent into small, independently-deliverable sub-tasks. FIRST read .bridza/.metadata/creation-guide.md and follow it exactly: for each sub-task create .bridza/pipelines/<this pipeline>/<sub-task-id>/metadata.json (type: \"subtask\") and context.md with its own clear intent and acceptance criteria, and wire ordering dependencies into .bridza/plan.json (merge, never overwrite). Your output is TASKS, not code or docs.",
          outputs: [{ name: ".bridza/pipelines/", type: "issue", note: "one sub-task per sub-feature" }] },
      ] },
    ],
  },
  {
    id: "product", label: "Product", workingDir: ".",
    flows: [
      { id: "feedback-roadmap", name: "Feedback → Roadmap", stages: [
        { id: "fb-synthesize", name: "Synthesize feedback", tool: "claude", gate: "themes agreed",
          systemPrompt: "You are a product researcher. Synthesize the feedback named in the task intent (tickets, reviews, interviews) into themes with frequency and severity. Write themes.md.",
          outputs: [{ name: "themes.md" }] },
        { id: "fb-prioritize", name: "Prioritize", tool: "claude", gate: "priorities approved", judge: true,
          systemPrompt: "You are a product manager. Score themes.md by impact vs effort, pick what makes the cut and what explicitly does not, with reasoning. Write priorities.md.",
          outputs: [{ name: "priorities.md" }] },
        { id: "fb-roadmap", name: "Roadmap update", tool: "claude", gate: "roadmap published",
          systemPrompt: "You are a product lead. Turn priorities.md into the roadmap update: now/next/later, owners, and the public changelog note. Write roadmap.md.",
          outputs: [{ name: "roadmap.md" }] },
      ] },
    ],
  },
  {
    id: "design-brand", label: "Design & Brand", workingDir: ".",
    flows: [
      { id: "brand-identity", name: "Brand identity", stages: [
        { id: "brand-positioning", name: "Positioning", tool: "claude", gate: "positioning agreed",
          systemPrompt: "You are a brand strategist. From the task intent define the positioning: audience, category, differentiation, personality, and the one-line promise. Write positioning.md.",
          outputs: [{ name: "positioning.md" }],
          specs: [{ key: "target-age", value: "" }, { key: "branding", value: "" }] },
        { id: "brand-voice", name: "Voice & messaging", tool: "claude", gate: "voice approved",
          systemPrompt: "You are a brand writer. From positioning.md define the voice (tone, do/don't, vocabulary) and the messaging hierarchy (tagline, elevator pitch, proof points). Write voice.md.",
          outputs: [{ name: "voice.md" }] },
        { id: "brand-visual", name: "Visual brief", tool: "claude", gate: "brief approved", judge: true,
          systemPrompt: "You are an art director. From positioning.md and voice.md write the visual identity brief: color direction, typography, imagery style, logo requirements. Write visual-brief.md.",
          outputs: [{ name: "visual-brief.md" }] },
      ] },
    ],
  },
  {
    id: "content", label: "Content Studio", workingDir: ".",
    flows: [
      { id: "full-production", name: "Full production", stages: [
        { id: "concept", name: "Concept", tool: "claude", gate: "concept approved",
          systemPrompt: "You are a video creative director. From the task intent, write the video concept: audience, core message, tone, format, and success metric. Write concept.md. No script yet.",
          outputs: [{ name: "concept.md" }], specs: [{ key: "platforms", value: "" }, { key: "target-age", value: "" }, { key: "video-length", value: "" }] },
        { id: "script", name: "Script", tool: "claude", gate: "script locked",
          systemPrompt: "You are a scriptwriter. Read concept.md. Write the full narration/dialog script with timestamps and scene notes. Write script.md.",
          outputs: [{ name: "script.md" }] },
        { id: "storyboard", name: "Storyboard", tool: "claude", gate: "storyboard approved",
          systemPrompt: "You are a storyboard artist. Read script.md. Break it into numbered shots: framing, on-screen text, b-roll, and assets needed per shot. Write storyboard.md and assets-list.md.",
          outputs: [{ name: "storyboard.md" }, { name: "assets-list.md" }] },
        { id: "produce", name: "Production plan", tool: "claude", gate: "ready to shoot/render", judge: true,
          systemPrompt: "You are a producer. Read all docs. Produce the shoot/render plan: schedule, tooling, who/what per shot, and the edit checklist. Write production-plan.md.",
          outputs: [{ name: "production-plan.md" }] },
        { id: "publish", name: "Publish kit", tool: "claude", gate: "published",
          systemPrompt: "You are a distribution specialist. Produce per-platform titles, descriptions, tags, thumbnails brief, chapters, and a posting schedule. Write publish-kit.md.",
          outputs: [{ name: "publish-kit.md" }] },
      ] },
      { id: "quick-short", name: "Quick short", stages: [
        { id: "hook", name: "Hook & script", tool: "claude", gate: "hook approved",
          systemPrompt: "You are a short-form video writer. From the task intent, write 3 hook options and a <60s script for the best one. Write short-script.md.",
          outputs: [{ name: "short-script.md" }], specs: [{ key: "platforms", value: "" }] },
        { id: "shotlist", name: "Shot list", tool: "claude", gate: "ready to record", judge: true,
          systemPrompt: "You are a director. Turn short-script.md into a shot list with framing, text overlays, and cut timing. Write shots.md.",
          outputs: [{ name: "shots.md" }] },
        { id: "captions", name: "Captions & publish", tool: "claude", gate: "posted",
          systemPrompt: "You are a publisher. Write captions, hashtags, and per-platform posting notes. Write publish.md.",
          outputs: [{ name: "publish.md" }] },
      ] },
      { id: "repurpose", name: "Repurpose existing", stages: [
        { id: "source", name: "Source review", tool: "claude", gate: "cuts chosen",
          systemPrompt: "You are a content editor. Review the source video/transcript named in the task intent and pick the strongest segments to repurpose. Write segments.md with timestamps and why each works.",
          outputs: [{ name: "segments.md" }] },
        { id: "variants", name: "Platform variants", tool: "claude", gate: "variants approved", judge: true,
          systemPrompt: "You are a repurposing specialist. For each segment produce per-platform cut plans (aspect, length, captions, hook). Write variants.md.",
          outputs: [{ name: "variants.md" }] },
      ] },
      { id: "blog-article", name: "Blog article", stages: [
        { id: "blog-outline", name: "Outline", tool: "claude", gate: "outline approved",
          systemPrompt: "You are a content editor. From the task intent write the article outline: angle, audience, key points, sources to cite. Write outline.md.",
          outputs: [{ name: "outline.md" }] },
        { id: "blog-draft", name: "Draft", tool: "claude", gate: "draft reviewed", judge: true,
          systemPrompt: "You are a writer. Write the article per outline.md — clear, concrete, no filler. Write draft.md.",
          outputs: [{ name: "draft.md" }] },
        { id: "blog-edit", name: "Edit & publish", tool: "claude", gate: "published",
          systemPrompt: "You are an editor. Tighten draft.md, add meta title/description and internal links, and produce the final. Write final.md.",
          outputs: [{ name: "final.md" }] },
      ] },
    ],
  },
  {
    id: "marketing", label: "Marketing & Growth", workingDir: ".",
    flows: [
      { id: "campaign-brief", name: "Campaign brief", stages: [
        { id: "research", name: "Research", tool: "claude", gate: "reviewed",
          systemPrompt: "You are a market researcher. Produce a crisp brief from the task intent only.",
          outputs: [{ name: "brief.md", note: "problem + audience" }] },
        { id: "planning", name: "Planning", tool: "claude", gate: "reviewed",
          systemPrompt: "You are a campaign planner. Turn the brief into a concrete plan.",
          outputs: [{ name: "plan.md" }] },
        { id: "spec", name: "Spec", tool: "claude", gate: "reviewed", judge: true,
          systemPrompt: "You are a copy/spec writer. Produce the final deliverable spec from the plan.",
          outputs: [{ name: "spec.md" }] },
      ] },
      { id: "social-campaign", name: "Social campaign", stages: [
        { id: "soc-research", name: "Research", tool: "claude", gate: "insights reviewed",
          systemPrompt: "You are a social strategist. Research the audience, competitors, and platform trends relevant to the task intent. Write research.md.",
          outputs: [{ name: "research.md" }], specs: [{ key: "platforms", value: "" }, { key: "target-age", value: "" }, { key: "campaign-budget", value: "" }] },
        { id: "strategy", name: "Strategy", tool: "claude", gate: "strategy approved",
          systemPrompt: "You are a campaign planner. Read research.md. Define goals, KPIs, platform mix, content pillars, and cadence. Write strategy.md.",
          outputs: [{ name: "strategy.md" }] },
        { id: "calendar", name: "Content calendar", tool: "claude", gate: "calendar approved", judge: true,
          systemPrompt: "You are a content planner. Read strategy.md. Produce a dated content calendar: per-post platform, format, topic, CTA. Write calendar.md.",
          outputs: [{ name: "calendar.md" }] },
        { id: "assets", name: "Copy & assets", tool: "claude", gate: "assets ready",
          systemPrompt: "You are a copywriter and art director. Write the copy and visual briefs for every calendar entry. Write posts/ one file per post.",
          outputs: [{ name: "posts/" }] },
        { id: "launch", name: "Schedule & KPIs", tool: "claude", gate: "scheduled",
          systemPrompt: "You are a social media manager. Produce the scheduling plan and the KPI tracking sheet (what to measure, when, targets). Write schedule.md and kpis.md.",
          outputs: [{ name: "schedule.md" }, { name: "kpis.md" }] },
      ] },
      { id: "single-post", name: "Single post", stages: [
        { id: "post-brief", name: "Brief", tool: "claude", gate: "brief ok",
          systemPrompt: "You are a social editor. Turn the task intent into a one-post brief: platform, audience, message, CTA. Write brief.md.",
          outputs: [{ name: "brief.md" }], specs: [{ key: "platforms", value: "" }] },
        { id: "post", name: "Copy & visual", tool: "claude", gate: "approved", judge: true,
          systemPrompt: "You are a copywriter. From brief.md write the post copy (with variants), hashtags, and the visual brief. Write post.md.",
          outputs: [{ name: "post.md" }] },
      ] },
      { id: "fire-drill", name: "Community fire drill", stages: [
        { id: "triage", name: "Triage", tool: "claude", gate: "severity agreed",
          systemPrompt: "You are a community manager handling an incident. Assess what happened, sentiment, spread, and severity. Write triage.md. Recommend respond/ignore/escalate.",
          outputs: [{ name: "triage.md" }] },
        { id: "respond", name: "Response plan", tool: "claude", gate: "responses approved", judge: true,
          systemPrompt: "You are a comms lead. From triage.md draft the public response(s), internal talking points, and do/don't list. Write response.md.",
          outputs: [{ name: "response.md" }] },
        { id: "followup", name: "Follow-up report", tool: "claude", gate: "closed",
          systemPrompt: "You are an analyst. Write the post-incident report: timeline, impact, learnings, prevention. Write postmortem.md.",
          outputs: [{ name: "postmortem.md" }] },
      ] },
      { id: "site-audit", name: "SEO site audit", stages: [
        { id: "crawl", name: "Crawl audit", tool: "claude", gate: "findings reviewed",
          systemPrompt: "You are a technical SEO. Audit the site named in the task intent: indexing, speed, structure, schema, internal linking. Write audit.md with prioritized findings.",
          outputs: [{ name: "audit.md" }], specs: [{ key: "target-locale", value: "" }, { key: "primary-market", value: "" }] },
        { id: "techfix", name: "Technical fixes", tool: "claude", gate: "fixes specced",
          systemPrompt: "You are an SEO engineer. Turn audit.md findings into concrete fix specs with effort estimates. Write fixes.md.",
          outputs: [{ name: "fixes.md" }] },
        { id: "gaps", name: "Content gaps", tool: "claude", gate: "gaps agreed",
          systemPrompt: "You are a content strategist. Map keyword/content gaps vs competitors. Write content-gaps.md.",
          outputs: [{ name: "content-gaps.md" }] },
        { id: "roadmap", name: "Roadmap", tool: "claude", gate: "roadmap approved", judge: true,
          systemPrompt: "You are an SEO lead. Combine fixes.md and content-gaps.md into a quarter roadmap with expected impact. Write roadmap.md.",
          outputs: [{ name: "roadmap.md" }] },
      ] },
      { id: "keyword-sprint", name: "Keyword sprint", stages: [
        { id: "keywords", name: "Keyword research", tool: "claude", gate: "keywords chosen",
          systemPrompt: "You are a keyword researcher. For the topic in the task intent, cluster keywords by intent and pick the primary + secondaries. Write keywords.md.",
          outputs: [{ name: "keywords.md" }] },
        { id: "kw-brief", name: "Content brief", tool: "claude", gate: "brief approved",
          systemPrompt: "You are a content editor. From keywords.md write the article brief: outline, entities to cover, internal links, meta. Write brief.md.",
          outputs: [{ name: "brief.md" }] },
        { id: "draft", name: "Draft", tool: "claude", gate: "draft reviewed", judge: true,
          systemPrompt: "You are a writer. Write the article per brief.md. Write draft.md.",
          outputs: [{ name: "draft.md" }] },
        { id: "onpage", name: "On-page optimization", tool: "claude", gate: "published",
          systemPrompt: "You are an on-page SEO. Final pass on draft.md: title/meta, headings, schema, links, image alts. Write final.md and checklist.md.",
          outputs: [{ name: "final.md" }, { name: "checklist.md" }] },
      ] },
      { id: "rank-drop", name: "Rank drop (urgent)", stages: [
        { id: "diagnose", name: "Diagnose", tool: "claude", gate: "cause identified",
          systemPrompt: "You are an SEO incident analyst. Diagnose the ranking drop in the task intent: algo update, technical regression, lost links, SERP change. Write diagnosis.md.",
          outputs: [{ name: "diagnosis.md" }] },
        { id: "fixplan", name: "Fix plan", tool: "claude", gate: "fixes shipped", judge: true,
          systemPrompt: "You are an SEO engineer. From diagnosis.md write the recovery plan ordered by impact. Write recovery.md.",
          outputs: [{ name: "recovery.md" }] },
        { id: "monitor", name: "Monitor report", tool: "claude", gate: "recovered",
          systemPrompt: "You are an analyst. Define what to watch, checkpoints, and the recovery report template. Write monitoring.md.",
          outputs: [{ name: "monitoring.md" }] },
      ] },
    ],
  },
  {
    id: "sales", label: "Sales", workingDir: ".",
    flows: [
      { id: "outbound", name: "Outbound campaign", stages: [
        { id: "icp", name: "ICP research", tool: "claude", gate: "ICP agreed",
          systemPrompt: "You are a sales researcher. Define the ideal customer profile for the offer in the task intent: firmographics, pain points, buying triggers. Write icp.md.",
          outputs: [{ name: "icp.md" }], specs: [{ key: "deal-size", value: "" }, { key: "sales-region", value: "" }] },
        { id: "prospects", name: "Prospect criteria", tool: "claude", gate: "list criteria approved",
          systemPrompt: "You are a prospecting specialist. From icp.md produce the list-building playbook: sources, filters, disqualifiers, and a scoring rubric. Write prospecting.md.",
          outputs: [{ name: "prospecting.md" }] },
        { id: "sequence", name: "Sequence copy", tool: "claude", gate: "sequence approved", judge: true,
          systemPrompt: "You are a sales copywriter. Write the outreach sequence: emails, LinkedIn touches, call scripts, objection handling. Write sequence.md.",
          outputs: [{ name: "sequence.md" }] },
        { id: "launchplan", name: "Launch plan", tool: "claude", gate: "launched",
          systemPrompt: "You are a sales ops lead. Produce the rollout plan: volumes, cadence, tracking fields, and review checkpoints. Write launch.md.",
          outputs: [{ name: "launch.md" }] },
      ] },
      { id: "enterprise", name: "Enterprise deal", stages: [
        { id: "discovery", name: "Discovery brief", tool: "claude", gate: "discovery done",
          systemPrompt: "You are an enterprise AE. From the task intent compile the account brief: stakeholders, needs, decision process, competition, risks. Write discovery.md.",
          outputs: [{ name: "discovery.md" }] },
        { id: "solution", name: "Solution map", tool: "claude", gate: "solution fits",
          systemPrompt: "You are a solutions consultant. Map their needs to the offering; note gaps and required proof points. Write solution-map.md.",
          outputs: [{ name: "solution-map.md" }] },
        { id: "proposal", name: "Proposal", tool: "claude", gate: "proposal sent", judge: true,
          systemPrompt: "You are a proposal writer. Draft the proposal: scope, pricing structure, timeline, terms, and the executive summary. Write proposal.md.",
          outputs: [{ name: "proposal.md" }] },
        { id: "negotiation", name: "Negotiation prep", tool: "claude", gate: "closed",
          systemPrompt: "You are a deal desk advisor. Prepare the negotiation: concessions ladder, walk-away points, and close plan. Write negotiation.md.",
          outputs: [{ name: "negotiation.md" }] },
      ] },
      { id: "inbound", name: "Inbound lead", stages: [
        { id: "qualify", name: "Qualify", tool: "claude", gate: "qualified",
          systemPrompt: "You are an SDR. From the lead info in the task intent, qualify it (fit, urgency, budget signals) and draft the first response. Write qualify.md.",
          outputs: [{ name: "qualify.md" }] },
        { id: "demo", name: "Demo prep", tool: "claude", gate: "demo done", judge: true,
          systemPrompt: "You are an AE. Prepare the demo: agenda tailored to their pain points, story arc, and likely questions. Write demo-prep.md.",
          outputs: [{ name: "demo-prep.md" }] },
        { id: "follow", name: "Follow-up", tool: "claude", gate: "next step booked",
          systemPrompt: "You are an AE. Write the follow-up email, recap, and mutual action plan. Write follow-up.md.",
          outputs: [{ name: "follow-up.md" }] },
      ] },
    ],
  },
  {
    id: "support", label: "Customer Success & Support", workingDir: ".",
    flows: [
      { id: "support-ticket", name: "Support ticket", stages: [
        { id: "sup-triage", name: "Triage", tool: "claude", gate: "severity set",
          systemPrompt: "You are a support engineer. Triage the issue in the task intent: reproduce or gather what's missing, classify severity, and identify the affected area. Write triage.md.",
          outputs: [{ name: "triage.md" }] },
        { id: "sup-resolve", name: "Resolve", tool: "claude", gate: "customer unblocked", judge: true,
          systemPrompt: "You are a support engineer. From triage.md write the resolution: the fix or workaround, the customer-facing reply, and any engineering escalation needed. Write resolution.md.",
          outputs: [{ name: "resolution.md" }] },
        { id: "sup-kb", name: "KB update", tool: "claude", gate: "documented",
          systemPrompt: "You are a technical writer. If this issue will recur, turn resolution.md into a knowledge-base article; otherwise note why not. Write kb-note.md.",
          outputs: [{ name: "kb-note.md" }] },
      ] },
      { id: "kb-article", name: "KB article", stages: [
        { id: "kb-draft", name: "Draft", tool: "claude", gate: "draft reviewed", judge: true,
          systemPrompt: "You are a technical writer. Write the knowledge-base article for the topic in the task intent: symptoms, cause, step-by-step resolution, prevention. Write article.md.",
          outputs: [{ name: "article.md" }] },
        { id: "kb-review", name: "Review & publish", tool: "claude", gate: "published",
          systemPrompt: "You are a support lead. Review article.md for accuracy and tone, add related-article links and search keywords. Write final.md.",
          outputs: [{ name: "final.md" }] },
      ] },
    ],
  },
  {
    id: "operations", label: "Operations & Supply Chain", workingDir: ".",
    flows: [
      { id: "e2e-analysis", name: "End-to-end analysis", stages: [
        { id: "data", name: "Data inventory", tool: "claude", gate: "data mapped",
          systemPrompt: "You are a supply chain analyst. Inventory the available data for the chain in the task intent: suppliers, lead times, costs, volumes, systems of record. Write data-inventory.md.",
          outputs: [{ name: "data-inventory.md" }] },
        { id: "map", name: "Flow mapping", tool: "claude", gate: "map validated",
          systemPrompt: "You are a process analyst. Map the end-to-end flow: nodes, routes, lead times, buffers. Write flow-map.md.",
          outputs: [{ name: "flow-map.md" }] },
        { id: "bottlenecks", name: "Bottleneck analysis", tool: "claude", gate: "bottlenecks agreed",
          systemPrompt: "You are an operations researcher. From flow-map.md find bottlenecks, single points of failure, and cost concentrations. Write bottlenecks.md.",
          outputs: [{ name: "bottlenecks.md" }] },
        { id: "optimize", name: "Optimization plan", tool: "claude", gate: "plan approved", judge: true,
          systemPrompt: "You are a supply chain consultant. Write the optimization plan: initiatives, savings estimates, risks, sequencing. Write optimization.md.",
          outputs: [{ name: "optimization.md" }] },
      ] },
      { id: "cost-sprint", name: "Cost sprint", stages: [
        { id: "snapshot", name: "Spend snapshot", tool: "claude", gate: "snapshot done",
          systemPrompt: "You are a cost analyst. Summarize spend by category/supplier for the scope in the task intent. Write spend.md.",
          outputs: [{ name: "spend.md" }] },
        { id: "quickwins", name: "Quick wins", tool: "claude", gate: "wins picked", judge: true,
          systemPrompt: "You are a procurement advisor. From spend.md list quick-win savings (renegotiation, consolidation, substitution) with effort/impact. Write quick-wins.md.",
          outputs: [{ name: "quick-wins.md" }] },
        { id: "actions", name: "Action list", tool: "claude", gate: "actions owned",
          systemPrompt: "You are a program manager. Turn quick-wins.md into an owned, dated action list. Write actions.md.",
          outputs: [{ name: "actions.md" }] },
      ] },
      { id: "disruption", name: "Disruption response", stages: [
        { id: "impact", name: "Impact assessment", tool: "claude", gate: "impact sized",
          systemPrompt: "You are a supply chain risk analyst. Assess the disruption in the task intent: affected nodes, inventory runway, customer impact. Write impact.md.",
          outputs: [{ name: "impact.md" }] },
        { id: "mitigate", name: "Mitigation plan", tool: "claude", gate: "mitigations running", judge: true,
          systemPrompt: "You are a crisis operations lead. Write the mitigation plan: alternate sources/routes, allocation rules, cost of each option. Write mitigation.md.",
          outputs: [{ name: "mitigation.md" }] },
        { id: "comms", name: "Comms brief", tool: "claude", gate: "stakeholders informed",
          systemPrompt: "You are a comms writer. Draft customer and internal comms about the disruption and the plan. Write comms.md.",
          outputs: [{ name: "comms.md" }] },
      ] },
    ],
  },
  {
    id: "strategy", label: "Strategy & Research", workingDir: ".",
    flows: [
      { id: "deep-research", name: "PMF deep research", stages: [
        { id: "landscape", name: "Market landscape", tool: "claude", gate: "landscape reviewed",
          systemPrompt: "You are a market researcher. Map the market for the product in the task intent: segments, competitors, substitutes, trends, sizing. Write landscape.md.",
          outputs: [{ name: "landscape.md" }], specs: [{ key: "potential-userbase", value: "" }, { key: "target-age", value: "" }] },
        { id: "interviews", name: "Interview plan", tool: "claude", gate: "plan approved",
          systemPrompt: "You are a UX researcher. Design the customer interview study: screener, guide, target n per segment. Write interview-plan.md.",
          outputs: [{ name: "interview-plan.md" }] },
        { id: "survey", name: "Survey design", tool: "claude", gate: "survey ready",
          systemPrompt: "You are a quantitative researcher. Design the PMF survey (incl. the Ellis test) and its analysis plan. Write survey.md.",
          outputs: [{ name: "survey.md" }] },
        { id: "synthesis", name: "Synthesis", tool: "claude", gate: "synthesis reviewed", judge: true,
          systemPrompt: "You are a research lead. Synthesize all findings into themes, segment verdicts, and open risks. Write synthesis.md.",
          outputs: [{ name: "synthesis.md" }] },
        { id: "report", name: "PMF report", tool: "claude", gate: "decision made",
          systemPrompt: "You are a product strategist. Write the PMF verdict and recommendation: persevere, pivot, or kill — with evidence. Write pmf-report.md.",
          outputs: [{ name: "pmf-report.md" }] },
      ] },
      { id: "hypothesis", name: "Hypothesis test", stages: [
        { id: "hypo", name: "Hypothesis", tool: "claude", gate: "hypothesis sharp",
          systemPrompt: "You are a product scientist. Turn the task intent into a falsifiable hypothesis with a success threshold. Write hypothesis.md.",
          outputs: [{ name: "hypothesis.md" }] },
        { id: "experiment", name: "Experiment design", tool: "claude", gate: "experiment running", judge: true,
          systemPrompt: "You are an experiment designer. Design the cheapest test that could falsify hypothesis.md: method, sample, duration, metrics. Write experiment.md.",
          outputs: [{ name: "experiment.md" }] },
        { id: "readout", name: "Results readout", tool: "claude", gate: "decision made",
          systemPrompt: "You are an analyst. Write the readout template and decision rule (ship/iterate/drop) for the experiment. Write readout.md.",
          outputs: [{ name: "readout.md" }] },
      ] },
      { id: "pivot-check", name: "Pivot check (urgent)", stages: [
        { id: "signals", name: "Signals review", tool: "claude", gate: "signals honest",
          systemPrompt: "You are a candid advisor. Review the signals in the task intent (retention, growth, feedback) and state what they actually say. Write signals.md.",
          outputs: [{ name: "signals.md" }] },
        { id: "options", name: "Options analysis", tool: "claude", gate: "options scored", judge: true,
          systemPrompt: "You are a strategist. Lay out the realistic options (persevere, zoom-in pivot, segment pivot, kill) with costs and evidence needed. Write options.md.",
          outputs: [{ name: "options.md" }] },
        { id: "recommend", name: "Recommendation", tool: "claude", gate: "decision made",
          systemPrompt: "You are the deciding voice. Write the recommendation memo with the reasoning and the 30-day plan. Write recommendation.md.",
          outputs: [{ name: "recommendation.md" }] },
      ] },
      { id: "competitive", name: "Competitive teardown", stages: [
        { id: "comp-recon", name: "Recon", tool: "claude", gate: "facts gathered",
          systemPrompt: "You are a competitive intelligence analyst. Gather the facts on the competitor in the task intent: product, pricing, positioning, channels, reviews. Write recon.md.",
          outputs: [{ name: "recon.md" }] },
        { id: "comp-analysis", name: "Analysis", tool: "claude", gate: "analysis reviewed", judge: true,
          systemPrompt: "You are a strategist. From recon.md analyze strengths, weaknesses, and where we win or lose. Write analysis.md.",
          outputs: [{ name: "analysis.md" }] },
        { id: "comp-battlecard", name: "Battlecard", tool: "claude", gate: "battlecard shipped",
          systemPrompt: "You are a sales enablement writer. Condense analysis.md into a one-page battlecard: how to position, objection responses, landmines to set. Write battlecard.md.",
          outputs: [{ name: "battlecard.md" }] },
      ] },
    ],
  },
  {
    id: "hiring", label: "People & Hiring", workingDir: ".",
    flows: [
      { id: "hire-role", name: "Hire a role", stages: [
        { id: "hire-spec", name: "Role spec", tool: "claude", gate: "role approved",
          systemPrompt: "You are a hiring manager. From the task intent write the role spec: mission, outcomes for the first year, must-have vs nice-to-have skills, level, and comp band placeholder. Write role.md and the public job description jd.md.",
          outputs: [{ name: "role.md" }, { name: "jd.md" }] },
        { id: "hire-sourcing", name: "Sourcing plan", tool: "claude", gate: "pipeline filling",
          systemPrompt: "You are a recruiter. From role.md write the sourcing plan: channels, search strings, outreach templates, and the screening rubric. Write sourcing.md.",
          outputs: [{ name: "sourcing.md" }] },
        { id: "hire-interviews", name: "Interview kit", tool: "claude", gate: "loop calibrated", judge: true,
          systemPrompt: "You are a talent lead. Design the interview loop: stages, per-stage questions mapped to the role.md outcomes, scoring rubric, and debrief format. Write interview-kit.md.",
          outputs: [{ name: "interview-kit.md" }] },
        { id: "hire-offer", name: "Offer & onboarding", tool: "claude", gate: "offer accepted",
          systemPrompt: "You are a people ops lead. Draft the offer structure and the 30/60/90-day onboarding plan tied to the role.md outcomes. Write offer.md and onboarding.md.",
          outputs: [{ name: "offer.md" }, { name: "onboarding.md" }] },
      ] },
    ],
  },
  {
    id: "finance", label: "Finance & Legal", workingDir: ".",
    flows: [
      { id: "fundraising", name: "Fundraising prep", stages: [
        { id: "fund-narrative", name: "Narrative", tool: "claude", gate: "story tight",
          systemPrompt: "You are a fundraising advisor. From the task intent write the raise narrative: why now, traction, market, ask, and use of funds. Write narrative.md.",
          outputs: [{ name: "narrative.md" }] },
        { id: "fund-deck", name: "Deck outline", tool: "claude", gate: "deck approved", judge: true,
          systemPrompt: "You are a pitch consultant. Turn narrative.md into a slide-by-slide deck outline with the key numbers and chart briefs per slide. Write deck-outline.md.",
          outputs: [{ name: "deck-outline.md" }] },
        { id: "fund-dataroom", name: "Data room checklist", tool: "claude", gate: "data room ready",
          systemPrompt: "You are a diligence advisor. Write the data-room checklist: financials, legal, metrics, team docs — what exists, what's missing, who owns each. Write dataroom.md.",
          outputs: [{ name: "dataroom.md" }] },
      ] },
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
