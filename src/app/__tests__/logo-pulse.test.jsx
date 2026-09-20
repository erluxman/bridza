// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState, useEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../features/nav.jsx";

const proj = { repo: "/r", business: { name: "R" }, pipelines: [], inbox: [] };

// Mirrors how App bumps the pulse key each time the view returns to home.
function Harness({ away }) {
  const atHome = !away;
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => { if (atHome) setPulseKey((n) => n + 1); }, [atHome]);
  return <Sidebar proj={proj} running={[]} runningTasks={new Set()} recents={[]} pulseKey={pulseKey} />;
}

let host;
afterEach(() => {
  if (host) {
    act(() => host.root.unmount());
    host.remove();
    host = null;
  }
});

function mount(away = false) {
  host = document.createElement("div");
  document.body.appendChild(host);
  host.root = createRoot(host);
  act(() => host.root.render(<Harness away={away} />));
  return host;
}

const brand = () => host.querySelector(".brand");

describe("home-navigation logo heartbeat", () => {
  it("pulses on the first render, which lands on home", () => {
    mount();
    expect(brand().className).toBe("brand pulse");
  });

  it("restarts the animation by remounting the node on every return home", () => {
    mount();
    const first = brand();
    act(() => host.root.render(<Harness away={true} />));   // leave home
    act(() => host.root.render(<Harness away={false} />));  // come back
    const second = brand();
    expect(second.className).toBe("brand pulse");
    expect(second).not.toBe(first);
  });

  it("stays static while the view is away from home", () => {
    mount(true);
    expect(brand().className).toBe("brand");
  });
});
