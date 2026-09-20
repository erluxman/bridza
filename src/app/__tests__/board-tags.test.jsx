// @vitest-environment jsdom
// Tags on a card: L opens the tag picker (on every pipeline, single-flow ones
// included), F opens the stage-flow menu — the binding L used to own. Chips
// render from the resolved task.tags the projection hands the board.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "../features/board.jsx";

const api = vi.hoisted(() => ({
  saveKanbanOrder: vi.fn(), setTaskArchived: vi.fn(), retargetTask: vi.fn(),
  createTag: vi.fn(), setTaskTags: vi.fn(),
}));
vi.mock("../api/client.js", () => api);
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));

const task = (over = {}) => ({
  id: "t1", title: "ship it", ref: 1, branch: "bridza/eng/t1", flow: "feature",
  stages: ["build"], tracking: {}, progress: 0, tags: [], ...over,
});
const pipeline = (over = {}) => ({
  id: "eng", label: "Engineering", stages: [{ id: "build", name: "Build" }],
  flows: [], tags: {}, kanbanOrder: [], tasks: [task()], ...over,
});

let host, root;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function mount(p) {
  act(() => root.render(<Board dir="/repo" pipeline={p} onOpen={() => {}} onNewTask={() => {}} onFlow={() => {}} onChange={() => {}} flash={() => {}} />));
}
const card = () => host.querySelector(".kcard");
const press = (key) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

// React attaches onMouseEnter via a delegated mouseout/mouseover pair; dispatch
// the raw event the same way React's synthetic enter is derived from.
function hoverCard() {
  act(() => { card().dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })); });
}
function leaveCard() {
  act(() => { card().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); });
}

describe("board card tag picker", () => {
  it("L opens the tag picker even when the pipeline has one flow", () => {
    mount(pipeline({ tags: { billing: { name: "billing", color: "violet" } } }));
    hoverCard();
    press("l");
    const menu = host.querySelector(".tag-menu");
    expect(menu).toBeTruthy();
    expect(menu.textContent).toContain("billing");
    expect(host.querySelector(".proj-menu:not(.tag-menu)")).toBeNull();
  });

  it("F opens the stage-flow menu, and only with two or more flows", () => {
    mount(pipeline());                       // no flows
    hoverCard();
    press("f");
    expect(host.textContent).not.toContain("Change stage flow");

    act(() => root.unmount());
    root = createRoot(host);
    mount(pipeline({ flows: [{ id: "feature", name: "Feature" }, { id: "bugfix", name: "Bugfix" }] }));
    hoverCard();
    press("f");
    expect(host.textContent).toContain("Change stage flow");
    expect(host.querySelector(".tag-menu")).toBeNull();
  });

  it("clicking a tag row toggles it — assigning adds, re-clicking removes", async () => {
    api.setTaskTags.mockResolvedValue({ ok: true });
    mount(pipeline({ tags: { billing: { name: "billing", color: "violet" } } }));
    hoverCard();
    press("l");
    await act(async () => { host.querySelector(".tag-menu .item").click(); });
    expect(api.setTaskTags).toHaveBeenCalledWith("/repo", { pipeline: "eng", task: "t1", tags: ["billing"] });

    act(() => root.unmount());
    root = createRoot(host);
    mount(pipeline({
      tags: { billing: { name: "billing", color: "violet" } },
      tasks: [task({ tags: [{ id: "billing", name: "billing", color: "violet" }] })],
    }));
    hoverCard();
    press("l");
    await act(async () => { host.querySelector(".tag-menu .item").click(); });
    expect(api.setTaskTags).toHaveBeenLastCalledWith("/repo", { pipeline: "eng", task: "t1", tags: [] });
  });

  it("Escape closes the picker", () => {
    mount(pipeline());
    hoverCard();
    press("l");
    expect(host.querySelector(".tag-menu")).toBeTruthy();
    press("Escape");
    expect(host.querySelector(".tag-menu")).toBeNull();
  });

  // reaching for the menu takes the pointer off the card; Escape is bound to the
  // open menu, not the hover, so the picker never strands itself open
  it("Escape still closes the picker after the pointer leaves the card", () => {
    mount(pipeline());
    hoverCard();
    press("l");
    leaveCard();
    expect(host.querySelector(".tag-menu")).toBeTruthy();
    press("Escape");
    expect(host.querySelector(".tag-menu")).toBeNull();
  });

  it("typing a name and picking a swatch creates the tag in that colour and assigns it", async () => {
    api.createTag.mockResolvedValue({ ok: true, id: "billing", created: true });
    api.setTaskTags.mockResolvedValue({ ok: true });
    mount(pipeline());
    hoverCard();
    press("l");
    const swatches = [...host.querySelectorAll(".tag-swatch")];
    expect(swatches.map((b) => b.className)).toContain("tag-swatch tag-violet on");  // empty registry → first colour
    act(() => { swatches.find((b) => b.classList.contains("tag-rose")).click(); });
    expect(host.querySelector(".tag-swatch.on").className).toContain("tag-rose");

    const input = host.querySelector(".tag-menu input");
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Billing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { host.querySelector(".tag-menu form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    expect(api.createTag).toHaveBeenCalledWith("/repo", { name: "Billing", color: "rose" });
    expect(api.setTaskTags).toHaveBeenCalledWith("/repo", { pipeline: "eng", task: "t1", tags: ["billing"] });
  });

  it("F does not stack the flow menu on top of an open tag picker", () => {
    mount(pipeline({ flows: [{ id: "feature", name: "Feature" }, { id: "bugfix", name: "Bugfix" }] }));
    hoverCard();
    press("l");
    press("f");
    expect(host.querySelector(".tag-menu")).toBeNull();
    expect(host.textContent).toContain("Change stage flow");
  });

  it("renders a chip per resolved tag, coloured by palette name", () => {
    mount(pipeline({ tasks: [task({ tags: [
      { id: "billing", name: "billing", color: "violet" },
      { id: "regression", name: "regression", color: "rose" },
    ] })] }));
    const chips = [...host.querySelectorAll(".tag-chips .tag")];
    expect(chips.map((c) => c.className)).toEqual(["tag tag-violet", "tag tag-rose"]);
    expect(chips.map((c) => c.textContent)).toEqual(["billing", "regression"]);
  });

  it("the hint names L for tags, and F only when there are several flows", () => {
    mount(pipeline());
    hoverCard();
    expect(host.textContent).toContain("press L to tag");
    expect(host.textContent).not.toContain("for flow");
  });
});
