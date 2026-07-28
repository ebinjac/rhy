import { defineConfig, devices } from "@playwright/test"

const viewports = [
  { name: "mobile", viewport: { width: 375, height: 812 } },
  { name: "tablet", viewport: { width: 768, height: 1024 } },
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "wide", viewport: { width: 1600, height: 1000 } },
] as const

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 2,
  use: {
    baseURL: process.env.RHYTHM_WEB_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: viewports.flatMap(({ name, viewport }) =>
    (["light", "dark"] as const).map((colorScheme) => ({
      name: `${name}-${colorScheme}`,
      use: {
        ...devices["Desktop Chrome"],
        colorScheme,
        viewport,
      },
    }))
  ),
})
