// REPRO (stage: repro, task #40) — the pipeline Kanban renders EVERY derived
// column, including stages no task currently sits in. There is no setting /
// toggle to hide the empty ones. Delete after the fix stage lands its own test.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
// The terminal drawer is never opened in this repro; stub it so the test does
// not drag xterm.js (and its browser-only addons) into the node environment.
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));
const { Board } = await import("../features/board.jsx");

globalThis.localStorage = (globalThis.localStorage && typeof globalThis.localStorage.getItem === "function")
  ? globalThis.localStorage
  : { getItem: () => null, setItem: () => {} };

// A realistic pipeline: 6 stages in the flow, only 2 of them occupied.
const pipeline = {
  id: "engineering",
  label: "Engineering",
  stages: [
    { id: "research", name: "Research" },
    { id: "plan", name: "Plan" },
    { id: "repro", name: "Reproduce" },
    { id: "fix", name: "Fix" },
    { id: "fix-review", name: "Fix review" },
    { id: "ship", name: "Ship" },
  ],
  flows: [],
  tasks: [
    { id: "t1", title: "Hide empty kanban columns", ref: 40, branch: "bridza/engineering/t1",
      progress: 30, stages: ["repro", "fix", "fix-review"], tracking: { repro: { status: "running" } } },
    { id: "t2", title: "Claude runner hangs", ref: 87, branch: "bridza/engineering/t2",
      progress: 60, stages: ["research", "plan", "fix"], tracking: { research: { status: "done" }, plan: { status: "running" } } },
  ],
};

const html = renderToStaticMarkup(
  <Board dir="/tmp/repo" pipeline={pipeline} runningTasks={new Set()} onOpen={() => {}} onNewTask={() => {}} onFlow={() => {}} onChange={() => {}} />
);
const headers = [...html.matchAll(/class="kcol-h"[^>]*><span[^>]*>([^<]*)<\/span><span class="n">(\d+)</g)]
  .map((m) => `${m[1]}(${m[2]})`);
const emptyPlaceholders = (html.match(/kcol-empty/g) || []).length;

describe("REPRO #40 — Kanban shows columns with no cards", () => {
  it("observed: every stage column is rendered, empty ones included", () => {
    console.log("columns rendered:", headers.join(" | "));
    console.log('"—" empty placeholders:', emptyPlaceholders);
    expect(headers).toEqual([
      "Research(0)", "Plan(1)", "Reproduce(1)", "Fix(0)", "Fix review(0)", "Ship(0)", "Delivered(0)", "Archived(0)",
    ]);
    expect(emptyPlaceholders).toBe(6); // 6 of 8 columns are pure noise
  });

  it("expected: only columns holding at least one card are rendered by default", () => {
    expect(headers).toEqual(["Plan(1)", "Reproduce(1)"]);
  });

  it("expected: a toggle exists on the pipeline view to show all columns", () => {
    expect(/show all columns/i.test(html)).toBe(true);
  });
});
