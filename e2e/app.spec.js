import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { FIXTURE } from "./global-setup.js";

// End-to-end over the REAL app with a stub CLI tool (instant, deterministic).
// Serial: each test builds on the project state the previous one left behind —
// a failure skips the rest instead of cascading into misleading errors.
test.describe.configure({ mode: "serial" });

const openApp = async (page) => {
  await page.goto("/app");
  await page.evaluate((dir) => localStorage.setItem("bridza-project", dir), FIXTURE);
  await page.goto("/app");
};

/* 1 ─ first run: category picker → create two category pipelines */
test("first run: pick Engineering + Product from the category catalog", async ({ page }) => {
  await page.goto("/app");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app");

  const pathInput = page.locator(".panel input.input");
  await expect(pathInput).toBeVisible();
  await pathInput.fill(FIXTURE);
  await pathInput.press("Enter");

  // the picker lists the business categories with their flow summaries
  await expect(page.getByRole("heading", { name: /Set up/ })).toBeVisible();
  await expect(page.locator(".picker button", { hasText: "Engineering" })).toContainText("flows");
  await expect(page.locator(".picker button", { hasText: "Marketing & Growth" })).toBeVisible();
  await page.locator(".picker button", { hasText: "Engineering" }).click();
  await page.locator(".picker button", { hasText: /Product\s*$|Product\b(?!-| Copy)/ }).filter({ hasNotText: "Market" }).click();
  await page.getByRole("button", { name: /^Create 2/ }).click();

  await expect(page.locator(".pipe", { hasText: "Engineering" })).toBeVisible();
  await expect(page.locator(".pipe", { hasText: "Product" })).toBeVisible();
});

/* 2 ─ tasks: flow choice is MANDATORY on multi-flow pipelines; a stage runs */
test("new task must pick a flow; the chosen flow's stages run with the stub", async ({ page }) => {
  await openApp(page);
  await page.locator(".pipe", { hasText: "Engineering" }).click();
  await page.getByRole("button", { name: /New task/ }).click();

  const modal = page.locator(".modal");
  await modal.locator('input[placeholder="e.g. Q3 launch microsite"]').fill("E2E Feature");
  // no flow chosen → Create refuses (modal stays open)
  await modal.getByRole("button", { name: "Create", exact: true }).click();
  await expect(modal).toBeVisible();
  // flow select carries every Engineering flow; pick Feature
  const flowSel = modal.locator("select");
  await expect(flowSel.locator("option", { hasText: "Full product SDLC" })).toHaveCount(1);
  await flowSel.selectOption("feature");
  await modal.getByRole("button", { name: "Create", exact: true }).click();

  // the task got EXACTLY the Feature flow's stages
  await expect(page.getByRole("heading", { name: "E2E Feature" })).toBeVisible();
  await expect(page.locator(".stage-hd", { hasText: "Spec" })).toBeVisible();
  await expect(page.locator(".stage-hd", { hasText: "Build" })).toBeVisible();
  await expect(page.locator(".stage-hd")).toHaveCount(3);

  // run the first stage — stub tool → done
  const textarea = page.locator(".stage-body textarea").first();
  await textarea.fill("do the spec");
  await page.getByRole("button", { name: /Run stage/ }).click();
  await expect(page.locator(".stage .tag.done").first()).toBeVisible({ timeout: 45_000 });
});

/* 3 ─ stage flows editor: columns, handoff, judge exclusivity, specs, save */
test("stage flows editor: side-by-side flows, handoff selector, one judge per flow, specs", async ({ page }) => {
  await openApp(page);
  await page.locator(".pipe", { hasText: /Product\s*\d+$/ }).click();
  await page.getByRole("button", { name: /Stage flow/ }).click();

  // one designer column per flow
  const cols = page.locator(".flow-col:not(.new)");
  await expect(cols).toHaveCount(2);
  await expect(cols.nth(0).locator(".flow-name")).toHaveValue("Feedback → Roadmap");
  await expect(cols.nth(1).locator(".flow-name")).toHaveValue("Product Spec & Planning");

  // starter handoffs are preselected (product-spec → engineering/dissection)
  const handoff = (col) => col.locator("select").filter({ hasText: "— none" }).first();
  await expect(handoff(cols.nth(1))).toHaveValue("engineering/dissection");
  await expect(handoff(cols.nth(0))).toHaveValue("engineering/feature");

  // judge is exclusive per flow: flag another stage, the old flag clears
  const judges = cols.nth(0).locator(".fnode-auto", { hasText: "⚖" });
  await expect(cols.nth(0).locator(".fnode-auto.judge")).toHaveCount(1);
  await judges.first().click();                     // move judge to stage 1
  await expect(cols.nth(0).locator(".fnode-auto.judge")).toHaveCount(1);
  await judges.first().click();                     // toggle off entirely
  await expect(cols.nth(0).locator(".fnode-auto.judge")).toHaveCount(0);
  await judges.nth(1).click();                      // restore the original judge
  await expect(cols.nth(0).locator(".fnode-auto.judge")).toHaveCount(1);

  // add a predefined spec from the grouped dropdown + fill its value
  const firstNode = cols.nth(0).locator(".fnode").first();
  await firstNode.locator("select.spec-add").selectOption("target-os");
  const chip = firstNode.locator(".ochip").filter({ has: page.locator('input[value="target-os"]') });
  await chip.locator(".ochip-val").fill("iOS, Android");

  await page.getByRole("button", { name: "Save flows" }).click();
  await expect(page.getByRole("button", { name: "Save flows" })).toBeDisabled();

  // persisted: reload the editor and the spec is still there
  await page.reload();
  await page.locator(".pipe", { hasText: /Product\s*\d+$/ }).click();
  await page.getByRole("button", { name: /Stage flow/ }).click();
  await expect(page.locator('.fnode input[value="target-os"]').first()).toBeVisible();
});

/* 4 ─ portability: export the whole pipeline, import it as a new one, import one flow */
test("export pipeline → import as new pipeline; import a single flow from a pipeline file", async ({ page }) => {
  await openApp(page);
  await page.locator(".pipe", { hasText: /Product\s*\d+$/ }).click();
  await page.getByRole("button", { name: /Stage flow/ }).click();

  // export downloads a bridza-pipeline JSON
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export pipeline/ }).click();
  const file = await (await dl).path();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(parsed.kind).toBe("bridza-pipeline");
  expect(parsed.flows.length).toBe(2);

  // import it from ＋ New pipeline (renamed to avoid the id clash)
  await page.locator(".pipe", { hasText: "＋ New pipeline" }).click();
  const modal = page.locator(".modal");
  await modal.locator('input[type="file"]').setInputFiles(file);
  await expect(modal.locator(".tag", { hasText: "2 flows" })).toBeVisible();
  await modal.locator("input.input").first().fill("Product Copy");
  await modal.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".pipe", { hasText: "Product Copy" })).toBeVisible();

  // import ONE flow out of the pipeline file: a picker offers the flows
  await page.locator(".pipe", { hasText: "Engineering" }).click();
  await page.getByRole("button", { name: /Stage flow/ }).click();
  await page.locator(".flow-col.new input[type=file]").setInputFiles(file);
  const picker = page.locator(".modal");
  await expect(picker.getByRole("heading", { name: /Import flows from/ })).toBeVisible();
  await picker.locator('input[type="checkbox"]').first().uncheck();          // drop flow 1
  await picker.getByRole("button", { name: /^Import 1 flow$/ }).click();
  await expect(page.locator(".flow-name").last()).toHaveValue("Product Spec & Planning");
  // don't save — leave Engineering unchanged for later tests
});

/* 5 ─ archive: hidden from the list, data kept, restorable */
test("archive hides a pipeline behind the Archived toggle; unarchive restores it", async ({ page }) => {
  await openApp(page);
  await page.locator(".pipe", { hasText: "Product Copy" }).click();
  await page.getByRole("button", { name: /Stage flow/ }).click();
  await page.getByRole("button", { name: /Archive/ }).click();

  await expect(page.locator(".pipe:not(.archived):not(.arch-tog)", { hasText: "Product Copy" })).toHaveCount(0);
  const tog = page.locator(".pipe.arch-tog");
  await expect(tog).toContainText("Archived");
  await tog.click();
  const archived = page.locator(".pipe.archived", { hasText: "Product Copy" });
  await expect(archived).toBeVisible();

  await archived.click();
  await page.getByRole("button", { name: /Stage flow/ }).click();
  await page.getByRole("button", { name: /Unarchive/ }).click();
  await expect(page.locator(".pipe:not(.archived)", { hasText: "Product Copy" })).toBeVisible();
});

/* 6 ─ plan board: pipeline timeline, auto-gated downstream task, cost estimates */
test("pipeline timeline gates downstream tasks; estimates weight the critical path", async ({ page }) => {
  await openApp(page);

  // the starter handoff materialized a Product → Engineering edge at creation
  await page.locator(".pipe", { hasText: "🗺 Plan" }).click();
  await expect(page.locator(".pipe-strip")).toBeVisible();
  await expect(page.locator(".pipe-edge", { hasText: "Product → Engineering" })).toBeVisible();
  expect(await page.locator(".pipe-chip").count()).toBeGreaterThanOrEqual(3);

  // create an OPEN Product task, then a NEW Engineering task → auto-gated → blocked
  await page.locator(".pipe", { hasText: /Product\s*\d+$/ }).click();
  await page.getByRole("button", { name: /New task/ }).click();
  let modal = page.locator(".modal");
  await modal.locator('input[placeholder="e.g. Q3 launch microsite"]').fill("Write the spec");
  await modal.locator("select").selectOption("feedback-roadmap");
  await modal.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Write the spec" })).toBeVisible();

  await page.locator(".pipe", { hasText: "Engineering" }).click();
  await page.getByRole("button", { name: /New task/ }).click();
  modal = page.locator(".modal");
  await modal.locator('input[placeholder="e.g. Q3 launch microsite"]').fill("Gated build");
  await modal.locator("select").selectOption("feature");
  await modal.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Gated build" })).toBeVisible();

  // the gated task's stage refuses to run (server-enforced plan gate)
  await page.locator(".stage-body textarea").first().fill("try it");
  await page.getByRole("button", { name: /Run stage/ }).click();
  await expect(page.locator(".toast")).toContainText(/blocked by the plan/i, { timeout: 30_000 });

  // the board shows it blocked; set a cost estimate and see it on the node + path
  await page.locator(".pipe", { hasText: "🗺 Plan" }).click();
  const blocked = page.locator(".plan-node.blocked", { hasText: "Gated build" });
  await expect(blocked).toBeVisible();
  await blocked.click();
  const panel = page.locator(".plan-panel");
  await expect(panel).toContainText("Cost estimate");
  await panel.locator('input[type="number"]').fill("8");
  await expect(page.locator(".pn-est", { hasText: "~8h" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Critical path/ })).toContainText("h");

  // connect + disconnect an edge from the strip (click source, then target)
  await page.locator(".pipe-chip", { hasText: "Engineering" }).click();
  await expect(page.locator(".pipe-chip.src")).toHaveCount(1);
  await page.locator(".pipe-chip", { hasText: "Product Copy" }).click();
  const newEdge = page.locator(".pipe-edge", { hasText: "Engineering → Product Copy" });
  await expect(newEdge).toBeVisible();
  await newEdge.locator("button").click();
  await expect(newEdge).toHaveCount(0);
});

/* 7 ─ flow handoff: deliver the upstream task → one-click follow-on, plan-gated */
test("a delivered task follows on into its handoff flow, gated on the source", async ({ page }) => {
  await openApp(page);
  // finish "Write the spec" (Feedback → Roadmap, 3 stages) via auto-advance + stub
  await page.locator(".pipe", { hasText: /Product\s*\d+$/ }).click();
  await page.locator(".kcard", { hasText: "Write the spec" }).first().click();
  await expect(page.getByRole("heading", { name: "Write the spec" })).toBeVisible();

  const followBtn = page.getByRole("button", { name: /→ Feature/ });
  await expect(followBtn).toBeVisible();          // handoff declared by the flow
  await expect(followBtn).toBeDisabled();         // …but only after delivery

  // #39 — opening the task ran nothing: start the first stage by hand, and ⚡
  // auto-advance (on by default) carries the rest; the run-log pane shows it
  await expect(page.locator(".term")).toHaveCount(0);
  await page.getByRole("button", { name: /Run (stage|again)/ }).first().click();
  await expect(page.locator(".stage .tag.done")).toHaveCount(3, { timeout: 120_000 });
  await expect(page.locator(".term").first()).toBeVisible();

  await expect(followBtn).toBeEnabled();
  await followBtn.click();
  // we land on the follow-on task in Engineering: same title, FEATURE flow
  // stages (Build exists only there, not in Feedback → Roadmap)
  await expect(page.locator(".stage-hd", { hasText: "Build" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".stage-hd")).toHaveCount(3);
});

/* 8 ─ AI pipeline recommendation entry points exist (LLM itself not exercised) */
test("recommendation UI is wired in the New pipeline modal", async ({ page }) => {
  await openApp(page);
  await page.locator(".pipe", { hasText: "＋ New pipeline" }).click();
  const modal = page.locator(".modal");
  await expect(modal.getByRole("button", { name: /Analyze with AI/ })).toBeVisible();
  await expect(modal.locator("select option")).toHaveCount(11);   // the 11 categories
});
