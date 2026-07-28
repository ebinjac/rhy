import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const primaryRoutes = [
  "/",
  "/monitors",
  "/applications",
  "/elf",
  "/elf/runs",
  "/alerts",
  "/suites",
  "/configuration",
  "/configuration?kind=certificates",
  "/configuration?kind=proxies",
  "/configuration?kind=auth",
  "/configuration?kind=environments",
  "/configuration?kind=telemetry",
  "/audit",
]

for (const route of primaryRoutes) {
  test(`${route} has no serious accessibility violations`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    await page.goto(route)
    await expect(page.locator("#main-content")).toBeVisible()

    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()

    expect(
      result.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? "")
      )
    ).toEqual([])
    expect(consoleErrors, "browser console errors").toEqual([])
  })
}

test("skip link moves keyboard focus to the main content", async ({ page }) => {
  await page.goto("/")
  await page.keyboard.press("Tab")
  const skipLink = page.getByRole("link", { name: /skip to content/i })
  await expect(skipLink).toBeFocused()
  await skipLink.press("Enter")
  await expect(page.locator("#main-content")).toBeFocused()
})
