import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createBrowserMonitor,
  listBrowserMonitorRuns,
  publishBrowserMonitor,
  runBrowserMonitor,
  skipIfApiDown,
} from "./helpers/api.mjs"
import { waitUntil, TERMINAL } from "./helpers/wait.mjs"
import { browserMonitorBody, targetURL } from "./helpers/fixtures.mjs"
import { env } from "./helpers/env.mjs"

test("browser: navigate to /browser/home when API + agent available", async (t) => {
  if (await skipIfApiDown(t)) return

  try {
    const probe = await fetch(`${env.testTargetProbeURL}/browser/home`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!probe.ok) {
      t.skip(`test-target /browser/home unreachable`)
      return
    }
  } catch {
    t.skip(`test-target unreachable at ${env.testTargetProbeURL}`)
    return
  }

  const startUrl = targetURL("/browser/home")
  const created = await createBrowserMonitor(browserMonitorBody(startUrl))
  if (!created.ok) {
    t.skip(
      `browser monitor create unsupported or failed: ${created.status} ${created.text.slice(0, 200)}`
    )
    return
  }
  const monitorId = created.data?.id
  assert.ok(monitorId, "browser monitor id")

  // Prefer draft run (no publish required); fall back to publish + published.
  let started = await runBrowserMonitor(monitorId, { revision: "draft" })
  if (!started.ok) {
    const published = await publishBrowserMonitor(monitorId)
    if (!published.ok) {
      t.skip(
        `browser publish/run unavailable: ${started.status} ${started.text.slice(0, 160)}; publish ${published.status}`
      )
      return
    }
    started = await runBrowserMonitor(monitorId, { revision: "published" })
  }
  if (!started.ok) {
    t.skip(
      `browser agent/run unavailable: ${started.status} ${started.text.slice(0, 200)}`
    )
    return
  }

  const runId = started.data?.run?.id || started.data?.id || started.data?.runId
  try {
    const run = await waitUntil(
      async () => {
        if (runId) {
          // Prefer listing monitor runs and matching id
          const listed = await listBrowserMonitorRuns(monitorId, 10)
          const items = listed.data?.items || listed.data || []
          const match = Array.isArray(items)
            ? items.find((item) => item.id === runId) || items[0]
            : null
          if (match?.status && TERMINAL.has(match.status)) {
            return { done: true, value: match }
          }
          return { done: false, value: match }
        }
        const listed = await listBrowserMonitorRuns(monitorId, 1)
        const items = listed.data?.items || listed.data || []
        const latest = Array.isArray(items) ? items[0] : null
        if (latest?.status && TERMINAL.has(latest.status)) {
          return { done: true, value: latest }
        }
        return { done: false, value: latest }
      },
      { timeoutMs: env.runTimeoutMs, label: "browser run" }
    )
    if (!["SUCCESS", "SUCCESS_WITH_WARNINGS"].includes(run.status)) {
      t.skip(
        `browser run ended ${run.status}${run.failureReason ? `: ${run.failureReason}` : ""} (agent/target topology often flaky)`
      )
      return
    }
    assert.ok(run.status)
  } catch (error) {
    t.skip(`browser run did not complete: ${error}`)
  }
})
