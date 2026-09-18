// kanban-order.test.js — the pure column-order helpers behind dragging Kanban
// headers: stored order over the derived one, and moving a column.
import { describe, it, expect } from "vitest";
import { applyKanbanOrder, moveColumn } from "../features/kanban-order.js";

const derived = ["a", "b", "c", "__done__"];

describe("applyKanbanOrder", () => {
  it("falls back to the derived order with no stored order", () => {
    expect(applyKanbanOrder(derived, undefined)).toEqual(derived);
    expect(applyKanbanOrder(derived, [])).toEqual(derived);
  });
  it("uses a full stored order as-is", () => {
    expect(applyKanbanOrder(derived, ["__done__", "c", "a", "b"])).toEqual(["__done__", "c", "a", "b"]);
  });
  it("appends columns missing from a partial order in derived order", () => {
    expect(applyKanbanOrder(derived, ["c", "a"])).toEqual(["c", "a", "b", "__done__"]);
  });
  it("drops stale and duplicate ids", () => {
    expect(applyKanbanOrder(derived, ["gone", "b", "b", "a"])).toEqual(["b", "a", "c", "__done__"]);
  });
});

describe("moveColumn", () => {
  it("moves forward and backward without mutating the input", () => {
    const order = ["a", "b", "c", "d"];
    expect(moveColumn(order, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveColumn(order, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(order).toEqual(["a", "b", "c", "d"]);
  });
  it("is a no-op when moved to its own slot", () => {
    expect(moveColumn(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });
});
