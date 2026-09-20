// @vitest-environment jsdom
// The Create PR button: busy while the `gh` call is in flight (a slow create
// must not be double-clicked), and never a dead click — a server fallback opens
// the compose page with the reason flashed.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TaskDetail } from "../features/task.jsx";
import { __resetLogs } from "../lib/autolog.js";

const api = vi.hoisted(() => ({
  getPlan: vi.fn(), getTimeline: vi.fn(), getContext: vi.fn(), fetchTime: vi.fn(),
  getBlast: vi.fn(), getModels: vi.fn(), getBranches: vi.fn(), automate: vi.fn(),
  runStage: vi.fn(), stopRun: vi.fn(), saveTime: vi.fn(), finalize: vi.fn(), openEditor: vi.fn(),
  createPR: vi.fn(), attachRun: vi.fn(),
}));
vi.mock("../api/client.js", () => api);
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));
vi.mock("../features/diff.jsx", () => ({ DiffView: () => null, FileModal: () => null }));

function stubLocalStorage() {
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) {}
}

const pipeline = { id: "eng", label: "Engineering", flows: [], stages: [
  { id: "build", name: "Build", tool: "claude", hint: "", systemPrompt: "", outputs: [], shell: [], gate: "Output reviewed", auto: true },
] };
const task = { id: "t1", title: "Add the thing", flow: "", stages: ["build"], tracking: {}, branch: "bridza/eng/t1", status: "open", target: "main" };
const tools = [{ id: "claude", label: "claude", available: true }];
const noop = () => {};

let host, flashed, opened;
const baseProps = () => ({
  dir: "/repo", proj: { pipelines: [] }, pipeline, task, tools, runningStages: new Set(),
  flash: (m) => flashed.push(m), onBack: noop, onChange: noop, onOpenTask: noop, onExpandSide: noop, collapsed: false,
});

const prButton = () => [...host.querySelectorAll(".btn")].find((b) => /Create PR|Creating PR/.test(b.textContent));
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

beforeEach(() => {
  stubLocalStorage();
  flashed = []; opened = [];
  Object.values(api).forEach((f) => f.mockReset());
  api.getPlan.mockResolvedValue({ plan: { deps: {}, milestones: [], pos: {}, links: {} } });
  api.getTimeline.mockResolvedValue({ commits: [] });
  api.getContext.mockResolvedValue({ text: "# Add the thing\n\nWhy." });
  api.fetchTime.mockResolvedValue({ time: {} });
  api.getBlast.mockResolvedValue({ ok: true, seeds: [], impacted: [], edges: [] });
  api.getModels.mockResolvedValue({ models: [] });
  api.getBranches.mockResolvedValue({ branches: [] });
  api.attachRun.mockImplementation((_d, _b, onEvent) => { const e = { t: "end", none: true }; onEvent(e); return Promise.resolve(e); });   // nothing live on the server
  window.open = (url) => { opened.push(url); return null; };

  host = document.createElement("div");
  document.body.appendChild(host);
  host.root = createRoot(host);
  act(() => host.root.render(<TaskDetail {...baseProps()} />));
});

afterEach(() => {
  if (host) { act(() => host.root.unmount()); host.remove(); host = null; }
  __resetLogs();
});

describe("Create PR button", () => {
  it("shows a busy label, refuses a second click, and opens the created PR", async () => {
    let settle;
    api.createPR.mockReturnValue(new Promise((r) => (settle = r)));

    await click(prButton());
    expect(prButton().textContent).toBe("Creating PR…");
    expect(prButton().disabled).toBe(true);
    await click(prButton());                       // the double click
    expect(api.createPR).toHaveBeenCalledTimes(1);

    await act(async () => { settle({ ok: true, url: "https://github.com/acme/widgets/pull/42" }); });
    expect(prButton().textContent).toBe("Create PR");
    expect(opened).toEqual(["https://github.com/acme/widgets/pull/42"]);
    expect(flashed.some((m) => m.includes("PR created · https://github.com/acme/widgets/pull/42"))).toBe(true);
  });

  it("opens the compose page and flashes the reason on a fallback", async () => {
    const compose = "https://github.com/acme/widgets/compare/main...bridza/eng/t1?expand=1";
    api.createPR.mockResolvedValue({ ok: false, fallback: true, error: "not logged in to GitHub CLI — run `gh auth login`", url: compose });

    await act(async () => { prButton().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(opened).toEqual([compose]);
    expect(flashed.some((m) => m.includes("not logged in to GitHub CLI"))).toBe(true);
    expect(prButton().textContent).toBe("Create PR");
  });

  it("flashes an existing PR, and opens nothing on a hard error", async () => {
    api.createPR.mockResolvedValue({ ok: true, url: "https://github.com/acme/widgets/pull/7", existing: true });
    await act(async () => { prButton().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(flashed.some((m) => m.includes("PR already exists · https://github.com/acme/widgets/pull/7"))).toBe(true);

    opened = [];
    api.createPR.mockResolvedValue({ ok: false, error: "push failed: no upstream" });
    await act(async () => { prButton().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(opened).toEqual([]);
    expect(flashed.some((m) => m.includes("push failed: no upstream"))).toBe(true);
    expect(prButton().textContent).toBe("Create PR");
  });
});
