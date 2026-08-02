import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "line",
  use: {
    baseURL: process.env.TOUR_RELEASE_URL || "http://127.0.0.1:8080",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
    { name: "chromium-android", use: { ...devices["Pixel 7"] } }
  ]
});
