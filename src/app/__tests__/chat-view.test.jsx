// @vitest-environment jsdom
// chat-view.test.jsx — the surface half of the task chat. The point of the
// feature is that someone who would never open a terminal can find it and watch
// it work, so what these tests pin is exactly that: the entry point is a
// floating bubble (NOT a fourth button in the audit-view switcher), opening it
// docks a panel WITHOUT taking the stage timeline off screen, and sending shows
// the agent working step by step instead of a silent pane.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TaskDetail } from "../features/task.jsx";
import { activityPhrase } from "../features/views.jsx";
import { __resetLogs } from "../lib/autolog.js";

const api = vi.hoisted(() => ({
  getPlan: vi.fn(), getTimeline: vi.fn(), getContext: vi.fn(), fetchTime: vi.fn(),
  getBlast: vi.fn(), getModels: vi.fn(), getBranches: vi.fn(), automate: vi.fn(),
  runStage: vi.fn(), stopRun: vi.fn(), saveTime: vi.fn(), finalize: vi.fn(),
  openEditor: vi.fn(), attachRun: vi.fn(), sendChat: vi.fn(), setStageRouting: vi.fn(),
}));
vi.mock("../api/client.js", () => api);
// term/diff pull in xterm + heavyweight diff machinery — stub them so their
// modules are never transformed in this test
vi.mock("../features/term.jsx", () => ({ TermDrawer: () => null }));
vi.mock("../features/diff.jsx", () => ({ DiffView: () => null, FileModal: () => null }));

function stubLocalStorage() {
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
  try { Object.defineProperty(window, "localStorage", { value: s, configurable: true }); } catch (e) { /* jsdom */ }
  return s;
}

const pipeline = { id: "eng", label: "Engineering", flows: [], stages: [
  { id: "spec", name: "Spec", tool: "claude", hint: "", systemPrompt: "", outputs: [], shell: [], gate: "", auto: true },
  { id: "build", name: "Build", tool: "claude", hint: "", systemPrompt: "", outputs: [], shell: [], gate: "", auto: true },
] };
const task = {
  id: "t1", title: "Chat in task details", flow: "", stages: ["spec", "build"], branch: "bridza/eng/t1",
  status: "open", routing: { spec: { tool: "claude", model: "" } },
  tracking: { spec: { status: "done", seconds: 12, runs: [{ tool: "claude", status: "done", exit: 0, files: ["spec.md"], startedAt: "2026-09-22T10:00:00Z", finishedAt: "2026-09-22T10:04:00Z" }] } },
  chat: { turns: [] },
};
const tools = [{ id: "claude", label: "Claude Code", available: true }, { id: "opencode", label: "opencode", available: true }];
const noop = () => { };
const baseProps = { dir: "/repo", proj: { pipelines: [] }, pipeline, task, tools, runningStages: new Set(), flash: noop, onBack: noop, onChange: noop, onOpenTask: noop, onExpandSide: noop, collapsed: false };

let host;
function mount(props = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  host.root = createRoot(host);
  act(() => host.root.render(<TaskDetail {...baseProps} {...props} />));
}
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const bubble = () => host.querySelector(".chat-bubble");
const panel = () => host.querySelector(".chat-panel");
const composer = () => host.querySelector(".chat-input");
const openChat = async () => { await click(bubble()); await act(async () => { await Promise.resolve(); }); };
async function type(text) {
  const ta = composer();
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => { set.call(ta, text); ta.dispatchEvent(new Event("input", { bubbles: true })); });
}
const send = async () => {
  const btn = [...host.querySelectorAll(".chat-crow .btn")].find((b) => b.textContent === "Send");
  await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

beforeEach(() => {
  stubLocalStorage();
  Object.values(api).forEach((f) => f.mockClear());
  api.getPlan.mockResolvedValue({ plan: { deps: {}, milestones: [], pos: {}, links: {} } });
  api.getTimeline.mockResolvedValue({ commits: [] });
  api.getContext.mockResolvedValue({ text: "# Chat in task details\n\nTalk to the agent." });
  api.fetchTime.mockResolvedValue({ time: {} });
  api.getBlast.mockResolvedValue({ ok: true, seeds: [], impacted: [], edges: [] });
  api.getModels.mockResolvedValue({ models: [] });
  api.getBranches.mockResolvedValue({ branches: [] });
  api.attachRun.mockImplementation((_d, _b, onEvent) => { const e = { t: "end", none: true }; onEvent(e); return Promise.resolve(e); });
});
afterEach(() => {
  if (host) { act(() => host.root.unmount()); host.remove(); host = null; }
  __resetLogs();
});

describe("the entry point a non-technical person will find", () => {
  it("is a floating bubble, and NOT a button in the audit-view switcher", () => {
    mount();
    expect(bubble()).toBeTruthy();
    const seg = [...host.querySelectorAll(".topbar .seg button")].map((b) => b.textContent);
    expect(seg).toEqual(["Stages", "Inspector", "Canvas", "⌨ Terminal"]);
    expect(seg).not.toContain("Chat");
  });

  it("opens a docked panel WITHOUT taking the stage timeline off screen", async () => {
    mount();
    expect(panel()).toBeNull();
    await openChat();
    expect(panel()).toBeTruthy();
    // the point of a panel over a full view: the stages stay visible behind it
    expect(host.querySelector(".stages")).toBeTruthy();
    expect(host.querySelector(".content.detail").classList.contains("chat-open")).toBe(true);
    // …and the details rail yields its column rather than fighting for it
    expect(host.querySelector(".rail")).toBeNull();
  });

  it("closing it brings the details rail back, and remembers being open", async () => {
    mount();
    await openChat();
    expect(localStorage.getItem("bridza.chatOpen:/repo|eng/t1")).toBe("1");
    await click(host.querySelector(".chat-x"));
    expect(panel()).toBeNull();
    expect(host.querySelector(".rail")).toBeTruthy();
    expect(localStorage.getItem("bridza.chatOpen:/repo|eng/t1")).toBe("0");
  });

  it("starts with an invitation in plain words, and a collapsed agent picker", async () => {
    mount();
    await openChat();
    expect(host.querySelector(".chat-empty").textContent).toMatch(/Ask for anything else — in plain words/);
    expect(host.querySelector(".chat-agent")).toBeNull();          // collapsed by default…
    expect(host.querySelector(".chat-crow .uxv-syslink").textContent).toMatch(/claude/);   // …but pre-filled
  });
});

describe("sending shows the agent working", () => {
  it("puts the message up, opens a working bubble, then names each step in plain words", async () => {
    let emit;
    api.sendChat.mockImplementation((_d, _b, onEvent) => { emit = onEvent; return new Promise(() => { }); });
    mount();
    await openChat();
    await type("make the header smaller");
    await send();

    // the message is on screen before the server has said anything
    expect(host.querySelector(".chat-bub.you").textContent).toBe("make the header smaller");
    expect(composer().value).toBe("");
    // and a working bubble, never an empty pane
    expect(host.querySelector(".chat-activity").textContent).toMatch(/working…/);

    await act(async () => { emit({ t: "out", d: "· Read src/app/features/task.jsx\n" }); });
    expect(host.querySelector(".chat-activity").textContent).toMatch(/reading src\/app\/features\/task\.jsx/);
    await act(async () => { emit({ t: "out", d: "· Bash pnpm test\n" }); });
    expect(host.querySelector(".chat-activity").textContent).toMatch(/running pnpm test/);
    await act(async () => { emit({ t: "commit", phase: "chat", sha: "abcdef1234" }); });
    expect(host.querySelector(".chat-activity").textContent).toMatch(/saving the change/);
  });

  it("streams the agent's prose into the bubble and keeps tool lines out of it", async () => {
    let emit;
    api.sendChat.mockImplementation((_d, _b, onEvent) => { emit = onEvent; return new Promise(() => { }); });
    mount();
    await openChat();
    await type("make it blue");
    await send();
    await act(async () => { emit({ t: "out", d: "· Edit button.jsx\nMade the button blue.\n" }); });
    expect(host.querySelector(".chat-answer").textContent).toBe("Made the button blue.\n");
    expect(host.querySelector(".chat-answer").textContent).not.toMatch(/Edit button\.jsx/);
  });

  it("sends what was typed, with the task's agent, and Enter sends while Shift+Enter does not", async () => {
    api.sendChat.mockResolvedValue({ t: "end", status: "done", exit: 0, turn: { seq: 1 } });
    mount();
    await openChat();
    await type("add a test");
    const ta = composer();
    await act(async () => { ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })); });
    expect(api.sendChat).not.toHaveBeenCalled();
    await act(async () => { ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(api.sendChat).toHaveBeenCalledTimes(1);
    expect(api.sendChat.mock.calls[0][1]).toMatchObject({ pipeline: "eng", task: "t1", message: "add a test", tool: "claude" });
  });

  it("shows the answer and real file chips the moment the turn lands", async () => {
    // the end event carries the STORED turn shape — plain file PATHS — so it has
    // to go through the same adapter the stored turns do. Skipping that renders
    // a row of blank chips on every successful turn.
    api.sendChat.mockResolvedValue({ t: "end", status: "done", exit: 0, resultCommit: "abc1234def",
      turn: { seq: 1, at: "2026-09-23T10:00:00Z", tool: "claude", model: null, message: "make it blue",
        answer: "Made it blue.", status: "done", exit: 0, files: ["src/app/features/task.jsx"], commit: "abc1234def" } });
    mount();
    await openChat();
    await type("make it blue");
    await send();
    expect(host.querySelector(".chat-answer").textContent).toBe("Made it blue.");
    expect(host.querySelector(".uxv-file .uxv-fn").textContent).toBe("task.jsx");
    expect(host.querySelector(".chat-activity")).toBeNull();
  });

  it("keeps a failed turn in the conversation with its reason", async () => {
    api.sendChat.mockResolvedValue({ t: "end", status: "failed", exit: 1, error: "the agent exited with code 1" });
    mount();
    await openChat();
    await type("break it");
    await send();
    expect(host.querySelector(".chat-err").textContent).toMatch(/the agent exited with code 1/);
    expect(host.querySelector(".chat-bub.you").textContent).toBe("break it");
  });
});

describe("one live run per task", () => {
  it("disables the composer while a stage runs and says which one", async () => {
    mount({ runningStages: new Set(["eng/t1/build"]) });
    await openChat();
    expect(composer().disabled).toBe(true);
    expect(composer().placeholder).toMatch(/Build is running — you can send as soon as it finishes/);
    expect(host.querySelector(".chat-hint").textContent).toMatch(/Build is running/);
  });

  it("disables it on a finalized task and says what to do instead", async () => {
    mount({ task: { ...task, finalized: true } });
    await openChat();
    expect(composer().disabled).toBe(true);
    expect(host.querySelector(".chat-hint").textContent).toMatch(/finalized\. Reopen a stage or create a follow-up task/);
  });

  it("pulses the bubble while a turn runs, from any view", () => {
    mount({ runningStages: new Set(["eng/t1/__chat__"]) });
    expect(bubble().classList.contains("live")).toBe(true);
    expect(bubble().querySelector(".chat-bubble-dot")).toBeTruthy();
  });
});

describe("a finished conversation is there on the next load", () => {
  it("renders the stored turns with their answer and files", async () => {
    const withTurns = { ...task, chat: { turns: [
      { seq: 1, at: "2026-09-22T11:00:00Z", tool: "claude", model: null, message: "make the header smaller",
        answer: "Made the header 13px.", status: "done", exit: 0, files: ["src/app/features/task.jsx"], commit: "abc1234def" },
    ] } };
    mount({ task: withTurns });
    await openChat();
    expect(host.querySelector(".chat-bub.you").textContent).toBe("make the header smaller");
    expect(host.querySelector(".chat-answer").textContent).toBe("Made the header 13px.");
    expect(host.querySelector(".uxv-file .uxv-fn").textContent).toBe("task.jsx");
    expect(host.querySelector(".chat-empty")).toBeNull();
  });

  it("keeps the stage runs as collapsed history, not as the subject", async () => {
    mount();
    await openChat();
    expect(host.querySelector(".chat-panel .uxv-thread")).toBeNull();   // collapsed
    await click(host.querySelector(".chat-histtog"));
    expect(host.querySelector(".chat-panel .uxv-thread")).toBeTruthy();
  });
});

describe("activityPhrase — the run stream in plain words", () => {
  it("maps the tool markers a person should not have to decode", () => {
    expect(activityPhrase("· Read board.jsx")).toBe("reading board.jsx");
    expect(activityPhrase("· Edit task.jsx")).toBe("editing task.jsx");
    expect(activityPhrase("· Write notes.md")).toBe("writing notes.md");
    expect(activityPhrase("· Bash pnpm test")).toBe("running pnpm test");
    expect(activityPhrase("· Grep useState")).toBe("searching the code");
    expect(activityPhrase("· Task dig into it")).toBe("thinking it through");
    expect(activityPhrase("$ pnpm build")).toBe("running pnpm build");
  });
  it("falls back to the tool's own name rather than inventing one", () => {
    expect(activityPhrase("· Mcp__weird__thing a/b")).toBe("Mcp__weird__thing a/b");
  });
  it("says nothing for the runner's own notes and for prose", () => {
    expect(activityPhrase("Made the header smaller.")).toBe("");
    expect(activityPhrase("· done · 4 turns · 12s")).toBe("");
  });
});
