// bridza-flow-branch.test.js — a task created while the repo is on a non-main
// branch must keep its flow once its (main-forked) task branch starts running.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runStage, taskWorktree, git } from "../../../server/bridza-run.js";
import { createPipeline, createTask, readProject } from "../../../server/bridza-store.js";
import { rel } from "../../../core/domain.js";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const G = (d, a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d }).toString();
let root;
const dirs = [];
const tmp = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), tag)); dirs.push(d); return d; };

beforeEach(() => {
  root = tmp("bridza-flow-");
  process.env.BRIDZA_WORKTREE_DIR = tmp("bridza-flow-wt-");
  process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo hi > x.txt"] });
  G(root, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a"), "a");
  G(root, ["add", "-A"]); G(root, ["commit", "-m", "init"]);
  G(root, ["checkout", "-b", "feat"]);   // task is created OFF main
  createPipeline(root, { id: "eng", label: "Eng", flows: [
    { id: "stlc", name: "STLC", stages: [{ id: "req", name: "Req" }, { id: "design", name: "Design" }] },
    { id: "bugfix", name: "Bugfix", stages: [{ id: "repro", name: "Repro" }, { id: "fix", name: "Fix" }] }] });
  expect(createTask(root, { pipeline: "eng", id: "t1", title: "bug", flow: "bugfix" }).ok).toBe(true);
});
afterEach(() => {
  delete process.env.BRIDZA_TOOL_OVERRIDE;
  delete process.env.BRIDZA_WORKTREE_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const theTask = () => readProject(root).pipelines[0].tasks[0];

it("running a stage keeps the task's flow and its stage list", async () => {
  await runStage(root, { tool: "claude", pipeline: "eng", task: "t1", stage: "repro" }, () => {});
  expect(theTask().flow).toBe("bugfix");
  expect(theTask().stages).toEqual(["repro", "fix"]);
  const W = taskWorktree(root, "eng", "t1");
  expect(JSON.parse(git(W, ["show", "HEAD:" + rel.taskMeta("eng", "t1")])).flow).toBe("bugfix");
});

it("heals a branch whose committed metadata already lost the flow", async () => {
  await runStage(root, { tool: "claude", pipeline: "eng", task: "t1", stage: "repro" }, () => {});
  const W = taskWorktree(root, "eng", "t1");
  const f = path.join(W, rel.taskMeta("eng", "t1"));
  const m = JSON.parse(fs.readFileSync(f, "utf8"));
  fs.writeFileSync(f, JSON.stringify({ ...m, flow: "", stages: ["repro"] }));   // the old bug's output
  G(W, ["commit", "-am", "broken"]);
  expect(theTask().flow).toBe("bugfix");
  expect(theTask().stages).toEqual(["repro", "fix"]);
  await runStage(root, { tool: "claude", pipeline: "eng", task: "t1", stage: "fix" }, () => {});
  expect(JSON.parse(git(W, ["show", "HEAD:" + rel.taskMeta("eng", "t1")])).flow).toBe("bugfix");
});
