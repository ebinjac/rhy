import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createMonitor,
  publishMonitor,
  skipIfApiDown,
} from "./helpers/api.mjs"
import { runAndWait } from "./helpers/wait.mjs"
import { extractorsMonitorBody } from "./helpers/fixtures.mjs"
import { env } from "./helpers/env.mjs"

test("extractors: jsonpath from /json used in second step", async (t) => {
  if (await skipIfApiDown(t)) return

  try {
    const probe = await fetch(`${env.testTargetProbeURL}/json`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!probe.ok) {
      t.skip(`test-target unhealthy at ${env.testTargetProbeURL}`)
      return
    }
  } catch {
    t.skip(`test-target unreachable at ${env.testTargetProbeURL}`)
    return
  }

  const created = await createMonitor(extractorsMonitorBody())
  await publishMonitor(created.data.id)
  const run = await runAndWait(created.data.id)
  assert.equal(run.status, "SUCCESS", JSON.stringify(run).slice(0, 500))
})
