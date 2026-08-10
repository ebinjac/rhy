import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createMonitor,
  createSecret,
  publishMonitor,
  skipIfApiDown,
} from "./helpers/api.mjs"
import { runAndWait } from "./helpers/wait.mjs"
import {
  basicAuthMonitorBody,
  bearerAuthMonitorBody,
} from "./helpers/fixtures.mjs"
import { env, uniqueSlug } from "./helpers/env.mjs"

async function requireTarget(t) {
  try {
    const probe = await fetch(`${env.testTargetProbeURL}/health`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!probe.ok) {
      t.skip(`test-target unhealthy at ${env.testTargetProbeURL}`)
      return false
    }
  } catch {
    t.skip(`test-target unreachable at ${env.testTargetProbeURL}`)
    return false
  }
  return true
}

test("auth: basic against test-target /basic-auth", async (t) => {
  if (await skipIfApiDown(t)) return
  if (!(await requireTarget(t))) return

  // Auth fields are secret aliases, not plaintext.
  const userAlias = uniqueSlug("basic-user")
  const passAlias = uniqueSlug("basic-pass")
  await createSecret(userAlias, "test")
  await createSecret(passAlias, "secret")

  const created = await createMonitor(basicAuthMonitorBody(userAlias, passAlias))
  await publishMonitor(created.data.id)
  const run = await runAndWait(created.data.id)
  assert.equal(run.status, "SUCCESS", JSON.stringify(run).slice(0, 500))
})

test("auth: bearer against test-target /bearer", async (t) => {
  if (await skipIfApiDown(t)) return
  if (!(await requireTarget(t))) return

  const tokenAlias = uniqueSlug("bearer-token")
  await createSecret(tokenAlias, "test-token")

  const created = await createMonitor(bearerAuthMonitorBody(tokenAlias))
  await publishMonitor(created.data.id)
  const run = await runAndWait(created.data.id)
  assert.equal(run.status, "SUCCESS", JSON.stringify(run).slice(0, 500))
})
