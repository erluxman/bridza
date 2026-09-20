// @vitest-environment jsdom
// Tags on a card: L opens the tag picker (on every pipeline, single-flow ones
// included), F opens the stage-flow menu — the binding L used to own. Chips
// render from the resolved task.tags the projection hands the board.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "../features/board.jsx";
import { TAG_PALETTE } from "../../../core/domain.js";

// colours are values now; these three are palette presets, so the picker marks
// them selected and the tests can still name them
const [VIOLET, , , , , ROSE, CYAN] = TAG_PALETTE;
// jsdom reports a style colour as rgb() — compare through the element's own
// parsing rather than hand-rolling hex→rgb in the assertions
const asRgb = (hex) => { const d = document.createElement("i"); d.style.color = hex; return d.style.color; };

const api = vi.hoisted(() => ({
  saveKanbanOrder: vi.fn(), setTaskArchived: vi.fn(), retargetTask: vi.fn(),
  createTag: vi.fn(), updateTag: vi.fn(), setTaskTags: vi.fn(),
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
    mount(pipeline({ tags: { billing: { name: "billing", color: VIOLET } } }));
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
    mount(pipeline({ tags: { billing: { name: "billing", color: VIOLET } } }));
    hoverCard();
    press("l");
    await act(async () => { host.querySelector(".tag-menu .item").click(); });
    expect(api.setTaskTags).toHaveBeenCalledWith("/repo", { pipeline: "eng", task: "t1", tags: ["billing"] });

    act(() => root.unmount());
    root = createRoot(host);
    mount(pipeline({
      tags: { billing: { name: "billing", color: VIOLET } },
      tasks: [task({ tags: [{ id: "billing", name: "billing", color: VIOLET }] })],
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
    expect(swatches.find((b) => b.classList.contains("on")).title).toBe(VIOLET);   // empty registry → first colour
    act(() => { swatches.find((b) => b.title === ROSE).click(); });
    expect(host.querySelector(".tag-swatch.on").title).toBe(ROSE);

    const input = host.querySelector(".tag-menu .search-input");
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Billing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { host.querySelector(".tag-menu form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    expect(api.createTag).toHaveBeenCalledWith("/repo", { name: "Billing", color: ROSE });
    expect(api.setTaskTags).toHaveBeenCalledWith("/repo", { pipeline: "eng", task: "t1", tags: ["billing"] });
  });

  it("clicking a tag's dot reveals its swatches, and picking one recolours without retagging", async () => {
    api.updateTag.mockResolvedValue({ ok: true });
    mount(pipeline({ tags: { billing: { name: "billing", color: VIOLET }, regression: { name: "regression", color: ROSE } } }));
    hoverCard();
    press("l");
    const rowSwatches = () => [...host.querySelectorAll(".tag-menu > div .tag-swatches .tag-swatch")];
    expect(rowSwatches()).toHaveLength(0);               // collapsed until the dot is clicked

    act(() => { host.querySelector(".tag-menu .tag-dot").click(); });
    expect(rowSwatches()).toHaveLength(8);
    expect(rowSwatches().find((b) => b.classList.contains("on")).title).toBe(VIOLET);

    // a second tag's dot replaces the open row rather than adding to it
    act(() => { host.querySelectorAll(".tag-menu .tag-dot")[1].click(); });
    expect(rowSwatches().find((b) => b.classList.contains("on")).title).toBe(ROSE);
    expect(rowSwatches()).toHaveLength(8);

    await act(async () => { rowSwatches().find((b) => b.title === CYAN).click(); });
    expect(api.updateTag).toHaveBeenCalledWith("/repo", { id: "regression", color: CYAN });
    expect(api.setTaskTags).not.toHaveBeenCalled();      // a recolour never tags the card
    expect(rowSwatches()).toHaveLength(0);               // and collapses the row
  });

  it("F does not stack the flow menu on top of an open tag picker", () => {
    mount(pipeline({ flows: [{ id: "feature", name: "Feature" }, { id: "bugfix", name: "Bugfix" }] }));
    hoverCard();
    press("l");
    press("f");
    expect(host.querySelector(".tag-menu")).toBeNull();
    expect(host.textContent).toContain("Change stage flow");
  });

  it("renders a chip per resolved tag, carrying the tag's own colour", () => {
    mount(pipeline({ tasks: [task({ tags: [
      { id: "billing", name: "billing", color: VIOLET },
      { id: "regression", name: "regression", color: "#123456" },
    ] })] }));
    const chips = [...host.querySelectorAll(".tag-chips .tag")];
    expect(chips.map((c) => c.textContent)).toEqual(["billing", "regression"]);
    // an off-palette colour renders exactly as stored — no class, no rounding
    expect(chips.map((c) => c.style.color)).toEqual([asRgb(VIOLET), asRgb("#123456")]);
    expect(chips.map((c) => c.style.borderColor)).toEqual([asRgb(VIOLET + "55"), asRgb("#12345655")]);
  });

  it("the hint names L for tags, and F only when there are several flows", () => {
    mount(pipeline());
    hoverCard();
    expect(host.textContent).toContain("press L to tag");
    expect(host.textContent).not.toContain("for flow");
  });
});
