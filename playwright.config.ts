import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke + accessibility checks. These run against the built
// preview server, not the dev server, so they exercise what actually ships.
// Vitest owns tests/*.test.js (unit); Playwright owns tests/e2e/*.spec.ts.
const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // In CI we `playwright install chromium` so the bundled browser is used.
    // Locally, PW_CHROME_PATH can point at an already-present Chromium so the
    // suite runs without a separate download.
    ...(process.env.PW_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROME_PATH } }
      : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Build already ran in CI; here we just serve dist. Reuse an
  // already-running preview locally so the suite is quick to iterate on.
  webServer: {
    command: `npm run preview -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
