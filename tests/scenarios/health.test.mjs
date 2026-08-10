import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createMonitor,
  publishMonitor,
  skipIfApiDown,
} from "./helpers/api.mjs"
import { runAndWait } from "./helpers/wait.mjs"
import { healthMonitorBody } from "./helpers/fixtures.mjs"
import { env } from "./helpers/env.mjs"

test("health: create + publish + run GET /health → SUCCESS", async (t) => {
  if (await skipIfApiDown(t)) return

  let probeOk = false
  try {
    const probe = await fetch(`${env.testTargetProbeURL}/health`, {
      signal: AbortSignal.timeout(2500),
    })
    probeOk = probe.ok
  } catch {
    probeOk = false
  }
  if (!probeOk) {
    t.skip(
      `test-target unreachable at ${env.testTargetProbeURL} (start with: docker compose --profile test up -d test-target)`
    )
    return
  }

  const created = await createMonitor(healthMonitorBody())
  const monitorId = created.data.id
  assert.ok(monitorId, "monitor id")

  await publishMonitor(monitorId)
  const run = await runAndWait(monitorId, { revision: "published" })
  assert.equal(run.status, "SUCCESS", JSON.stringify(run).slice(0, 500))
})
