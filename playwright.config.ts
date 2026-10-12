import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3210";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3210",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
