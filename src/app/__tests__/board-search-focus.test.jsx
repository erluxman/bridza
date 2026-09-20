// @vitest-environment jsdom
//
// REPRO (task #107) — the kanban search field steals focus.
//
// The board's search <input> mounts with an INLINE ref callback:
//     ref={(el) => el && setTimeout(() => el.focus(), 0)}   (board.jsx:191)
// React re-invokes an inline ref callback on EVERY commit (old ref ← null, new
// ref ← element), so this is not a mount-time focus — it is a focus() on every
// single render of <Board>. The app polls the bridge every 4s (App.jsx:78) and
// re-renders the board, so once the search box is open the caret is yanked back
// into it roughly every 4 seconds no matter what the user is doing.
//
// These tests assert the WANTED behaviour and therefore FAIL on current main.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// board.jsx pulls in the xterm terminal drawer at module level. It is never
// rendered here (the drawer is closed), and xterm does not load under jsdom —
// stub it so the test exercises the board alone.
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));

const { Board } = await import("../features/board.jsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pipeline = {
  id: "eng",
  label: "Engineering",
  stages: [{ id: "spec", name: "Spec" }, { id: "build", name: "Build" }],
  flows: [{ id: "feature", name: "Feature" }],
  tags: {},
  tasks: [
    { id: "t1", ref: 1, title: "Alpha task", branch: "bridza/eng/alpha", stages: ["spec", "build"], tracking: {}, progress: 0, tags: [] },
    { id: "t2", ref: 2, title: "Beta task", branch: "bridza/eng/beta", stages: ["spec", "build"], tracking: {}, progress: 0, tags: [] },
  ],
};

let container, root;
const noop = () => {};
const render = (props) =>
  act(() => {
    root.render(
      <Board dir="/tmp/repo" pipeline={props.pipeline} runningTasks={new Set()}
        onOpen={noop} onNewTask={noop} onFlow={noop} onChange={noop} flash={noop}
        collapsed={false} onExpandSide={noop} />
    );
  });

// the ref callback focuses inside setTimeout(…, 0) — let the macrotask land
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

// React tracks the input's value on the DOM node, so a bare `el.value = x`
// is swallowed as a no-op change. Go through the native setter.
const type = async (el, text) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(el, text);
  await act(async () => el.dispatchEvent(new Event("input", { bubbles: true })));
};

const $ = (sel) => container.querySelector(sel);
const searchInput = () => $("input.search-input");
const searchButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent.includes("🔍"));
const newTaskButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent.includes("New task"));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("kanban search field focus", () => {
  it("focuses the search box when the user opens it on purpose (click)", async () => {
    await render({ pipeline });
    await act(async () => searchButton().click());
    await settle();
    // this half is the intended behaviour and already holds
    expect(document.activeElement).toBe(searchInput());
  });

  it("does NOT re-steal focus on an unrelated re-render (the 4s poll)", async () => {
    await render({ pipeline });

    // 1. user opens search on purpose and types, so it stays open
    await act(async () => searchButton().click());
    await settle();
    const input = searchInput();
    await type(input, "alpha");
    await settle();
    expect(searchInput().value).toBe("alpha");

    // 2. user moves focus somewhere else — here the "New task" button
    const btn = newTaskButton();
    await act(async () => btn.focus());
    expect(document.activeElement).toBe(btn);

    // 3. the 4s poll lands: App re-renders <Board> with freshly fetched data.
    //    Nothing about the search changed; the user did not ask for focus.
    await render({ pipeline: { ...pipeline, tasks: [...pipeline.tasks] } });
    await settle();

    // 4. focus must have stayed put. On current main it is back in the search box.
    expect(document.activeElement).toBe(btn);
  });

  it("does NOT re-steal focus when the pointer merely crosses a card", async () => {
    // the cards' onMouseEnter sets Board-local `hover` state — another render,
    // another unwanted focus(). No polling needed to hit this one.
    await render({ pipeline });
    await act(async () => searchButton().click());
    await settle();
    await type(searchInput(), "alpha");
    await settle();

    const btn = newTaskButton();
    await act(async () => btn.focus());
    expect(document.activeElement).toBe(btn);

    await act(async () => $(".kcard").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await settle();

    expect(document.activeElement).toBe(btn);
  });

  it("does not grab focus when the board first renders", async () => {
    // guards the other half of the report: focus should never land in search
    // without a click or the ⌘K / "/" shortcut
    await render({ pipeline });
    await settle();
    expect(searchInput()).toBe(null);
    expect(document.activeElement).toBe(document.body);
  });
});
