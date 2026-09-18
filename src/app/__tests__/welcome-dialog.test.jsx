// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WelcomeDialog, greetingForHour } from "../features/onboarding.jsx";
import { LS, today } from "../lib/format.js";

// The test process's bare `localStorage` globals are inert (Node 25 without a
// valid --localstorage-file), so back them with a tiny in-memory Storage.
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

// Mirror how the App mounts the dialog: shown only when today's dismissal
// hasn't been recorded, and dismissing records today.
function Harness() {
  const [open, setOpen] = useState(() => localStorage.getItem(LS.welcome) !== today());
  return open ? <WelcomeDialog onClose={() => { setOpen(false); localStorage.setItem(LS.welcome, today()); }} /> : null;
}

let host;
beforeEach(() => stubLocalStorage());
afterEach(() => {
  if (host) {
    act(() => host.root.unmount());
    host.remove();
    host = null;
  }
});

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  host.root = createRoot(host);
  act(() => host.root.render(<Harness />));
  return host;
}

describe("WelcomeDialog", () => {
  it("renders on mount with the greeting + good-luck message", () => {
    mount();
    expect(host.querySelector(".modal-bg")).toBeTruthy();
    const modal = host.querySelector(".modal");
    expect(modal.textContent).toMatch(greetingForHour(new Date().getHours()));
    expect(modal.textContent).toMatch(/Good luck/);
  });

  it("closes via the close button", () => {
    mount();
    act(() => host.querySelector(".modal .btn").click());
    expect(host.querySelector(".modal-bg")).toBeNull();
  });

  it("closes via clicking the backdrop", () => {
    mount();
    act(() => host.querySelector(".modal-bg").click());
    expect(host.querySelector(".modal-bg")).toBeNull();
  });

  it("closes via the Escape key", () => {
    mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".modal-bg")).toBeNull();
  });
});

describe("greetingForHour", () => {
  it.each([
    [5, "Good morning"],
    [8, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [14, "Good afternoon"],
    [16, "Good afternoon"],
    [17, "Good evening"],
    [20, "Good evening"],
    [23, "Good evening"],
    [0, "Good morning"],
    [4, "Good morning"],
  ])("hour %i → %s", (hour, expected) => {
    expect(greetingForHour(hour)).toBe(expected);
  });
});