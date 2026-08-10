import { expect, test } from "@playwright/test"

async function webReachable(baseURL: string | undefined): Promise<boolean> {
  if (!baseURL) return false
  try {
    const response = await fetch(new URL("/healthz", baseURL), {
      signal: AbortSignal.timeout(2500),
    })
    return response.ok
  } catch {
    return false
  }
}

test.describe("product smoke", () => {
  test.beforeEach(async ({ baseURL }, testInfo) => {
    if (!(await webReachable(baseURL))) {
      testInfo.skip(
        true,
        `Web unreachable at ${baseURL ?? "(unset)"}; start compose web or set RHYTHM_WEB_URL`
      )
    }
  })

  test("monitors page loads", async ({ page }) => {
    await page.goto("/monitors")
    await expect(page).toHaveURL(/\/monitors/)
    await expect(page.locator("body")).toBeVisible()
  })

  test("configuration page loads", async ({ page }) => {
    await page.goto("/configuration")
    await expect(page).toHaveURL(/\/configuration/)
    await expect(page.locator("body")).toBeVisible()
  })
})
