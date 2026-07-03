import { test, expect } from "@playwright/test";
import { FIXTURE } from "./global-setup.js";

// End-to-end: drive the real app through a full task lifecycle with the stub tool,
// and assert the features built this session (auto-advance toggle, running-tasks,
// readable trail, fixed project switcher).
test("open project → create pipeline + task → run a stage → verify features", async ({ page }) => {
  // 1 · fresh app on the test server
  await page.goto("/app");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app");

  // 2 · open the fixture repo via the "paste a path" field
  const pathInput = page.locator(".panel input.input");
  await expect(pathInput).toBeVisible();
  await pathInput.fill(FIXTURE);
  await pathInput.press("Enter");

  // 3 · fresh repo → pipeline picker; pick Agile SDLC and create it
  await expect(page.getByRole("heading", { name: /Set up/ })).toBeVisible();
  await page.locator(".picker button", { hasText: "Agile SDLC" }).click();
  await page.getByRole("button", { name: /^Create/ }).click();

  // 4 · pipeline shows in the sidebar
  await expect(page.locator(".pipe", { hasText: "Agile SDLC" })).toBeVisible();

  // 5 · create a task
  await page.getByRole("button", { name: /New task/ }).click();
  await page.locator('input[placeholder="e.g. Q3 launch microsite"]').fill("E2E Task");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // 6 · task header has: title · Open in VS Code · Auto-advance toggle · Finalize
  await expect(page.getByRole("heading", { name: "E2E Task" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open in VS Code/ })).toBeVisible();
  await expect(page.locator(".switch", { hasText: "Auto-advance" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Finalize/ })).toBeVisible();

  // 7 · project-switcher dropdown fix — long paths truncate, no overflow bleed
  await page.locator(".proj-btn").click();
  await expect(page.locator(".proj-menu")).toBeVisible();
  const textOverflow = await page.locator(".proj-menu .path").first()
    .evaluate((el) => getComputedStyle(el).textOverflow);
  expect(textOverflow).toBe("ellipsis");
  await page.locator(".proj-btn").click(); // toggle the menu closed
  await expect(page.locator(".proj-menu")).toBeHidden();

  // 8 · run the first stage (Vision) — stub tool makes it instant + deterministic
  const textarea = page.locator(".stage-body textarea").first();
  await expect(textarea).toBeVisible();
  await textarea.fill("do the vision");
  await page.getByRole("button", { name: /Run stage/ }).click();

  // 9 · the run committed a timeline (prompt + result) and the stage went done
  await expect.poll(() => page.locator(".timeline .tl").count(), { timeout: 45_000 })
    .toBeGreaterThan(0);
  await expect(page.locator(".stage .tag.done").first()).toBeVisible({ timeout: 45_000 });

  // 10 · auto-advance toggle actually drives the remaining stages (stub).
  // The checkbox is visually hidden (styled slider), so click its label.
  await page.locator(".switch").click();
  await expect.poll(() => page.locator(".stage .tag.done").count(), { timeout: 90_000 })
    .toBeGreaterThan(1);
});
