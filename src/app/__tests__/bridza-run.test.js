// bridza-run.test.js — integration tests for the Bridza git core against real
// temp git repos. Worktrees are redirected outside the repo via
// BRIDZA_WORKTREE_DIR and the CLI tool is stubbed via BRIDZA_TOOL_OVERRIDE, so
// the whole flow — branch-per-task, worktree-per-task, the prompt→result commit
// timeline, parallel isolation, and finalize/merge — runs without LLM cost.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Each git worktree op is ~2s solo; under full-suite parallelism (multiple
// git-integration files at once) they slow several-fold. Generous timeout so
// contention doesn't flake the run.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
import {
  ensureTaskBranch, ensureTaskWorktree, taskWorktree, runStage, finalizeTask,
  taskTimeline, branchExists, currentBranch, git, taskBranchName, parseDiff, commitDiff, branchDiff, workingDiff,
} from "../../../server/bridza-run.js";
import { rel } from "../store/bridza.js";

let root, wtBase;
const dirs = [];

function tmp(tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), tag)); dirs.push(d); return d; }

function makeRepo({ commit = true } = {}) {
  const d = tmp("bridza-test-");
  execFileSync("git", ["init", "-b", "main"], { cwd: d });
  if (commit) {
    fs.writeFileSync(path.join(d, "README.md"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: d });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"], { cwd: d });
  }
  return d;
}

function stub(script) { process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", script] }); }

async function run(body) {
  const events = [];
  const end = await runStage(root, { tool: "claude", pipeline: "marketing", task: "task-506", stage: "research", ...body }, (e) => events.push(e));
  return { events, end };
}

beforeEach(() => {
  root = makeRepo();
  wtBase = tmp("bridza-wt-");
  process.env.BRIDZA_WORKTREE_DIR = wtBase;
});
afterEach(() => {
  delete process.env.BRIDZA_TOOL_OVERRIDE;
  delete process.env.BRIDZA_WORKTREE_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("task branch + worktree", () => {
  it("refuses outside a git repo, in an empty repo, and on bad refs", () => {
    expect(ensureTaskBranch(tmp("bridza-plain-"), "p", "t").error).toMatch(/not a git repository/);
    expect(ensureTaskBranch(makeRepo({ commit: false }), "p", "t").error).toMatch(/no commits yet/);
    expect(ensureTaskBranch(root, "  ", "t").ok).toBe(false);
    expect(ensureTaskBranch(root, "p", "??").ok).toBe(false);
  });

  it("creates bridza/<pipeline>/<task> idempotently, forked from main", () => {
    const a = ensureTaskBranch(root, "marketing", "task-506");
    expect(a).toEqual({ ok: true, branch: "bridza/marketing/task-506" });
    expect(ensureTaskBranch(root, "marketing", "task-506")).toEqual(a);
  });

  it("the worktree lives OUTSIDE the repo and is checked out to the task branch", () => {
    const w = ensureTaskWorktree(root, "marketing", "task-506");
    expect(w.worktree).toBe(taskWorktree(root, "marketing", "task-506"));
    expect(w.worktree.startsWith(path.resolve(root))).toBe(false);   // not nested in the repo
    expect(fs.existsSync(path.join(w.worktree, ".git"))).toBe(true);
    expect(currentBranch(w.worktree)).toBe("bridza/marketing/task-506");
  });
});

describe("runStage — one commit per stage", () => {
  it("commits exactly ONE commit for the stage, and never touches the user's tree", async () => {
    stub(`echo working...; echo brief > ${rel.stageOutputs("marketing", "task-506", "research")}/brief.md; echo done`);
    const { events, end } = await run({});
    expect(events[0].t).toBe("meta");
    expect(events[0].branch).toBe("bridza/marketing/task-506");
    expect(events.some((e) => e.t === "out" && /working/.test(e.d))).toBe(true);
    const commitPhases = events.filter((e) => e.t === "commit").map((e) => e.phase);
    expect(commitPhases).toEqual(["result"]);
    expect(end).toMatchObject({ exit: 0, status: "done" });
    expect(end.files).toContain(`${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`);

    // ONE commit ahead of main, by the bridza author, prompt in the body
    const subjects = git(root, ["log", "--format=%an%x1f%s", "main..bridza/marketing/task-506"]).trim().split("\n");
    expect(subjects.map((l) => l.split("\x1f")[1])).toEqual([
      "bridza(marketing/task-506/research): done · claude · exit 0 · 1 file",
    ]);
    expect(subjects.every((l) => l.split("\x1f")[0] === "bridza")).toBe(true);

    // the user's checkout is untouched
    expect(currentBranch(root)).toBe("main");
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
    expect(fs.existsSync(path.join(root, ".bridza"))).toBe(false);
  });

  it("records per-stage tracking + the run record in the task metadata", async () => {
    stub("echo x > out.txt");
    await run({ prompt: "do research" });
    const meta = JSON.parse(git(root, ["show", `bridza/marketing/task-506:${rel.taskMeta("marketing", "task-506")}`]));
    const track = meta.tracking.research;
    expect(track.status).toBe("done");
    expect(track.runs).toHaveLength(1);
    expect(track.runs[0]).toMatchObject({ tool: "claude", prompt: "do research", status: "done", exit: 0 });
  });

  it("folds wall-clock time into metadata and writes a browsable task README on the branch", async () => {
    stub(`echo x > ${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`);
    await run({ prompt: "do research", wallSeconds: 300, stageName: "Research", taskTitle: "My Task" });
    const B = "bridza/marketing/task-506";
    const meta = JSON.parse(git(root, ["show", `${B}:${rel.taskMeta("marketing", "task-506")}`]));
    expect(meta.tracking.research.seconds).toBe(300);            // wall-clock dominated the 0s stub run
    const readme = git(root, ["show", `${B}:${rel.task("marketing", "task-506")}/README.md`]);
    expect(readme).toContain("My Task");
    expect(readme).toContain("do research");                     // the prompt is browsable (Asked), not just in JSON
    expect(readme).toContain("research — ✅ done");              // per-stage story line with status glyph
    expect(readme).toContain("5m 0s");                           // wall-clock rendered human-readable (was 300s)
  });

  it("a re-run REPLACES the stage's single commit — files and run history are kept", async () => {
    stub("echo one > a.txt");
    await run({});
    stub("echo two > b.txt");
    await run({});
    const tl = taskTimeline(root, "marketing", "task-506");
    expect(tl.commits).toHaveLength(1);   // still ONE commit for the stage
    expect(tl.commits[0].subject).toBe("bridza(marketing/task-506/research): done · claude · exit 0 · 2 files");
    // the soft reset kept the first run's files AND both run records + prompts
    const tree = git(root, ["ls-tree", "-r", "--name-only", "bridza/marketing/task-506"]);
    expect(tree).toContain("a.txt");
    expect(tree).toContain("b.txt");
    const meta = JSON.parse(git(root, ["show", `bridza/marketing/task-506:${rel.taskMeta("marketing", "task-506")}`]));
    expect(meta.tracking.research.runs).toHaveLength(2);
  });

  it("a failed run still commits its stage commit (status failed) so the timeline is honest", async () => {
    stub("echo partial > junk.txt; exit 3");
    const { end } = await run({});
    expect(end).toMatchObject({ exit: 3, status: "failed", errorKind: "exit" });
    const subjects = git(root, ["log", "--format=%s", "main..bridza/marketing/task-506"]).trim().split("\n");
    expect(subjects[0]).toBe("bridza(marketing/task-506/research): failed · claude · exit 3 · 1 file");
    expect(git(root, ["ls-tree", "-r", "--name-only", "bridza/marketing/task-506"])).toContain("junk.txt");
  });

  it("cmd.shell gates run in the worktree after the tool; their changes are committed", async () => {
    stub("echo src > main.txt");
    const { events, end } = await run({ stage: "build", shell: ["cat main.txt main.txt > double.txt", "echo checked"] });
    const cmds = events.filter((e) => e.t === "cmd").map((e) => e.cmd);
    expect(cmds[0]).toMatch(/^sh -c /);   // the tool invocation itself is surfaced first
    expect(cmds.slice(1)).toEqual(["cat main.txt main.txt > double.txt", "echo checked"]);
    expect(end.exit).toBe(0);
    expect(end.files).toEqual(expect.arrayContaining(["double.txt", "main.txt"]));
  });

  it("a failing cmd.shell fails the run with errorKind 'shell'", async () => {
    stub("echo src > main.txt");
    const { end } = await run({ stage: "build", shell: ["exit 7"] });
    expect(end).toMatchObject({ exit: 7, status: "failed", errorKind: "shell" });
    expect(end.error).toContain("exit 7");
  });

  it("unknown tool and bad refs fail with typed errors", async () => {
    delete process.env.BRIDZA_TOOL_OVERRIDE;
    expect((await run({ tool: "nope" })).end.errorKind).toBe("unknown-tool");
    stub("true");
    expect((await run({ task: "!!" })).end.errorKind).toBe("bad-ref");
  });
});

describe("commit diff (file changes viewer)", () => {
  it("parseDiff parses files, hunks and +/- counts", () => {
    const patch = ["diff --git a/foo.md b/foo.md", "--- a/foo.md", "+++ b/foo.md",
      "@@ -1,2 +1,3 @@ ctx", " keep", "-old", "+new1", "+new2"].join("\n");
    const files = parseDiff(patch);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "foo.md", add: 2, del: 1 });
    expect(files[0].hunks[0].lines.map((l) => l.t)).toEqual([" ", "-", "+", "+"]);
  });

  it("branchDiff returns the whole branch's cumulative changes vs main", async () => {
    stub(`echo a > ${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`);
    await run({ stage: "research" });
    stub("echo b > plan.md");
    await run({ stage: "planning" });
    const d = branchDiff(root, "marketing", "task-506");
    expect(d.ok).toBe(true);
    expect(d.base).toBe("main");
    const paths = d.files.map((f) => f.path);
    expect(paths).toContain(`${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`);
    expect(paths).toContain("plan.md");                  // both stages' changes in one diff
  });

  it("commitDiff returns a stage run's file changes from the task branch", async () => {
    stub(`echo "a line" > ${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`);
    const { end } = await run({});
    const d = commitDiff(root, end.resultCommit);
    expect(d.ok).toBe(true);
    const f = d.files.find((x) => x.path.endsWith("brief.md"));
    expect(f).toBeTruthy();
    expect(f.add).toBeGreaterThan(0);
  });
});

describe("parallel tasks are isolated", () => {
  it("two tasks get independent branches + worktrees that don't see each other's work", async () => {
    stub("echo aaa > a.txt");
    await run({ task: "task-1" });
    stub("echo bbb > b.txt");
    await run({ task: "task-2" });

    expect(branchExists(root, "bridza/marketing/task-1")).toBe(true);
    expect(branchExists(root, "bridza/marketing/task-2")).toBe(true);
    expect(taskWorktree(root, "marketing", "task-1")).not.toBe(taskWorktree(root, "marketing", "task-2"));

    const t1 = git(root, ["ls-tree", "-r", "--name-only", "bridza/marketing/task-1"]);
    const t2 = git(root, ["ls-tree", "-r", "--name-only", "bridza/marketing/task-2"]);
    expect(t1).toContain("a.txt");
    expect(t1).not.toContain("b.txt");      // task-1 never saw task-2's output
    expect(t2).toContain("b.txt");
    expect(t2).not.toContain("a.txt");
  });
});

describe("full worktree checkout (runnable in parallel)", () => {
  it("materialises the WHOLE tree, not just the working dir", () => {
    fs.mkdirSync(path.join(root, "Marketing"));
    fs.writeFileSync(path.join(root, "Marketing", "keep.txt"), "in\n");
    fs.mkdirSync(path.join(root, "ios"));
    fs.writeFileSync(path.join(root, "ios", "App.swift"), "app\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "dirs"], { cwd: root });

    const w = ensureTaskWorktree(root, "marketing", "task-506", { workingDir: "Marketing" });
    expect(fs.existsSync(path.join(w.worktree, "Marketing", "keep.txt"))).toBe(true);
    expect(fs.existsSync(path.join(w.worktree, "ios", "App.swift"))).toBe(true);   // present — full checkout, runnable
  });
});

describe("finalize → merge into main", () => {
  it("squash-merges the task branch into main (in the user's clean checkout)", async () => {
    stub(`echo final > ${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`);
    await run({});
    expect(fs.existsSync(path.join(root, ".bridza"))).toBe(false);   // not on main yet

    const r = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r.ok).toBe(true);
    expect(r.target).toBe("main");
    // main now carries the task's output, as a single squash commit
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toBe("bridza: finalize marketing/task-506 → main");
    expect(fs.existsSync(path.join(root, ".bridza", "pipelines", "marketing", "task-506", "research", "outputs", "brief.md"))).toBe(true);
    expect(currentBranch(root)).toBe("main");
  });

  it("auto-commits the task worktree's pending edits (opencode message) before merging", async () => {
    stub("echo seed > out.md");
    await run({});                                            // creates the worktree + a commit
    const wt = taskWorktree(root, "marketing", "task-506");
    fs.writeFileSync(path.join(wt, "debug.txt"), "a hand edit while debugging\n");   // user's uncommitted work
    stub("echo 'tweak: adjust debug output'");                // opencode message generator (stubbed)
    const r = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r.ok).toBe(true);
    expect(r.autocommit).toMatchObject({ committed: true });
    expect(r.autocommit.message).toContain("tweak: adjust debug output");
    expect(fs.existsSync(path.join(root, "debug.txt"))).toBe(true);   // landed on main via the auto-commit + merge
  });

  it("a dirty main checkout returns needsResolve + a working diff (UI shows the dialog)", async () => {
    stub("echo x > out.txt");
    await run({});
    fs.writeFileSync(path.join(root, "dirty.txt"), "uncommitted\n");
    const r = finalizeTask(root, "marketing", "task-506");
    expect(r.ok).toBeFalsy();
    expect(r.needsResolve).toBe(true);
    expect(workingDiff(root).untracked).toContain("dirty.txt");
  });

  it("resolveMain 'commit' commits the dirty main (given message) then merges", async () => {
    stub("echo x > out.txt");
    await run({});
    fs.writeFileSync(path.join(root, "wip.txt"), "work in progress\n");
    const r = finalizeTask(root, "marketing", "task-506", { resolveMain: "commit", mainCommitMessage: "save wip" });
    expect(r.ok).toBe(true);
    expect(r.mainResolved).toMatchObject({ action: "commit", message: "save wip" });
    expect(fs.existsSync(path.join(root, "wip.txt"))).toBe(true);          // committed, then merged
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");          // main clean after
  });

  it("resolveMain 'stash' stashes the dirty main then merges (recoverable)", async () => {
    stub("echo x > out.txt");
    await run({});
    fs.writeFileSync(path.join(root, "wip2.txt"), "stash me\n");
    const r = finalizeTask(root, "marketing", "task-506", { resolveMain: "stash" });
    expect(r.ok).toBe(true);
    expect(r.mainResolved).toMatchObject({ action: "stash" });
    expect(fs.existsSync(path.join(root, "wip2.txt"))).toBe(false);        // stashed away
    expect(git(root, ["stash", "list"])).toContain("stashed before finalize");
  });

  it("merge style keeps task commits as a merge commit", async () => {
    stub("echo x > out.txt");
    await run({});
    const r = finalizeTask(root, "marketing", "task-506", { style: "merge" });
    expect(r.ok).toBe(true);
    expect(git(root, ["log", "-1", "--format=%s", "main"]).trim()).toBe("bridza: finalize marketing/task-506 → main");
    // the task branch's own commits are reachable from main (true merge, not squash)
    expect(git(root, ["branch", "--contains", taskBranchName("marketing", "task-506"), "--list", "main"]).trim()).toContain("main");
  });
});
