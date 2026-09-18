// @vitest-environment jsdom
// Regression: "every flow stage floor should be in auto advance by default" —
// 1) opening a task WITH work remaining kicks off auto-advance on its own (no
// switch click), and 2) the run-log pane survives navigating away and back
// (the module store retains it, and a still-live background run is shown
// without silently restarting). Both assertions fail against the old code:
// automate() was only reachable via the switch, and TaskDetail wiped its log
// on every task change.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TaskDetail } from "../features/task.jsx";
import { __resetLogs } from "../lib/autolog.js";

const api = vi.hoisted(() => ({
  getPlan: vi.fn(), getTimeline: vi.fn(), getContext: vi.fn(), fetchTime: vi.fn(),
  getBlast: vi.fn(), getModels: vi.fn(), getBranches: vi.fn(), automate: vi.fn(),
  runStage: vi.fn(), stopRun: vi.fn(), saveTime: vi.fn(), finalize: vi.fn(), openEditor: vi.fn(),
}));
vi.mock("../api/client.js", () => api);
// term/diff pull in xterm (a dynamic import of @xterm/addon-ligatures that
// vitest's resolver chokes on) and heavyweight diff machinery — stub them so
// their modules are never actually transformed/loaded in this test.
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));
vi.mock("../features/diff.jsx", () => ({ DiffView: () => null, FileModal: () => null }));

// bare jsdom `localStorage` is present in these test runners, but guard anyway
function stubLocalStorage() {
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) {}
  return s;
}

const pipeline = { id: "eng", label: "Engineering", flows: [], stages: [
  { id: "planning", name: "Planning", tool: "opencode", hint: "", systemPrompt: "", outputs: [], shell: [], gate: "Output reviewed", auto: true },
  { id: "build", name: "Build", tool: "opencode", hint: "", systemPrompt: "", outputs: [], shell: [], gate: "Output reviewed", auto: true },
] };
const task = { id: "t506", title: "Staging floor", flow: "", stages: ["planning", "build"], tracking: {}, branch: "feat/t506", status: "open" };
const tools = [{ id: "opencode", label: "opencode", available: true }];
const noop = () => {};
const baseProps = { dir: "/repo", proj: { pipelines: [] }, pipeline, task, tools, runningStages: new Set(), flash: noop, onBack: noop, onChange: noop, onOpenTask: noop, onExpandSide: noop, collapsed: false };

let host;
let pendings = [];
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  pendings.push({ promise, resolve });
  return { promise, resolve };
};

function mount(props = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  host.root = createRoot(host);
  act(() => host.root.render(<TaskDetail {...baseProps} {...props} />));
}
function remount(props) {
  act(() => {
    host.root.unmount();
    host.root = createRoot(host);
    host.root.render(<TaskDetail {...baseProps} {...props} />);
  });
}

beforeEach(() => {
  stubLocalStorage();
  Object.values(api).forEach((f) => f.mockClear());
  api.getPlan.mockResolvedValue({ plan: { deps: {}, milestones: [], pos: {}, links: {} } });
  api.getTimeline.mockResolvedValue({ commits: [] });
  api.getContext.mockResolvedValue({ text: "# Staging floor\n\nBuild a staging floor on every floor." });
  api.fetchTime.mockResolvedValue({ time: {} });
  api.getBlast.mockResolvedValue({ ok: true, seeds: [], impacted: [], edges: [] });
  api.getModels.mockResolvedValue({ models: [] });
  api.getBranches.mockResolvedValue({ branches: [] });
  api.automate.mockImplementation((_dir, _bodies, onEvent) => {
    onEvent({ t: "out", d: "measuring the floor…" });
    return defer().promise;   // hold the run open so the pane stays live
  });
});

afterEach(() => {
  pendings.forEach((p) => p.resolve({ ok: true, exit: 0 }));
  pendings = [];
  if (host) {
    act(() => host.root.unmount());
    host.remove();
    host = null;
  }
  __resetLogs();
});

describe("auto-advance on by default", () => {
  it("opens a task with stages left and starts advancing on its own, log pane showing the run", async () => {
    mount();
    await vi.waitFor(() => expect(api.automate).toHaveBeenCalled());
    // every stage of the task is sent (the server resumes from the first undone)
    expect(api.automate.mock.calls[0][1].stages).toHaveLength(2);
    // the pane is up, labeled as advancing, streaming the runner's output
    const pane = host.querySelector(".term");
    expect(pane).toBeTruthy();
    expect(pane.textContent).toContain("measuring the floor");
    expect(pane.parentElement.querySelector(".side-label").textContent).toMatch(/Auto-advancing/);
  });

  it("does NOT auto-start a finalized task with stages still open", async () => {
    mount({ task: { ...task, finalized: true } });
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });   // let any (wrong) auto-start land
    expect(api.automate).not.toHaveBeenCalled();
  });

  it("does NOT auto-start an all-done task", async () => {
    mount({ task: { ...task, tracking: { planning: { status: "done" }, build: { status: "done" } } } });
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(api.automate).not.toHaveBeenCalled();
  });
});

describe("the run log survives navigation", () => {
  it("keeps showing the background run after leaving the task and coming back, without restarting it", async () => {
    mount();
    await vi.waitFor(() => expect(api.automate).toHaveBeenCalledTimes(1));

    // navigate away (TaskDetail unmounts) …
    act(() => host.root.unmount());

    // … and come back while the run is STILL LIVE in the background
    remount({ runningStages: new Set(["eng/t506/planning"]) });
    const pane = host.querySelector(".term");
    expect(pane).toBeTruthy();                       // pane is up without needing a new run
    expect(pane.textContent).toContain("measuring the floor");   // the log was retained
    expect(pane.parentElement.querySelector(".side-label").textContent).toMatch(/LIVE RUN/);
    expect(api.automate).toHaveBeenCalledTimes(1);   // a live run → nothing restarted
  });

  it("restarts advancing on re-open only when nothing is live anymore", async () => {
    mount();
    await vi.waitFor(() => expect(api.automate).toHaveBeenCalledTimes(1));
    act(() => host.root.unmount());
    // run finished while we were away: no live stages, work remains → start again
    remount({ runningStages: new Set() });
    await vi.waitFor(() => expect(api.automate).toHaveBeenCalledTimes(2));
    expect(host.querySelector(".term").textContent).toContain("measuring the floor");
  });
});