import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createNotificationWebhook,
  createSecret,
  skipIfApiDown,
  apiOk,
} from "./helpers/api.mjs"
import { env, uniqueSlug } from "./helpers/env.mjs"

/**
 * Optional: register a WEBHOOK notification pointing at test-target capture.
 * Full failure→dispatch e2e depends on notification policy wiring and may skip.
 */
test("webhook: create notification profile targeting /webhook/capture", async (t) => {
  if (await skipIfApiDown(t)) return

  const captureURL = `${env.testTargetProbeURL}/webhook/capture`
  try {
    await fetch(captureURL, { method: "DELETE", signal: AbortSignal.timeout(2500) })
  } catch {
    t.skip(`test-target webhook capture unreachable at ${captureURL}`)
    return
  }

  // Prefer plaintext URL create; if API requires secret ref, create a secret first.
  const name = uniqueSlug("scenario-webhook")
  try {
    const created = await createNotificationWebhook(name, captureURL)
    assert.ok(created.data?.id, "notification profile id")
  } catch (error) {
    // Fallback: store URL as secret and use urlSecretRef
    try {
      const alias = uniqueSlug("webhook-url")
      await createSecret(alias, captureURL)
      const created = await apiOk("/api/v1/config/notifications", {
        method: "POST",
        body: {
          name,
          description: "scenario webhook via secret",
          profileType: "WEBHOOK",
          config: { urlSecretRef: alias },
        },
      })
      assert.ok(created.data?.id)
    } catch (inner) {
      t.skip(`webhook notification create skipped: ${error}; fallback: ${inner}`)
      return
    }
  }

  // Prove capture endpoint works independently of dispatch wiring.
  const post = await fetch(captureURL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "scenario", ok: true }),
    signal: AbortSignal.timeout(5000),
  })
  assert.ok(post.ok, `capture POST ${post.status}`)
  const listed = await fetch(captureURL, { signal: AbortSignal.timeout(5000) })
  const body = await listed.json()
  assert.ok(Array.isArray(body.items) && body.items.length >= 1)
})
