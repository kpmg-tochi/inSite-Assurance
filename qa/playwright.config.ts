import { defineConfig, devices } from '@playwright/test';

/**
 * UI verification flows (saas_updates/ui_verification_and_design_plan.md).
 * The web app (5173) and API (4000) are started by the owner; there is deliberately no webServer block.
 * Run from the repo root: npx playwright test -c qa/playwright.config.ts
 */
export default defineConfig({
  testDir: './flows/web',
  outputDir: './.playwright/test-results',
  fullyParallel: false,
  workers: 1, // one shared database and a 20-per-15-minutes login limit per IP
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: './.playwright/report', open: 'never' }]],
  globalSetup: './flows/web/support/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
