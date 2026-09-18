// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WelcomeDialog } from "../features/onboarding.jsx";

// Mirror how the App mounts the dialog: rendered until dismissed.
function Harness() {
  const [open, setOpen] = useState(true);
  return open ? <WelcomeDialog onClose={() => setOpen(false)} /> : null;
}

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
  act(() => host.root.render(<Harness />));
  return host;
}

describe("WelcomeDialog", () => {
  it("renders on mount with the welcome + good-luck message", () => {
    mount();
    expect(host.querySelector(".modal-bg")).toBeTruthy();
    const modal = host.querySelector(".modal");
    expect(modal.textContent).toMatch(/Welcome/);
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