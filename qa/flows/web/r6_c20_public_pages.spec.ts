// R6 plan section 10, C20 and the section 11 checks for the public pages.
// Runs against the owner's dev server (http://localhost:5173); signed out, no data needed.
import { expect, test } from "@playwright/test";

const BASE = process.env.QA_WEB_BASE_URL ?? "http://localhost:5173";
const AXE_URL = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const FORBIDDEN = /lender|\bAI\b|join[ -]?code|\bIPC\b|disburse|reconcil|tranche/i;

test.describe("C20 public pages", () => {
  for (const path of ["/", "/mobile-app"]) {
    test(`${path} has no lender, AI or join-code text`, async ({ page }) => {
      await page.goto(BASE + path);
      await expect(page.locator("h1")).toHaveCount(1);
      expect(await page.title()).not.toMatch(FORBIDDEN);
      expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN);
    });
  }

  test("/about redirects to the home page", async ({ page }) => {
    await page.goto(BASE + "/about");
    await expect(page).toHaveURL(BASE + "/");
  });

  for (const path of ["/", "/mobile-app", "/login"]) {
    test(`${path}: axe has no serious or critical violations`, async ({ page }) => {
      await page.goto(BASE + path);
      await page.addScriptTag({ url: AXE_URL });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe;
        const result = await axe.run(document, { resultTypes: ["violations"] });
        return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
      });
      expect(violations).toEqual([]);
    });

    for (const width of [1440, 1280, 1024, 768, 390]) {
      test(`${path} has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(BASE + path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }

  test("login inputs are labelled", async ({ page }) => {
    await page.goto(BASE + "/login");
    await expect(page.getByLabel("Work Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });
});
