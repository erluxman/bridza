// bridza-store.test.js — the .bridza store on real temp repos: scaffold,
// pipeline/task creation (committed to the project), enumeration, and live
// per-stage tracking read back from the task branch tip after a run.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureDataDir, readProject, readPlan, savePlan, createPipeline, savePipeline, archivePipeline, createTask, deleteTask, saveContext, mergeTime, taskTime, addInbox, promoteInbox, discardInbox } from "../../../server/bridza-store.js";
import { runStage, git } from "../../../server/bridza-run.js";
import { STARTER_PIPELINES, rel, judgeStageId, pipelineFlows, exportFlow, parseFlowFile, exportPipeline, parsePipelineFile } from "../../../core/domain.js";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

// A minimal single-flow pipeline fixture (the starters are all multi-flow
// categories now; these tests need a plain 3-stage pipeline).
const MARKETING = { id: "marketing", label: "Marketing", workingDir: ".", stages: [
  { id: "research", name: "Research", tool: "claude", outputs: [{ name: "brief.md" }] },
  { id: "planning", name: "Planning", tool: "claude", outputs: [{ name: "plan.md" }] },
  { id: "spec", name: "Spec", tool: "claude", outputs: [{ name: "spec.md" }] },
] };

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
    expect(fs.existsSync(path.join(root, rel.taskContext("marketing", "task-506")))).toBe(true);
  });

  it("rejects duplicate pipeline / task ids", () => {
    createPipeline(root, MARKETING);
    expect(createPipeline(root, MARKETING).error).toMatch(/already exists/);
    createTask(root, { pipeline: "marketing", id: "task-1" });
    expect(createTask(root, { pipeline: "marketing", id: "task-1" }).error).toMatch(/already exists/);
  });
});

describe("live tracking from the task branch tip", () => {
  it("reflects a stage run's status + progress without touching main", async () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "task-506", title: "Q3" });

    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", `echo brief > ${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`] });
    const end = await runStage(root, { tool: "claude", pipeline: "marketing", task: "task-506", stage: "research", prompt: "go" }, () => {});
    expect(end.status).toBe("done");

    const task = readProject(root).pipelines[0].tasks[0];
    expect(task.live).toBe(true);                       // read from the branch tip
    expect(task.tracking.research.status).toBe("done");
    expect(task.tracking.research.runs[0]).toMatchObject({ prompt: "go", exit: 0 });
    expect(task.tracking.research.runs[0].files).toContain(`${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`);
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
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", `echo spec > ${rel.stageOutputs("prod2", "u1", "sp1")}/spec.md`] });
    await runStage(root, { tool: "claude", pipeline: "prod2", task: "u1", stage: "sp1", prompt: "go" }, () => {});
    createTask(root, { pipeline: "eng2", id: "d1", title: "Build from spec", flow: "bf", dependsOn: "prod2/u1" });
    const ctx = fs.readFileSync(path.join(root, rel.taskContext("eng2", "d1")), "utf8");
    expect(ctx).toMatch(/Follow-on from #\d+ "Write the spec" \(prod2\/u1\)/);
    expect(ctx).toContain(rel.stageOutputs("prod2", "u1", "sp1") + "/spec.md");
    expect(readPlan(root).links["eng2/d1"]).toEqual(["prod2/u1"]);   // focused-context injection
  });

  it("plan estimates round-trip (hours per task; bad values dropped) and the creation guide carries the plan-board contract", () => {
    createPipeline(root, MARKETING);
    savePlan(root, { est: { "marketing/t1": 4, "marketing/t2": 2.5, "marketing/t3": -1, "bad key!": 3, "marketing/t4": "nope" } });
    expect(readPlan(root).est).toEqual({ "marketing/t1": 4, "marketing/t2": 2.5 });
    const guide = fs.readFileSync(path.join(root, ".bridza", ".metadata", "creation-guide.md"), "utf8");
    for (const section of ["AND & OR", "Estimate the cost", "Pipeline-level sequence", "The planning contract"]) expect(guide).toContain(section);
    // old-guide projects self-heal to the v2 contract
    fs.writeFileSync(path.join(root, ".bridza", ".metadata", "creation-guide.md"), "# old guide\n");
    ensureDataDir(root);
    expect(fs.readFileSync(path.join(root, ".bridza", ".metadata", "creation-guide.md"), "utf8")).toContain("plan-guide-v2");
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
    mergeTime(root, "marketing", "task-7", { research: 200 });          // merges (overwrite per key)
    expect(taskTime(root, "marketing", "task-7")).toEqual({ research: 200, planning: 30 });
    expect(fs.readFileSync(path.join(root, ".bridza", ".gitignore"), "utf8")).toContain(".cache/");
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");        // .cache is ignored
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
});

describe("context editing", () => {
  it("writes and commits task context", () => {
    createPipeline(root, MARKETING);
    createTask(root, { pipeline: "marketing", id: "task-9" });
    const r = saveContext(root, { pipeline: "marketing", task: "task-9", text: "New intent.\n" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, rel.taskContext("marketing", "task-9")), "utf8")).toBe("New intent.\n");
  });
});
