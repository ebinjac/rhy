import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("documentation home is accessible and uses its public shell", async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await page.goto("/docs")
  await expect(
    page.getByRole("heading", { level: 1, name: "Rhythm documentation" })
  ).toBeVisible()
  await expect(page.getByRole("main")).toBeVisible()
  await expect(page.getByText("API monitoring", { exact: true })).toHaveCount(0)

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

test("documentation is usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/docs/monitors/javascript-sandbox")

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "JavaScript pre-request sandbox",
    })
  ).toBeVisible()

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  )
  expect(documentWidth).toBeLessThanOrEqual(375)
})

test("documentation search returns local content", async ({ request }) => {
  const response = await request.get("/api/docs-search?query=JavaScript")
  expect(response.ok()).toBeTruthy()
  const body = await response.text()
  expect(body).toContain("JavaScript")
})

test("machine-readable documentation endpoints are public", async ({
  request,
}) => {
  const endpoints = [
    "/llms.txt",
    "/llms-full.txt",
    "/docs-markdown/monitors/javascript-sandbox",
    "/robots.txt",
    "/sitemap.xml",
  ]

  for (const endpoint of endpoints) {
    const response = await request.get(endpoint)
    expect(response.ok(), endpoint).toBeTruthy()
    expect(await response.text(), endpoint).not.toHaveLength(0)
  }
})
