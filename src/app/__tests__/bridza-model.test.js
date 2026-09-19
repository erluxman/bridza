// bridza-model.test.js — the pure model layer, exhaustively. These tests are
// deterministic (no fs, no git, no network) and encode the INVARIANTS every
// future change must keep: starter-template integrity, flow normalization,
// judge resolution, fit checks, spec/prompt assembly, and the portable file
// formats. If a refactor breaks a contract the UI or agents rely on, one of
// these fails by name.
import { describe, it, expect } from "vitest";
import {
  safeRef, taskBranchName, gateSatisfied, criticalPath,
  pipelineFlows, flattenFlows, judgeStageId, flowFitCheck, recommendFlow,
  SPEC_CATALOG, specLabel, specValues, withSpecs,
  FLOW_FILE_KIND, exportFlow, parseFlowFile,
  PIPELINE_FILE_KIND, exportPipeline, parsePipelineFile,
  STARTER_PIPELINES, CLI_TOOLS, buildFileTree,
  REF_WIDTH, padRef, taskDirName, parseTaskDir, displayRef,
} from "../../../core/domain.js";

/* ───────────────────────── naming + branches ───────────────────────── */

describe("safeRef / branch names", () => {
  it("slugs anything into a git-legal ref component", () => {
    expect(safeRef("Hello World!")).toBe("Hello-World");
    expect(safeRef("..lock")).toBe("lock");
    expect(safeRef("")).toBe("x");
    expect(safeRef("äöü")).toBe("x");
    expect(safeRef("a.b.c")).toBe("a-b-c");
  });
  it("task branches are namespaced under bridza/", () => {
    expect(taskBranchName("My Pipe", "Task #1")).toBe("bridza/My-Pipe/Task-1");
  });
});

/* ───────────────────────── AND/OR gates ───────────────────────── */

describe("zero-padded numbered folders", () => {
  it("pads to a width that covers the ~10 million task target", () => {
    expect(REF_WIDTH).toBe(8);
    expect(padRef(17)).toBe("00000017");
    expect(padRef(1)).toBe("00000001");
    expect(padRef(10000000)).toBe("10000000");
    // the whole point: lexicographic order == generation order
    expect([padRef(9), padRef(10), padRef(100)].slice().sort())
      .toEqual([padRef(9), padRef(10), padRef(100)].slice().sort((a, b) => a.localeCompare(b)));
    expect(padRef(9) < padRef(10)).toBe(true);
  });

  it("builds <padded-ref>-<slug> dir names", () => {
    expect(taskDirName("engineering", "every-task-when-they-are-converted-into", 17))
      .toBe("00000017-every-task-when-they-are-converted-into");
    expect(taskDirName("engineering", "Number Prefix Contract", 3))
      .toBe("00000003-Number-Prefix-Contract");
  });

  it("leaves the slug bare when there is no usable ref", () => {
    for (const bad of [null, undefined, 0, -1, 1.5, "", "abc", NaN]) {
      expect(taskDirName("engineering", "foo", bad)).toBe("foo");
    }
  });

  it("round-trips taskDirName ↔ parseTaskDir", () => {
    for (const ref of [1, 9, 17, 999, 10000000, 99999999]) {
      const dir = taskDirName("engineering", "some-task", ref);
      expect(parseTaskDir(dir)).toEqual({ ref, id: "some-task" });
    }
  });

  it("round-trips a ref that has outgrown REF_WIDTH rather than losing identity", () => {
    const dir = taskDirName("engineering", "some-task", 100000000);
    expect(dir).toBe("100000000-some-task");
    expect(parseTaskDir(dir)).toEqual({ ref: 100000000, id: "some-task" });
  });

  it("treats an unpadded dir as legacy, id untouched", () => {
    expect(parseTaskDir("every-task-when-they-are-converted-into"))
      .toEqual({ ref: null, id: "every-task-when-they-are-converted-into" });
  });

  it("never mis-reads a slug that merely starts with digits", () => {
    for (const slug of ["2fa-rollout", "1234-abc", "0000001-short-by-one", "12345678"]) {
      expect(parseTaskDir(slug)).toEqual({ ref: null, id: slug });
    }
  });

  it("refuses #0 — refs.json never hands it out", () => {
    expect(parseTaskDir("00000000-foo")).toEqual({ ref: null, id: "00000000-foo" });
  });

  it("survives an empty or absent dir name", () => {
    expect(parseTaskDir("")).toEqual({ ref: null, id: "" });
    expect(parseTaskDir(null)).toEqual({ ref: null, id: "" });
  });

  it("displays the plain integer, from either shape", () => {
    expect(displayRef(17)).toBe(17);
    expect(displayRef("00000017")).toBe(17);
    expect(displayRef(padRef(10000000))).toBe(10000000);
    for (const none of [null, undefined, 0, "", "abc", -4]) expect(displayRef(none)).toBe(null);
  });
});

describe("gateSatisfied", () => {
  const done = new Set(["a", "b"]);
  it("empty gate is satisfied", () => expect(gateSatisfied({}, done)).toBe(true));
  it("ALL requires every dep", () => {
    expect(gateSatisfied({ all: ["a", "b"] }, done)).toBe(true);
    expect(gateSatisfied({ all: ["a", "c"] }, done)).toBe(false);
  });
  it("ANY requires at least one", () => {
    expect(gateSatisfied({ any: ["c", "b"] }, done)).toBe(true);
    expect(gateSatisfied({ any: ["c", "d"] }, done)).toBe(false);
  });
  it("ALL and ANY are wired in series", () => {
    expect(gateSatisfied({ all: ["a"], any: ["b", "c"] }, done)).toBe(true);
    expect(gateSatisfied({ all: ["c"], any: ["a"] }, done)).toBe(false);
    expect(gateSatisfied({ all: ["a"], any: ["c", "d"] }, done)).toBe(false);
  });
});

describe("criticalPath", () => {
  const gates = { c: { all: ["a", "b"] }, d: { all: ["c"] } };
  const gateOf = (k) => gates[k] || {};
  it("finds the longest chain (unit weights)", () => {
    const r = criticalPath(["a", "b", "c", "d"], gateOf, () => 1);
    expect(r.length).toBe(3);
    expect(r.path[r.path.length - 1]).toBe("d");
  });
  it("weights by cost — a heavy short chain beats a light long one", () => {
    const w = { a: 10, b: 1, c: 1, d: 1 };
    const r = criticalPath(["a", "b", "c", "d"], gateOf, (k) => w[k]);
    expect(r.length).toBe(12);           // a(10) → c(1) → d(1)
    expect(r.path).toEqual(["a", "c", "d"]);
  });
  it("ANY gates take the cheapest option", () => {
    const g = { c: { any: ["a", "b"] } };
    const w = { a: 10, b: 2, c: 1 };
    const r = criticalPath(["a", "b", "c"], (k) => g[k] || {}, (k) => w[k]);
    expect(r.length).toBe(10);           // ends at a (heaviest single), c's chain is b(2)+c(1)=3
  });
  it("survives cycles without hanging", () => {
    const g = { a: { all: ["b"] }, b: { all: ["a"] } };
    const r = criticalPath(["a", "b"], (k) => g[k], () => 1);
    expect(r.length).toBeGreaterThan(0);
  });
});

/* ───────────────────────── flow normalization ───────────────────────── */

describe("pipelineFlows", () => {
  it("flows form: carries id, name (defaults), stages, next", () => {
    const fl = pipelineFlows({ label: "P", flows: [{ stages: [{ id: "s" }], next: { pipeline: "x", flow: "y" } }, { name: "B" }] });
    expect(fl[0]).toMatchObject({ id: "flow-1", name: "P", next: { pipeline: "x", flow: "y" } });
    expect(fl[1]).toMatchObject({ id: "flow-2", name: "B", stages: [], next: null });
  });
  it("next requires BOTH pipeline and flow", () => {
    expect(pipelineFlows({ flows: [{ id: "f", next: { pipeline: "x" } }] })[0].next).toBe(null);
  });
  it("templates form: each template becomes a flow over the stage pool", () => {
    const def = {
      label: "Dev",
      stages: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      templates: [{ id: "t1", label: "T1", stages: ["a", "c", "ghost"] }],
    };
    const fl = pipelineFlows(def);
    expect(fl).toHaveLength(1);
    expect(fl[0].id).toBe("t1");
    expect(fl[0].stages.map((s) => s.id)).toEqual(["a", "c"]);   // unknown ids dropped
  });
  it("plain stage list becomes one flow named after the pipeline", () => {
    const fl = pipelineFlows({ label: "Marketing", stages: [{ id: "s1" }] });
    expect(fl).toEqual([{ id: "main", name: "Marketing", stages: [{ id: "s1" }] }]);
  });
});

describe("CLI_TOOLS — session reuse flags", () => {
  const tool = (id) => STARTER_PIPELINES && CLI_TOOLS.find((t) => t.id === id);
  it("claude: --session-id to start, --resume to continue, nothing without a session", () => {
    const claude = tool("claude");
    expect(claude.args({ prompt: "p", session: { id: "abc", mode: "start" } })).toEqual(expect.arrayContaining(["--session-id", "abc"]));
    expect(claude.args({ prompt: "p", session: { id: "abc", mode: "resume" } })).toEqual(expect.arrayContaining(["--resume", "abc"]));
    const plain = claude.args({ prompt: "p" });
    expect(plain).not.toContain("--resume");
    expect(plain).not.toContain("--session-id");
  });
  it("opencode: --session only when resuming", () => {
    const oc = tool("opencode");
    expect(oc.args({ prompt: "p", session: { id: "s1", mode: "resume" } })).toEqual(expect.arrayContaining(["--session", "s1"]));
    expect(oc.args({ prompt: "p", session: { id: "s1", mode: "start" } })).not.toContain("--session");
    expect(oc.args({ prompt: "p" })).not.toContain("--session");
  });
  it("codex: `exec resume <id>` when resuming, plain `exec` otherwise", () => {
    const cx = tool("codex");
    expect(cx.args({ prompt: "p", session: { id: "cid", mode: "resume" } }).slice(0, 3)).toEqual(["exec", "resume", "cid"]);
    expect(cx.args({ prompt: "p" })[0]).toBe("exec");
    expect(cx.args({ prompt: "p" })).not.toContain("resume");
  });
});

describe("recommendFlow — most-appropriate, not most-detailed", () => {
  const pipeline = { label: "Eng", flows: [
    { id: "full-sdlc", name: "Full SDLC", stages: [{ id: "vision", name: "Vision" }, { id: "build", name: "Implementation" }] },
    { id: "feature", name: "Feature", stages: [{ id: "spec", name: "Spec" }, { id: "build", name: "Build" }] },
    { id: "bugfix", name: "Bugfix", stages: [{ id: "repro", name: "Repro" }, { id: "fix", name: "Fix" }] },
    { id: "ui-design", name: "UI Design", stages: [{ id: "design", name: "Design" }] },
  ] };
  it("single-flow pipeline always returns that flow", () => {
    expect(recommendFlow({ label: "M", stages: [{ id: "s" }] }, "anything").id).toBe("main");
  });
  it("bug title picks the bugfix flow, not the most detailed", () => {
    expect(recommendFlow(pipeline, "Fix crash on login").id).toBe("bugfix");
  });
  it("design title picks the design flow", () => {
    expect(recommendFlow(pipeline, "Design the new dashboard UI").id).toBe("ui-design");
  });
  it("ambiguous title returns no pick (asks the user)", () => {
    expect(recommendFlow(pipeline, "Q3 stuff").id).toBe("");
  });
});

describe("flattenFlows", () => {
  it("first occurrence of a stage id wins; nullish entries skipped", () => {
    const out = flattenFlows([
      { stages: [{ id: "a", v: 1 }, null, { id: "b" }] },
      { stages: [{ id: "a", v: 2 }, { id: "c" }, {}] },
    ]);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(out[0].v).toBe(1);
  });
});

/* ───────────────────────── judge + fit check ───────────────────────── */

describe("judgeStageId", () => {
  it("explicit judge flag wins over the name heuristic", () => {
    const f = { stages: [{ id: "build", name: "Build" }, { id: "x", name: "Review", judge: true }] };
    expect(judgeStageId(f)).toBe("x");
  });
  it("falls back to the first implementation-looking stage name", () => {
    expect(judgeStageId({ stages: [{ id: "s", name: "Spec" }, { id: "i", name: "Implement it" }] })).toBe("i");
    expect(judgeStageId({ stages: [{ id: "f", name: "Fix" }] })).toBe("f");
  });
  it("null when nothing matches (no silent guess)", () => {
    expect(judgeStageId({ stages: [{ id: "w", name: "Write" }] })).toBe(null);
    expect(judgeStageId(null)).toBe(null);
  });
});

describe("flowFitCheck", () => {
  it("empty when there are no other flows", () => {
    expect(flowFitCheck("A", [])).toBe("");
    expect(flowFitCheck("A", [{}])).toBe("");
  });
  it("names the flow, lists alternatives with stage sequences, demands flow-fit.md on mis-fit", () => {
    const s = flowFitCheck("Quick fix", [{ name: "Feature", stages: [{ name: "Spec" }, { id: "b" }] }]);
    expect(s).toContain('"Quick fix"');
    expect(s).toContain('"Feature" (Spec → b)');
    expect(s).toContain("flow-fit.md");
    expect(s).toContain("STOP");
  });
});

/* ───────────────────────── specs + prompt assembly ───────────────────────── */

describe("spec catalog + withSpecs", () => {
  it("catalog keys are globally unique", () => {
    const keys = SPEC_CATALOG.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("every catalog item has a label and suggested values array", () => {
    for (const g of SPEC_CATALOG) for (const it_ of g.items) {
      expect(it_.label).toBeTruthy();
      expect(Array.isArray(it_.values)).toBe(true);
    }
  });
  it("specLabel/specValues resolve catalog keys and fall back for custom keys", () => {
    expect(specLabel("target-os")).toBe("Target OS");
    expect(specLabel("battery-budget")).toBe("battery-budget");
    expect(specValues("form-factors").length).toBeGreaterThan(0);
    expect(specValues("battery-budget")).toEqual([]);
  });
  it("withSpecs appends a hard-requirement block to the PROMPT, skipping empty values", () => {
    const out = withSpecs("Do it", [{ key: "target-os", value: "iOS" }, { key: "offline", value: "  " }, { key: "custom", value: "x" }]);
    expect(out).toBe("Do it\n\nStage specs — treat each as a hard requirement:\n- Target OS: iOS\n- custom: x");
  });
  it("withSpecs is a no-op with no filled specs (prompt untouched)", () => {
    expect(withSpecs("p", [])).toBe("p");
    expect(withSpecs("p", [{ key: "a", value: "" }])).toBe("p");
    expect(withSpecs("", [{ key: "a", value: "1" }])).toContain("- a: 1");
  });
});

/* ───────────────────────── portable file formats ───────────────────────── */

describe("flow files", () => {
  it("round-trips a flow", () => {
    const flow = { name: "F", stages: [{ id: "s", name: "S" }] };
    const back = parseFlowFile(JSON.stringify(exportFlow(flow)));
    expect(back.flow).toEqual(flow);
  });
  it("rejects bad JSON, wrong kind, and empty stages", () => {
    expect(parseFlowFile("nope").error).toMatch(/JSON/);
    expect(parseFlowFile('{"kind":"other","stages":[{}]}').error).toContain(FLOW_FILE_KIND);
    expect(parseFlowFile(JSON.stringify({ kind: FLOW_FILE_KIND, stages: [] })).error).toBeTruthy();
  });
});

describe("pipeline files", () => {
  it("round-trips a whole pipeline including flow handoffs", () => {
    const p = { label: "P", workingDir: "sub", flows: [{ id: "f", name: "F", stages: [{ id: "s" }], next: { pipeline: "x", flow: "y" } }] };
    const back = parsePipelineFile(JSON.stringify(exportPipeline(p)));
    expect(back.error).toBeUndefined();
    expect(back.pipeline.label).toBe("P");
    expect(back.pipeline.workingDir).toBe("sub");
    expect(back.pipeline.flows[0].next).toEqual({ pipeline: "x", flow: "y" });
  });
  it("rejects wrong kind and missing flows; defaults label", () => {
    expect(parsePipelineFile(JSON.stringify({ kind: FLOW_FILE_KIND, stages: [{}] })).error).toContain(PIPELINE_FILE_KIND);
    expect(parsePipelineFile(JSON.stringify({ kind: PIPELINE_FILE_KIND, flows: [] })).error).toBeTruthy();
    expect(parsePipelineFile(JSON.stringify({ kind: PIPELINE_FILE_KIND, flows: [{ stages: [] }] })).pipeline.label).toBe("Imported pipeline");
  });
});

/* ───────────────────────── starter-template integrity ───────────────────────── */

describe("STARTER_PIPELINES integrity (the category catalog)", () => {
  const CATEGORY_IDS = ["engineering", "product", "design-brand", "content", "marketing", "sales", "support", "operations", "strategy", "hiring", "finance"];

  it("exactly these 11 business categories, in this order", () => {
    expect(STARTER_PIPELINES.map((p) => p.id)).toEqual(CATEGORY_IDS);
  });

  it("every category has a label, workingDir and at least one flow", () => {
    for (const p of STARTER_PIPELINES) {
      expect(p.label, p.id).toBeTruthy();
      expect(p.workingDir, p.id).toBeTruthy();
      expect(pipelineFlows(p).length, p.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("stage ids are unique across ALL flows of a category (task lookup depends on it)", () => {
    for (const p of STARTER_PIPELINES) {
      const ids = pipelineFlows(p).flatMap((f) => f.stages.map((s) => s.id));
      expect(new Set(ids).size, p.id + " has duplicate stage ids").toBe(ids.length);
    }
  });

  it("every stage is fully specified: id, name, tool (known), systemPrompt, gate, outputs", () => {
    const tools = new Set(CLI_TOOLS.map((t) => t.id));
    for (const p of STARTER_PIPELINES) for (const f of pipelineFlows(p)) for (const s of f.stages) {
      const at = `${p.id}/${f.id}/${s.id}`;
      expect(s.id, at).toMatch(/^[a-z0-9-]+$/);
      expect(s.name, at).toBeTruthy();
      expect(tools.has(s.tool), at + " unknown tool " + s.tool).toBe(true);
      expect((s.systemPrompt || "").length, at + " needs a system prompt").toBeGreaterThan(40);
      expect(s.gate, at + " needs an acceptance gate").toBeTruthy();
      expect((s.outputs || []).length, at + " needs outputs").toBeGreaterThan(0);
    }
  });

  it("every multi-stage flow has an EXPLICIT fit-judge stage", () => {
    for (const p of STARTER_PIPELINES) for (const f of pipelineFlows(p)) {
      if (f.stages.length < 2) continue;
      expect(f.stages.some((s) => s.judge === true), `${p.id}/${f.id} has no judge`).toBe(true);
      expect(f.stages.filter((s) => s.judge).length, `${p.id}/${f.id} has multiple judges`).toBe(1);
    }
  });

  it("every flow handoff (next) points at a real starter pipeline + flow", () => {
    const byId = new Map(STARTER_PIPELINES.map((p) => [p.id, p]));
    for (const p of STARTER_PIPELINES) for (const f of pipelineFlows(p)) {
      if (!f.next) continue;
      const target = byId.get(f.next.pipeline);
      expect(target, `${p.id}/${f.id} → missing pipeline ${f.next.pipeline}`).toBeTruthy();
      expect(pipelineFlows(target).some((tf) => tf.id === f.next.flow), `${p.id}/${f.id} → missing flow ${f.next.flow}`).toBe(true);
    }
  });

  it("the research → product spec → engineering chain is wired", () => {
    const next = (pid, fid) => pipelineFlows(STARTER_PIPELINES.find((p) => p.id === pid)).find((f) => f.id === fid).next;
    expect(next("strategy", "deep-research")).toEqual({ pipeline: "product", flow: "product-spec" });
    expect(next("product", "product-spec")).toEqual({ pipeline: "engineering", flow: "dissection" });
    expect(next("product", "feedback-roadmap")).toEqual({ pipeline: "engineering", flow: "feature" });
  });

  it("seeded specs have valid shape (key present; value may be empty for the user to fill)", () => {
    for (const p of STARTER_PIPELINES) for (const f of pipelineFlows(p)) for (const s of f.stages) {
      for (const sp of s.specs || []) {
        expect(typeof sp.key, `${p.id}/${f.id}/${s.id}`).toBe("string");
        expect(sp.key.length).toBeGreaterThan(0);
        expect(typeof sp.value).toBe("string");
      }
    }
  });

  it("planning/breakdown stages carry the mandatory plan-board shell gate", () => {
    const find = (pid, fid, sid) => pipelineFlows(STARTER_PIPELINES.find((p) => p.id === pid)).find((f) => f.id === fid).stages.find((s) => s.id === sid);
    for (const st of [find("engineering", "full-sdlc", "planning"), find("product", "product-spec", "ps-breakdown")]) {
      expect(st.shell.some((c) => c.includes("plan board is empty"))).toBe(true);
      expect(st.systemPrompt).toContain("creation-guide.md");
      expect(st.systemPrompt).toContain("est");
      expect(st.outputs.some((o) => o.type === "issue")).toBe(true);
    }
    // dissect also emits plan items with estimates
    const dissect = find("engineering", "dissection", "dissect");
    expect(dissect.systemPrompt).toContain("creation-guide.md");
    expect(dissect.systemPrompt).toContain("est");
  });

  it("system prompts never leak between stages: each names its own output files", () => {
    for (const p of STARTER_PIPELINES) for (const f of pipelineFlows(p)) for (const s of f.stages) {
      const named = (s.outputs || []).filter((o) => /\.\w+$/.test(o.name || ""));  // concrete files only
      for (const o of named) {
        const base = o.name.split("/").pop();
        expect(s.systemPrompt.includes(base), `${p.id}/${f.id}/${s.id} prompt doesn't mention ${base}`).toBe(true);
      }
    }
  });
});

/* ───────────────────────── CLI tool registry ───────────────────────── */

describe("CLI_TOOLS", () => {
  it("claude, opencode, codex and gemini are registered with arg builders", () => {
    const ids = CLI_TOOLS.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["claude", "opencode", "codex", "gemini"]));
    for (const t of CLI_TOOLS) {
      const args = t.args({ prompt: "P", system: "S", model: "M" });
      expect(args.join(" ")).toContain("P");
      expect(args.join(" ")).toContain("M");
    }
  });
});

describe("buildFileTree (#8 — git-PR file explorer)", () => {
  const f = (path, add = 1, del = 0) => ({ path, add, del });

  it("nests files under their folders, dirs before files, alpha-sorted", () => {
    const t = buildFileTree([f("src/b.js"), f("src/a.js"), f("README.md")]);
    expect(t.dirs.map((d) => d.name)).toEqual(["src"]);
    expect(t.files.map((x) => x.name)).toEqual(["README.md"]);   // root-level file
    expect(t.dirs[0].files.map((x) => x.name)).toEqual(["a.js", "b.js"]);
  });

  it("collapses single-child directory chains like GitHub", () => {
    const t = buildFileTree([f("a/b/c/deep.js")]);
    expect(t.dirs).toHaveLength(1);
    expect(t.dirs[0].name).toBe("a/b/c");            // whole chain in one row
    expect(t.dirs[0].files.map((x) => x.name)).toEqual(["deep.js"]);
  });

  it("stops collapsing when a directory branches", () => {
    const t = buildFileTree([f("a/b/x.js"), f("a/c/y.js")]);
    expect(t.dirs.map((d) => d.name)).toEqual(["a"]);
    expect(t.dirs[0].dirs.map((d) => d.name)).toEqual(["b", "c"]);
  });

  it("preserves each file's original fields plus a leaf name, and handles empty input", () => {
    const t = buildFileTree([f("src/app.js", 4, 2)]);
    expect(t.dirs[0].files[0]).toMatchObject({ path: "src/app.js", add: 4, del: 2, name: "app.js" });
    expect(buildFileTree([])).toEqual({ dirs: [], files: [] });
    expect(buildFileTree(undefined)).toEqual({ dirs: [], files: [] });
  });
});
