import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createMonitor,
  createSecret,
  publishMonitor,
  skipIfApiDown,
} from "./helpers/api.mjs"
import { runAndWait } from "./helpers/wait.mjs"
import { secretHeaderMonitorBody } from "./helpers/fixtures.mjs"
import { env, uniqueSlug } from "./helpers/env.mjs"

test("secrets: create LOCAL secret and use {{secrets.alias}} in header", async (t) => {
  if (await skipIfApiDown(t)) return

  try {
    const probe = await fetch(`${env.testTargetProbeURL}/health`, {
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

  const alias = uniqueSlug("scenario-secret")
  const secret = await createSecret(alias, "scenario-secret-value")
  assert.ok(secret.data?.id, "secret profile id")

  const created = await createMonitor(secretHeaderMonitorBody(alias))
  await publishMonitor(created.data.id)
  const run = await runAndWait(created.data.id)
  assert.equal(run.status, "SUCCESS", JSON.stringify(run).slice(0, 500))
})
