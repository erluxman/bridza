// bridza-store.test.js — the .bridza store on real temp repos: scaffold,
// pipeline/task creation (committed to the project), enumeration, and live
// per-stage tracking read back from the task branch tip after a run.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureDataDir, readProject, createPipeline, savePipeline, createTask, saveContext, mergeTime, taskTime, addInbox, promoteInbox, discardInbox } from "../../../server/bridza-store.js";
import { runStage, git } from "../../../server/bridza-run.js";
import { STARTER_PIPELINES, rel } from "../store/bridza.js";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

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
    const r = createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing"));
    expect(r).toMatchObject({ ok: true, id: "marketing", committed: true });
    const proj = readProject(root);
    expect(proj.initialized).toBe(true);
    expect(proj.pipelines.map((p) => p.id)).toEqual(["marketing"]);
    expect(proj.pipelines[0].stages.map((s) => s.id)).toEqual(["research", "planning", "spec"]);
    // committed only the pipeline's own file, nothing else
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toMatch(/^bridza: add pipeline "Marketing" \(marketing\) · 3 stages$/);
  });

  it("creates a task with the pipeline's stage set and its own branch", () => {
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing"));
    const r = createTask(root, { pipeline: "marketing", id: "task-506", title: "Q3 launch" });
    expect(r).toMatchObject({ ok: true, pipeline: "marketing", id: "task-506", branch: "bridza/marketing/task-506", committed: true });
    const task = readProject(root).pipelines[0].tasks[0];
    expect(task).toMatchObject({ id: "task-506", title: "Q3 launch", status: "in-progress", progress: 0 });
    expect(task.stages).toEqual(["research", "planning", "spec"]);
    expect(fs.existsSync(path.join(root, rel.taskContext("marketing", "task-506")))).toBe(true);
  });

  it("rejects duplicate pipeline / task ids", () => {
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing"));
    expect(createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing")).error).toMatch(/already exists/);
    createTask(root, { pipeline: "marketing", id: "task-1" });
    expect(createTask(root, { pipeline: "marketing", id: "task-1" }).error).toMatch(/already exists/);
  });
});

describe("live tracking from the task branch tip", () => {
  it("reflects a stage run's status + progress without touching main", async () => {
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing"));
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
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing"));
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
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toMatch(/^bridza: edit pipeline .*\(marketing\) stage flow · \d+ stages$/);
  });

  it("rejects saving a pipeline that doesn't exist", () => {
    expect(savePipeline(root, { id: "ghost", stages: [] }).error).toMatch(/not found/);
  });
});

describe("wall-clock time store", () => {
  it("persists per-stage seconds in a gitignored .cache and keeps main clean", () => {
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing"));
    mergeTime(root, "marketing", "task-7", { research: 120, planning: 30 });
    mergeTime(root, "marketing", "task-7", { research: 200 });          // merges (overwrite per key)
    expect(taskTime(root, "marketing", "task-7")).toEqual({ research: 200, planning: 30 });
    expect(fs.readFileSync(path.join(root, ".bridza", ".gitignore"), "utf8")).toContain(".cache/");
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");        // .cache is ignored
  });
});

describe("inbox", () => {
  it("captures, routes to a task, and discards", () => {
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing"));
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
    createPipeline(root, STARTER_PIPELINES.find((p) => p.id === "marketing"));
    createTask(root, { pipeline: "marketing", id: "task-9" });
    const r = saveContext(root, { pipeline: "marketing", task: "task-9", text: "New intent.\n" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, rel.taskContext("marketing", "task-9")), "utf8")).toBe("New intent.\n");
  });
});
