// plan.test.js — the task network plan: AND/OR gate logic (pure) and the
// .bridza/plan.json store (sanitized save + committed + round-trip).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readPlan, savePlan, readTaskMeta, createPipeline, createTask } from "../../../server/bridza-store.js";
import { git, extractImports, resolveImport, buildReverseImportGraph, reverseClosure, runStage, reopenStage } from "../../../server/bridza-run.js";
import { gateSatisfied, criticalPath, rel } from "../store/bridza.js";

// generous: the reopen/failed-run tests do several real runStage rounds (git
// worktrees + subprocesses) and slow down when the whole suite runs in parallel
vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });

let root;
const dirs = [];
function makeRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-plan-"));
  dirs.push(d);
  execFileSync("git", ["init", "-b", "main"], { cwd: d });
  fs.writeFileSync(path.join(d, "README.md"), "seed\n");
  execFileSync("git", ["add", "-A"], { cwd: d });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"], { cwd: d });
  return d;
}
beforeEach(() => { root = makeRepo(); });
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("gateSatisfied — AND/OR dependency gate", () => {
  const done = new Set(["p/a", "p/b"]);
  it("no gate / empty gate = satisfied", () => {
    expect(gateSatisfied(undefined, done)).toBe(true);
    expect(gateSatisfied({ all: [], any: [] }, done)).toBe(true);
  });
  it("all: every dep must be done", () => {
    expect(gateSatisfied({ all: ["p/a", "p/b"] }, done)).toBe(true);
    expect(gateSatisfied({ all: ["p/a", "p/c"] }, done)).toBe(false);
  });
  it("any: one done dep is enough", () => {
    expect(gateSatisfied({ any: ["p/c", "p/b"] }, done)).toBe(true);
    expect(gateSatisfied({ any: ["p/c", "p/d"] }, done)).toBe(false);
  });
  it("all AND any in series", () => {
    expect(gateSatisfied({ all: ["p/a"], any: ["p/b", "p/c"] }, done)).toBe(true);
    expect(gateSatisfied({ all: ["p/c"], any: ["p/a"] }, done)).toBe(false);
    expect(gateSatisfied({ all: ["p/a"], any: ["p/c", "p/d"] }, done)).toBe(false);
  });
});

describe("plan store — .bridza/plan.json", () => {
  it("reads an empty plan when none exists", () => {
    expect(readPlan(root)).toEqual({ v: 1, deps: {}, milestones: [], pos: {} });
  });
  it("saves, commits, and round-trips deps + milestones + positions", () => {
    const r = savePlan(root, {
      deps: { "dev/build": { all: ["dev/spec"], any: ["mkt/brief", "dev/spike"] } },
      milestones: [{ id: "ms-1", title: "Beta", due: "2026-08-01", tasks: ["dev/spec", "dev/build"], needs: [] }],
      pos: { "dev/build": { x: 120.7, y: 80.2 } },
    });
    expect(r.ok).toBe(true);
    expect(r.committed).toBe(true);
    const back = readPlan(root);
    expect(back.deps["dev/build"]).toEqual({ all: ["dev/spec"], any: ["mkt/brief", "dev/spike"] });
    expect(back.milestones).toEqual([{ id: "ms-1", title: "Beta", due: "2026-08-01", tasks: ["dev/spec", "dev/build"], needs: [] }]);
    expect(back.pos["dev/build"]).toEqual({ x: 121, y: 80 });   // rounded
    expect(git(root, ["log", "-1", "--format=%s"]).trim()).toMatch(/bridza: edit plan/);
    expect(fs.existsSync(path.join(root, rel.plan()))).toBe(true);
  });
  it("sanitizes: drops self-deps, bad keys, empty gates, untitled milestones", () => {
    savePlan(root, {
      deps: {
        "dev/build": { all: ["dev/build", "dev/spec", "../evil", "dev/spec"], any: [] },
        "bad key!": { all: ["dev/spec"] },
        "dev/empty": { all: [], any: [] },
      },
      milestones: [{ id: "m1", title: "  ", tasks: [] }, { id: "m2", title: "Real", tasks: ["dev/build", "nope"] }],
      pos: { "dev/build": { x: "nan", y: 5 }, "bad!": { x: 1, y: 2 }, "dev/ok": { x: 3, y: 4 } },
    });
    const back = readPlan(root);
    expect(back.deps).toEqual({ "dev/build": { all: ["dev/spec"], any: [] } });
    expect(back.milestones).toEqual([{ id: "m2", title: "Real", due: "", tasks: ["dev/build"], needs: [] }]);
    expect(back.pos).toEqual({ "dev/ok": { x: 3, y: 4 } });
  });
  it("a task can belong to only ONE milestone (first wins) and needs drops self/unknown", () => {
    savePlan(root, {
      milestones: [
        { id: "m1", title: "One", tasks: ["a/x", "a/y"], needs: ["m1", "m2", "ghost"] },
        { id: "m2", title: "Two", tasks: ["a/x", "a/z"], needs: [] },
      ],
    });
    const back = readPlan(root);
    expect(back.milestones[0]).toEqual({ id: "m1", title: "One", due: "", tasks: ["a/x", "a/y"], needs: ["m2"] });
    expect(back.milestones[1]).toEqual({ id: "m2", title: "Two", due: "", tasks: ["a/z"], needs: [] });
  });
  it("partial save keeps the other half (deps-only edit keeps milestones)", () => {
    savePlan(root, { milestones: [{ id: "m1", title: "Alpha", tasks: [] }] });
    savePlan(root, { deps: { "a/b": { all: ["a/c"] } } });
    const back = readPlan(root);
    expect(back.milestones.map((m) => m.title)).toEqual(["Alpha"]);
    expect(back.deps["a/b"]).toEqual({ all: ["a/c"], any: [] });
  });
});

describe("blast radius — reverse import closure (gitGraph semantics)", () => {
  it("extracts es/cjs/css/python imports (mid-line too)", () => {
    const src = `import a from "./a.js"; import aa from './a2';\nexport { b } from '../b';\nconst c = require("./c");\n@import "./d.css";\nfrom .mod import thing\nimport "side-effect";\n`;
    const got = new Set(extractImports(src));
    for (const want of ["./a.js", "./a2", "../b", "./c", "./d.css", ".mod", "side-effect"]) expect(got).toContain(want);
  });
  it("resolves relative specifiers against the repo file set (ext + index probing)", () => {
    const files = new Set(["src/a.js", "src/lib/index.ts", "src/b/c.dart"]);
    expect(resolveImport("src/main.js", "./a", files)).toBe("src/a.js");
    expect(resolveImport("src/main.js", "./lib", files)).toBe("src/lib/index.ts");
    expect(resolveImport("src/x/y.js", "../b/c.dart", files)).toBe("src/b/c.dart");
    expect(resolveImport("src/main.js", "react", files)).toBe(null);   // package import — skipped
    expect(resolveImport("src/main.js", "./missing", files)).toBe(null);
  });
  it("BFS on reverse edges: distance = hops from the change; cycles are safe", () => {
    // app.js → api.js → services.js → auth.js   (auth.js is the change)
    const FS = {
      "auth.js": "",
      "services.js": 'import x from "./auth.js";',
      "api.js": 'import y from "./services.js";',
      "app.js": 'import z from "./api.js";',
      "loner.js": "",
      "cycle1.js": 'import a from "./cycle2.js"; import s from "./services.js";',
      "cycle2.js": 'import b from "./cycle1.js";',
    };
    const incoming = buildReverseImportGraph(Object.keys(FS), (f) => FS[f]);
    const dist = reverseClosure(incoming, ["auth.js"]);
    expect(dist.get("auth.js")).toBe(0);
    expect(dist.get("services.js")).toBe(1);
    expect(dist.get("api.js")).toBe(2);
    expect(dist.get("app.js")).toBe(3);
    expect(dist.get("cycle1.js")).toBe(2);   // via services
    expect(dist.get("cycle2.js")).toBe(3);   // via cycle1, cycle survives
    expect(dist.has("loner.js")).toBe(false);   // untouched = not in the map
  });
});

describe("criticalPath — CPM over AND/OR gates", () => {
  // a → b → d ;  c → d(any with b)…  weights: done = 0, pending = 1
  const gates = {
    "p/b": { all: ["p/a"], any: [] },
    "p/c": { all: [], any: [] },
    "p/d": { all: ["p/b"], any: [] },
    "p/e": { all: [], any: ["p/d", "p/c"] },   // OR: fastest option counts
  };
  const keys = ["p/a", "p/b", "p/c", "p/d", "p/e"];
  const gateOf = (k) => gates[k] || { all: [], any: [] };

  it("OR gates take the FASTEST option; done tasks cost nothing", () => {
    // everything pending: e's any picks c (cost 1) over d (cost 3) → e = 2; critical = a→b→d = 3
    const r = criticalPath(keys, gateOf, () => 1);
    expect(r.path).toEqual(["p/a", "p/b", "p/d"]);
    expect(r.length).toBe(3);
    // a and b done → d = 1, c = 1; e = 1 + min(1,1) = 2 → critical path = c→e or d→e, length 2
    const done = new Set(["p/a", "p/b"]);
    const r2 = criticalPath(keys, gateOf, (k) => (done.has(k) ? 0 : 1));
    expect(r2.length).toBe(2);
    expect(r2.path.length).toBe(2);
    expect(r2.path[1]).toBe("p/e");
  });
  it("all done → empty path", () => {
    const r = criticalPath(keys, gateOf, () => 0);
    expect(r.length).toBe(0);
    expect(r.path).toEqual([]);
  });
  it("survives dependency cycles", () => {
    const cyc = { "x/a": { all: ["x/b"], any: [] }, "x/b": { all: ["x/a"], any: [] } };
    const r = criticalPath(["x/a", "x/b"], (k) => cyc[k], () => 1);
    expect(r.length).toBe(2);
  });
});

describe("reopenStage — hard rollback: commits after the stage are removed", () => {
  it("resets HEAD to the last valid commit; the stage and later commits (and their files) are gone", async () => {
    const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-plan-wt-"));
    dirs.push(wtBase);
    process.env.BRIDZA_WORKTREE_DIR = wtBase;
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo output >> out.txt"] });
    try {
      createPipeline(root, { id: "dev", label: "Dev", stages: [{ id: "spec", name: "Spec" }, { id: "build", name: "Build" }] });
      createTask(root, { pipeline: "dev", id: "t1", title: "T1" });
      for (const stage of ["spec", "build"]) {
        const end = await runStage(root, { pipeline: "dev", task: "t1", stage, tool: "opencode", prompt: "go" }, () => {});
        expect(end.status).toBe("done");
      }
      const B = "bridza/dev/t1";
      expect(git(root, ["log", "--format=%s", "main.." + B]).trim().split("\n")).toHaveLength(2);   // one commit per stage
      const forkPoint = git(root, ["rev-parse", "main"]).trim();

      // going back to spec removes BOTH stage commits; HEAD = the last valid commit
      const r = reopenStage(root, "dev", "t1", "spec");
      expect(r.ok).toBe(true);
      expect(r.reset).toEqual(["spec", "build"]);
      expect(r.removed).toBe(2);
      expect(r.head).toBe(forkPoint);
      expect(git(root, ["rev-parse", B]).trim()).toBe(forkPoint);
      const meta = readTaskMeta(root, "dev", "t1");
      expect(meta.tracking.spec).toBeUndefined();                                     // rolled back with the commit
      expect(meta.finalized).toBeFalsy();
      expect(git(root, ["ls-tree", "-r", "--name-only", B])).not.toContain("out.txt");   // files rolled back too

      // reopening only the LATER stage keeps the earlier one intact
      await runStage(root, { pipeline: "dev", task: "t1", stage: "spec", tool: "opencode", prompt: "again" }, () => {});
      await runStage(root, { pipeline: "dev", task: "t1", stage: "build", tool: "opencode", prompt: "again" }, () => {});
      const r2 = reopenStage(root, "dev", "t1", "build");
      expect(r2.reset).toEqual(["build"]);
      expect(r2.removed).toBe(1);
      const meta2 = readTaskMeta(root, "dev", "t1");
      expect(meta2.tracking.spec.status).toBe("done");
      expect(meta2.tracking.build).toBeUndefined();
      expect(git(root, ["log", "--format=%s", "main.." + B]).trim().split("\n")).toHaveLength(1);
    } finally {
      delete process.env.BRIDZA_WORKTREE_DIR;
      delete process.env.BRIDZA_TOOL_OVERRIDE;
    }
  });
});

describe("failed runs carry their reason", () => {
  it("stores error + output tail on the run record (committed to the branch)", async () => {
    const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-fail-wt-"));
    dirs.push(wtBase);
    process.env.BRIDZA_WORKTREE_DIR = wtBase;
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo not authenticated: run opencode auth login >&2; exit 3"] });
    try {
      createPipeline(root, { id: "dev", label: "Dev", stages: [{ id: "spec", name: "Spec" }] });
      createTask(root, { pipeline: "dev", id: "t2", title: "T2" });
      const end = await runStage(root, { pipeline: "dev", task: "t2", stage: "spec", tool: "opencode", prompt: "go" }, () => {});
      expect(end.status).toBe("failed");
      expect(end.exit).toBe(3);
      const meta = readTaskMeta(root, "dev", "t2");
      const run = meta.tracking.spec.runs[0];
      expect(run.status).toBe("failed");
      expect(run.error).toMatch(/exited with code 3/);
      expect(run.log).toMatch(/^\$ sh -c /);   // the EXACT command line is the log's first line
      expect(run.log).toMatch(/not authenticated/);
    } finally {
      delete process.env.BRIDZA_WORKTREE_DIR;
      delete process.env.BRIDZA_TOOL_OVERRIDE;
    }
  });
});

describe("opencode error events (exit 0) mark the run failed", () => {
  it("a {type:error} JSON event fails the stage with the provider message", async () => {
    const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-ocerr-wt-"));
    dirs.push(wtBase);
    process.env.BRIDZA_WORKTREE_DIR = wtBase;
    // mimics opencode: emits an error event as JSON, then exits 0
    const EV = JSON.stringify({ type: "error", sessionID: "ses_test", error: { name: "APIError", data: { message: "Error from provider (DeepSeek): tools[0].function: missing field name" } } });
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo '" + EV + "'"], stream: "json" });
    try {
      createPipeline(root, { id: "dev", label: "Dev", stages: [{ id: "spec", name: "Spec" }] });
      createTask(root, { pipeline: "dev", id: "t3", title: "T3" });
      const end = await runStage(root, { pipeline: "dev", task: "t3", stage: "spec", tool: "opencode", prompt: "go" }, () => {});
      expect(end.status).toBe("failed");
      expect(end.errorKind).toBe("tool-error");
      expect(end.error).toMatch(/DeepSeek/);
      const run = readTaskMeta(root, "dev", "t3").tracking.spec.runs[0];
      expect(run.status).toBe("failed");
      expect(run.error).toMatch(/missing field name/);
      expect(run.sessionId).toBe("ses_test");
    } finally {
      delete process.env.BRIDZA_WORKTREE_DIR;
      delete process.env.BRIDZA_TOOL_OVERRIDE;
    }
  });
});

describe("every Run press records the prompt to a file", () => {
  it("appends each run's prompt to <stage>/prompts.md, committed on the branch", async () => {
    const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-plog-wt-"));
    dirs.push(wtBase);
    process.env.BRIDZA_WORKTREE_DIR = wtBase;
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo done"] });
    try {
      createPipeline(root, { id: "dev", label: "Dev", stages: [{ id: "spec", name: "Spec" }] });
      createTask(root, { pipeline: "dev", id: "t4", title: "T4" });
      await runStage(root, { pipeline: "dev", task: "t4", stage: "spec", tool: "opencode", prompt: "first prompt text" }, () => {});
      await runStage(root, { pipeline: "dev", task: "t4", stage: "spec", tool: "opencode", model: "x/y", prompt: "second prompt text" }, () => {});
      const plog = git(root, ["show", "bridza/dev/t4:.bridza/pipelines/dev/t4/spec/prompts.md"]);
      expect(plog).toMatch(/# Prompt history — Spec|# Prompt history — spec/);
      expect(plog).toMatch(/run 1 · opencode\n\nfirst prompt text/);
      expect(plog).toMatch(/run 2 · opencode · x\/y\n\nsecond prompt text/);
      expect(plog.indexOf("first prompt text")).toBeLessThan(plog.indexOf("second prompt text"));
    } finally {
      delete process.env.BRIDZA_WORKTREE_DIR;
      delete process.env.BRIDZA_TOOL_OVERRIDE;
    }
  });
});

describe("web terminal — termRun", () => {
  it("streams output and exit code from the repo root", async () => {
    const { termRun } = await import("../../../server/bridza-run.js");
    const events = [];
    const h = termRun(root, { cmd: "echo one; echo two >&2; exit 4" }, (e) => events.push(e));
    await h.done;
    const out = events.filter((e) => e.t === "out").map((e) => e.d).join("");
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(events.find((e) => e.t === "cwd").dir).toBe(root);
    expect(events.find((e) => e.t === "end").exit).toBe(4);
  });
  it("runs inside the task worktree when pipeline+task are given", async () => {
    const { termRun } = await import("../../../server/bridza-run.js");
    const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-term-wt-"));
    dirs.push(wtBase);
    process.env.BRIDZA_WORKTREE_DIR = wtBase;
    try {
      createPipeline(root, { id: "dev", label: "Dev", stages: [{ id: "spec", name: "Spec" }] });
      createTask(root, { pipeline: "dev", id: "t5", title: "T5" });
      const events = [];
      const h = termRun(root, { pipeline: "dev", task: "t5", cmd: "pwd; git branch --show-current" }, (e) => events.push(e));
      await h.done;
      const out = events.filter((e) => e.t === "out").map((e) => e.d).join("");
      expect(events.find((e) => e.t === "cwd").dir).toContain(wtBase);
      expect(out).toContain("bridza/dev/t5");   // the worktree has the task branch checked out
      expect(events.find((e) => e.t === "end").exit).toBe(0);
    } finally {
      delete process.env.BRIDZA_WORKTREE_DIR;
    }
  });
});

describe("auto-advance resumes — never restarts", () => {
  it("automateTask skips stages the branch tip already marks done, even if the client sends them", async () => {
    const { automateTask } = await import("../../../server/bridza-run.js");
    const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-auto-wt-"));
    dirs.push(wtBase);
    process.env.BRIDZA_WORKTREE_DIR = wtBase;
    process.env.BRIDZA_TOOL_OVERRIDE = JSON.stringify({ bin: "sh", args: ["-c", "echo ok"] });
    try {
      createPipeline(root, { id: "dev", label: "Dev", stages: [{ id: "spec", name: "Spec" }, { id: "build", name: "Build" }] });
      createTask(root, { pipeline: "dev", id: "t6", title: "T6" });
      // complete the FIRST stage beforehand
      const first = await runStage(root, { pipeline: "dev", task: "t6", stage: "spec", tool: "opencode", prompt: "done already" }, () => {});
      expect(first.status).toBe("done");
      // a stale client sends BOTH stages — the server must skip spec and run build
      const events = [];
      const bodies = ["spec", "build"].map((stage) => ({ pipeline: "dev", task: "t6", stage, tool: "opencode", prompt: "go", stageName: stage }));
      const r = await automateTask(root, { stages: bodies }, (e) => events.push(e));
      expect(r.ok).toBe(true);
      expect(r.results[0]).toMatchObject({ stage: "spec", status: "done", skipped: true });
      expect(r.results[1]).toMatchObject({ stage: "build", status: "done" });
      expect(r.results[1].skipped).toBeUndefined();
      expect(events.some((e) => e.t === "automate" && e.phase === "skip" && e.stage === "spec")).toBe(true);
      // spec was NOT re-run: still exactly one run record
      expect(readTaskMeta(root, "dev", "t6").tracking.spec.runs.length).toBe(1);
    } finally {
      delete process.env.BRIDZA_WORKTREE_DIR;
      delete process.env.BRIDZA_TOOL_OVERRIDE;
    }
  });
});
