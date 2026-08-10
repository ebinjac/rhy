import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createMonitor,
  publishMonitor,
  skipIfApiDown,
} from "./helpers/api.mjs"
import { runAndWait } from "./helpers/wait.mjs"
import {
  scriptsFailMonitorBody,
  scriptsPassMonitorBody,
} from "./helpers/fixtures.mjs"
import { env } from "./helpers/env.mjs"

async function requireTarget(t) {
  try {
    const probe = await fetch(`${env.testTargetProbeURL}/health`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!probe.ok) {
      t.skip(`test-target unhealthy`)
      return false
    }
  } catch {
    t.skip(`test-target unreachable at ${env.testTargetProbeURL}`)
    return false
  }
  return true
}

test("scripts: test script that passes", async (t) => {
  if (await skipIfApiDown(t)) return
  if (!(await requireTarget(t))) return

  const created = await createMonitor(scriptsPassMonitorBody())
  await publishMonitor(created.data.id)
  const run = await runAndWait(created.data.id)
  assert.equal(run.status, "SUCCESS", JSON.stringify(run).slice(0, 500))
})

test("scripts: test script that fails", async (t) => {
  if (await skipIfApiDown(t)) return
  if (!(await requireTarget(t))) return

  const created = await createMonitor(scriptsFailMonitorBody())
  await publishMonitor(created.data.id)
  const run = await runAndWait(created.data.id)
  assert.equal(run.status, "FAILED", JSON.stringify(run).slice(0, 500))
})
