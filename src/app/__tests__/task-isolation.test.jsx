// @vitest-environment jsdom
// #106 — one tab, two tasks: switching the task detail from A to B must carry
// NOTHING of A along (open stage, clock, conflict dialog, diff, typed prompt).
// App.jsx keys <TaskDetail> by pipeline/task so the swap below is a remount;
// these tests re-render the SAME element position with a new `task` prop and
// assert that a fresh instance came up — the way a user sees it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TaskDetail } from "../features/task.jsx";
import { __resetLogs } from "../lib/autolog.js";

const api = vi.hoisted(() => ({
  getPlan: vi.fn(), getTimeline: vi.fn(), getContext: vi.fn(), fetchTime: vi.fn(),
  getBlast: vi.fn(), getModels: vi.fn(), getBranches: vi.fn(), automate: vi.fn(),
  runStage: vi.fn(), stopRun: vi.fn(), saveTime: vi.fn(), finalize: vi.fn(), openEditor: vi.fn(),
  finishConflict: vi.fn(), abortConflict: vi.fn(), openConflict: vi.fn(), setStageRouting: vi.fn(),
}));
vi.mock("../api/client.js", () => api);
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));
// record the props the diff/file modals are mounted with — that is where the
// leak becomes an actual wrong-file / wrong-commit read.
const seen = vi.hoisted(() => ({ diff: [], file: [] }));
vi.mock("../features/diff.jsx", () => ({
  DiffView: (p) => { seen.diff.push(p); return null; },
  FileModal: (p) => { seen.file.push(p); return null; },
}));

function stubLocalStorage() {
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) {}
  return s;
}

// one pipeline, four stage defs — task A uses two of them, task B the other two
const pipeline = { id: "eng", label: "Engineering", flows: [], stages: [
  { id: "planning", name: "Planning", tool: "opencode", hint: "", systemPrompt: "", outputs: [], shell: [], auto: true },
  { id: "build", name: "Build", tool: "opencode", hint: "", systemPrompt: "", outputs: [], shell: [], auto: true },
  { id: "repro", name: "Repro", tool: "opencode", hint: "", systemPrompt: "", outputs: [], shell: [], auto: true },
  { id: "fix", name: "Fix", tool: "opencode", hint: "", systemPrompt: "", outputs: [], shell: [], auto: true },
] };
const taskA = { id: "t-alpha", title: "Alpha", flow: "", stages: ["planning", "build"], tracking: {}, branch: "feat/alpha", status: "open", target: "main" };
const taskB = { id: "t-bravo", title: "Bravo", flow: "", stages: ["repro", "fix"], tracking: {}, branch: "feat/bravo", status: "open", target: "main" };
const tools = [{ id: "opencode", label: "opencode", available: true }];
const noop = () => {};
const baseProps = { dir: "/repo", proj: { pipelines: [] }, pipeline, tools, runningStages: new Set(), flash: noop, onBack: noop, onChange: noop, onOpenTask: noop, onExpandSide: noop, collapsed: false };

let host;
function mount(task) {
  host = document.createElement("div");
  document.body.appendChild(host);
  host.root = createRoot(host);
  act(() => host.root.render(<TaskDetail key={"eng/" + task.id} {...baseProps} task={task} />));
}
// what clicking another task in the sidebar does: same position, new prop —
// and, keyed like App.jsx, a new instance.
function swapTo(task) {
  act(() => host.root.render(<TaskDetail key={"eng/" + task.id} {...baseProps} task={task} />));
}
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const byText = (sel, text) => [...host.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
const openStageCard = (name) => click([...host.querySelectorAll(".stage-hd")].find((h) => h.textContent.startsWith(name)));
const openStageNames = () => [...host.querySelectorAll(".stage")].filter((s) => s.querySelector(".stage-body")).map((s) => s.querySelector("b").textContent);

beforeEach(() => {
  stubLocalStorage();
  seen.diff.length = 0; seen.file.length = 0;
  Object.values(api).forEach((f) => f.mockClear());
  api.getPlan.mockResolvedValue({ plan: { deps: {}, milestones: [], pos: {}, links: {} } });
  api.getTimeline.mockResolvedValue({ commits: [] });
  api.getContext.mockResolvedValue({ text: "# Alpha\n\nbrief" });
  api.fetchTime.mockResolvedValue({ time: {} });
  api.getBlast.mockResolvedValue({ ok: true, seeds: [], impacted: [], edges: [] });
  api.getModels.mockResolvedValue({ models: [] });
  api.getBranches.mockResolvedValue({ branches: ["main"] });
  api.saveTime.mockResolvedValue({ ok: true });
  api.finishConflict.mockResolvedValue({ ok: true, target: "main" });
});

afterEach(() => {
  if (host) { act(() => host.root.unmount()); host.remove(); host = null; }
  __resetLogs();
  vi.useRealTimers();
});

describe("#106 — switching tasks in the detail screen carries nothing across", () => {
  it("A: the open stage carries over, so task B opens with a stage it does not have", async () => {
    mount(taskA);
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    openStageCard("Build");
    expect(openStageNames()).toEqual(["Build"]);

    swapTo(taskB);
    await act(async () => { await Promise.resolve(); });
    // task B's stages are Repro/Fix. Expected: its first unfinished stage,
    // "Repro", is the open one. Observed: openStage is still "build", which
    // matches nothing in B — B renders with every card collapsed.
    expect(openStageNames()).toEqual(["Repro"]);
  });

  it("B: the leaked open stage bills task A's stage id into task B's time file", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount(taskA);
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    openStageCard("Build");
    swapTo(taskB);
    // let task B's own time hydration land first, so what follows is purely
    // the leaked open stage ticking
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    api.saveTime.mockClear();
    // one second at a time, so React flushes its passive effects between
    // ticks the way a real browser does
    for (let i = 0; i < 11; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    const write = api.saveTime.mock.calls.find((c) => c[2] === "t-bravo");
    expect(write, "task B should have flushed its time").toBeTruthy();
    // Observed: { build: 11, __idle: {...} } — "build" is task A's stage, now
    // recorded in task B's .bridza/.cache/time.json.
    const keys = Object.keys(write[3]).filter((k) => k !== "__idle");
    expect(keys.every((k) => taskB.stages.includes(k)), `time keys ${JSON.stringify(keys)} must all be stages of task B`).toBe(true);
  });

  it("C: a paused merge conflict from task A stays open over task B and finishes against B", async () => {
    api.finalize.mockResolvedValue({ conflict: true, files: ["core/domain.js"], dir: "/repo/.bridza/wt/alpha", target: "main" });
    mount(taskA);
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await act(async () => { await click(byText(".topbar .btn", "Finalize")); });
    expect(host.querySelector(".diffwin")).toBeTruthy();   // ConflictDialog is up

    swapTo(taskB);
    await act(async () => { await Promise.resolve(); });
    // Expected: task A's conflict dialog is not part of task B's screen.
    expect(host.querySelector(".diffwin"), "conflict dialog from task A is still mounted over task B").toBeNull();
  });

  it("C2: …and pressing “Finish merge” after the swap posts task A's worktree with task B's id", async () => {
    api.finalize.mockResolvedValue({ conflict: true, files: ["core/domain.js"], dir: "/repo/.bridza/wt/alpha", target: "main" });
    mount(taskA);
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await act(async () => { await click(byText(".topbar .btn", "Finalize")); });
    swapTo(taskB);
    await act(async () => { await Promise.resolve(); });
    const finish = byText(".diffwin .btn.primary", "Finish merge");
    if (finish) await act(async () => { await click(finish); });
    // Observed: { dir: "/repo/.bridza/wt/alpha", pipeline: "eng", task: "t-bravo", target: "main" }
    // — task A's paused merge, attributed to task B.
    expect(api.finishConflict).not.toHaveBeenCalled();
  });

  it("D: a diff opened on task A's commit re-renders against task B", async () => {
    api.getTimeline.mockResolvedValue({ commits: [{ sha: "aaaaaaaaaaaa", subject: "bridza(eng): planning: done", stage: "planning", kind: "done", date: new Date().toISOString(), files: [] }] });
    mount(taskA);
    await vi.waitFor(() => expect(api.getTimeline).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    await click(host.querySelector(".timeline .tl.click"));
    expect(seen.diff.length).toBeGreaterThan(0);

    seen.diff.length = 0;
    swapTo(taskB);
    await act(async () => { await Promise.resolve(); });
    // Expected: no diff modal for task B. Observed: DiffView is still mounted,
    // now with commit=aaaaaaa (task A's) but task="t-bravo".
    const bad = seen.diff.filter((p) => p.task === "t-bravo" && p.commit === "aaaaaaaaaaaa");
    expect(bad, "task A's commit is being diffed under task B").toEqual([]);
  });

  it("E: the task-detail view mode is one global localStorage key, shared by every task and every tab", async () => {
    mount(taskA);
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    await click(byText(".topbar .seg button", "Canvas"));
    expect(localStorage.getItem("bridza.taskView:/repo|eng/t-alpha")).toBe("canvas");
    act(() => host.root.unmount());
    host.remove();

    // a second window/tab opening a DIFFERENT task reads the same key
    mount(taskB);
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    const on = [...host.querySelectorAll(".topbar .seg button")].find((b) => b.className === "on");
    expect(on.textContent, "task B opened in the view task A was left in").toBe("Stages");
  });
  it("F: two tasks that share an id in different pipelines keep each other's prompt, agent and model", async () => {
    // StageRunner re-seeds on [task.id, def.id] — the pipeline is not in the
    // dependency list, so a same-id task in another pipeline is "the same
    // stage" as far as that effect is concerned.
    const pipeA = { ...pipeline, id: "eng", label: "Engineering" };
    const pipeB = { ...pipeline, id: "design", label: "Design" };
    const same = { ...taskA, id: "login-form", title: "Login form", stages: ["build"] };
    host = document.createElement("div");
    document.body.appendChild(host);
    host.root = createRoot(host);
    act(() => host.root.render(<TaskDetail key={"eng/" + same.id} {...baseProps} pipeline={pipeA} task={same} />));
    await vi.waitFor(() => expect(api.getContext).toHaveBeenCalled());
    const ta = host.querySelector(".stage-run textarea");   // "build" is the only stage — open already
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), "value").set;
      setter.call(ta, "ENG-ONLY: wire the engineering login form");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".stage-run textarea").value).toContain("ENG-ONLY");

    act(() => host.root.render(<TaskDetail key={"design/" + same.id} {...baseProps} pipeline={pipeB} task={{ ...same, title: "Login form" }} />));
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    // Expected: the Design task's Build stage seeds from its own brief.
    // Observed: the text typed against the Engineering task is still there.
    expect(host.querySelector(".stage-run textarea").value).not.toContain("ENG-ONLY");
  });
});
