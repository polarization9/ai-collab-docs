import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: {
    timeout: 10000
  },
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    headless: true,
    trace: "on-first-retry",
    viewport: { width: 1280, height: 800 }
  }
});
