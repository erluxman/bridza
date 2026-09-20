// Regression (task #105) — the open task is named in the URL, so a refresh (or
// a shared link, or the back button) reopens that task instead of dropping back
// to the board/home.
import { test, expect } from "@playwright/test";
import { FIXTURE } from "./global-setup.js";

// Serial: the second test reuses the project + pipeline the first one sets up.
test.describe.configure({ mode: "serial" });

// Open the fixture project, suppressing the once-a-day welcome dialog (it
// overlays the app and would swallow the clicks below).
const openApp = async (page) => {
  await page.goto("/app");
  await page.evaluate((dir) => {
    localStorage.setItem("bridza-project", dir);
    const d = new Date();
    localStorage.setItem("bridza-welcome", `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }, FIXTURE);
  await page.goto("/app");
};

// Make sure the Engineering pipeline exists — this file runs standalone against
// a virgin fixture OR after app.spec.js has already set one up.
async function ensureEngineering(page) {
  await openApp(page);
  const pipe = page.locator(".pipe", { hasText: "Engineering" }).first();
  try { await pipe.waitFor({ state: "visible", timeout: 10_000 }); return pipe; }
  catch { /* fresh repo — run the category picker below */ }
  await page.locator(".picker button", { hasText: "Engineering" }).first().click({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Create \d/ }).click();
  await pipe.waitFor({ state: "visible", timeout: 15_000 });
  return pipe;
}

test("the open task is in the URL, and a refresh reopens it", async ({ page }) => {
  const pipe = await ensureEngineering(page);
  await pipe.click();
  // the board names its pipeline, even before a task is opened
  await expect(page).toHaveURL(/\/app\/engineering$/);

  await page.getByRole("button", { name: /New task/ }).click();
  const modal = page.locator(".modal");
  await modal.locator('input[placeholder="e.g. Q3 launch microsite"]').fill("URL Task 105");
  await modal.locator("select").selectOption("feature");
  await modal.getByRole("button", { name: "Create", exact: true }).click();

  const heading = page.getByRole("heading", { name: "URL Task 105" });
  await expect(heading).toBeVisible();
  await expect(page).toHaveURL(/\/app\/engineering\/[a-z0-9-]+$/);
  const taskUrl = page.url();

  // back steps through in-app history instead of leaving the app
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/engineering$/);
  await expect(heading).toHaveCount(0);
  await page.goForward();
  await expect(heading).toBeVisible();

  // the regression itself: a refresh reopens the same task, not the board
  await page.reload();
  await expect(heading).toBeVisible();
  expect(page.url()).toBe(taskUrl);

  // and the task URL works cold, as a pasted link
  await page.goto("/app");
  await expect(heading).toHaveCount(0);
  await page.goto(taskUrl);
  await expect(heading).toBeVisible();
});

test("the non-board views are in the URL too", async ({ page }) => {
  await openApp(page);

  await page.locator(".pipe", { hasText: "Inbox" }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=inbox/);

  await page.reload();
  await expect(page).toHaveURL(/[?&]view=inbox/);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
});
