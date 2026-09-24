// bridza-store.test.js — the .bridza store on real temp repos: scaffold,
// pipeline/task creation (committed to the project), enumeration, and live
// per-stage tracking read back from the task branch tip after a run.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { TAG_PALETTE, LEGACY_TAG_COLORS } from "../../../core/domain.js";
import { ensureDataDir, readProject, readPlan, savePlan, createPipeline, savePipeline, archivePipeline, saveKanbanOrder, createTask, deleteTask, readContext, saveContext, mergeTime, taskTime, addInbox, promoteInbox, discardInbox, setTaskArchived, assignRefs, deletePipeline, createTag, updateTag, setTaskTags } from "../../../server/bridza-store.js";
import { runStage, git, ensureTaskWorktree, taskDirOn } from "../../../server/bridza-run.js";
import { STARTER_PIPELINES, rel, judgeStageId, pipelineFlows, exportFlow, parseFlowFile, exportPipeline, parsePipelineFile, shortTitle } from "../../../core/domain.js";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

// tag colours are values; these two are presets, so they read as names here
const [VIOLET, , , , , ROSE] = TAG_PALETTE;

// A minimal single-flow pipeline fixture (the starters are all multi-flow
// categories now; these tests need a plain 3-stage pipeline).
const MARKETING = { id: "marketing", label: "Marketing", workingDir: ".", stages: [
  { id: "research", name: "Research", tool: "claude", outputs: [{ name: "brief.md" }] },
  { id: "planning", name: "Planning", tool: "claude", outputs: [{ name: "plan.md" }] },
  { id: "spec", name: "Spec", tool: "claude", outputs: [{ name: "spec.md" }] },
] };

// A task's folder is "<padded-ref>-<id>" under the zero-padded naming contract
// (and the bare id for tasks predating it), so resolve it the way the store
// does instead of hard-coding either form. `tree` is the repo root by default,
// a worktree when the assertion is about what a run committed there.
const T = {
  task: (p, t, tree) => rel.task(p, taskDirOn(tree || root, p, t)),
  meta: (p, t, tree) => rel.taskMeta(p, taskDirOn(tree || root, p, t)),
  ctx: (p, t, tree) => rel.taskContext(p, taskDirOn(tree || root, p, t)),
  outs: (p, t, st, tree) => rel.stageOutputs(p, taskDirOn(tree || root, p, t), st),
};

let root, wtBase;
const dirs = [];
function tmp(tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), tag)); dirs.push(d); return d; }
function makeRepo() {
  const d = tmp("bridza-store-");
  execFileSync("git", ["init", "-b", "main"], { cwd: d });
  fs.writeFileSync(path.join(d, "README.md"), "seed\n");
  execFileSync("git", ["add", "-A"], { cwd: d });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"], { cwd: d });
  return d;
}

beforeEach(() => { root = makeRepo(); wtBase = tmp("bridza-wt-"); process.env.BRIDZA_WORKTREE_DIR = wtBase; });
afterEach(() => {
  delete process.env.BRIDZA_WORKTREE_DIR; delete process.env.BRIDZA_TOOL_OVERRIDE;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("scaffold + enumeration", () => {
  it("reads an empty project without writing to the tree; ensureDataDir scaffolds", () => {
    expect(readProject(root).initialized).toBe(false);
    expect(fs.existsSync(path.join(root, rel.business()))).toBe(false);   // read is pure
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
    ensureDataDir(root);
    expect(fs.existsSync(path.join(root, rel.business()))).toBe(true);
    expect(fs.existsSync(path.join(root, rel.principles()))).toBe(true);
  });
});

describe("create pipeline + task", () => {
  it("creates a pipeline from a starter template and commits it", () => {
    const r = createPipeline(root, MARKETING);
    expect(r).toMatchObject({ ok: true, id: "marketing", committed: true });
    const proj = readProject(root);
    expect(proj.initialized).toBe(true);
    expect(proj.pipelines.map((p) => p.id)).toEqual(["marketing"]);
    expect(proj.pipelines[0].stages.map((s) => s.id)).toEqual(["research", "planning", "spec"]);
    // committed only the pipeline's own file, nothing else
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toMatch(/^bridza: add pipeline "Marketing" \(marketing\) · 3 stages$/);
  });

  it("creates a task with the pipeline's stage set and its own branch", () => {
    createPipeline(root, MARKETING);
    const r = createTask(root, { pipeline: "marketing", id: "task-506", title: "Q3 launch" });
    expect(r).toMatchObject({ ok: true, pipeline: "marketing", id: "task-506", branch: "bridza/marketing/task-506", committed: true });
    const task = readProject(root).pipelines[0].tasks[0];
    expect(task).toMatchObject({ id: "task-506", title: "Q3 launch", status: "in-progress", progress: 0 });
    expect(task.stages).toEqual(["research", "planning", "spec"]);
    expect(fs.existsSync(path.join(root, T.ctx("marketing", "task-506")))).toBe(true);
  });

  it("rejects duplicate pipeline / task ids", () => {
    createPipeline(root, MARKETING);
    expect(createPipeline(root, MARKETING).error).toMatch(/already exists/);
    createTask(root, { pipeline: "marketing", id: "task-1" });
    expect(createTask(root, { pipeline: "marketing", id: "task-1" }).error).toMatch(/already exists/);
  });
});

describe("zero-padded task folders", () => {
  const taskDirs = (pid) => fs.readdirSync(path.join(root, rel.pipeline(pid)))
    .filter((d) => d !== ".metadata").sort();

  it("names a new task's folder <padded-ref>-<id> while every key stays plain", () => {
    createPipeline(root, MARKETING);
    const r = createTask(root, { pipeline: "marketing", id: "task-506", title: "Q3 launch" });
    expect(r.ref).toBe(1);
    expect(taskDirs("marketing")).toEqual(["00000001-task-506"]);
    // the folder is the ONLY thing that carries the padding
    expect(r).toMatchObject({ id: "task-506", branch: "bridza/marketing/task-506" });
    const refs = JSON.parse(fs.readFileSync(path.join(root, ".bridza", "refs.json"), "utf8"));
    expect(refs.refs).toEqual({ "marketing/task-506": 1 });
    const task = readProject(root).pipelines[0].tasks[0];
    expect(task).toMatchObject({ id: "task-506", ref: 1, branch: "bridza/marketing/task-506" });
    expect(JSON.parse(fs.readFileSync(path.join(root, T.meta("marketing", "task-506")), "utf8")).id).toBe("task-506");
  });

  it("sorts folders in creation order, not alphabetically by slug", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "zulu", title: "first" });
    createTask(root, { pipeline: "marketing", id: "alpha", title: "second" });
    // alphabetically "alpha" would come first; by #ref the order is as created
    expect(taskDirs("marketing")).toEqual(["00000001-zulu", "00000002-alpha"]);
  });

  it("finds, reads and deletes a LEGACY unpadded task folder", () => {
    createPipeline(root, MARKETING);
    // a task exactly as a pre-contract bridza wrote it: bare slug, no refs entry
    const legacy = path.join(root, rel.pipeline("marketing"), "old-task");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "metadata.json"), JSON.stringify({
      v: 1, id: "old-task", pipeline: "marketing", title: "From before", ref: 41,
      stages: ["research"], status: "in-progress", tracking: {},
    }));
    fs.writeFileSync(path.join(legacy, "context.md"), "Old intent.\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "legacy task"], { cwd: root });

    const task = readProject(root).pipelines[0].tasks.find((t) => t.id === "old-task");
    expect(task).toMatchObject({ id: "old-task", title: "From before", ref: 41 });
    expect(readContext(root, { pipeline: "marketing", task: "old-task" }).text).toBe("Old intent.\n");
    // a new task alongside it still gets the padded form — the two coexist
    createTask(root, { pipeline: "marketing", id: "new-task", title: "After" });
    expect(taskDirs("marketing")).toEqual(["00000001-new-task", "old-task"]);
    expect(readProject(root).pipelines[0].tasks.map((t) => t.id).sort()).toEqual(["new-task", "old-task"]);

    expect(deleteTask(root, { pipeline: "marketing", task: "old-task" }).ok).toBe(true);
    expect(taskDirs("marketing")).toEqual(["00000001-new-task"]);
  });

  it("edits context and deletes through the padded folder", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "task-9", title: "Nine" });
    expect(saveContext(root, { pipeline: "marketing", task: "task-9", text: "New intent.\n" }).ok).toBe(true);
    expect(fs.readFileSync(path.join(root, rel.taskContext("marketing", "00000001-task-9")), "utf8")).toBe("New intent.\n");
    expect(readContext(root, { pipeline: "marketing", task: "task-9" }).text).toBe("New intent.\n");
    expect(deleteTask(root, { pipeline: "marketing", task: "task-9" }).ok).toBe(true);
    expect(taskDirs("marketing")).toEqual([]);
  });

  it("#ref numbers only grow: a merge that lowered `next` can't hand out a used number", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "a", title: "A" });   // #1
    createTask(root, { pipeline: "marketing", id: "b", title: "B" });   // #2
    const f = path.join(root, ".bridza", "refs.json");
    // what a bad merge resolution of the "next" line left behind
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), next: 1 }, null, 2) + "\n");
    expect(createTask(root, { pipeline: "marketing", id: "c", title: "C" }).ref).toBe(3);
  });

  it("a task whose refs.json entry was lost keeps its number only if nobody else holds it", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "a", title: "A" });   // #1
    createTask(root, { pipeline: "marketing", id: "b", title: "B" });   // #2
    const f = path.join(root, ".bridza", "refs.json");
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    // a merge dropped "b", and "a" was renumbered onto b's old #2
    fs.writeFileSync(f, JSON.stringify({ ...j, refs: { "marketing/a": 2 }, next: 3 }, null, 2) + "\n");
    const b = readProject(root).pipelines[0].tasks.find((t) => t.id === "b");
    expect(b).toMatchObject({ ref: 2, refRecorded: false });   // stale copy, not trusted
    expect(assignRefs(root, ["marketing/b"], { "marketing/b": 2 })["marketing/b"]).toBe(3);

    // but a lost entry whose number is still free is re-adopted, not renumbered
    fs.writeFileSync(f, JSON.stringify({ ...j, refs: { "marketing/a": 1 }, next: 3 }, null, 2) + "\n");
    expect(assignRefs(root, ["marketing/b"], { "marketing/b": 2 })["marketing/b"]).toBe(2);
  });

  it("refuses a duplicate id whichever folder form the existing task uses", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "dup", title: "Padded" });
    expect(createTask(root, { pipeline: "marketing", id: "dup" }).error).toMatch(/already exists/);
    // …and no #ref was burned on the rejected attempt
    const refs = JSON.parse(fs.readFileSync(path.join(root, ".bridza", "refs.json"), "utf8"));
    expect(refs.next).toBe(2);
  });
});

describe("live tracking from the task branch tip", () => {
  it("reflects a stage run's status + progress without touching main", async () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "task-506", title: "Q3" });

    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", `echo brief > ${T.outs("marketing", "task-506", "research")}/brief.md`] });
    const end = await runStage(root, { tool: "claude", pipeline: "marketing", task: "task-506", stage: "research", prompt: "go" }, () => {});
    expect(end.status).toBe("done");

    const task = readProject(root).pipelines[0].tasks[0];
    expect(task.live).toBe(true);                       // read from the branch tip
    expect(task.tracking.research.status).toBe("done");
    expect(task.tracking.research.runs[0]).toMatchObject({ prompt: "go", exit: 0 });
    expect(task.tracking.research.runs[0].files).toContain(`${T.outs("marketing", "task-506", "research")}/brief.md`);
    expect(task.progress).toBe(33);                     // 1 of 3 stages done
    // main is untouched — the stage outputs live only on the task branch
    expect(fs.existsSync(path.join(root, ".bridza", "pipelines", "marketing", "task-506", "research", "outputs", "brief.md"))).toBe(false);
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
  });
});

describe("edit pipeline stage flow", () => {
  it("saves edited stages (rename, system prompt, outputs, reorder) and commits", () => {
    createPipeline(root, MARKETING);
    const stages = [
      { id: "research", name: "Discovery", systemPrompt: "Dig deep.", outputs: [{ name: "findings.md", type: "doc" }], gate: "reviewed", auto: true },
      { id: "spec", name: "Spec", systemPrompt: "Write the spec.", outputs: [{ name: "spec.md", type: "doc" }] },
      { name: "Sign-off", systemPrompt: "Approve it.", outputs: [{ name: "ok.txt", type: "value" }] }, // new stage, no id
    ];
    const r = savePipeline(root, { id: "marketing", stages });
    expect(r.ok).toBe(true);
    const p = readProject(root).pipelines[0];
    expect(p.stages.map((s) => s.name)).toEqual(["Discovery", "Spec", "Sign-off"]);
    expect(p.stages[0]).toMatchObject({ id: "research", systemPrompt: "Dig deep.", auto: true });
    expect(p.stages[0].outputs[0]).toMatchObject({ name: "findings.md", type: "doc" });
    expect(p.stages[2].id).toMatch(/^stage-/);            // generated id for the new stage
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toMatch(/^bridza: edit pipeline .*\(marketing\) stage flows · \d+ flows?, \d+ stages?$/);
  });

  it("rejects saving a pipeline that doesn't exist", () => {
    expect(savePipeline(root, { id: "ghost", stages: [] }).error).toMatch(/not found/);
  });
});

describe("multiple stage flows per pipeline", () => {
  const twoFlows = [
    { id: "ticket", name: "Ticket", stages: [
      { id: "spec", name: "Spec", systemPrompt: "s", outputs: [{ name: "spec.md" }] },
      { id: "build", name: "Build", systemPrompt: "b", outputs: [{ name: "diff" }] },
    ] },
    { id: "feature", name: "Multi-ticket feature", stages: [
      { id: "dissect", name: "Dissect", systemPrompt: "d", outputs: [{ name: "tasks" }] },
    ] },
  ];

  it("saves flows, exposes them + the flattened stage union", () => {
    createPipeline(root, MARKETING);
    const r = savePipeline(root, { id: "marketing", flows: twoFlows });
    expect(r.ok).toBe(true);
    const p = readProject(root).pipelines[0];
    expect(p.flows.map((f) => f.name)).toEqual(["Ticket", "Multi-ticket feature"]);
    expect(p.stages.map((s) => s.id)).toEqual(["spec", "build", "dissect"]);   // union for id→def lookup
  });

  it("migrates legacy template pipelines to flows", () => {
    createPipeline(root, { id: "dev", label: "Dev", stages: [
      { id: "spec", name: "Spec" }, { id: "build", name: "Build" }, { id: "review", name: "Review" },
      { id: "repro", name: "Repro" }, { id: "fix", name: "Fix" },
    ], templates: [
      { id: "feature", label: "Feature", stages: ["spec", "build", "review"] },
      { id: "bugfix", label: "Bugfix", stages: ["repro", "fix", "review"] },
    ] });
    const p = readProject(root).pipelines[0];
    expect(p.flows.map((f) => f.id)).toEqual(["feature", "bugfix"]);
    expect(p.flows[1].stages.map((s) => s.id)).toEqual(["repro", "fix", "review"]);
  });

  it("task creation: flow is mandatory with several flows, recorded, and sets the stage list", () => {
    createPipeline(root, MARKETING);
    savePipeline(root, { id: "marketing", flows: twoFlows });
    expect(createTask(root, { pipeline: "marketing", id: "t1", title: "T1" }).error).toMatch(/pick one/);
    const r = createTask(root, { pipeline: "marketing", id: "t1", title: "T1", flow: "feature" });
    expect(r.ok).toBe(true);
    const task = readProject(root).pipelines[0].tasks[0];
    expect(task.flow).toBe("feature");
    expect(task.stages).toEqual(["dissect"]);
  });

  it("persists the judge flag and judgeStageId resolves it (flag > name heuristic > none)", () => {
    createPipeline(root, MARKETING);
    savePipeline(root, { id: "marketing", flows: [
      { id: "ticket", name: "Ticket", stages: [
        { id: "spec", name: "Spec" },
        { id: "impl", name: "Implementation", judge: true },
        { id: "review", name: "Review" },
      ] },
      { id: "feature", name: "Feature", stages: [{ id: "plan", name: "Plan" }, { id: "build2", name: "Build it" }] },
      { id: "docs", name: "Docs", stages: [{ id: "write", name: "Write" }] },
    ] });
    const p = readProject(root).pipelines[0];
    expect(judgeStageId(p.flows[0])).toBe("impl");     // explicit flag wins
    expect(judgeStageId(p.flows[1])).toBe("build2");   // name heuristic fallback
    expect(judgeStageId(p.flows[2])).toBe(null);       // nothing implementation-like
  });

  it("starters are business CATEGORIES, each carrying flows with unique stage ids", () => {
    expect(STARTER_PIPELINES.map((p) => p.id)).toEqual([
      "engineering", "product", "design-brand", "content", "marketing", "sales",
      "support", "operations", "strategy", "hiring", "finance",
    ]);
    for (const p of STARTER_PIPELINES) {
      const ids = pipelineFlows(p).flatMap((f) => f.stages.map((s) => s.id));
      expect(new Set(ids).size, p.id + " has duplicate stage ids").toBe(ids.length);
    }
    const r = createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "content"));
    expect(r.ok).toBe(true);
    const pipe = readProject(root).pipelines[0];
    expect(pipe.flows.map((f) => f.name)).toEqual(["Full production", "Quick short", "Repurpose existing", "Blog article"]);
    expect(judgeStageId(pipe.flows[0])).toBe("produce");
    // a task must pick a flow here
    expect(createTask(root, { pipeline: "content", id: "t1" }).error).toMatch(/pick one/);
    expect(createTask(root, { pipeline: "content", id: "t1", flow: "quick-short" }).ok).toBe(true);
  });

  it("a flow round-trips through the export file format", () => {
    const flow = pipelineFlows(STARTER_PIPELINES.find((p) => p.id === "marketing")).find((f) => f.name === "Keyword sprint");
    const text = JSON.stringify(exportFlow(flow));
    const back = parseFlowFile(text);
    expect(back.error).toBeUndefined();
    expect(back.flow.name).toBe("Keyword sprint");
    expect(back.flow.stages.map((s) => s.id)).toEqual(["keywords", "kw-brief", "draft", "onpage"]);
    expect(parseFlowFile("not json").error).toMatch(/JSON/);
    expect(parseFlowFile('{"kind":"other","stages":[{}]}').error).toMatch(/stage-flow/);
  });

  it("a whole pipeline round-trips through the export file format and creates from it", () => {
    const file = JSON.stringify(exportPipeline(STARTER_PIPELINES.find((p) => p.id === "sales")));
    const back = parsePipelineFile(file);
    expect(back.error).toBeUndefined();
    expect(back.pipeline.label).toBe("Sales");
    const r = createPipeline(root, { id: "sales-2", label: back.pipeline.label, workingDir: back.pipeline.workingDir, flows: back.pipeline.flows });
    expect(r.ok).toBe(true);
    expect(readProject(root).pipelines[0].flows.map((f) => f.name)).toEqual(["Outbound campaign", "Enterprise deal", "Inbound lead"]);
    expect(parsePipelineFile('{"kind":"bridza-stage-flow","stages":[{}]}').error).toMatch(/pipeline file/);
  });

  it("archive hides a pipeline (flag only — data stays) and unarchive restores it", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "kept" });
    expect(archivePipeline(root, { id: "marketing", archived: true })).toMatchObject({ ok: true, archived: true, committed: true });
    let p = readProject(root).pipelines[0];
    expect(p.archived).toBe(true);
    expect(p.tasks.map((t) => t.id)).toEqual(["t1"]);   // nothing deleted
    expect(archivePipeline(root, { id: "marketing", archived: false }).archived).toBe(false);
    expect(readProject(root).pipelines[0].archived).toBe(false);
    expect(archivePipeline(root, { id: "ghost" }).error).toMatch(/not found/);
  });

  it("kanban column order persists per pipeline, committed in its metadata", () => {
    createPipeline(root, MARKETING);
    createPipeline(root, { ...MARKETING, id: "sales", label: "Sales" });
    expect(readProject(root).pipelines.every((p) => p.kanbanOrder.length === 0)).toBe(true);
    expect(saveKanbanOrder(root, { id: "marketing", order: ["spec", "research"] })).toMatchObject({ ok: true, kanbanOrder: ["spec", "research"], committed: true });
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
    const meta = JSON.parse(fs.readFileSync(path.join(root, rel.pipelineMeta("marketing")), "utf8"));
    expect(meta.kanbanOrder).toEqual(["spec", "research"]);
    const byId = Object.fromEntries(readProject(root).pipelines.map((p) => [p.id, p]));
    expect(byId.marketing.kanbanOrder).toEqual(["spec", "research"]);
    expect(byId.sales.kanbanOrder).toEqual([]);
    expect(saveKanbanOrder(root, { id: "ghost", order: [] }).error).toMatch(/not found/);
    expect(saveKanbanOrder(root, { id: "marketing", order: "spec" }).ok).toBe(false);
    expect(saveKanbanOrder(root, { id: "marketing", order: [1] }).ok).toBe(false);
  });

  it("flow handoffs (next) persist, and dependsOn gates the follow-on task at run time", async () => {
    // product-ish flow hands off to an engineering-ish flow
    createPipeline(root, { id: "prod", label: "Prod", flows: [
      { id: "spec-flow", name: "Spec", next: { pipeline: "eng", flow: "build-flow" }, stages: [{ id: "spec1", name: "Spec", outputs: [{ name: "spec.md" }] }] },
    ] });
    createPipeline(root, { id: "eng", label: "Eng", flows: [
      { id: "build-flow", name: "Build", stages: [{ id: "build1", name: "Build", outputs: [{ name: "out.md" }] }] },
    ] });
    const prod = readProject(root).pipelines.find((p) => p.id === "prod");
    expect(prod.flows[0].next).toEqual({ pipeline: "eng", flow: "build-flow" });

    createTask(root, { pipeline: "prod", id: "t-spec", title: "Spec it", flow: "spec-flow" });
    createTask(root, { pipeline: "eng", id: "t-build", title: "Build it", flow: "build-flow", dependsOn: "prod/t-spec" });
    expect(readPlan(root).deps["eng/t-build"]).toEqual({ all: ["prod/t-spec"], any: [] });

    // the gated task refuses to run while upstream is not done
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo ok"] });
    const blocked = await runStage(root, { tool: "claude", pipeline: "eng", task: "t-build", stage: "build1", prompt: "go" }, () => {});
    expect(blocked.status).toBe("blocked");
    expect(blocked.error).toMatch(/prod\/t-spec/);
    // finish the upstream task → the gate opens
    const up = await runStage(root, { tool: "claude", pipeline: "prod", task: "t-spec", stage: "spec1", prompt: "go" }, () => {});
    expect(up.status).toBe("done");
    const now = await runStage(root, { tool: "claude", pipeline: "eng", task: "t-build", stage: "build1", prompt: "go" }, () => {});
    expect(now.status).toBe("done");
  });

  it("pipeline sequence: edges persist, auto-gate new downstream tasks, and materialize from flow handoffs", async () => {
    // creating B whose flow hands off to A, then A→B edge is drawn by hand:
    createPipeline(root, { id: "research", label: "Research", flows: [
      { id: "study", name: "Study", next: { pipeline: "build", flow: "make" }, stages: [{ id: "st1", name: "Study", outputs: [{ name: "study.md" }] }] },
    ] });
    createPipeline(root, { id: "build", label: "Build", flows: [
      { id: "make", name: "Make", stages: [{ id: "mk1", name: "Make", outputs: [{ name: "out.md" }] }] },
    ] });
    // the advisory flow handoff materialized into a pipeline edge on creation
    expect(readPlan(root).pipeDeps).toEqual([{ from: "research", to: "build" }]);

    createTask(root, { pipeline: "research", id: "r1", title: "Interviews", flow: "study" });
    createTask(root, { pipeline: "build", id: "b1", title: "Build it", flow: "make" });
    // the new downstream task is auto-gated on the upstream pipeline's open task
    expect(readPlan(root).deps["build/b1"]).toEqual({ all: ["research/r1"], any: [] });
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo ok"] });
    const blocked = await runStage(root, { tool: "claude", pipeline: "build", task: "b1", stage: "mk1", prompt: "go" }, () => {});
    expect(blocked.status).toBe("blocked");
    // savePlan round-trips pipeDeps and drops self/dupe edges
    savePlan(root, { pipeDeps: [{ from: "research", to: "build" }, { from: "research", to: "build" }, { from: "build", to: "build" }] });
    expect(readPlan(root).pipeDeps).toEqual([{ from: "research", to: "build" }]);
  });

  it("handoff manifest: the follow-on task's context lists the upstream outputs and links it as focused context", async () => {
    createPipeline(root, { id: "prod2", label: "Prod2", flows: [{ id: "sf", name: "Spec", stages: [{ id: "sp1", name: "Spec", outputs: [{ name: "spec.md" }] }] }] });
    createPipeline(root, { id: "eng2", label: "Eng2", flows: [{ id: "bf", name: "Build", stages: [{ id: "bd1", name: "Build", outputs: [{ name: "o.md" }] }] }] });
    createTask(root, { pipeline: "prod2", id: "u1", title: "Write the spec", flow: "sf" });
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", `echo spec > ${T.outs("prod2", "u1", "sp1")}/spec.md`] });
    await runStage(root, { tool: "claude", pipeline: "prod2", task: "u1", stage: "sp1", prompt: "go" }, () => {});
    createTask(root, { pipeline: "eng2", id: "d1", title: "Build from spec", flow: "bf", dependsOn: "prod2/u1" });
    const ctx = fs.readFileSync(path.join(root, T.ctx("eng2", "d1")), "utf8");
    expect(ctx).toMatch(/Follow-on from #\d+ "Write the spec" \(prod2\/u1\)/);
    expect(ctx).toContain(T.outs("prod2", "u1", "sp1") + "/spec.md");
    expect(readPlan(root).links["eng2/d1"]).toEqual(["prod2/u1"]);   // focused-context injection
  });

  it("plan estimates round-trip (hours per task; bad values dropped) and the creation guide carries the plan-board contract", () => {
    createPipeline(root, MARKETING);
    savePlan(root, { est: { "marketing/t1": 4, "marketing/t2": 2.5, "marketing/t3": -1, "bad key!": 3, "marketing/t4": "nope" } });
    expect(readPlan(root).est).toEqual({ "marketing/t1": 4, "marketing/t2": 2.5 });
    const guide = fs.readFileSync(path.join(root, ".bridza", ".metadata", "creation-guide.md"), "utf8");
    for (const section of ["AND & OR", "Estimate the cost", "Pipeline-level sequence", "The planning contract"]) expect(guide).toContain(section);
    // old-guide projects self-heal to the current (v3) contract
    fs.writeFileSync(path.join(root, ".bridza", ".metadata", "creation-guide.md"), "# old guide\n");
    ensureDataDir(root);
    const healed = fs.readFileSync(path.join(root, ".bridza", ".metadata", "creation-guide.md"), "utf8");
    expect(healed).toContain("plan-guide-v3");
    expect(healed).toContain("Worked example");   // the non-confusing reference now ships a concrete example
  });

  it("planning stages are gated on a populated plan board (mandatory shell check)", () => {
    const eng = STARTER_PIPELINES.find((p) => p.id === "engineering");
    const planning = pipelineFlows(eng).find((f) => f.id === "full-sdlc").stages.find((s) => s.id === "planning");
    const breakdown = pipelineFlows(STARTER_PIPELINES.find((p) => p.id === "product")).find((f) => f.id === "product-spec").stages.find((s) => s.id === "ps-breakdown");
    for (const st of [planning, breakdown]) {
      expect(st.shell.some((c) => c.includes("plan board is empty"))).toBe(true);
      expect(st.systemPrompt).toContain("creation-guide.md");
      expect(st.outputs.some((o) => o.type === "issue")).toBe(true);
    }
  });

  it("starter handoffs: research → product spec → engineering", () => {
    const flowNext = (pid, fid) => pipelineFlows(STARTER_PIPELINES.find((p) => p.id === pid)).find((f) => f.id === fid).next;
    expect(flowNext("strategy", "deep-research")).toEqual({ pipeline: "product", flow: "product-spec" });
    expect(flowNext("product", "product-spec")).toEqual({ pipeline: "engineering", flow: "dissection" });
    expect(flowNext("product", "feedback-roadmap")).toEqual({ pipeline: "engineering", flow: "feature" });
  });

  it("pipeline edges support fan-in and leave independent pipelines ungated", () => {
    const mk = (id) => createPipeline(root, { id, label: id, flows: [{ id: "f", name: "F", stages: [{ id: id + "-s1", name: "S", outputs: [{ name: "o.md" }] }] }] });
    mk("alpha"); mk("beta"); mk("gamma"); mk("free");
    savePlan(root, { pipeDeps: [{ from: "alpha", to: "gamma" }, { from: "beta", to: "gamma" }] });   // fan-in: gamma waits on both
    createTask(root, { pipeline: "alpha", id: "a1", title: "A1", flow: "f" });
    createTask(root, { pipeline: "beta", id: "b1", title: "B1", flow: "f" });
    createTask(root, { pipeline: "gamma", id: "g1", title: "G1", flow: "f" });
    createTask(root, { pipeline: "free", id: "fr1", title: "FR1", flow: "f" });
    expect(readPlan(root).deps["gamma/g1"].all.sort()).toEqual(["alpha/a1", "beta/b1"]);
    expect(readPlan(root).deps["free/fr1"]).toBeUndefined();   // independent pipeline: no gate
  });

  it("archived upstream pipelines stop gating new downstream tasks", () => {
    const mk = (id) => createPipeline(root, { id, label: id, flows: [{ id: "f", name: "F", stages: [{ id: id + "-s1", name: "S", outputs: [{ name: "o.md" }] }] }] });
    mk("up"); mk("down");
    savePlan(root, { pipeDeps: [{ from: "up", to: "down" }] });
    createTask(root, { pipeline: "up", id: "u1", title: "U1", flow: "f" });
    archivePipeline(root, { id: "up", archived: true });
    createTask(root, { pipeline: "down", id: "d1", title: "D1", flow: "f" });
    expect(readPlan(root).deps["down/d1"]).toBeUndefined();
  });

  it("OR gates open at run time when ANY alternative is done", async () => {
    createPipeline(root, { id: "orp", label: "OrP", flows: [{ id: "f", name: "F", stages: [
      { id: "x1", name: "X1", outputs: [{ name: "o.md" }] }, { id: "x2", name: "X2", outputs: [{ name: "o.md" }] }, { id: "x3", name: "X3", outputs: [{ name: "o.md" }] },
    ] }] });
    createTask(root, { pipeline: "orp", id: "opt-a", title: "A", stages: ["x1"] });
    createTask(root, { pipeline: "orp", id: "opt-b", title: "B", stages: ["x2"] });
    createTask(root, { pipeline: "orp", id: "final", title: "F", stages: ["x3"] });
    savePlan(root, { deps: { "orp/final": { all: [], any: ["orp/opt-a", "orp/opt-b"] } } });
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo ok"] });
    const blocked = await runStage(root, { tool: "claude", pipeline: "orp", task: "final", stage: "x3", prompt: "go" }, () => {});
    expect(blocked.status).toBe("blocked");
    await runStage(root, { tool: "claude", pipeline: "orp", task: "opt-b", stage: "x2", prompt: "go" }, () => {});   // one alternative done
    const now = await runStage(root, { tool: "claude", pipeline: "orp", task: "final", stage: "x3", prompt: "go" }, () => {});
    expect(now.status).toBe("done");
  });

  it("archive round-trips WITHOUT losing flows, handoffs, or specs", () => {
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "product"));
    archivePipeline(root, { id: "product", archived: true });
    archivePipeline(root, { id: "product", archived: false });
    const p = readProject(root).pipelines[0];
    expect(p.flows.map((f) => f.id)).toEqual(["feedback-roadmap", "product-spec"]);
    expect(p.flows[1].next).toEqual({ pipeline: "engineering", flow: "dissection" });
    expect(p.flows[1].stages[0].specs.length).toBeGreaterThan(0);
  });

  it("a pipeline export → import round trip preserves handoffs and materializes edges when the target exists", () => {
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "engineering"));
    const file = JSON.stringify(exportPipeline(STARTER_PIPELINES.find((p) => p.id === "product")));
    const parsed = parsePipelineFile(file);
    const r = createPipeline(root, { id: "product", label: parsed.pipeline.label, workingDir: parsed.pipeline.workingDir, flows: parsed.pipeline.flows });
    expect(r.ok).toBe(true);
    const prod = readProject(root).pipelines.find((p) => p.id === "product");
    expect(prod.flows.find((f) => f.id === "product-spec").next).toEqual({ pipeline: "engineering", flow: "dissection" });
    // both product flows point at engineering (dissection + feature) → edges materialized (deduped)
    expect(readPlan(root).pipeDeps).toEqual([{ from: "product", to: "engineering" }]);
  });

  it("deleting a task keeps unrelated plan data (est, pipeDeps) intact", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "keep", title: "Keep" });
    createTask(root, { pipeline: "marketing", id: "drop", title: "Drop" });
    savePlan(root, { est: { "marketing/keep": 3, "marketing/drop": 5 }, pipeDeps: [{ from: "marketing", to: "other" }] });
    deleteTask(root, { pipeline: "marketing", task: "drop" });
    const plan = readPlan(root);
    expect(plan.est["marketing/keep"]).toBe(3);
    expect(plan.pipeDeps).toEqual([{ from: "marketing", to: "other" }]);
  });

  it("single-flow pipelines don't require a flow choice", () => {
    createPipeline(root, MARKETING);
    const r = createTask(root, { pipeline: "marketing", id: "t1", title: "T1" });
    expect(r.ok).toBe(true);
    expect(readProject(root).pipelines[0].tasks[0].stages).toEqual(["research", "planning", "spec"]);
  });
});

describe("wall-clock time store", () => {
  it("persists per-stage seconds in a gitignored .cache and keeps main clean", () => {
    createPipeline(root, MARKETING);
    mergeTime(root, "marketing", "task-7", { research: 120, planning: 30 });
    mergeTime(root, "marketing", "task-7", { research: 200 });          // merges (max per key)
    expect(taskTime(root, "marketing", "task-7")).toEqual({ research: 200, planning: 30 });
    // #106 — a second window posting a smaller total for a stage never winds the clock back
    mergeTime(root, "marketing", "task-7", { research: 150, planning: 45, __idle: { research: 10 } });
    expect(taskTime(root, "marketing", "task-7")).toEqual({ research: 200, planning: 45, __idle: { research: 10 } });
    expect(fs.readFileSync(path.join(root, ".bridza", ".gitignore"), "utf8")).toContain(".cache/");
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");        // .cache is ignored
  });
  it("#14 — tracks the idle share under __idle without disturbing per-stage totals", () => {
    createPipeline(root, MARKETING);
    mergeTime(root, "marketing", "task-9", { research: 300, __idle: { research: 90 } });
    mergeTime(root, "marketing", "task-9", { research: 360, __idle: { research: 120 } });   // merges
    const t = taskTime(root, "marketing", "task-9");
    expect(t.research).toBe(360);              // total
    expect(t.__idle).toEqual({ research: 120 });   // idle share → work = 240
    // a later save with no idle data keeps the recorded idle
    mergeTime(root, "marketing", "task-9", { planning: 20 });
    expect(taskTime(root, "marketing", "task-9").__idle).toEqual({ research: 120 });
  });
});

describe("#106 — plan saves from two windows", () => {
  it("merge:true patches the per-task maps key by key; null clears a key; lists still replace", () => {
    createPipeline(root, MARKETING);
    savePlan(root, { deps: { "marketing/a": { all: ["marketing/x"], any: [] } }, est: { "marketing/a": 2 }, pos: { "marketing/a": { x: 1, y: 2 } } });
    // window 2, loaded before window 1's edit, saves ITS one edit
    savePlan(root, { deps: { "marketing/b": { all: ["marketing/x"], any: [] } }, est: { "marketing/b": 3 }, merge: true });
    const p = readPlan(root);
    expect(Object.keys(p.deps).sort()).toEqual(["marketing/a", "marketing/b"]);
    expect(p.est).toEqual({ "marketing/a": 2, "marketing/b": 3 });
    expect(p.pos).toEqual({ "marketing/a": { x: 1, y: 2 } });
    // clearing under merge
    savePlan(root, { est: { "marketing/a": null }, deps: { "marketing/a": null }, merge: true });
    expect(readPlan(root).est).toEqual({ "marketing/b": 3 });
    expect(Object.keys(readPlan(root).deps)).toEqual(["marketing/b"]);
    // without the flag a section is still replaced wholesale (agents, the old client)
    savePlan(root, { est: { "marketing/c": 1 } });
    expect(readPlan(root).est).toEqual({ "marketing/c": 1 });
  });
});

describe("inbox", () => {
  it("captures, routes to a task, and discards", () => {
    createPipeline(root, MARKETING);
    const a = addInbox(root, { kind: "bug", text: "Login button misaligned on iOS" });
    const b = addInbox(root, { kind: "idea", text: "Add dark mode" });
    expect(readProject(root).inbox.map((i) => i.text)).toEqual(["Add dark mode", "Login button misaligned on iOS"]);

    const p = promoteInbox(root, { id: a.item.id, pipeline: "marketing" });
    expect(p.ok).toBe(true);
    expect(p.task.id).toBe("login-button-misaligned-on-ios");
    const proj = readProject(root);
    expect(proj.inbox.map((i) => i.id)).toEqual([b.item.id]);              // promoted one removed
    expect(proj.pipelines[0].tasks.map((t) => t.id)).toContain("login-button-misaligned-on-ios");

    discardInbox(root, b.item.id);
    expect(readProject(root).inbox).toEqual([]);
  });

  it("rejects empty capture and unknown promote", () => {
    expect(addInbox(root, { text: "  " }).error).toMatch(/empty/);
    expect(promoteInbox(root, { id: "nope", pipeline: "marketing" }).error).toMatch(/not found/);
  });

  // A long capture must survive promotion IN FULL: the title is only a
  // headline, the whole text becomes the task's brief (context.md).
  it("keeps the whole capture as the brief and headlines the title", () => {
    createPipeline(root, MARKETING);
    const long = "Right now it seems a little bit confusing whether the stage flow runs top to bottom or "
      + "left to right, and the labels do not say which one is current.\n\nIt should show the active stage clearly.";
    const a = addInbox(root, { kind: "idea", text: long });
    const p = promoteInbox(root, { id: a.item.id, pipeline: "marketing" });
    expect(p.ok).toBe(true);

    expect(p.task.title).toBe("Right now it seems a little bit confusing whether the stage flow…");
    expect(p.task.title.length).toBeLessThanOrEqual(74);
    // the on-disk id / branch name is the only dashed form, and it cuts on a
    // word boundary rather than mid-word
    expect(p.task.id).toBe("right-now-it-seems-a-little-bit");
    expect(p.task.id).not.toMatch(/^-|-$/);

    const ctx = fs.readFileSync(path.join(root, T.ctx("marketing", p.task.id)), "utf8");
    expect(ctx).toContain(long);                                           // nothing dropped
    expect(ctx.split("\n")[0]).toBe("# " + p.task.title);
    expect(readContext(root, { pipeline: "marketing", task: p.task.id }).text).toBe(ctx);
  });

  it("takes an explicit title and edited description from the promote dialog", () => {
    createPipeline(root, MARKETING);
    const a = addInbox(root, { kind: "bug", text: "raw capture" });
    const p = promoteInbox(root, {
      id: a.item.id, pipeline: "marketing",
      title: "Stage flow direction is unclear", description: "raw capture\n\nplus what I worked out afterwards",
    });
    expect(p.task.title).toBe("Stage flow direction is unclear");
    expect(p.task.id).toBe("stage-flow-direction-is-unclear");
    const ctx = fs.readFileSync(path.join(root, T.ctx("marketing", p.task.id)), "utf8");
    expect(ctx).toBe("# Stage flow direction is unclear\n\nraw capture\n\nplus what I worked out afterwards\n");
  });
});

describe("shortTitle", () => {
  it("headlines prose without dashes, never mid-word, and leaves short text alone", () => {
    expect(shortTitle("Add dark mode")).toBe("Add dark mode");                 // short → untouched
    expect(shortTitle("")).toBe("");
    expect(shortTitle("  \n\n  Second line is the first real one")).toBe("Second line is the first real one");
    expect(shortTitle("# Already a heading")).toBe("Already a heading");       // markdown heading stripped
    expect(shortTitle("one two three four five six seven eight nine ten eleven twelve thirteen"))
      .toBe("one two three four five six seven eight nine ten eleven twelve…");
    // char budget wins over the word budget, and never cuts mid-word
    const t = shortTitle("supercalifragilistic expialidocious antidisestablishmentarianism pneumonoultramicroscopic volcano");
    expect(t.endsWith("…")).toBe(true);
    expect(t.replace("…", "").split(" ").every((w) => "supercalifragilistic expialidocious antidisestablishmentarianism pneumonoultramicroscopic volcano".includes(w))).toBe(true);
    expect(t.length).toBeLessThanOrEqual(73);
    // a dangling comma before the ellipsis reads like a typo
    expect(shortTitle("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu, nu xi")).not.toContain(",…");
    expect(shortTitle("spaces  and\ttabs collapse")).toBe("spaces and tabs collapse");
  });
});

describe("context editing", () => {
  it("writes and commits task context", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "task-9" });
    const r = saveContext(root, { pipeline: "marketing", task: "task-9", text: "New intent.\n" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, T.ctx("marketing", "task-9")), "utf8")).toBe("New intent.\n");
  });
});

describe("task target branch", () => {
  it("createTask persists + returns a target and readProject exposes it", () => {
    createPipeline(root, MARKETING);
    const init = git(root, ["rev-parse", "main"]).trim();
    git(root, ["branch", "release/1.x"]);
    fs.writeFileSync(path.join(root, "main2.txt"), "movin on main\n");   // now main ≠ release/1.x
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "release head"], { cwd: root });
    const mainCmt = git(root, ["rev-parse", "main"]).trim();
    expect(mainCmt).not.toBe(init);                          // sanity: the two branches diverged
    // a target that doesn't exist is rejected BEFORE anything is written
    expect(createTask(root, { pipeline: "marketing", id: "task-bad", target: "nope" }).error).toMatch(/does not exist/);
    expect(fs.existsSync(path.join(root, ".bridza/pipelines/marketing/tasks/task-bad/meta.json"))).toBe(false);
    const r = createTask(root, { pipeline: "marketing", id: "task-target", title: "Ship to release", target: "release/1.x" });
    expect(r.ok).toBe(true);
    expect(r.target).toBe("release/1.x");
    const p = readProject(root).pipelines[0];
    const t = p.tasks.find((x) => x.id === "task-target");
    expect(t.target).toBe("release/1.x");
    expect(t.title).toBe("Ship to release");
    // the metadata file (committed on main; on the task branch runStage lands it) + the commit message carry the target
    const meta = JSON.parse(fs.readFileSync(path.join(root, T.meta("marketing", "task-target")), "utf8"));
    expect(meta.target).toBe("release/1.x");
    expect(git(root, ["log", "main", "--format=%B", "-1"])).toMatch(/Target: release\/1\.x/);
    expect(git(root, ["rev-parse", t.branch]).trim()).toBe(init);     // forked from release/1.x (= init)
    expect(git(root, ["rev-parse", t.branch]).trim()).not.toBe(mainCmt); // …not from main's newer tip
    // default target = the repo's default branch
    const d = createTask(root, { pipeline: "marketing", id: "task-plain", title: "Plain" });
    expect(d.target).toBe("main");
    const d2 = readProject(root).pipelines[0].tasks.find((x) => x.id === "task-plain");
    expect(d2.target).toBe("main");
    expect(git(root, ["rev-parse", d.branch]).trim()).toBe(git(root, ["rev-parse", "main"]).trim());
  });
});

// Tags: a board-wide registry + a per-task assignment, both in root refs.json
// on the base branch for the same reason `archived` is — a task's metadata.json
// lives on a bridza/* branch tip that is never pushed.
describe("task tags", () => {
  const tagsOf = (r, id) => readProject(r).pipelines[0].tasks.find((t) => t.id === id).tags;
  const refsJson = (r) => JSON.parse(fs.readFileSync(path.join(r, ".bridza", "refs.json"), "utf8"));

  beforeEach(() => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "ship it" });
  });

  it("createTag slugifies, validates the colour, and is idempotent on the slug", () => {
    expect(createTag(root, { name: "Billing", color: VIOLET })).toMatchObject({ ok: true, id: "billing", created: true });
    expect(refsJson(root).tags.billing).toEqual({ name: "Billing", color: VIOLET });
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");

    // same slug → the existing entry comes back untouched, never a recolour
    expect(createTag(root, { name: "billing", color: ROSE })).toMatchObject({ ok: true, id: "billing", created: false });
    expect(refsJson(root).tags.billing).toEqual({ name: "Billing", color: VIOLET });

    expect(createTag(root, { name: "", color: VIOLET }).error).toMatch(/name/);

    // a name with no letter or digit slugs to the literal "x" — two unrelated
    // tags would silently become one, so it is rejected outright
    expect(createTag(root, { name: "!!!", color: VIOLET }).ok).toBe(false);
    expect(createTag(root, { name: "???", color: VIOLET }).error).toMatch(/tag name/);
    expect(refsJson(root).tags.x).toBeUndefined();
  });

  it("createTag takes any colour, not just the presets, and normalizes it", () => {
    expect(createTag(root, { name: "teal", color: "#0FA" })).toMatchObject({ ok: true });
    expect(refsJson(root).tags.teal.color).toBe("#00ffaa");      // shorthand expands
    expect(createTag(root, { name: "brand", color: "#1B2C3D" })).toMatchObject({ ok: true });
    expect(refsJson(root).tags.brand.color).toBe("#1b2c3d");     // and folds to lower case

    // a palette NAME is what a pre-free-colour client sent, and still resolves
    expect(createTag(root, { name: "legacy", color: "violet" })).toMatchObject({ ok: true });
    expect(refsJson(root).tags.legacy.color).toBe(VIOLET);

    for (const bad of ["chartreuse", "#gg0000", "#12345", "rgb(1,2,3)", "", null, 7]) {
      expect(createTag(root, { name: "nope", color: bad })).toEqual({ ok: false, error: "invalid color" });
    }
    expect(refsJson(root).tags.nope).toBeUndefined();
  });

  it("updateTag recolours an existing tag and leaves its name and assignments alone", () => {
    createTag(root, { name: "Billing", color: VIOLET });
    setTaskTags(root, "marketing", "t1", ["billing"]);

    expect(updateTag(root, { id: "billing", color: ROSE })).toMatchObject({ ok: true, id: "billing", color: ROSE });
    expect(refsJson(root).tags.billing).toEqual({ name: "Billing", color: ROSE });
    expect(refsJson(root).taskTags["marketing/t1"]).toEqual(["billing"]);
    expect(tagsOf(root, "t1")).toEqual([{ id: "billing", name: "Billing", color: ROSE }]);
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");

    // an off-palette colour is now perfectly valid — that is the whole point
    expect(updateTag(root, { id: "billing", color: "#123456" })).toMatchObject({ ok: true, color: "#123456" });
    expect(tagsOf(root, "t1")).toEqual([{ id: "billing", name: "Billing", color: "#123456" }]);

    // an unparseable colour and an unknown id both change nothing on disk
    expect(updateTag(root, { id: "billing", color: "burnt sienna" })).toEqual({ ok: false, error: "invalid color" });
    expect(updateTag(root, { id: "ghost", color: ROSE }).ok).toBe(false);
    expect(updateTag(root, { id: "ghost", color: ROSE }).error).toMatch(/ghost/);
    expect(refsJson(root).tags.billing).toEqual({ name: "Billing", color: "#123456" });
    expect(refsJson(root).tags.ghost).toBeUndefined();
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
  });

  // `refs.tags["constructor"]` is a function inherited from Object.prototype, so
  // a truthiness check read it as a tag that exists and wrote a nameless entry
  it("updateTag rejects an Object.prototype key as an unknown tag", () => {
    createTag(root, { name: "Billing", color: VIOLET });
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(updateTag(root, { id, color: ROSE })).toMatchObject({ ok: false });
      expect(updateTag(root, { id, color: ROSE }).error).toMatch(/unknown tag/);
    }
    expect(Object.keys(refsJson(root).tags)).toEqual(["billing"]);
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
  });

  // a repo tagged before free colours holds a palette NAME on disk; it resolves
  // on read, so nothing needs migrating and nothing renders colourless
  it("reads a legacy palette name out of an existing refs.json as its hex", () => {
    createTag(root, { name: "Billing", color: VIOLET });
    setTaskTags(root, "marketing", "t1", ["billing"]);
    const f = path.join(root, ".bridza", "refs.json");
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    raw.tags.billing.color = "emerald";
    fs.writeFileSync(f, JSON.stringify(raw, null, 2));

    expect(tagsOf(root, "t1")).toEqual([{ id: "billing", name: "Billing", color: LEGACY_TAG_COLORS.emerald }]);
    expect(readProject(root).pipelines[0].tags.billing.color).toBe(LEGACY_TAG_COLORS.emerald);
  });

  it("setTaskTags keeps only known slugs, de-duplicates, and clears on empty", () => {
    createTag(root, { name: "billing", color: VIOLET });
    createTag(root, { name: "regression", color: ROSE });

    expect(setTaskTags(root, "marketing", "t1", ["billing", "billing", "ghost", "regression"]))
      .toEqual({ ok: true, tags: ["billing", "regression"] });
    expect(refsJson(root).taskTags["marketing/t1"]).toEqual(["billing", "regression"]);

    expect(setTaskTags(root, "marketing", "t1", []).tags).toEqual([]);
    expect(refsJson(root).taskTags["marketing/t1"]).toBeUndefined();
    expect(setTaskTags(root, "marketing", "", ["billing"]).error).toMatch(/task/);
  });

  it("the task projection resolves slugs to { id, name, color } and drops unknown ones", () => {
    expect(tagsOf(root, "t1")).toEqual([]);
    createTag(root, { name: "Billing", color: VIOLET });
    setTaskTags(root, "marketing", "t1", ["billing"]);
    expect(tagsOf(root, "t1")).toEqual([{ id: "billing", name: "Billing", color: VIOLET }]);
    expect(readProject(root).pipelines[0].tags).toEqual({ billing: { name: "Billing", color: VIOLET } });

    // a hand-edited refs.json naming a tag the registry lost: ignored, no crash
    const f = path.join(root, ".bridza", "refs.json");
    const j = refsJson(root); j.taskTags["marketing/t1"] = ["billing", "ghost"];
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    expect(tagsOf(root, "t1")).toEqual([{ id: "billing", name: "Billing", color: VIOLET }]);
  });

  it("a refs.json predating tags reads as no tags, and deleting a task drops its entry", () => {
    const f = path.join(root, ".bridza", "refs.json");
    const j = refsJson(root); delete j.tags; delete j.taskTags;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    expect(tagsOf(root, "t1")).toEqual([]);

    createTag(root, { name: "billing", color: VIOLET });
    setTaskTags(root, "marketing", "t1", ["billing"]);
    deleteTask(root, { pipeline: "marketing", task: "t1" });
    expect(refsJson(root).taskTags["marketing/t1"]).toBeUndefined();
    expect(refsJson(root).tags.billing).toBeTruthy();   // registry is never auto-pruned
  });
});

// Archiving a card used to write the flag onto the task's bridza/* branch,
// which never leaves the machine it was made on — so the card came back out of
// the Archived column on every other computer. It is board state now: root
// .bridza/refs.json, on the base branch, like the kanban order.
describe("task archive state", () => {
  const archivedOf = (r, id) => readProject(r).pipelines[0].tasks.find((t) => t.id === id).archived;

  it("commits the archive on the base branch, so it survives a clone of it", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "ship it" });
    expect(archivedOf(root, "t1")).toBe(false);

    expect(setTaskArchived(root, "marketing", "t1", true)).toMatchObject({ ok: true, archived: true, committed: true });
    expect(archivedOf(root, "t1")).toBe(true);
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toBe("bridza: archive task marketing/t1");

    // device B: only the base branch is ever pushed/pulled — no bridza/* branch
    const other = tmp("bridza-clone-");
    execFileSync("git", ["clone", "--single-branch", "--branch", "main", root, other]);
    expect(git(other, ["for-each-ref", "--format=%(refname)", "refs/heads/bridza/"]).trim()).toBe("");
    expect(archivedOf(other, "t1")).toBe(true);

    expect(setTaskArchived(root, "marketing", "t1", false)).toMatchObject({ ok: true, archived: false, committed: true });
    expect(archivedOf(root, "t1")).toBe(false);
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toBe("bridza: unarchive task marketing/t1");
    expect(setTaskArchived(root, "marketing", "", true).error).toMatch(/task/);
  });

  // A refs.json that won't parse (conflict markers) once read as empty, and the
  // board load's #ref self-heal saved that over it — every archive flag gone.
  it("never overwrites an unreadable refs.json", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "ship it" });
    setTaskArchived(root, "marketing", "t1", true);
    const file = path.join(root, ".bridza", "refs.json");
    const broken = "<<<<<<< HEAD\n" + fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, broken);

    expect(assignRefs(root, ["marketing/t2"])).toEqual({});
    expect(() => setTaskArchived(root, "marketing", "t1", false)).toThrow(/unreadable/);
    expect(fs.readFileSync(file, "utf8")).toBe(broken);
  });

  it("still honours a legacy flag on the task branch, and unarchive clears it", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "archived before the fix" });
    // exactly what the old branch-local setTaskArchived left behind
    const wt = ensureTaskWorktree(root, "marketing", "t1");
    const mp = path.join(wt.worktree, T.meta("marketing", "t1", wt.worktree));
    fs.writeFileSync(mp, JSON.stringify({ ...JSON.parse(fs.readFileSync(mp, "utf8")), archived: true }, null, 2) + "\n");
    git(wt.worktree, ["add", "-A"]);
    git(wt.worktree, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "bridza: archive task marketing/t1"]);
    expect(archivedOf(root, "t1")).toBe(true);

    setTaskArchived(root, "marketing", "t1", false);
    expect(archivedOf(root, "t1")).toBe(false);   // the explicit false outranks the stale flag
  });

  it("deleting the whole pipeline retires its tasks' archive entries too", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "gone with the pipeline" });
    setTaskArchived(root, "marketing", "t1", true);
    deletePipeline(root, { id: "marketing" });

    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "reused id" });
    expect(archivedOf(root, "t1")).toBe(false);
  });

  it("stores archive as a self-describing flag record, with reason and duplicate-of", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "original" });
    createTask(root, { pipeline: "marketing", id: "t2", title: "copy" });
    setTaskArchived(root, "marketing", "t1", true);
    setTaskArchived(root, "marketing", "t2", true, { reason: "duplicate", of: "marketing/t1" });
    const refs = JSON.parse(fs.readFileSync(path.join(root, ".bridza", "refs.json"), "utf8"));
    expect(refs.archived).toBeUndefined();
    expect(refs.taskFlags["marketing/t1"].archived).toMatchObject({ on: true, reason: "manual" });
    expect(refs.taskFlags["marketing/t2"].archived).toMatchObject({ on: true, reason: "duplicate", of: "marketing/t1" });
    expect(Date.parse(refs.taskFlags["marketing/t2"].archived.at)).not.toBeNaN();
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toBe("bridza: archive task marketing/t2 — duplicate of marketing/t1");
    expect(readProject(root).pipelines[0].tasks.find((t) => t.id === "t2").flags.archived.of).toBe("marketing/t1");
  });

  it("migrates the legacy `archived: { key: bool }` map into taskFlags", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "old archive" });
    createTask(root, { pipeline: "marketing", id: "t2", title: "old unarchive" });
    const file = path.join(root, ".bridza", "refs.json");
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    delete old.taskFlags;
    fs.writeFileSync(file, JSON.stringify({ ...old, archived: { "marketing/t1": true, "marketing/t2": false } }, null, 2) + "\n");
    expect(archivedOf(root, "t1")).toBe(true);
    expect(archivedOf(root, "t2")).toBe(false);

    setTaskTags(root, "marketing", "t1", []);   // any refs write persists the migration
    const refs = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(refs.archived).toBeUndefined();
    expect(refs.taskFlags["marketing/t1"]).toEqual({ archived: { on: true, at: null, reason: "legacy" } });
    expect(refs.taskFlags["marketing/t2"]).toEqual({ archived: { on: false, at: null, reason: "legacy" } });
  });

  it("deleting an archived task retires its archive entry too", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t1", title: "gone" });
    setTaskArchived(root, "marketing", "t1", true);
    deleteTask(root, { pipeline: "marketing", task: "t1", deleteBranch: true });
    createTask(root, { pipeline: "marketing", id: "t1", title: "reused id" });
    expect(archivedOf(root, "t1")).toBe(false);
  });
});

// #37 — one user action used to leave 4–5 commits behind (every write helper
// committed for itself, and the actions compose those helpers). The writes of
// one action now fold into one commit, and a run of the same edit folds too.
describe("one commit per action", () => {
  const commits = () => Number(git(root, ["rev-list", "--count", "HEAD"]).trim());

  it("promotes an inbox item in ONE commit, the brief in place from the start", () => {
    createPipeline(root, MARKETING);
    const a = addInbox(root, { kind: "bug", text: "Sync drops archived cards" });
    const before = commits();
    const p = promoteInbox(root, { id: a.item.id, pipeline: "marketing" });
    expect(p.ok).toBe(true);
    expect(commits() - before).toBe(1);                      // was 4: #ref, task, context, inbox

    // named for the action, with the steps it folded in kept in the body
    const body = git(root, ["log", "-1", "--format=%B"]);
    expect(body.split("\n")[0]).toMatch(/^bridza: inbox promote \(bug\) ".*" → task #\d+ marketing\//);
    expect(body).toContain("- bridza: assign task #ref");
    expect(body).toContain('- bridza: add task #');

    // the brief is the captured text — the placeholder never reached history
    const ctxPath = T.ctx("marketing", p.task.id);
    expect(fs.readFileSync(path.join(root, ctxPath), "utf8")).toContain("Sync drops archived cards");
    expect(git(root, ["log", "-p", "--", ctxPath])).not.toContain("Describe the intent of this task.");
  });

  it("creates a task in ONE commit and forks its branch off that commit", () => {
    createPipeline(root, MARKETING);
    const before = commits();
    const r = createTask(root, { pipeline: "marketing", id: "t1", title: "T", est: 4, milestone: { id: "ms", title: "M" } });
    expect(r.ok).toBe(true);
    expect(commits() - before).toBe(1);                      // was 3: #ref, task, plan wiring
    expect(git(root, ["log", "-1", "--format=%s"]).trim()).toMatch(/^bridza: add task #\d+ "T" \(marketing\/t1\)$/);
    // the branch forks off the FINAL commit, not off a version folded away
    expect(git(root, ["rev-parse", r.branch]).trim()).toBe(git(root, ["rev-parse", "HEAD"]).trim());
    const files = git(root, ["show", "--name-only", "--format=", "HEAD"]).trim().split("\n");
    expect(files).toEqual(expect.arrayContaining([T.meta("marketing", "t1"), rel.plan()]));
  });

  it("folds a run of plan edits into one commit instead of one each", () => {
    const before = commits();
    savePlan(root, { links: { "dev/a": ["dev/spec"] } });
    savePlan(root, { links: { "dev/a": ["dev/spec"], "dev/b": ["dev/spec"] } });
    savePlan(root, { links: { "dev/a": ["dev/spec"], "dev/b": ["dev/spec"], "dev/c": ["dev/spec"] } });
    expect(commits() - before).toBe(1);                      // was one commit per link
    expect(git(root, ["log", "-1", "--format=%s"]).trim()).toMatch(/3 context links/);
    expect(Object.keys(readPlan(root).links)).toEqual(["dev/a", "dev/b", "dev/c"]);
  });

  it("never amends a commit another ref reaches", () => {
    savePlan(root, { pos: { "dev/a": { x: 1, y: 2 } } });
    const pinned = git(root, ["rev-parse", "HEAD"]).trim();
    git(root, ["branch", "keep-me"]);                        // stands in for a forked task branch
    const before = commits();
    savePlan(root, { pos: { "dev/a": { x: 3, y: 4 } } });
    expect(commits() - before).toBe(1);                      // a fresh commit, not a rewrite
    expect(git(root, ["rev-parse", "keep-me"]).trim()).toBe(pinned);
  });

  it("never amends the user's own commit", () => {
    fs.writeFileSync(path.join(root, "user.txt"), "hi\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "user work"], { cwd: root });
    const before = commits();
    savePlan(root, { pos: { "dev/a": { x: 7, y: 8 } } });
    expect(commits() - before).toBe(1);
    expect(git(root, ["log", "-1", "--format=%s", "HEAD~1"]).trim()).toBe("user work");
  });

  it("leaves the user's staged work alone rather than folding it in", () => {
    savePlan(root, { pos: { "dev/a": { x: 1, y: 2 } } });
    fs.writeFileSync(path.join(root, "mine.txt"), "wip\n");
    execFileSync("git", ["add", "mine.txt"], { cwd: root });
    const before = commits();
    savePlan(root, { pos: { "dev/a": { x: 5, y: 6 } } });
    expect(commits() - before).toBe(1);                      // no amend while their index is dirty
    expect(git(root, ["diff", "--cached", "--name-only"]).trim()).toBe("mine.txt");
    expect(git(root, ["show", "--name-only", "--format=", "HEAD"])).not.toContain("mine.txt");
  });

  it("folds consecutive kanban drags and context saves, not unrelated ones", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "t2" });
    let before = commits();
    saveKanbanOrder(root, { id: "marketing", order: ["spec", "research", "planning"] });
    saveKanbanOrder(root, { id: "marketing", order: ["planning", "spec", "research"] });
    expect(commits() - before).toBe(1);

    before = commits();
    saveContext(root, { pipeline: "marketing", task: "t2", text: "First draft.\n" });
    saveContext(root, { pipeline: "marketing", task: "t2", text: "Second draft.\n" });
    expect(commits() - before).toBe(1);                      // same brief, one edit
    expect(readContext(root, { pipeline: "marketing", task: "t2" }).text).toBe("Second draft.\n");

    before = commits();                                      // a different edit does NOT fold in
    saveKanbanOrder(root, { id: "marketing", order: ["research", "spec", "planning"] });
    expect(commits() - before).toBe(1);
    expect(git(root, ["log", "-1", "--format=%s", "HEAD~1"]).trim()).toMatch(/edit task context/);
  });
});
