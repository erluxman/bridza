// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../App.tsx";

let host;
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
  act(() => host.root.render(<App />));
  return host;
}

describe("landing page", () => {
  it("renders the hero H1", () => {
    mount();
    const h1 = host.querySelector("h1");
    expect(h1.textContent).toBe("From ideas to impact.");
  });

  it("has no waitlist form", () => {
    mount();
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector('input[type="email"]')).toBeNull();
    expect(host.textContent).not.toMatch(/waitlist/i);
  });
});
