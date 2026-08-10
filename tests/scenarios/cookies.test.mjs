import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createMonitor,
  publishMonitor,
  skipIfApiDown,
} from "./helpers/api.mjs"
import { runAndWait } from "./helpers/wait.mjs"
import { cookiesMonitorBody } from "./helpers/fixtures.mjs"
import { env } from "./helpers/env.mjs"

test("cookies: set-cookie then cookie-echo across steps", async (t) => {
  if (await skipIfApiDown(t)) return

  try {
    const probe = await fetch(`${env.testTargetProbeURL}/set-cookie`, {
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

  const created = await createMonitor(cookiesMonitorBody())
  await publishMonitor(created.data.id)
  const run = await runAndWait(created.data.id)
  assert.equal(run.status, "SUCCESS", JSON.stringify(run).slice(0, 500))
})
