import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./client/e2e", timeout: 30000, workers: 1, reporter: "line",
  use: { baseURL: "http://127.0.0.1:4173", headless: true, ...(process.platform === "win32" ? { channel: "chrome" } : {}), trace: "retain-on-failure" },
  globalSetup: "./scripts/playwright-setup.js",
});
