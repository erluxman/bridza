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
  ensureTaskBranch, ensureTaskWorktree, taskWorktree, runStage, finalizeTask, retargetTask,
  getTaskSession, setTaskSession, clearTaskSessions,
  taskTimeline, branchExists, currentBranch, git, taskBranchName, parseDiff, commitDiff, branchDiff, workingDiff,
  resolveRunnableTool, DEFAULT_STAGE_PROMPT, readTaskFile, saveTaskFile,
  finishConflict, abortConflict, pendingConflict, conflictedFiles,
  taskTarget, listBranches, setStageRouting, stageRouting,
  attachRun, runStageAndAdvance, listActiveRuns,
} from "../../../server/bridza-run.js";
import { rel, CLI_TOOLS } from "../../../core/domain.js";

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

  // #6 — only a fully-complete stage is committed. A failed run must NOT add a
  // commit; the timeline stays a clean sequence of done stages (no error commits).
  it("a failed run adds NO commit — the timeline only carries done stages", async () => {
    stub("echo partial > junk.txt; exit 3");
    const { end } = await run({});
    expect(end).toMatchObject({ exit: 3, status: "failed", errorKind: "exit", resultCommit: null });
    // no commit ahead of main for this task branch (the failure left no trace)
    const log = git(root, ["log", "--format=%s", "main..bridza/marketing/task-506"]).trim();
    expect(log).toBe("");
    // a subsequent SUCCESSFUL run commits exactly one done stage commit
    stub("echo good > out.txt");
    const { end: ok } = await run({});
    expect(ok.status).toBe("done");
    const subjects = git(root, ["log", "--format=%s", "main..bridza/marketing/task-506"]).trim().split("\n");
    expect(subjects).toEqual(["bridza(marketing/task-506/research): done · claude · exit 0 · 1 file"]);
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

  // #11 — a stage with no typed prompt must still run (off its system prompt +
  // upstream outputs), never error on empty input.
  it("an empty prompt still runs the stage instead of erroring", async () => {
    stub(`echo x > ${rel.stageOutputs("marketing", "task-506", "research")}/out.md`);
    const { end } = await run({ prompt: "" });
    expect(end).toMatchObject({ exit: 0, status: "done" });
    const plog = git(root, ["show", `bridza/marketing/task-506:${rel.stage("marketing", "task-506", "research")}/prompts.md`]);
    expect(plog).toContain("no prompt text");   // record still notes the empty input…
    expect(DEFAULT_STAGE_PROMPT.trim().length).toBeGreaterThan(0);  // …but a real default is sent to the tool
  });
});

// #4/#5 — the configured tool may not be installed; fall back to an installed
// CLI agent rather than dying with ENOENT and stopping the Automate chain.
describe("per-stage agent routing (the pick sticks to the stage)", () => {
  const meta = () => JSON.parse(git(root, ["show", `bridza/marketing/task-506:${rel.taskMeta("marketing", "task-506")}`]));

  it("round-trips a pick through the task metadata on the branch, with no run at all", () => {
    const r = setStageRouting(root, "marketing", "task-506", "research", { tool: "claude", model: "opus" });
    expect(r.ok).toBe(true);
    expect(meta().routing).toEqual({ research: { tool: "claude", model: "opus" } });
    expect(stageRouting(root, "marketing", "task-506", "research")).toEqual({ tool: "claude", model: "opus" });
    // unknown stage ids read as "no pick", never a crash
    expect(stageRouting(root, "marketing", "task-506", "gone")).toEqual({});
  });

  it("keeps stages and tasks independent, and overwrites the stage's own pick", () => {
    setStageRouting(root, "marketing", "task-506", "research", { tool: "claude", model: "opus" });
    setStageRouting(root, "marketing", "task-506", "planning", { tool: "opencode", model: "" });
    setStageRouting(root, "marketing", "other-task", "research", { tool: "codex", model: "" });
    setStageRouting(root, "marketing", "task-506", "research", { tool: "opencode", model: "" });
    expect(meta().routing).toEqual({ research: { tool: "opencode", model: "" }, planning: { tool: "opencode", model: "" } });
    expect(stageRouting(root, "marketing", "other-task", "research")).toEqual({ tool: "codex", model: "" });
  });

  it("runStage uses the saved agent when the request carries none, and the explicit one when it does", async () => {
    setStageRouting(root, "marketing", "task-506", "research", { tool: "claude", model: "opus" });
    stub("echo x > out.txt");
    await run({ tool: undefined, prompt: "p" });
    expect(meta().tracking.research.runs[0]).toMatchObject({ tool: "claude", model: "opus" });
    await run({ tool: "opencode", prompt: "p" });
    const runs = meta().tracking.research.runs;
    expect(runs[runs.length - 1]).toMatchObject({ tool: "opencode", model: null });  // saved model belongs to claude
    expect(meta().routing.research).toEqual({ tool: "opencode", model: "" });        // and the pick follows the run
  });
});

describe("tool resolution + fallback", () => {
  afterEach(() => { delete process.env.BRIDZA_TOOL_OVERRIDE; });

  it("registry ships codex and gemini, and each folds prompt + system into its args", () => {
    for (const id of ["opencode", "codex", "gemini"]) {
      const t = CLI_TOOLS.find((x) => x.id === id);
      expect(t, id).toBeTruthy();
      const args = t.args({ prompt: "PROMPTBODY", system: "SYS", model: "" });
      expect(args.join(" ")).toContain("PROMPTBODY");
      expect(args.join(" ")).toContain("SYS");   // no --system flag → folded into the message
    }
  });

  it("keeps the configured tool when it is installed", () => {
    delete process.env.BRIDZA_TOOL_OVERRIDE;
    const r = resolveRunnableTool("opencode", () => true);
    expect(r).toMatchObject({ toolId: "opencode" });
    expect(r.fellBackFrom).toBeUndefined();
  });

  it("falls back to an installed tool when the configured one is missing", () => {
    delete process.env.BRIDZA_TOOL_OVERRIDE;
    // opencode missing, claude present → substitute claude, remember the origin
    const r = resolveRunnableTool("opencode", (bin) => bin === "claude");
    expect(r.toolId).toBe("claude");
    expect(r.fellBackFrom).toBe("opencode");
  });

  it("reports no-tool (not ENOENT) when nothing is installed", () => {
    delete process.env.BRIDZA_TOOL_OVERRIDE;
    const r = resolveRunnableTool("opencode", () => false);
    expect(r.tool).toBeUndefined();
    expect(r.error).toMatch(/no CLI agent installed/);
  });

  it("unknown tool ids report an unknown-tool error", () => {
    delete process.env.BRIDZA_TOOL_OVERRIDE;
    expect(resolveRunnableTool("nope", () => true).error).toMatch(/unknown tool/);
  });
});

// #1 — read + edit an output file, committing as a new commit or an amend.
describe("file editor — read + save", () => {
  const P = `${rel.stageOutputs("marketing", "task-506", "research")}/note.md`;
  const count = () => Number(git(root, ["rev-list", "--count", "bridza/marketing/task-506"]).trim());

  it("reads a file, saves it as a NEW commit, then AMENDS the tip", async () => {
    stub(`echo hello > ${P}`);
    await run({});   // one done commit carrying note.md
    expect(readTaskFile(root, { pipeline: "marketing", task: "task-506", path: P })).toMatchObject({ ok: true, exists: true });
    expect(readTaskFile(root, { pipeline: "marketing", task: "task-506", path: P }).content).toMatch(/hello/);

    const before = count();
    const sv = saveTaskFile(root, { pipeline: "marketing", task: "task-506", path: P, content: "edited body\n", message: "edit note" });
    expect(sv).toMatchObject({ ok: true, committed: true, amended: false });
    expect(count()).toBe(before + 1);                 // NEW commit added
    expect(git(root, ["show", `bridza/marketing/task-506:${P}`])).toMatch(/edited body/);

    const at = count();
    const sv2 = saveTaskFile(root, { pipeline: "marketing", task: "task-506", path: P, content: "amended body\n", amend: true });
    expect(sv2).toMatchObject({ ok: true, committed: true, amended: true });
    expect(count()).toBe(at);                          // amend keeps the commit count
    expect(git(root, ["show", `bridza/marketing/task-506:${P}`])).toMatch(/amended body/);
  });

  it("rejects path traversal and no-ops an unchanged save", async () => {
    stub("echo x > a.txt");
    await run({});
    expect(readTaskFile(root, { pipeline: "marketing", task: "task-506", path: "../../etc/passwd" }).ok).toBe(false);
    expect(saveTaskFile(root, { pipeline: "marketing", task: "task-506", path: "/etc/passwd", content: "x" }).ok).toBe(false);
    expect(saveTaskFile(root, { pipeline: "marketing", task: "task-506", path: "a.txt", content: "x\n" }))
      .toMatchObject({ ok: true, committed: false, unchanged: true });
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

describe("finalize → merge conflict", () => {
  // A task branch whose app.txt and main's app.txt both move, so a squash into
  // main conflicts. Returns the diverge already committed on both sides.
  const diverge = () => {
    fs.writeFileSync(path.join(root, "app.txt"), "line1\nline2\nline3\n");
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "base"]);
    stub("echo x > out.txt");
    return run({});                                            // task worktree + branch commit, fork from main
  };
  const t = ["-c", "user.name=t", "-c", "user.email=t@t"];

  it("returns a conflict (not a generic failure) and resolves it IN PLACE, app-driven", async () => {
    await diverge();
    const wt = taskWorktree(root, "marketing", "task-506");
    fs.writeFileSync(path.join(wt, "app.txt"), "line1\ntask line\nline3\n");
    git(wt, ["add", "-A"]); git(wt, [...t, "commit", "-m", "task change"]);
    fs.writeFileSync(path.join(root, "app.txt"), "line1\nmain line\nline3\n");
    git(root, ["add", "-A"]); git(root, [...t, "commit", "-m", "main change"]);

    const r = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(r.files).toEqual(["app.txt"]);
    expect(r.dir).toBe(root);                                  // the merge is paused in main's checkout
    // the conflict survives with a real unmerged index + markers, ready for VS Code
    expect(git(root, ["ls-files", "-u"]).trim().split("\n")).toHaveLength(3);
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toContain("<<<<<<< HEAD");
    // the "dirty main" dialog can no longer show (or commit) marker text
    const wd = workingDiff(root);
    expect(wd.conflicts).toEqual(["app.txt"]);
    expect(wd.files.every((f) => f.path !== "")).toBe(true);

    // resolve like VS Code does (pick a side, stage it), then finish from the app
    fs.writeFileSync(path.join(root, "app.txt"), "line1\nmerged line\nline3\n");
    git(root, ["add", "app.txt"]);
    const f = finishConflict(root, { dir: root, pipeline: "marketing", task: "task-506", target: "main" });
    expect(f.ok).toBe(true);
    expect(f.target).toBe("main");
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
    expect(git(root, ["show", "HEAD:app.txt"]).trim()).toBe("line1\nmerged line\nline3");
  });

  it("keeps the conflict worktree OUT-OF-PLACE and finishes it without touching the user's checkout", async () => {
    await diverge();
    const wt = taskWorktree(root, "marketing", "task-506");
    fs.writeFileSync(path.join(wt, "app.txt"), "line1\ntask line\nline3\n");
    git(wt, ["add", "-A"]); git(wt, [...t, "commit", "-m", "task change"]);
    fs.writeFileSync(path.join(root, "app.txt"), "line1\nmain line\nline3\n");
    git(root, ["add", "-A"]); git(root, [...t, "commit", "-m", "main change"]);
    git(root, ["checkout", "-qb", "feature-x"]);               // user's checkout sits on another branch

    const r = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(r.files).toEqual(["app.txt"]);
    expect(r.dir).not.toBe(root);
    const mwt = r.dir;
    // THE fix for the destroyed-evidence bug: the worktree that holds the merge
    // is KEPT, not cleaned up, and the app knows exactly where the conflict is.
    expect(fs.existsSync(path.join(mwt, ".git"))).toBe(true);
    expect(git(mwt, ["ls-files", "-u"]).trim().split("\n")).toHaveLength(3);

    // resolving it and finishing advances main; the user's checkout is untouched
    fs.writeFileSync(path.join(mwt, "app.txt"), "line1\nmerged line\nline3\n");
    git(mwt, ["add", "app.txt"]);
    const f = finishConflict(root, { dir: mwt, pipeline: "marketing", task: "task-506", target: "main" });
    expect(f.ok).toBe(true);
    expect(f.target).toBe("main");
    expect(fs.existsSync(path.join(mwt, ".git"))).toBe(false); // finished worktree torn down
    expect(currentBranch(root)).toBe("feature-x");
    expect(git(root, ["show", "main:app.txt"]).trim()).toBe("line1\nmerged line\nline3");
  });

  it("a second finalize re-surfaces (never destroys) the pending conflict, then finishes once resolved", async () => {
    await diverge();
    const wt = taskWorktree(root, "marketing", "task-506");
    fs.writeFileSync(path.join(wt, "app.txt"), "line1\ntask line\nline3\n");
    git(wt, ["add", "-A"]); git(wt, [...t, "commit", "-m", "task change"]);
    fs.writeFileSync(path.join(root, "app.txt"), "line1\nmain line\nline3\n");
    git(root, ["add", "-A"]); git(root, [...t, "commit", "-m", "main change"]);
    git(root, ["checkout", "-qb", "feature-x"]);

    const r1 = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r1.conflict).toBe(true);
    const mwt = r1.dir;
    // clicking Finalize again mid-conflict must NOT remove the worktree →
    // re-run returns the same conflict instead of destroying it
    const r2 = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r2.conflict).toBe(true);
    expect(r2.dir).toBe(mwt);
    expect(fs.existsSync(path.join(mwt, ".git"))).toBe(true);
    expect(pendingConflict(root, "main")).toEqual({ dir: mwt, files: ["app.txt"], target: "main", owner: "marketing/task-506" });
    // stash (the old "resolve dirty main" escape) can't run against a conflict
    expect(finalizeTask(root, "marketing", "task-506", { style: "squash", resolveMain: "stash" }).conflict).toBe(true);

    // finalizing into a DIFFERENT branch must not delete the paused merge
    git(root, ["branch", "release", "main"]);
    const rx = finalizeTask(root, "marketing", "task-506", { style: "squash", into: "release" });
    expect(rx.conflict).toBe(true);
    expect(rx.target).toBe("main");
    expect(rx.dir).toBe(mwt);
    expect(git(mwt, ["ls-files", "-u"]).trim().split("\n")).toHaveLength(3);

    // resolve the markers, then the next Finalize simply lands the merge
    fs.writeFileSync(path.join(mwt, "app.txt"), "line1\nmerged line\nline3\n");
    git(mwt, ["add", "app.txt"]);
    const r3 = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r3.ok).toBe(true);
    expect(git(root, ["show", "main:app.txt"]).trim()).toBe("line1\nmerged line\nline3");
    expect(fs.existsSync(path.join(mwt, ".git"))).toBe(false);
  });

  it("#106 — a paused merge belongs to the task that parked it: another task can't finalize, finish or abort it", async () => {
    await diverge();
    const wt = taskWorktree(root, "marketing", "task-506");
    fs.writeFileSync(path.join(wt, "app.txt"), "line1\ntask line\nline3\n");
    git(wt, ["add", "-A"]); git(wt, [...t, "commit", "-m", "task change"]);
    fs.writeFileSync(path.join(root, "app.txt"), "line1\nmain line\nline3\n");
    git(root, ["add", "-A"]); git(root, [...t, "commit", "-m", "main change"]);
    git(root, ["checkout", "-qb", "feature-x"]);
    const r1 = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r1.conflict).toBe(true);
    const mwt = r1.dir;
    // another window, another task, the same dir (the leaked-state case) → refused, worktree kept
    expect(finishConflict(root, { dir: mwt, pipeline: "marketing", task: "task-999", target: "main" })).toMatchObject({ ok: false, error: expect.stringContaining("marketing/task-506") });
    expect(abortConflict(root, { dir: mwt, pipeline: "marketing", task: "task-999" })).toMatchObject({ ok: false, error: expect.stringContaining("marketing/task-506") });
    expect(fs.existsSync(path.join(mwt, ".git"))).toBe(true);
    // another task finalizing into the same target is told whose merge is paused, not handed the conflict
    git(root, ["branch", "bridza/marketing/task-999", "main"]);
    expect(finalizeTask(root, "marketing", "task-999", { style: "squash" })).toMatchObject({ ok: false, error: expect.stringContaining("marketing/task-506") });
    // the owner finishes it; the claim is released
    fs.writeFileSync(path.join(mwt, "app.txt"), "line1\nmerged line\nline3\n");
    git(mwt, ["add", "app.txt"]);
    expect(finishConflict(root, { dir: mwt, pipeline: "marketing", task: "task-506", target: "main" }).ok).toBe(true);
    expect(pendingConflict(root, "main")).toBeNull();
  });

  it("finishConflict refuses while files are still unmerged; abortConflict cancels cleanly", async () => {
    await diverge();
    const wt = taskWorktree(root, "marketing", "task-506");
    fs.writeFileSync(path.join(wt, "app.txt"), "line1\ntask line\nline3\n");
    git(wt, ["add", "-A"]); git(wt, [...t, "commit", "-m", "task change"]);
    fs.writeFileSync(path.join(root, "app.txt"), "line1\nmain line\nline3\n");
    git(root, ["add", "-A"]); git(root, [...t, "commit", "-m", "main change"]);

    // in-place
    const r = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r.conflict).toBe(true);
    expect(finishConflict(root, { dir: root }).stillConflicting).toBe(true);   // not resolved yet
    const a = abortConflict(root, { dir: root });
    expect(a.ok).toBe(true);
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");               // main restored, clean
    expect(conflictedFiles(root)).toEqual([]);
    expect(git(root, ["show", "HEAD:app.txt"]).trim()).toBe("line1\nmain line\nline3");

    // out-of-place: abort just deletes the throwaway worktree
    git(root, ["checkout", "-qb", "feature-x"]);
    const r2 = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r2.conflict).toBe(true);
    const mwt = r2.dir;
    expect(abortConflict(root, { dir: mwt }).ok).toBe(true);
    expect(fs.existsSync(path.join(mwt, ".git"))).toBe(false);
    expect(currentBranch(root)).toBe("feature-x");
    expect(git(root, ["show", "main:app.txt"]).trim()).toBe("line1\nmain line\nline3");  // main untouched
  });
});

describe("retargetTask — change a task's flow/type after creation", () => {
  it("switching flow DISCARDS progress: drops stage commits, rewrites stages + empty tracking", async () => {
    stub(`echo brief > ${rel.stageOutputs("marketing", "task-506", "research")}/brief.md`);
    await run({});                                             // one 'research' stage commit
    const r = retargetTask(root, "marketing", "task-506", { flow: "feature", flowName: "Feature", stages: ["spec", "build"] });
    expect(r.ok).toBe(true);
    expect(r.removed).toBeGreaterThanOrEqual(1);              // research commit dropped
    expect(r.flow).toBe("feature");
    expect(r.stages).toEqual(["spec", "build"]);
    const W = taskWorktree(root, "marketing", "task-506");
    const meta = JSON.parse(git(W, ["show", "HEAD:" + rel.taskMeta("marketing", "task-506")]));
    expect(meta.flow).toBe("feature");
    expect(meta.stages).toEqual(["spec", "build"]);
    expect(meta.tracking).toEqual({});
  });
  it("session store: set/get/clear per (task, tool), and reopenStage resets it", async () => {
    setTaskSession(root, "marketing", "task-506", "claude", { id: "u1", model: "" });
    setTaskSession(root, "marketing", "task-506", "opencode", { id: "s1", model: "opus" });
    expect(getTaskSession(root, "marketing", "task-506", "claude")).toEqual({ id: "u1", model: "" });
    expect(getTaskSession(root, "marketing", "task-506", "opencode")).toEqual({ id: "s1", model: "opus" });
    clearTaskSessions(root, "marketing", "task-506");
    expect(getTaskSession(root, "marketing", "task-506", "claude")).toBe(null);
  });

  it("type-only change keeps stage commits and progress", async () => {
    stub(`echo x > ${rel.stageOutputs("marketing", "task-506", "research")}/o.md`);
    await run({});
    const r = retargetTask(root, "marketing", "task-506", { type: "bug" });
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(0);
    expect(r.type).toBe("bug");
    const W = taskWorktree(root, "marketing", "task-506");
    const meta = JSON.parse(git(W, ["show", "HEAD:" + rel.taskMeta("marketing", "task-506")]));
    expect(meta.tracking.research).toBeTruthy();             // progress preserved
    expect(meta.type).toBe("bug");
  });
});

describe("target branch — where each task's work lands", () => {
  const gc = (msg) => {
    fs.writeFileSync(path.join(root, "commit.txt"), msg + "\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", msg], { cwd: root });
  };
  const putMeta = (task, meta) => { const p = path.join(root, rel.taskMeta("marketing", task)); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify({ v: 1, id: task, pipeline: "marketing", tracking: {}, ...meta })); };

  it("ensureTaskBranch forks the task branch from the stored target, not main", () => {
    gc("release work");
    git(root, ["branch", "release/1.x", "HEAD~1"]);           // release/1.x drifted one commit behind main
    putMeta("task-506", { target: "release/1.x" });
    expect(taskTarget(root, "marketing", "task-506")).toBe("release/1.x");
    const b = ensureTaskBranch(root, "marketing", "task-506");
    expect(b.ok).toBe(true);
    expect(git(root, ["rev-parse", b.branch]).trim()).toBe(git(root, ["rev-parse", "release/1.x"]).trim());
    expect(git(root, ["rev-parse", b.branch]).trim()).not.toBe(git(root, ["rev-parse", "main"]).trim());
    // a task with no stored target falls back to the repo default branch
    const def = ensureTaskBranch(root, "marketing", "task-1");
    expect(taskTarget(root, "marketing", "task-1")).toBe("main");
    expect(git(root, ["rev-parse", def.branch]).trim()).toBe(git(root, ["rev-parse", "main"]).trim());
    expect(listBranches(root)).toContain("release/1.x");
  });

  it("branchDiff reviews against the task's target branch, not main", async () => {
    gc("release work");
    git(root, ["branch", "release/1.x"]);
    fs.writeFileSync(path.join(root, "main2.txt"), "main only\n");    // main now has a commit the target lacks
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "main-only change"], { cwd: root });
    putMeta("task-506", { target: "release/1.x" });
    const w = ensureTaskWorktree(root, "marketing", "task-506"); // worktree forks from release/1.x
    expect(w.ok).toBe(true);
    fs.writeFileSync(path.join(w.worktree, "feature.txt"), "the feature\n");
    git(w.worktree, ["add", "-A"]);
    git(w.worktree, ["-c", "user.name=bridza", "-c", "user.email=bridza@local", "commit", "-m", "feature"]);
    const d = branchDiff(root, "marketing", "task-506");
    expect(d.base).toBe("release/1.x");
    const paths = d.files.map((f) => f.path);
    expect(paths).toContain("feature.txt");
    expect(paths).not.toContain("main2.txt");                  // the target's own newer commits stay OUT of the review
  });

  it("retargetTask sets a target branch and rejects one that doesn't exist", () => {
    git(root, ["branch", "release/1.x"]);
    expect(retargetTask(root, "marketing", "task-506", { target: "nope" }).error).toMatch(/does not exist/);
    expect(retargetTask(root, "marketing", "task-506", { target: "??" }).ok).toBe(false);   // not a valid ref name at all
    const r = retargetTask(root, "marketing", "task-506", { target: "release/1.x" });
    expect(r.ok).toBe(true);
    expect(r.target).toBe("release/1.x");
    expect(r.removed).toBe(0);                                 // no flow change → no stage commits dropped
    const W = taskWorktree(root, "marketing", "task-506");
    const meta = JSON.parse(fs.readFileSync(path.join(W, rel.taskMeta("marketing", "task-506")), "utf8"));
    expect(meta.target).toBe("release/1.x");
    expect(retargetTask(root, "marketing", "task-506", { target: "main", flow: "feature", flowName: "Feature", stages: ["spec", "build"] }).target).toBe("main");
  });

  it("finalize merges into the task's target branch when no into is passed", () => {
    gc("release work");
    git(root, ["branch", "release/1.x"]);
    putMeta("task-506", { target: "release/1.x", title: "ship to release" });
    const w = ensureTaskWorktree(root, "marketing", "task-506");
    expect(w.ok).toBe(true);
    fs.writeFileSync(path.join(w.worktree, "feature.txt"), "the feature\n");
    git(w.worktree, ["add", "-A"]);
    git(w.worktree, ["-c", "user.name=bridza", "-c", "user.email=bridza@local", "commit", "-m", "the feature"]);
    const r = finalizeTask(root, "marketing", "task-506", { style: "squash" });
    expect(r.ok).toBe(true);
    expect(r.target).toBe("release/1.x");
    const subject = git(root, ["log", "-1", "--format=%s", "release/1.x"]).trim();
    expect(subject).toMatch(/^bridza: finalize marketing\/task-506 .*→ release\/1\.x$/);
    const has = (ref, f) => { try { git(root, ["show", ref + ":" + f]); return true; } catch (e) { return false; } };
    expect(has("release/1.x", "feature.txt")).toBe(true);
    expect(has("main", "feature.txt")).toBe(false);           // the feature did NOT land on main
    expect(git(root, ["rev-parse", "main"]).trim()).toBe(git(root, ["rev-parse", "release/1.x~1"]).trim()); // main untouched
  });
});

// Task archive state moved to the root .bridza/refs.json so it syncs between
// devices — its tests live in bridza-store.test.js ("task archive state").

// The run is the server's, the page is a window onto it: a refresh mid-run can
// re-attach (replay + live tail), a run that ended while nobody watched keeps
// its text + reason, and the auto-advance chain carries on server-side.
describe("refresh survival: the run lives on the server", () => {
  const base = { tool: "claude", pipeline: "marketing", task: "task-506" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  it("re-attaching to a live run replays what it printed and streams the rest to its end", async () => {
    stub("echo first; sleep 1; echo second; echo out > OUTPUT.md");
    const running = run({});                       // not awaited — it's live
    await sleep(500);
    expect(listActiveRuns()).toHaveLength(1);
    expect(Object.keys(listActiveRuns()[0])).toEqual(["pipeline", "task", "stage", "tool", "startedAt"]);   // JSON-safe: no handles leak into /state
    const got = [];
    const end = await attachRun(root, "marketing", "task-506", "research", (e) => got.push(e)).done;
    expect(got[0]).toMatchObject({ t: "replay", live: true, tool: "claude" });
    expect(got[0].log).toContain("first\n");          // printed before we attached…
    expect(got[0].log).not.toContain("second\n");     // …this one not yet (the echoed command line mentions it, output doesn't)
    expect(got.some((e) => e.t === "out" && e.d.includes("second"))).toBe(true);
    expect(end.status).toBe("done");
    expect((await running).end.status).toBe("done");
    expect(listActiveRuns()).toHaveLength(0);
  });

  it("a run that failed while nobody watched still replays its text and the reason", async () => {
    stub("echo hello; echo 'quota exceeded' >&2; exit 3");
    await run({});
    const got = [];
    const end = await attachRun(root, "marketing", "task-506", "research", (e) => got.push(e)).done;
    expect(got[0]).toMatchObject({ t: "replay", live: false });
    expect(got[0].log).toContain("hello");
    expect(got[0].log).toContain("quota exceeded");
    expect(end).toMatchObject({ t: "end", replayed: true, status: "failed", exit: 3 });
    expect(end.error).toMatch(/exited with code 3/);
  });

  it("attaching where nothing ever ran ends at once with `none`", async () => {
    const got = [];
    const end = await attachRun(root, "marketing", "task-506", "never-ran", (e) => got.push(e)).done;
    expect(end).toEqual({ t: "end", none: true });
    expect(got).toHaveLength(1);
  });

  it("a stage run by hand carries the task on through its `advance` stages — on the server, after the response ended", async () => {
    stub("echo $RANDOM > OUTPUT-$(date +%s%N).md; echo ok");
    const events = [];
    const end = await runStageAndAdvance(root, { ...base, stage: "research", advance: [{ ...base, stage: "draft" }, { ...base, stage: "publish" }] }, (e) => events.push(e));
    expect(end.status).toBe("done");
    expect(events.find((e) => e.t === "end").advancing).toBe(2);
    await vi.waitFor(() => {
      const stages = taskTimeline(root, "marketing", "task-506").commits.map((c) => c.stage);
      expect(stages).toEqual(expect.arrayContaining(["research", "draft", "publish"]));
    }, { timeout: 25000, interval: 200 });
    await vi.waitFor(() => expect(listActiveRuns()).toHaveLength(0));
  });

  it("does not chain after a stage that did not end done", async () => {
    stub("echo nope >&2; exit 1");
    const events = [];
    const end = await runStageAndAdvance(root, { ...base, stage: "research", advance: [{ ...base, stage: "draft" }] }, (e) => events.push(e));
    expect(end.status).toBe("failed");
    expect(events.find((e) => e.t === "end").advancing).toBeUndefined();
    await sleep(600);
    expect(listActiveRuns()).toHaveLength(0);
    expect(taskTimeline(root, "marketing", "task-506").commits.map((c) => c.stage)).not.toContain("draft");
  });

  it("refuses a second stage of the same task while one is live", async () => {
    stub("sleep 1; echo ok");
    const first = run({});
    await sleep(300);
    const { end } = await run({ stage: "draft" });
    expect(end).toMatchObject({ status: "busy", errorKind: "busy" });
    expect(end.error).toMatch(/research/);
    expect((await first).end.status).toBe("done");
  });
});
