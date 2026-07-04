// bridza-store.test.js — the .bridza store on real temp repos: scaffold,
// pipeline/task creation (committed to the project), enumeration, and live
// per-stage tracking read back from the task branch tip after a run.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureDataDir, readProject, createPipeline, savePipeline, archivePipeline, createTask, saveContext, mergeTime, taskTime, addInbox, promoteInbox, discardInbox } from "../../../server/bridza-store.js";
import { runStage, git } from "../../../server/bridza-run.js";
import { STARTER_PIPELINES, rel, judgeStageId, pipelineFlows, exportFlow, parseFlowFile, exportPipeline, parsePipelineFile } from "../store/bridza.js";

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
