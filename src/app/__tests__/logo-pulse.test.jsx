// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useState, useEffect, act } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../features/nav.jsx";
import { LS, lsGet, lsSet } from "../lib/format.js";

// Same inert-localStorage workaround as welcome-dialog.test.jsx.
function stubLocalStorage() {
  const m = new Map();
  const s = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) {}
  return s;
}

const proj = { repo: "/r", business: { name: "R" }, pipelines: [], inbox: [] };

// Mirrors how App decides + records first launch, then hands the flag to Sidebar.
function Harness() {
  const [firstLaunch] = useState(() => !lsGet(LS.logo, ""));
  useEffect(() => { if (firstLaunch) lsSet(LS.logo, "1"); }, [firstLaunch]);
  return <Sidebar proj={proj} running={[]} runningTasks={new Set()} recents={[]} firstLaunch={firstLaunch} />;
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

describe("first-launch logo heartbeat", () => {
  it("pulses and records the marker when it is absent", () => {
    mount();
    expect(host.querySelector(".brand").className).toBe("brand pulse");
    expect(localStorage.getItem(LS.logo)).toBe("1");
  });

  it("stays static when the marker is already set", () => {
    localStorage.setItem(LS.logo, "1");
    mount();
    expect(host.querySelector(".brand").className).toBe("brand");
  });
});
