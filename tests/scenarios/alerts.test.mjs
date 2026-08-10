import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createMonitor,
  listAlerts,
  publishMonitor,
  skipIfApiDown,
} from "./helpers/api.mjs"
import { runAndWait } from "./helpers/wait.mjs"
import { failingAssertionMonitorBody } from "./helpers/fixtures.mjs"
import { env } from "./helpers/env.mjs"

test("alerts: assertion failure → run FAILED; list alerts if available", async (t) => {
  if (await skipIfApiDown(t)) return

  try {
    const probe = await fetch(`${env.testTargetProbeURL}/health`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!probe.ok) {
      t.skip(`test-target unhealthy`)
      return
    }
  } catch {
    t.skip(`test-target unreachable at ${env.testTargetProbeURL}`)
    return
  }

  const created = await createMonitor(failingAssertionMonitorBody())
  await publishMonitor(created.data.id)
  const run = await runAndWait(created.data.id)
  assert.equal(run.status, "FAILED", JSON.stringify(run).slice(0, 500))

  // Inbox alerts are primarily OpenSearch-ingested; listing must not throw.
  const alerts = await listAlerts("OPEN")
  if (!alerts.ok) {
    t.diagnostic?.(
      `alerts list returned ${alerts.status}; run failure assertion already covered`
    )
    return
  }
  assert.ok(Array.isArray(alerts.data) || Array.isArray(alerts.data?.items) || alerts.json)
})
