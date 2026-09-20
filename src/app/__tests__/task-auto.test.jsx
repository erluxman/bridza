// @vitest-environment jsdom
// Regression #39: opening a task must never START anything. Auto-advance is a
// SETTING (on by default, per task): once a stage the user ran by hand finishes,
// it carries the task forward through the stages AFTER it — it can never reach
// back into the first stage, and turning the switch off stops the chaining.
// Plus (#13, kept): the run-log pane survives navigating away and back, and a
// still-live background run is shown without restarting it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TaskDetail } from "../features/task.jsx";
import { __resetLogs } from "../lib/autolog.js";

const api = vi.hoisted(() => ({
  getPlan: vi.fn(), getTimeline: vi.fn(), getContext: vi.fn(), fetchTime: vi.fn(),
  getBlast: vi.fn(), getModels: vi.fn(), getBranches: vi.fn(), automate: vi.fn(),
  runStage: vi.fn(), stopRun: vi.fn(), saveTime: vi.fn(), finalize: vi.fn(), openEditor: vi.fn(), attachRun: vi.fn(),
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
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
// open a stage card by its header, so its runner (and ▸ Run button) is on screen
const openStage = (name) => click([...host.querySelectorAll(".stage-hd")].find((h) => h.textContent.startsWith(name)));
// press ▸ Run on the stage that's open — the only way to START work in a task
async function runOpenStage() {
  const btn = host.querySelector(".stage-run .btn.primary");
  await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
const autoSwitch = () => host.querySelector(".topbar .switch input[type=checkbox]");

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
  api.runStage.mockImplementation((_dir, body, onEvent) => {
    onEvent({ t: "out", d: "measuring the floor…" });
    // the server answers like the real one: a done stage with a chain says so
    return Promise.resolve({ status: "done", exit: 0, advancing: body.advance && body.advance.length ? body.advance.length : undefined });
  });
  // nothing live on the server unless a test says otherwise
  api.attachRun.mockImplementation((_dir, _body, onEvent) => { const e = { t: "end", none: true }; onEvent(e); return Promise.resolve(e); });
});
// the `advance` chain a ▸ Run press handed the server (stage ids), per call
const advanced = (i = 0) => (api.runStage.mock.calls[i][1].advance || []).map((s) => s.stage);

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

describe("opening a task starts nothing", () => {
  it("opens a task with every stage still to run and starts NO run at all", async () => {
    mount();
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });   // let any (wrong) auto-start land
    expect(api.automate).not.toHaveBeenCalled();
    expect(api.runStage).not.toHaveBeenCalled();
    // the setting is still on by default — it just doesn't start anything
    expect(autoSwitch().checked).toBe(true);
  });

  it("opens a half-done task (first stage already done) and still starts nothing", async () => {
    mount({ task: { ...task, tracking: { planning: { status: "done" } } } });
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(api.automate).not.toHaveBeenCalled();
    expect(api.runStage).not.toHaveBeenCalled();
  });

  it("does NOT auto-start a finalized task with stages still open", async () => {
    mount({ task: { ...task, finalized: true } });
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(api.automate).not.toHaveBeenCalled();
  });

  it("does NOT auto-start an all-done task", async () => {
    mount({ task: { ...task, tracking: { planning: { status: "done" }, build: { status: "done" } } } });
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(api.automate).not.toHaveBeenCalled();
  });
});

describe("auto-advance chains FORWARD from a stage you started — the chain is handed to the server with the run", () => {
  it("carries on after the first stage is run by hand — sending only the stages after it", async () => {
    mount();
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await runOpenStage();   // ▸ Run on Planning — the explicit start
    expect(api.runStage).toHaveBeenCalledTimes(1);
    expect(advanced()).toEqual(["build"]);           // never back into the first stage
    expect(api.automate).not.toHaveBeenCalled();     // no second request: the server carries on by itself
    // the chain's bodies are full run bodies, like Automate's
    expect(api.runStage.mock.calls[0][1].advance[0]).toMatchObject({ pipeline: "eng", task: "t506", stage: "build", stageName: "Build" });
    expect(host.querySelector(".term").textContent).toMatch(/continue on the server/);
  });

  it("never reaches back: running a middle stage advances forward only, skipping the unrun first stage", async () => {
    const three = ["planning", "build", "review"];
    mount({
      pipeline: { ...pipeline, stages: [...pipeline.stages, { id: "review", name: "Review", tool: "opencode", hint: "", systemPrompt: "", outputs: [], shell: [], gate: "", auto: true }] },
      task: { ...task, stages: three },
    });
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    openStage("Build");                 // Planning has never run
    await runOpenStage();
    expect(advanced()).toEqual(["review"]);
  });

  it("does not advance past the LAST stage", async () => {
    // Planning done → Build (the last stage) is the one open on arrival
    mount({ task: { ...task, tracking: { planning: { status: "done" } } } });
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await runOpenStage();
    expect(advanced()).toEqual([]);
    expect(api.automate).not.toHaveBeenCalled();
  });

  it("a failed stage shows why, and starts nothing more here (the server decides the chain)", async () => {
    api.runStage.mockResolvedValue({ status: "failed", exit: 1, error: "nope: provider quota" });
    mount();
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await runOpenStage();
    await act(async () => { await Promise.resolve(); });
    expect(api.automate).not.toHaveBeenCalled();
    expect(host.querySelector(".stage-run .term").textContent).toContain("✖ nope: provider quota");
  });
});

describe("a refresh mid-run: the page re-attaches to the run on the server", () => {
  it("shows the live run's text so far, keeps ▸ Run disabled, streams on, and frees the button at its end", async () => {
    let finish;
    api.attachRun.mockImplementation((_dir, body, onEvent) => {
      expect(body).toMatchObject({ pipeline: "eng", task: "t506", stage: "planning" });
      onEvent({ t: "replay", live: true, log: "measuring the floor…\n", startedAt: new Date().toISOString(), tool: "opencode", wallSeconds: 3 });
      return new Promise((r) => { finish = (end) => { onEvent(end); r(end); }; });
    });
    mount({ runningStages: new Set(["eng/t506/planning"]) });
    await vi.waitFor(() => expect(api.attachRun).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    const btn = host.querySelector(".stage-run .btn.primary");
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Running…");
    expect(host.querySelector(".stage-run .term").textContent).toContain("measuring the floor");
    // the task-level pane is up too, labelled live, with the replayed text
    const pane = host.querySelector(".card .term");
    expect(pane.parentElement.querySelector(".side-label").textContent).toMatch(/LIVE RUN/);
    expect(pane.textContent).toContain("reattached");
    expect(api.runStage).not.toHaveBeenCalled();     // attached, not restarted
    await act(async () => { finish({ t: "end", status: "done", exit: 0, advancing: 1 }); await Promise.resolve(); });
    expect(host.querySelector(".stage-run .btn.primary").disabled).toBe(false);
    expect(host.querySelector(".stage-run .term").textContent).toMatch(/1 stage\(s\) continue on the server/);
  });

  it("a run that failed while the page was away shows its text and the reason, without touching ▸ Run", async () => {
    api.attachRun.mockImplementation((_dir, _body, onEvent) => {
      onEvent({ t: "replay", live: false, log: "[agent] thinking\n" });
      const end = { t: "end", replayed: true, status: "failed", exit: 1, error: "tool exited with code 1" };
      onEvent(end); return Promise.resolve(end);
    });
    mount();
    await vi.waitFor(() => expect(api.attachRun).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    const term = host.querySelector(".stage-run .term");
    expect(term.textContent).toContain("[agent] thinking");
    expect(term.textContent).toContain("✖ tool exited with code 1");
    expect(host.querySelector(".stage-run .btn.primary").disabled).toBe(false);
    expect(api.runStage).not.toHaveBeenCalled();
    // …and the stage header says failed, not idle (failed runs are never committed)
    expect(host.querySelector(".stage-hd .tag").textContent).toMatch(/failed/i);
  });
});

describe("the auto-advance setting", () => {
  it("is off once you turn it off — a finished stage then chains nothing, and it is remembered", async () => {
    mount();
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await click(autoSwitch());
    expect(autoSwitch().checked).toBe(false);
    await runOpenStage();
    await act(async () => { await Promise.resolve(); });
    expect(api.runStage).toHaveBeenCalledTimes(1);   // the stage the user asked for ran
    expect(advanced()).toEqual([]);                  // nothing chained after it
    expect(api.automate).not.toHaveBeenCalled();

    remount({});                                     // reopening the task keeps it off
    expect(autoSwitch().checked).toBe(false);
    await runOpenStage();
    await act(async () => { await Promise.resolve(); });
    expect(advanced(1)).toEqual([]);
  });
});

describe("the run log survives navigation", () => {
  it("keeps showing the background run after leaving the task and coming back, without restarting it", async () => {
    mount();
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await runOpenStage();
    expect(api.runStage).toHaveBeenCalledTimes(1);

    // navigate away (TaskDetail unmounts) …
    act(() => host.root.unmount());

    // … and come back while the run is STILL LIVE in the background
    remount({ runningStages: new Set(["eng/t506/planning"]) });
    const pane = host.querySelector(".term");
    expect(pane).toBeTruthy();                       // pane is up without needing a new run
    expect(pane.textContent).toContain("measuring the floor");   // the log was retained
    expect(pane.parentElement.querySelector(".side-label").textContent).toMatch(/LIVE RUN/);
    expect(api.runStage).toHaveBeenCalledTimes(1);   // a live run → nothing restarted
    expect(api.automate).not.toHaveBeenCalled();
  });

  it("does NOT restart advancing on re-open once the run has stopped — reopening is never a start", async () => {
    mount();
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await runOpenStage();
    expect(api.runStage).toHaveBeenCalledTimes(1);
    act(() => host.root.unmount());
    // run stopped while we were away: work remains, nothing live — still no restart
    remount({ runningStages: new Set() });
    await act(async () => { await Promise.resolve(); });
    expect(api.runStage).toHaveBeenCalledTimes(1);
    expect(api.automate).not.toHaveBeenCalled();
    expect(host.querySelector(".term").textContent).toContain("measuring the floor");   // the log is still there
  });
});