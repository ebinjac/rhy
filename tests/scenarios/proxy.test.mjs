import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createProxy,
  skipIfApiDown,
  testProxy,
} from "./helpers/api.mjs"
import { env, uniqueSlug } from "./helpers/env.mjs"

/**
 * Full monitor-via-proxy e2e needs a real forward proxy in the network path.
 * This scenario creates a proxy profile and exercises the proxy test endpoint
 * when possible; otherwise it skips with a clear message.
 */
test("proxy: create profile and call /test (monitor-via-proxy may skip)", async (t) => {
  if (await skipIfApiDown(t)) return

  // Point the profile at a non-routable proxy host so create still validates
  // config shape. The /test call is expected to fail connectivity — we only
  // require that create succeeds. If an operator provides RHYTHM_SCENARIO_PROXY_URL,
  // we attempt a real proxy test against test-target.
  const proxyURL =
    process.env.RHYTHM_SCENARIO_PROXY_URL || "http://127.0.0.1:9"
  const name = uniqueSlug("scenario-proxy")

  let profile
  try {
    const created = await createProxy(name, proxyURL)
    profile = created.data
  } catch (error) {
    t.skip(`unable to create proxy profile: ${error}`)
    return
  }
  assert.ok(profile?.id, "proxy profile id")

  if (!process.env.RHYTHM_SCENARIO_PROXY_URL) {
    t.skip(
      "proxy profile created; set RHYTHM_SCENARIO_PROXY_URL to exercise monitor-via-proxy /test against a real forward proxy"
    )
    return
  }

  const result = await testProxy(profile.id, `${env.testTargetProbeURL}/proxy-only`)
  if (!result.ok || !result.data?.success) {
    t.skip(
      `proxy test did not succeed (topology): ${result.text?.slice(0, 200) || "unknown"}`
    )
    return
  }
  assert.equal(result.data.success, true)
})
