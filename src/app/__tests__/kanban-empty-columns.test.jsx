// @vitest-environment jsdom
// A pipeline's stage union is wide (18 columns on this repo's own `engineering`
// pipeline, 13 of them empty), so the board renders only the columns holding a
// card unless "Show all columns" is ticked. The choice is per pipeline and has
// to survive a reload — it is read back from localStorage on mount.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
// the terminal drawer would drag xterm.js (browser-only) into the test
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));
const { Board } = await import("../features/board.jsx");

// Node's bare `localStorage` global is inert here — back it with a real map,
// the same way welcome-dialog.test.jsx does.
function stubLocalStorage() {
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) {}
  return s;
}

const pipeline = {
  id: "engineering",
  label: "Engineering",
  stages: [
    { id: "research", name: "Research" },
    { id: "plan", name: "Plan" },
    { id: "repro", name: "Reproduce" },
    { id: "fix", name: "Fix" },
    { id: "ship", name: "Ship" },
  ],
  flows: [],
  tasks: [
    { id: "t1", title: "Hide empty kanban columns", branch: "bridza/engineering/t1",
      progress: 30, stages: ["repro", "fix"], tracking: { repro: { status: "running" } } },
    { id: "t2", title: "Claude runner hangs", branch: "bridza/engineering/t2",
      progress: 60, stages: ["research", "plan"], tracking: { research: { status: "done" }, plan: { status: "running" } } },
  ],
};
const ALL = ["Research", "Plan", "Reproduce", "Fix", "Ship", "Delivered", "Archived"];
const OCCUPIED = ["Plan", "Reproduce"];

let host, root, store;
// a fresh mount is the reload: the toggle's initial state comes from storage
function mount() {
  if (root) act(() => root.unmount());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(
    <Board dir="/tmp/repo" pipeline={pipeline} runningTasks={new Set()} onOpen={() => {}} onNewTask={() => {}} onFlow={() => {}} onChange={() => {}} />
  ));
}
const headers = () => [...host.querySelectorAll(".kcol-h > span:first-child")].map((el) => el.textContent);
const checkbox = () => host.querySelector('.topbar input[type="checkbox"]');

describe("kanban — hiding empty columns", () => {
  beforeEach(() => { store = stubLocalStorage(); });
  afterEach(() => { act(() => root.unmount()); root = null; host.remove(); });

  it("renders only the columns holding a card by default", () => {
    mount();
    expect(headers()).toEqual(OCCUPIED);
    expect(checkbox().checked).toBe(false);
  });

  it("renders every column once the toggle is ticked", () => {
    mount();
    act(() => checkbox().click());
    expect(headers()).toEqual(ALL);
  });

  it("keeps the choice across a reload, and unticking brings the hiding back", () => {
    // regression: the toggle wrote "1"/"0" while the reader compared against
    // "true", so the preference silently reset to off on every reload.
    mount();
    act(() => checkbox().click());
    mount();
    expect(checkbox().checked).toBe(true);
    expect(headers()).toEqual(ALL);

    act(() => checkbox().click());
    mount();
    expect(checkbox().checked).toBe(false);
    expect(headers()).toEqual(OCCUPIED);
  });

  it("scopes the choice to one pipeline", () => {
    mount();
    act(() => checkbox().click());
    expect([...store.getItem("bridza.showAllColumns.engineering")]).toEqual(["1"]);
    expect(store.getItem("bridza.showAllColumns.design")).toBe(null);
  });
});
