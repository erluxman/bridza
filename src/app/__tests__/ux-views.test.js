// ux-views.test.js — the ux-revamp foundation: the unified stage-record adapter
// (task.tracking + git timeline → the one shape all 3 views read) and the node
// layout engine (5 arrangements). Pure functions, no repo/subprocess needed.
import { describe, it, expect } from "vitest";
import { buildStageRecords, buildGraph } from "../lib/record.js";
import { layoutNodes, LAYOUTS } from "../lib/layout.js";

const pipeline = {
  id: "eng",
  stages: [
    { id: "research", name: "Research", gate: "reviewed", tool: "claude", systemPrompt: "Be a researcher." },
    { id: "build", name: "Build", gate: "tests pass", tool: "claude", systemPrompt: "Write the code." },
  ],
};
const task = {
  id: "t506", pipeline: "eng", title: "Q3 launch microsite",
  stages: ["research", "build"],
  tracking: {
    research: { status: "done", seconds: 120, runs: [
      { tool: "claude", prompt: "do research", status: "done", exit: 0, startedAt: "2026-06-20T10:00:00Z", finishedAt: "2026-06-20T10:02:00Z", files: [], log: "found 3 competitors" },
    ] },
    build: { status: "failed", runs: [
      { tool: "claude", prompt: "build it", status: "failed", exit: 1, error: "type error", log: "TS2322" },
      { tool: "claude", prompt: "fix the type", status: "done", exit: 0, files: ["src/form.js"] },
    ] },
  },
};
const timeline = [
  { sha: "bbbb111", stage: "build", kind: "done", subject: "bridza(build): result", date: "2026-06-20T11:00:00Z", files: [{ path: "src/form.js", add: 12, del: 3 }] },
  { sha: "aaaa222", stage: "research", kind: "done", subject: "bridza(research): result", date: "2026-06-20T10:02:00Z", files: [] },
];

describe("unified stage record", () => {
  const recs = buildStageRecords(pipeline, task, timeline);

  it("produces one record per stage, in flow order", () => {
    expect(recs.map((r) => r.id)).toEqual(["research", "build"]);
    expect(recs.map((r) => r.order)).toEqual([0, 1]);
  });

  it("exposes the fields the old UI hid: response + summary, per run", () => {
    const research = recs[0];
    expect(research.latest.response).toBe("found 3 competitors");
    expect(research.latest.summary).toBeTruthy();
    expect(research.status).toBe("done");
  });

  it("keeps full run history and infers file change markers from churn", () => {
    const build = recs[1];
    expect(build.runCount).toBe(2);
    expect(build.status).toBe("failed"); // stage-level status from tracking
    const f = build.latest.files[0];
    expect(f.path).toBe("src/form.js");
    expect(f.change).toBe("M");           // add & del > 0 → modified
    expect(build.latest.commit).toBe("bbbb111");
    expect(build.summary).toMatch(/1 file/);
  });

  it("builds a sequential graph of the flow", () => {
    const g = buildGraph(recs);
    expect(g.nodes.length).toBe(2);
    expect(g.edges).toEqual([{ from: "research", to: "build" }]);
  });
});

describe("layout engine", () => {
  it("offers 5 layouts", () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(["linear", "snake", "grid", "tree", "radial"]);
  });

  it("every mode returns one position per node with a positive canvas size", () => {
    for (const { id } of LAYOUTS) {
      const { nodes, width, height } = layoutNodes(5, id);
      expect(nodes.length).toBe(5);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      nodes.forEach((p) => { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); });
    }
  });

  it("linear is a single row; snake wraps onto multiple rows", () => {
    const lin = layoutNodes(6, "linear").nodes;
    expect(new Set(lin.map((p) => p.y)).size).toBe(1);
    const snake = layoutNodes(9, "snake", { cols: 3 }).nodes;
    expect(new Set(snake.map((p) => p.y)).size).toBeGreaterThan(1);
  });

  it("handles the empty and single-node cases without NaN", () => {
    expect(layoutNodes(0, "radial").nodes).toEqual([]);
    const one = layoutNodes(1, "radial").nodes[0];
    expect(Number.isFinite(one.x) && Number.isFinite(one.y)).toBe(true);
  });
});
