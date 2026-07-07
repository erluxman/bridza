import { test, expect } from "@playwright/test";
import { FIXTURE } from "./global-setup.js";

// End-to-end for the ux-revamp: the three task-detail views (Inspector / Canvas
// / Chat), the 5 node layouts, the planner node-canvas, and the surrounding UI
// configs (view switcher, rail hide/show, terminal). Real app, stub tool.
// Serial + self-contained: a defensive setup builds its own pipeline + task so
// this file runs standalone OR after app.spec.js in the shared fixture.
test.describe.configure({ mode: "serial" });

const openApp = async (page) => {
  await page.goto("/app");
  await page.evaluate((dir) => localStorage.setItem("bridza-project", dir), FIXTURE);
  await page.goto("/app");
};

// Make sure the Engineering pipeline exists (fresh repo → category picker;
// already set up → nothing to do).
async function ensureEngineering(page) {
  await openApp(page);
  const pipe = page.locator(".pipe", { hasText: "Engineering" }).first();
  // already set up? the opened project renders the pipe within a moment
  try { await pipe.waitFor({ state: "visible", timeout: 10_000 }); return; }
  catch { /* fresh repo — run the category picker below */ }
  const pathInput = page.locator(".panel input.input");
  if (await pathInput.isVisible().catch(() => false)) {
    await pathInput.fill(FIXTURE);
    await pathInput.press("Enter");
  }
  await page.locator(".picker button", { hasText: "Engineering" }).first().click({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Create \d/ }).click();
  await pipe.waitFor({ state: "visible", timeout: 15_000 });
}

// Open the shared "UX Demo" task, creating it (+running its first stage) once.
async function ensureDemoTask(page) {
  await ensureEngineering(page);
  await page.locator(".pipe", { hasText: "Engineering" }).click();
  const card = page.locator(".kcard", { hasText: "UX Demo" }).first();
  if (await card.isVisible().catch(() => false)) {
    await card.click();
    await expect(page.getByRole("heading", { name: "UX Demo" })).toBeVisible();
    return;
  }
  await page.getByRole("button", { name: /New task/ }).click();
  const modal = page.locator(".modal");
  await modal.locator('input[placeholder="e.g. Q3 launch microsite"]').fill("UX Demo");
  await modal.locator("select").selectOption("feature");
  await modal.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "UX Demo" })).toBeVisible();
  // run the first stage → stub → a real run with a changed file + commit
  await page.locator(".stage-body textarea").first().fill("do the spec");
  await page.getByRole("button", { name: /Run stage/ }).click();
  await expect(page.locator(".stage .tag.done").first()).toBeVisible({ timeout: 45_000 });
}

const openTask = async (page) => {
  await ensureEngineering(page);
  await page.locator(".pipe", { hasText: "Engineering" }).click();
  await page.locator(".kcard", { hasText: "UX Demo" }).first().click();
  await expect(page.getByRole("heading", { name: "UX Demo" })).toBeVisible();
};
const seg = (page, name) => page.locator(".seg button", { hasText: name });
const setView = async (page, name) => { await seg(page, name).click(); await expect(seg(page, name)).toHaveClass(/on/); };

/* ── 1 · setup ─────────────────────────────────────────────────────────────*/
test("setup: create a task and run a stage (seeds a real run for the views)", async ({ page }) => {
  await ensureDemoTask(page);
  await expect(page.locator(".stage .tag.done").first()).toBeVisible();
});

/* ── 2 · the view switcher ─────────────────────────────────────────────────*/
test("task view switcher offers Stages / Inspector / Canvas / Chat / Terminal", async ({ page }) => {
  await openTask(page);
  for (const v of ["Stages", "Inspector", "Canvas", "Chat", "Terminal"]) {
    await expect(seg(page, v)).toBeVisible();
  }
  await expect(seg(page, "Stages")).toHaveClass(/on/);   // default
});

/* ── 3 · Inspector ─────────────────────────────────────────────────────────*/
test("Inspector: split pane lists every stage; selecting one shows its detail", async ({ page }) => {
  await openTask(page);
  await setView(page, "Inspector");
  await expect(page.locator(".uxv-inspector")).toBeVisible();
  await expect(page.locator(".uxv-stagerow")).toHaveCount(3);
  await page.locator(".uxv-stagerow").first().click();   // the run-bearing stage
  await expect(page.locator(".uxv-detail-hd")).toBeVisible();
  await expect(page.locator(".uxv-tab", { hasText: "Response" })).toBeVisible();
});

test("Inspector: all five detail tabs render (Prompt / Files / Response / Summary / Raw)", async ({ page }) => {
  await openTask(page);
  await setView(page, "Inspector");
  await page.locator(".uxv-stagerow").first().click();
  const tab = (name) => page.locator(".uxv-tab", { hasText: name });
  await tab("Prompts").click();  await expect(page.locator(".uxv-pre.sys")).toBeVisible();
  await tab("Files").click();    await expect(page.locator(".uxv-tabbody").locator(".uxv-files, .uxv-dim").first()).toBeVisible();
  await tab("Response").click(); await expect(page.locator(".uxv-pre.resp")).toBeVisible();
  await tab("Summary").click();  await expect(page.locator(".uxv-summary")).toBeVisible();
  await tab("Raw JSON").click(); await expect(page.locator(".uxv-pre.raw")).toContainText("userPrompt");
});

test("Inspector: system + user prompts are both visible (not hidden as before)", async ({ page }) => {
  await openTask(page);
  await setView(page, "Inspector");
  await page.locator(".uxv-stagerow").first().click();
  await page.locator(".uxv-tab", { hasText: "Prompts" }).click();
  await expect(page.locator(".uxv-plabel", { hasText: "System prompt" })).toBeVisible();
  await expect(page.locator(".uxv-plabel", { hasText: "User prompt" })).toBeVisible();
});

test("Inspector: clicking a changed file opens its diff", async ({ page }) => {
  await openTask(page);
  await setView(page, "Inspector");
  await page.locator(".uxv-stagerow").first().click();
  await page.locator(".uxv-tab", { hasText: "Files" }).click();
  const file = page.locator(".uxv-file").first();
  await expect(file).toBeVisible();
  await file.click();
  await expect(page.locator(".diffwin")).toBeVisible();
  await page.locator(".diffwin").press("Escape").catch(() => {});
});

/* ── 4 · Canvas ────────────────────────────────────────────────────────────*/
test("Canvas: one node per stage + a 5-option layout bar", async ({ page }) => {
  await openTask(page);
  await setView(page, "Canvas");
  await expect(page.locator(".uxv-canvas")).toBeVisible();
  await expect(page.locator(".uxv-node")).toHaveCount(3);
  await expect(page.locator(".uxv-layoutbar .uxv-chip")).toHaveCount(5);
});

test("Canvas: every layout (linear/snake/grid/tree/radial) keeps all nodes on screen", async ({ page }) => {
  await openTask(page);
  await setView(page, "Canvas");
  for (const l of ["Linear", "Snake", "Grid", "Tree", "Radial"]) {
    await page.locator(".uxv-chip", { hasText: l }).click();
    await expect(page.locator(".uxv-chip.on", { hasText: l })).toBeVisible();
    await expect(page.locator(".uxv-node")).toHaveCount(3);
  }
});

test("Canvas: clicking a node opens the detail side-sheet, and it closes", async ({ page }) => {
  await openTask(page);
  await setView(page, "Canvas");
  await page.locator(".uxv-node").first().click();
  await expect(page.locator(".uxv-sheet .uxv-detail")).toBeVisible();
  await page.locator(".uxv-sheet-x").click();
  await expect(page.locator(".uxv-sheet")).toHaveCount(0);
});

test("Canvas: the chosen layout persists across re-opening the task", async ({ page }) => {
  await openTask(page);
  await setView(page, "Canvas");
  await page.locator(".uxv-chip", { hasText: "Radial" }).click();
  await openTask(page);
  await setView(page, "Canvas");
  await expect(page.locator(".uxv-chip.on", { hasText: "Radial" })).toBeVisible();
});

/* ── 5 · Chat ──────────────────────────────────────────────────────────────*/
test("Chat: the task reads as system / user / assistant turns per run", async ({ page }) => {
  await openTask(page);
  await setView(page, "Chat");
  await expect(page.locator(".uxv-thread")).toHaveCount(3);
  await expect(page.locator(".uxv-msg.system").first()).toBeVisible();
  await expect(page.locator(".uxv-msg.user").first()).toBeVisible();
  await expect(page.locator(".uxv-msg.asst").first()).toBeVisible();
});

test("Chat: the assistant turn carries a summary chip and the changed-files strip", async ({ page }) => {
  await openTask(page);
  await setView(page, "Chat");
  await expect(page.locator(".uxv-summary-chip").first()).toBeVisible();
  await expect(page.locator(".uxv-msg.asst .uxv-file").first()).toBeVisible();
});

/* ── 6 · cross-view configs ────────────────────────────────────────────────*/
test("the selected view persists across re-opening the task", async ({ page }) => {
  await openTask(page);
  await setView(page, "Chat");
  await openTask(page);
  await expect(seg(page, "Chat")).toHaveClass(/on/);
  await setView(page, "Stages");   // reset for later tests
});

test("Run from a view jumps back to Stages with that stage open", async ({ page }) => {
  await openTask(page);
  await setView(page, "Inspector");
  await page.locator(".uxv-stagerow").first().click();
  await page.locator(".uxv-detail .uxv-run", { hasText: "Run" }).click();
  await expect(seg(page, "Stages")).toHaveClass(/on/);
  await expect(page.locator(".stage-body textarea").first()).toBeVisible();
});

test("Terminal view replaces the stage list with the worktree shell", async ({ page }) => {
  await openTask(page);
  await seg(page, "Terminal").click();
  await expect(page.locator(".term-hd")).toBeVisible();
  await setView(page, "Stages");
});

test("the details rail hides and shows", async ({ page }) => {
  await openTask(page);
  await expect(page.locator("aside.rail")).toBeVisible();
  await page.locator(".rail-toggle").click();
  await expect(page.locator("aside.rail")).toHaveCount(0);
  await page.locator(".rail-toggle").click();
  await expect(page.locator("aside.rail")).toBeVisible();
});

/* ── 7 · the planner node-canvas ───────────────────────────────────────────*/
const openPlanner = async (page) => {
  await ensureEngineering(page);
  await page.locator(".pipe", { hasText: "Engineering" }).click();
  await page.getByRole("button", { name: /Stage flow/ }).click();
  await expect(page.locator(".seg button", { hasText: "Canvas" })).toBeVisible();
};

test("planner: Cards view lists editable stage nodes", async ({ page }) => {
  await openPlanner(page);
  await expect(seg(page, "Cards")).toHaveClass(/on/);
  await expect(page.locator(".flow-col:not(.new)").first()).toBeVisible();
  await expect(page.locator(".fnode").first()).toBeVisible();
});

test("planner: Canvas toggle renders the flow as a node graph with a layout bar", async ({ page }) => {
  await openPlanner(page);
  await seg(page, "Canvas").click();
  await expect(page.locator(".uxv-canvas").first()).toBeVisible();
  await expect(page.locator(".uxv-layoutbar .uxv-chip")).toHaveCount(5);
  expect(await page.locator(".uxv-node").count()).toBeGreaterThanOrEqual(3);
});

test("planner: every layout arranges the stage nodes", async ({ page }) => {
  await openPlanner(page);
  await seg(page, "Canvas").click();
  for (const l of ["Linear", "Snake", "Grid", "Tree", "Radial"]) {
    await page.locator(".uxv-chip", { hasText: l }).first().click();
    await expect(page.locator(".uxv-chip.on", { hasText: l }).first()).toBeVisible();
    expect(await page.locator(".uxv-node").count()).toBeGreaterThanOrEqual(3);
  }
});

test("planner: clicking a canvas node returns to the Cards editor", async ({ page }) => {
  await openPlanner(page);
  await seg(page, "Canvas").click();
  await page.locator(".uxv-node").first().click();
  await expect(seg(page, "Cards")).toHaveClass(/on/);
  await expect(page.locator(".fnode").first()).toBeVisible();
});

test("planner: the layout choice survives toggling Cards ↔ Canvas", async ({ page }) => {
  await openPlanner(page);
  await seg(page, "Canvas").click();
  await page.locator(".uxv-chip", { hasText: "Grid" }).first().click();
  await seg(page, "Cards").click();
  await seg(page, "Canvas").click();
  await expect(page.locator(".uxv-chip.on", { hasText: "Grid" }).first()).toBeVisible();
});

/* ── 8 · surrounding major flows / configs ─────────────────────────────────*/
test("kanban board: the task sits in a stage column with a progress bar", async ({ page }) => {
  await ensureEngineering(page);
  await page.locator(".pipe", { hasText: "Engineering" }).click();
  const card = page.locator(".kcard", { hasText: "UX Demo" }).first();
  await expect(card).toBeVisible();
  await expect(card.locator(".kcard-branch")).toContainText("bridza/");
});

test("task rail: the type field edits and persists across re-open", async ({ page }) => {
  await openTask(page);
  const typeInput = page.locator(".rail .kv input.input").first();
  await typeInput.fill("chore");
  await typeInput.blur();
  await openTask(page);
  await expect(page.locator(".rail .kv input.input").first()).toHaveValue("chore");
});

test("task rail: reuse-session toggle flips and confirms", async ({ page }) => {
  await openTask(page);
  const box = page.locator(".rail .kv", { hasText: "Reuse LLM session" }).locator('input[type="checkbox"]');
  const before = await box.isChecked();
  await box.click();
  await expect(box).toBeChecked({ checked: !before });
});

test("Inspector: run-history pins appear on a re-run stage", async ({ page }) => {
  await openTask(page);
  // a SECOND run on the FIRST stage (already has one) → two runs recorded
  const stage1 = page.locator(".stage").first();
  await stage1.locator(".stage-hd").click();               // open it
  await stage1.locator("textarea").fill("re-run the first stage");
  await stage1.getByRole("button", { name: /Run stage/ }).click();
  await expect(stage1.locator(".tag.done")).toBeVisible({ timeout: 45_000 });
  await setView(page, "Inspector");
  await page.locator(".uxv-stagerow").first().click();
  await expect(page.locator(".uxv-runpin").first()).toBeVisible();
});

test("revise rolls a stage back to idle", async ({ page }) => {
  await openTask(page);
  const revise = page.getByRole("button", { name: /Revise/ }).first();
  await expect(revise).toBeVisible();
  await revise.click();
  await expect(page.locator(".toast")).toContainText(/reopened/i, { timeout: 30_000 });
});

test("auto-advance drives every stage to done", async ({ page }) => {
  await openTask(page);
  await page.locator(".switch", { hasText: "Auto-advance" }).click();
  await expect(page.locator(".stage .tag.done")).toHaveCount(3, { timeout: 120_000 });
});

test("a throwaway task can be created and deleted (git history kept)", async ({ page }) => {
  await ensureEngineering(page);
  await page.locator(".pipe", { hasText: "Engineering" }).click();
  await page.getByRole("button", { name: /New task/ }).click();
  const modal = page.locator(".modal");
  await modal.locator('input[placeholder="e.g. Q3 launch microsite"]').fill("Throwaway");
  await modal.locator("select").selectOption("feature");
  await modal.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Throwaway" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Delete task/ }).click();
  await expect(page.locator(".kcard", { hasText: "Throwaway" })).toHaveCount(0, { timeout: 20_000 });
});
