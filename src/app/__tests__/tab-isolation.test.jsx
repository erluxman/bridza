// @vitest-environment jsdom
// #106 — two tabs, two tasks: nothing one tab does may reach the other's task.
// task-isolation.test.jsx covers one tab; this file covers the two channels
// that cross a tab/window boundary — localStorage (one store per origin) and
// the server (one process, one repo). Two tabs are modelled as two independent
// React roots in one document: separate component trees, ONE localStorage, ONE
// server — exactly what two tabs of the same origin are.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TaskDetail } from "../features/task.jsx";
import { __resetLogs } from "../lib/autolog.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeTime, taskTime } from "../../../server/bridza-store.js";

const api = vi.hoisted(() => ({
  getPlan: vi.fn(), getTimeline: vi.fn(), getContext: vi.fn(), fetchTime: vi.fn(),
  getBlast: vi.fn(), getModels: vi.fn(), getBranches: vi.fn(), automate: vi.fn(),
  runStage: vi.fn(), stopRun: vi.fn(), saveTime: vi.fn(), finalize: vi.fn(), openEditor: vi.fn(),
  finishConflict: vi.fn(), abortConflict: vi.fn(), openConflict: vi.fn(), setStageRouting: vi.fn(),
}));
vi.mock("../api/client.js", () => api);
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));
vi.mock("../features/diff.jsx", () => ({ DiffView: () => null, FileModal: () => null }));

// ONE localStorage for every tab — that is the whole point of this file.
function stubLocalStorage() {
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) { /* jsdom */ }
  return s;
}

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

// ── the two-tab harness ──────────────────────────────────────────────────────
// A "tab" is its own root in its own container. Two of them share this
// document's localStorage and the one mocked server above, and nothing else —
// exactly the sharing two real tabs have.
const tabs = [];
function openTab(task, props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const tab = { host, root, render: (t, p = {}) => act(() => root.render(<TaskDetail {...baseProps} {...props} {...p} task={t} />)) };
  tab.render(task);
  tabs.push(tab);
  return tab;
}
const settle = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const viewOn = (tab) => { const b = [...tab.host.querySelectorAll(".topbar .seg button")].find((x) => x.className === "on"); return b && b.textContent; };
const segButton = (tab, label) => [...tab.host.querySelectorAll(".topbar .seg button")].find((b) => b.textContent.includes(label));
const railHidden = (tab) => !tab.host.querySelector(".rail");
const openStageCard = (tab, name) => click([...tab.host.querySelectorAll(".stage-hd")].find((h) => h.textContent.startsWith(name)));

beforeEach(() => {
  stubLocalStorage();
  Object.values(api).forEach((f) => f.mockClear());
  api.getPlan.mockResolvedValue({ plan: { deps: {}, milestones: [], pos: {}, links: {} } });
  api.getTimeline.mockResolvedValue({ commits: [] });
  api.getContext.mockResolvedValue({ text: "# Task\n\nbrief" });
  api.fetchTime.mockResolvedValue({ time: {} });
  api.getBlast.mockResolvedValue({ ok: true, seeds: [], impacted: [], edges: [] });
  api.getModels.mockResolvedValue({ models: [] });
  api.getBranches.mockResolvedValue({ branches: ["main"] });
  api.saveTime.mockResolvedValue({ ok: true });
});

afterEach(() => {
  while (tabs.length) { const t = tabs.pop(); act(() => t.root.unmount()); t.host.remove(); }
  __resetLogs();
  vi.useRealTimers();
});

describe("#106 cross-tab — two tabs, two different tasks", () => {
  // ── G: the view mode written by tab 1 decides what tab 2 opens in ──────────
  it("G: switching task A to Canvas in tab 1 makes task B open in Canvas in tab 2", async () => {
    const tab1 = openTab(taskA);
    await settle();
    await click(segButton(tab1, "Canvas"));
    expect(localStorage.getItem("bridza.taskView:/repo|eng/t-alpha")).toBe("canvas");

    // a SECOND TAB, opened afterwards, on a DIFFERENT task: its own key, its own default.
    const tab2 = openTab(taskB);
    await settle();
    expect(viewOn(tab2), "tab 2 opened task B in the view tab 1 left task A in").toBe("Stages");
  });

  // ── H: the rail (the whole right-hand column) is global too ────────────────
  it("H: hiding the rail on task A in tab 1 hides it on task B in tab 2", async () => {
    const tab1 = openTab(taskA);
    await settle();
    const toggle = tab1.host.querySelector(".rail-toggle");
    expect(toggle, "rail toggle button").toBeTruthy();
    await click(toggle);
    expect(localStorage.getItem("bridza.railHidden:/repo|eng/t-alpha")).toBe("1");

    const tab2 = openTab(taskB);
    await settle();
    expect(railHidden(tab2), "tab 2 opened task B with the rail tab 1 hid on task A").toBe(false);
  });

  // ── I: two live tabs, each task keeps its own view ─────────────────────────
  it("I: a view change on task A in tab 1 changes nothing for task B in tab 2, and task A reopens as left", async () => {
    const tab1 = openTab(taskA);
    const tab2 = openTab(taskB);
    await settle();
    expect(viewOn(tab1)).toBe("Stages");
    expect(viewOn(tab2)).toBe("Stages");

    await click(segButton(tab1, "Canvas"));          // tab 1 → Canvas
    await settle();

    expect({ tab1: viewOn(tab1), tab2: viewOn(tab2) }).toEqual({ tab1: "Canvas", tab2: "Stages" });

    await click(segButton(tab2, "Inspector"));       // tab 2 sets task B's view…
    await settle();
    const tab3 = openTab(taskA);                     // …task A still reopens as it was left
    await settle();
    expect(viewOn(tab3), "task A reopens in the view it was left in, not task B's").toBe("Canvas");
  });

  // ── J: the same task in two tabs — the wall-clock loses time ───────────────
  it("J: two tabs on the SAME task overwrite each other's stage time instead of adding to it", async () => {
    // the REAL time store, on a temp dir — this is where two windows meet
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-tab-"));
    api.fetchTime.mockImplementation(async (_d, p, t) => ({ time: taskTime(root, p, t) }));
    api.saveTime.mockImplementation(async (_d, p, t, map) => mergeTime(root, p, t, map));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Same task open in two tabs — the everyday case: one tab on the Planning
    // stage, the other on Build, both of THIS task.
    const tab1 = openTab(taskA);
    const tab2 = openTab(taskA);
    await settle();
    // Planning is the first unfinished stage → already open in both; move tab 2 to Build
    openStageCard(tab2, "Build");
    await settle();

    // 30 seconds of wall clock: 30s spent on Planning in tab 1 and 30s on
    // Build in tab 2, with three 10s flushes from each.
    for (let i = 0; i < 30; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await settle();

    const rec = taskTime(root, "eng", "t-alpha");
    fs.rmSync(root, { recursive: true, force: true });
    // each tab posts absolute totals for its own open stage; the store keeps
    // the max per stage, so neither flush winds the other's stage back
    expect(rec.planning || 0, `planning was open 30s in tab 1; the file kept ${JSON.stringify(rec)}`).toBeGreaterThanOrEqual(28);
    expect(rec.build || 0, `build was open 30s in tab 2; the file kept ${JSON.stringify(rec)}`).toBeGreaterThanOrEqual(28);
  });

  // ── L: two tabs, two tasks, ONE committed plan.json — last write wins ──────
  it("L: a dependency added on task B in tab 2 deletes the one added on task A in tab 1", async () => {
    // a plan server with savePlan's section semantics: a section sent whole
    // replaces the stored one; with merge:true the per-task maps patch key-wise
    // (the real merge is covered in bridza-store.test.js — here the point is
    // WHAT THE CLIENT SENDS: only its own task's key, flagged merge)
    const planFile = { deps: {}, milestones: [], pos: {}, sizes: {}, links: {}, pipeDeps: [], est: {}, archive: null };
    api.getPlan.mockImplementation(async () => ({ plan: JSON.parse(JSON.stringify(planFile)) }));
    api.savePlan = vi.fn(async (_d, { merge, ...next }) => {
      for (const [k, v] of Object.entries(next)) planFile[k] = merge && !Array.isArray(v) && v && typeof v === "object" ? { ...planFile[k], ...v } : v;
      return { ok: true };
    });

    const proj = { pipelines: [{ id: "eng", label: "Engineering", tasks: [
      { ...taskA, progress: 0 }, { ...taskB, progress: 0 },
      { id: "t-charlie", title: "Charlie", stages: ["planning"], tracking: {}, progress: 0 },
    ] }] };
    const addDep = async (tab, value) => {
      const sel = [...tab.host.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.textContent.includes("add dependency")));
      expect(sel, "the add-dependency picker").toBeTruthy();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set;
        setter.call(sel, value);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    // Both tabs open BEFORE either edit — the everyday case: task A in one tab,
    // task B in another, both loaded the plan as it was.
    const tab1 = openTab(taskA, { proj });
    const tab2 = openTab(taskB, { proj });
    await settle();

    await addDep(tab1, "eng/t-charlie");           // task A now waits on Charlie
    await settle();
    expect(planFile.deps["eng/t-alpha"], "tab 1's dependency reached the file").toBeTruthy();

    await addDep(tab2, "eng/t-charlie");           // task B now waits on Charlie
    await settle();

    // both dependencies are in plan.json — two tasks, two keys, no clobber
    expect(Object.keys(planFile.deps).sort(), "tab 2's save dropped the dependency tab 1 added").toEqual(["eng/t-alpha", "eng/t-bravo"]);
    expect(api.savePlan.mock.calls.every((c) => c[1].merge === true && Object.keys(c[1].deps).length === 1), "each tab sends only its own task's key, flagged merge").toBe(true);
  });

  // ── M: nothing stops two tabs from running the SAME stage at once ─────────
  it("M: tab 2 offers ▸ Run on a stage that tab 1 is already running", async () => {
    // the server state poll tells every tab which stages are live
    // (runningStages → StageRunner `live`); Run must honour it, not just the
    // tab's own `running` flag
    const liveHere = new Set(["eng/t-alpha/planning"]);
    // "planning" is task A's first unfinished stage, so its card is open on
    // mount — the same card the run in tab 1 is using.
    const tab2 = openTab(taskA, { runningStages: liveHere });
    await settle();

    const runBtn = [...tab2.host.querySelectorAll(".stage-run .btn.primary")].find((b) => /Run/.test(b.textContent));
    expect(runBtn, "the Run button of the stage another tab is running").toBeTruthy();
    expect(runBtn.disabled, "tab 2 can start a second run of a stage tab 1 is already running").toBe(true);
  });

  // ── N: auto-advance flipped in tab 2 is followed by tab 1 ──────────────────
  it("N: turning auto-advance off for task A in tab 2 is seen by tab 1, which already has task A open", async () => {
    const tab1 = openTab(taskA);
    await settle();
    const box = () => [...tab1.host.querySelectorAll("input[type=checkbox]")][0];
    expect(box().checked).toBe(true);
    // tab 2 writes the per-task key; the browser fires `storage` in every OTHER tab
    localStorage.setItem("bridza.autoAdvance./repo|eng/t-alpha", "0");
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: "bridza.autoAdvance./repo|eng/t-alpha", newValue: "0" })); });
    expect(box().checked, "tab 1 follows the flip instead of chaining runs the user turned off").toBe(false);
  });

  // ── O: two repos, same pipeline/task id, one per tab ───────────────────────
  it("O: the same task id in two different repos keeps separate view prefs and auto-advance", async () => {
    const tab1 = openTab(taskA, { dir: "/work/bridza" });
    const tab2 = openTab(taskA, { dir: "/other/bridza" });   // same basename, different repo
    await settle();
    await click(segButton(tab1, "Canvas"));
    await act(async () => { [...tab1.host.querySelectorAll("input[type=checkbox]")][0].click(); });   // auto-advance OFF in repo 1
    await settle();
    expect(viewOn(tab2), "repo 2's task keeps its own view").toBe("Stages");
    expect([...tab2.host.querySelectorAll("input[type=checkbox]")][0].checked, "repo 2's task keeps auto-advance on").toBe(true);
    const tab3 = openTab(taskA, { dir: "/other/bridza" });
    await settle();
    expect(viewOn(tab3)).toBe("Stages");
  });

  // ── K: the control — the per-task key IS isolated across tabs ──────────────
  // `bridza.autoAdvance.<pipeline>/<task>` (task.jsx:18) is the shape the
  // global keys above should have. This test PASSES today and must keep
  // passing: it is the pattern a fix should copy, not a bug.
  it("K (control): auto-advance is keyed per task, so tab 1 and tab 2 stay independent", async () => {
    const tab1 = openTab(taskA);
    await settle();
    const box1 = tab1.host.querySelector(".auto-card input[type=checkbox]") || [...tab1.host.querySelectorAll("input[type=checkbox]")][0];
    expect(box1, "auto-advance checkbox").toBeTruthy();
    await act(async () => { box1.click(); });          // turn it OFF for task A
    expect(localStorage.getItem("bridza.autoAdvance./repo|eng/t-alpha")).toBe("0");

    const tab2 = openTab(taskB);
    await settle();
    expect(localStorage.getItem("bridza.autoAdvance./repo|eng/t-bravo"), "task B's own key is untouched").toBeNull();
    const box2 = tab2.host.querySelector(".auto-card input[type=checkbox]") || [...tab2.host.querySelectorAll("input[type=checkbox]")][0];
    expect(box2.checked, "task B in tab 2 keeps its own auto-advance default").toBe(true);
  });
});
