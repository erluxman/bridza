// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal, CATEGORIES } from "../features/settings.jsx";
import { getTermSettings, TERM_DEFAULTS } from "../lib/settings.js";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function stubLocalStorage() {
  const s = makeStorage();
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) {}
  return s;
}

let host;

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  if (host) {
    act(() => host.root.unmount());
    host.remove();
    host = null;
  }
});

function mount(props = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  host.root = createRoot(host);
  act(() => host.root.render(<SettingsModal onClose={() => {}} {...props} />));
  return host;
}

describe("Settings categories", () => {
  it("renders one button per category with the first category active by default", () => {
    mount();
    const buttons = host.querySelectorAll(".settings-cats button");
    expect(buttons.length).toBe(CATEGORIES.length);
    expect(buttons[0].getAttribute("aria-current")).toBe("page");
    expect(buttons[0].textContent).toBe("Terminal");
  });

  it("renders the Terminal panel fields and writes to localStorage via getTermSettings() on Save", () => {
    mount();
    const select = host.querySelector(".settings-pane select.input");
    expect(select).toBeTruthy();

    const initial = getTermSettings();
    expect(initial.fontSize).toBe(TERM_DEFAULTS.fontSize);

    const sizeInput = host.querySelector("input[type='number']");
    expect(sizeInput).toBeTruthy();

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(sizeInput, "15");
      sizeInput.dispatchEvent(new Event("input", { bubbles: true }));
      sizeInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const saveBtn = host.querySelectorAll(".spread button");
    const confirmBtn = Array.from(saveBtn).find(btn => btn.textContent === "Save");
    expect(confirmBtn).toBeTruthy();

    act(() => {
      confirmBtn.click();
    });

    const updated = getTermSettings();
    expect(updated.fontSize).toBe(15);
  });

  it("switches panes on click when a stubbed two-entry registry is provided", () => {
    const DummyPanel = () => <div className="dummy-pane">Dummy Category Panel</div>;
    const testCategories = [
      ...CATEGORIES,
      { id: "dummy", label: "Dummy", Panel: DummyPanel }
    ];

    mount({ categories: testCategories });

    const buttons = host.querySelectorAll(".settings-cats button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute("aria-current")).toBe("page");
    expect(buttons[1].getAttribute("aria-current")).toBeNull();

    act(() => {
      buttons[1].click();
    });

    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    expect(buttons[1].getAttribute("aria-current")).toBe("page");

    const dummyPane = host.querySelector(".dummy-pane");
    expect(dummyPane).toBeTruthy();
    expect(dummyPane.textContent).toBe("Dummy Category Panel");
  });
});
