// @vitest-environment jsdom
// A tag is editable from all three places a task is drawn — the kanban card
// (board-tags.test.jsx), the plan-board panel, and the task detail rail — and
// its colour is a free value, reached through the picker's ⚙ dialog or the
// full colour input beside the eight presets.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TagMenu } from "../features/tags.jsx";
import { TaskDetail } from "../features/task.jsx";
import { PlanView } from "../features/plan.jsx";
import { TAG_PALETTE } from "../../../core/domain.js";

const [VIOLET, , , , , ROSE] = TAG_PALETTE;

const api = vi.hoisted(() => ({
  createTag: vi.fn(), updateTag: vi.fn(), setTaskTags: vi.fn(),
  getPlan: vi.fn(), savePlan: vi.fn(), getTimeline: vi.fn(), getContext: vi.fn(),
  fetchTime: vi.fn(), getBlast: vi.fn(), getModels: vi.fn(), getBranches: vi.fn(),
  runStage: vi.fn(), stopRun: vi.fn(), saveTime: vi.fn(), automate: vi.fn(),
  finalize: vi.fn(), openEditor: vi.fn(), createPR: vi.fn(),
}));
vi.mock("../api/client.js", () => api);
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));
vi.mock("../features/diff.jsx", () => ({ DiffView: () => null, FileModal: () => null }));

function stubLocalStorage() {
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) { /* jsdom already froze it */ }
}

const REGISTRY = { billing: { name: "billing", color: VIOLET }, regression: { name: "regression", color: ROSE } };
const TAGS = [{ id: "billing", name: "billing", color: VIOLET }];

let host, root;
beforeEach(() => {
  stubLocalStorage();
  Object.values(api).forEach((f) => f.mockReset());
  api.setTaskTags.mockResolvedValue({ ok: true });
  api.updateTag.mockResolvedValue({ ok: true });
  api.createTag.mockResolvedValue({ ok: true, id: "billing", created: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const q = (sel) => document.querySelector(sel);
const qq = (sel) => [...document.querySelectorAll(sel)];

describe("the picker's colour input and ⚙ dialog", () => {
  const mountMenu = (over = {}) => act(() => root.render(
    <TagMenu task={{ id: "t1", tags: TAGS }} registry={REGISTRY}
      onToggle={() => {}} onCreate={() => {}} onRecolor={over.onRecolor || (() => {})} onClose={() => {}} />));

  // <input type="color"> fires `input` for every step of a drag through the OS
  // picker; only the `change` at the end is a colour the user chose.
  it("commits an off-palette colour on change, and ignores the drag", () => {
    const picked = [];
    mountMenu({ onRecolor: (id, c) => picked.push([id, c]) });
    click(q(".tag-menu .tag-dot"));
    const input = q(".tag-menu .tag-color-input");
    expect(input).toBeTruthy();

    act(() => {
      input.value = "#0f0f0f";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(picked).toEqual([]);                       // mid-drag — nothing written

    act(() => {
      input.value = "#123456";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(picked).toEqual([["billing", "#123456"]]);
  });

  it("⚙ opens a dialog listing every registry tag, and recolours from it", () => {
    mountMenu();
    expect(q(".modal-bg")).toBeNull();
    click([...host.querySelectorAll(".tag-menu .btn")].find((b) => b.textContent === "⚙"));

    // portalled out of the menu — a modal inside a z-indexed menu is trapped
    const modal = q(".modal-bg");
    expect(modal).toBeTruthy();
    expect(host.contains(modal)).toBe(false);
    expect(qq(".tag-manage-row").map((r) => r.querySelector(".tag").textContent)).toEqual(["billing", "regression"]);

    const row = qq(".tag-manage-row")[1];
    click([...row.querySelectorAll(".tag-swatch")].find((b) => b.title === VIOLET));
    expect(api.updateTag).not.toHaveBeenCalled();     // the dialog reports up, it does not write
  });

  it("the ⚙ dialog's recolour reaches the handler it was given", () => {
    const picked = [];
    mountMenu({ onRecolor: (id, c) => picked.push([id, c]) });
    click([...host.querySelectorAll(".tag-menu .btn")].find((b) => b.textContent === "⚙"));
    const row = qq(".tag-manage-row")[1];
    click([...row.querySelectorAll(".tag-swatch")].find((b) => b.title === VIOLET));
    expect(picked).toEqual([["regression", VIOLET]]);
  });
});

describe("the task detail rail", () => {
  const pipeline = { id: "eng", label: "Engineering", flows: [], tags: REGISTRY, stages: [
    { id: "build", name: "Build", tool: "claude", hint: "", systemPrompt: "", outputs: [], shell: [], gate: "", auto: true },
  ] };
  const task = { id: "t1", title: "Add the thing", flow: "", stages: ["build"], tracking: {}, branch: "bridza/eng/t1", status: "open", target: "main", tags: TAGS };

  const mountTask = () => {
    api.getPlan.mockResolvedValue({ plan: { deps: {}, milestones: [], pos: {}, links: {} } });
    api.getTimeline.mockResolvedValue({ commits: [] });
    api.getContext.mockResolvedValue({ text: "# Add the thing" });
    api.fetchTime.mockResolvedValue({ time: {} });
    api.getBlast.mockResolvedValue({ ok: true, seeds: [], impacted: [], edges: [] });
    api.getModels.mockResolvedValue({ models: [] });
    api.getBranches.mockResolvedValue({ branches: [] });
    act(() => root.render(<TaskDetail dir="/repo" proj={{ pipelines: [pipeline] }} pipeline={pipeline} task={task}
      tools={[{ id: "claude", label: "claude", available: true }]} runningStages={new Set()}
      flash={() => {}} onBack={() => {}} onChange={() => {}} onOpenTask={() => {}} onExpandSide={() => {}} collapsed={false} />));
  };
  const railRow = () => qq(".rail .kv").find((r) => r.querySelector("span") && r.querySelector("span").textContent === "Tags");

  it("carries a Tags row beside Status and Branch, with the task's chips", () => {
    mountTask();
    const row = railRow();
    expect(row).toBeTruthy();
    expect([...row.querySelectorAll(".tag-chips .tag")].map((c) => c.textContent)).toEqual(["billing"]);
  });

  // the rail row is where a task's tags live on this screen; the topbar keeps
  // the title on one line and must not grow chips beside it
  it("does not repeat the chips next to the title", () => {
    mountTask();
    expect(q(".task-title")).toBeTruthy();
    expect(q(".task-title").parentElement.querySelector(".tag-chips")).toBeNull();
    expect(qq(".tag-chips").every((c) => railRow().contains(c))).toBe(true);
  });

  it("opens the picker from that row and assigns a tag to the task", async () => {
    mountTask();
    click([...railRow().querySelectorAll(".btn")].find((b) => b.textContent === "edit"));
    const menu = railRow().querySelector(".tag-menu");
    expect(menu).toBeTruthy();

    const regression = [...menu.querySelectorAll(".item")].find((b) => b.textContent.startsWith("regression"));
    await act(async () => { regression.click(); });
    expect(api.setTaskTags).toHaveBeenCalledWith("/repo", { pipeline: "eng", task: "t1", tags: ["billing", "regression"] });
  });

  it("recolours from that row without touching the task's assignments", async () => {
    mountTask();
    click([...railRow().querySelectorAll(".btn")].find((b) => b.textContent === "edit"));
    click(railRow().querySelector(".tag-menu .tag-dot"));
    await act(async () => { [...railRow().querySelectorAll(".tag-swatch")].find((b) => b.title === ROSE).click(); });
    expect(api.updateTag).toHaveBeenCalledWith("/repo", { id: "billing", color: ROSE });
    expect(api.setTaskTags).not.toHaveBeenCalled();
  });
});

describe("the plan board panel", () => {
  const proj = { pipelines: [
    { id: "eng", label: "Engineering", tags: REGISTRY, tasks: [
      { id: "t1", title: "ship it", stages: ["build"], tracking: {}, progress: 0, tags: TAGS },
    ] },
    { id: "mkt", label: "Marketing", tags: {}, tasks: [
      { id: "t2", title: "launch", stages: ["write"], tracking: {}, progress: 0, tags: [] },
    ] },
  ] };

  const mountPlan = async () => {
    api.getPlan.mockResolvedValue({ plan: { deps: {}, milestones: [], pos: {}, sizes: {}, pipeDeps: [], est: {} } });
    api.savePlan.mockResolvedValue({ ok: true });
    await act(async () => { root.render(<PlanView dir="/repo" proj={proj} runningTasks={new Set()}
      onOpenTask={() => {}} flash={() => {}} onChange={() => {}} onExpandSide={() => {}} collapsed={false} />); });
  };
  // selection lands on the svg's mouseup, after a node mousedown that never moved
  const selectNode = (i) => {
    const g = qq(".plan-node")[i];
    act(() => { g.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 5, clientY: 5 })); });
    act(() => { q(".plan-svg").dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 5, clientY: 5 })); });
  };

  it("names a node's tags in the node's own tooltip, not on the 7px dots", async () => {
    await mountPlan();
    const g = qq(".plan-node")[0];
    const title = g.querySelector(":scope > title");
    expect(title).toBeTruthy();                        // on the node — the whole card is the hit area
    expect(title.textContent).toBe("billing");
    expect(g.querySelector("circle[fill]")).toBeTruthy();
  });

  it("shows the selected task's chips and opens a picker scoped to ITS pipeline", async () => {
    await mountPlan();
    selectNode(0);
    const panel = q(".plan-panel");
    expect(panel).toBeTruthy();
    expect([...panel.querySelectorAll(".tag-chips .tag")].map((c) => c.textContent)).toEqual(["billing"]);

    click([...panel.querySelectorAll(".btn")].find((b) => b.textContent.startsWith("🏷")));
    const menu = panel.querySelector(".tag-menu");
    expect(menu).toBeTruthy();
    // the registry is per-pipeline and the board spans all of them: this task's
    // pipeline has two tags, the other pipeline's none
    expect([...menu.querySelectorAll(".item")].map((b) => b.textContent.replace(" ✓", ""))).toEqual(["billing", "regression"]);
  });

  it("writes an assignment against the selected task's own pipeline", async () => {
    await mountPlan();
    selectNode(0);
    const panel = q(".plan-panel");
    click([...panel.querySelectorAll(".btn")].find((b) => b.textContent.startsWith("🏷")));
    const regression = [...panel.querySelectorAll(".tag-menu .item")].find((b) => b.textContent.startsWith("regression"));
    await act(async () => { regression.click(); });
    expect(api.setTaskTags).toHaveBeenCalledWith("/repo", { pipeline: "eng", task: "t1", tags: ["billing", "regression"] });
  });
});
