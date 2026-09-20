import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { FIXTURE } from "./global-setup.js";

// Visual review evidence for the categorised Settings panel: every screenshot
// embedded in review.md is produced here, against the REAL app (stub tool), so
// the pictures can be regenerated instead of trusted:
//
//   npx playwright test e2e/settings-screens.spec.js
//
// Each shot doubles as an assertion — a drifted layout fails the test before it
// writes a misleading image. The walkthrough test also records a video.
test.describe.configure({ mode: "serial" });
test.use({ video: "on", viewport: { width: 1440, height: 900 } });

const SHOTS = path.join(process.cwd(), "review-assets");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

const openApp = async (page) => {
  await page.goto("/app");
  await page.evaluate((dir) => {
    localStorage.setItem("bridza-project", dir);
    // the daily welcome dialog would sit over every shot
    const d = new Date();
    localStorage.setItem("bridza-welcome", `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }, FIXTURE);
  await page.goto("/app");
};

// Fresh fixture repo → category picker; already set up → nothing to do.
async function ensureProject(page) {
  await openApp(page);
  const pipe = page.locator(".pipe", { hasText: "Engineering" }).first();
  try { await pipe.waitFor({ state: "visible", timeout: 10_000 }); return; }
  catch { /* fresh repo — run the picker below */ }
  const pathInput = page.locator(".panel input.input");
  if (await pathInput.isVisible().catch(() => false)) {
    await pathInput.fill(FIXTURE);
    await pathInput.press("Enter");
  }
  await page.locator(".picker button", { hasText: "Engineering" }).first().click({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Create \d/ }).click();
  await pipe.waitFor({ state: "visible", timeout: 15_000 });
}

const openSettings = async (page) => {
  await page.locator(".side-footer button", { hasText: "Settings" }).click();
  await expect(page.locator(".modal.wide")).toBeVisible();
};

/* 1 ─ the walkthrough: rail, wide modal, every Terminal field, Save */
test("settings: category rail + Terminal panel, end to end", async ({ page }) => {
  await ensureProject(page);
  await openSettings(page);

  const modal = page.locator(".modal.wide");
  const rail = page.locator(".settings-cats button");
  const pane = page.locator(".settings-pane");

  // rail: one button per registry entry, first one active
  await expect(rail).toHaveCount(1);
  await expect(rail.first()).toHaveText("Terminal");
  await expect(rail.first()).toHaveAttribute("aria-current", "page");
  // two panes side by side, wide modal, no leftover inline "Terminal" heading
  await expect(page.locator(".settings-body")).toBeVisible();
  expect(Math.round((await modal.boundingBox()).width)).toBe(720);
  await expect(pane.locator(".side-label")).toHaveCount(0);
  await page.waitForTimeout(600);

  await page.screenshot({ path: shot("01-settings-in-app.png") });
  await modal.screenshot({ path: shot("02-modal-terminal.png") });

  // font family presets + Custom… → free-text CSS input appears
  const fontSelect = pane.locator("select.input");
  await expect(fontSelect.locator("option")).toHaveCount(8); // 7 presets + Custom…
  await fontSelect.selectOption("__custom__");
  const customInput = pane.locator("input.input[placeholder*='My Mono']");
  await expect(customInput).toBeVisible();
  await customInput.fill("'Fira Code', 'JetBrains Mono', monospace");
  await page.waitForTimeout(400);
  await modal.screenshot({ path: shot("03-modal-custom-font.png") });

  // size + ligatures
  const size = pane.locator("input[type='number']");
  await size.fill("18");
  const ligatures = pane.locator("input[type='checkbox']");
  await ligatures.setChecked(true);
  await page.waitForTimeout(400);
  await modal.screenshot({ path: shot("04-modal-size-ligatures.png") });

  // Save persists and closes
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal).toHaveCount(0);
  const stored = await page.evaluate(() => ({
    fontFamily: localStorage.getItem("bridza.term.fontFamily"),
    fontSize: localStorage.getItem("bridza.term.fontSize"),
    ligatures: localStorage.getItem("bridza.term.ligatures"),
  }));
  expect(stored).toEqual({ fontFamily: "'Fira Code', 'JetBrains Mono', monospace", fontSize: "18", ligatures: "1" });

  // reopen: selection is back on the first category, stored font shows in the
  // custom input (a non-preset value opens with the field already revealed)
  await openSettings(page);
  await expect(rail.first()).toHaveAttribute("aria-current", "page");
  await expect(pane.locator("input.input[placeholder*='My Mono']")).toHaveValue("'Fira Code', 'JetBrains Mono', monospace");
  await page.waitForTimeout(400);
  await modal.screenshot({ path: shot("05-modal-reopened-persisted.png") });

  // Cancel closes without writing
  await page.locator("input[type='number']").fill("11");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("bridza.term.fontSize"))).toBe("18");
});

/* 2 ─ `wide` is opt-in: every other modal keeps the 440px width */
test("other modals are unaffected by .modal.wide", async ({ page }) => {
  await ensureProject(page);
  await page.locator(".pipe", { hasText: "Engineering" }).first().click();
  await page.getByRole("button", { name: /New task/ }).click();

  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  await expect(modal).not.toHaveClass(/wide/);
  expect(Math.round((await modal.boundingBox()).width)).toBe(440);
  await page.screenshot({ path: shot("06-narrow-modal-unchanged.png") });
});

/* 3 ─ extensibility, shown rather than asserted: a stubbed two-entry registry
       (e2e/harness/settings-two.jsx) drives the same untouched SettingsModal */
test("a second registry entry adds a rail item and swaps the pane", async ({ page }) => {
  await page.goto("/e2e/harness/settings-two.html");

  const modal = page.locator(".modal.wide");
  const rail = page.locator(".settings-cats button");
  await expect(rail).toHaveCount(2);
  await expect(rail.nth(0)).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".settings-pane input[type='number']")).toBeVisible();
  await page.waitForTimeout(400);
  await modal.screenshot({ path: shot("07-two-categories-terminal.png") });

  await rail.nth(1).click();
  await expect(rail.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(rail.nth(0)).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator(".settings-pane")).toContainText("Density");
  await expect(page.locator(".settings-pane input[type='number']")).toHaveCount(0);
  await page.waitForTimeout(400);
  await modal.screenshot({ path: shot("08-two-categories-appearance.png") });
});
