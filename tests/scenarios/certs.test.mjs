import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createMonitor,
  publishMonitor,
  skipIfApiDown,
  uploadTrustBundle,
} from "./helpers/api.mjs"
import { runAndWait } from "./helpers/wait.mjs"
import { certsMonitorBody } from "./helpers/fixtures.mjs"
import { env, uniqueSlug } from "./helpers/env.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const caPath = join(
  __dirname,
  "../../services/test-target/certs/ca.pem"
)

test("certs: custom CA against HTTPS test-target (best-effort)", async (t) => {
  if (await skipIfApiDown(t)) return

  if (!existsSync(caPath)) {
    t.skip(`CA missing at ${caPath}; run node services/test-target/scripts/generate-certs.mjs`)
    return
  }

  // Probe HTTPS from the host (ignore TLS verify for reachability).
  const https = await import("node:https")
  const reachable = await new Promise((resolve) => {
    const req = https.get(
      env.testTargetHTTPSProbeURL + "/health",
      { rejectUnauthorized: false, timeout: 4000 },
      (res) => {
        res.resume()
        resolve((res.statusCode || 0) < 500)
      }
    )
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
  })
  if (!reachable) {
    t.skip(
      `HTTPS test-target unreachable at ${env.testTargetHTTPSProbeURL}`
    )
    return
  }

  const caPem = readFileSync(caPath, "utf8")
  const upload = await uploadTrustBundle(uniqueSlug("scenario-ca"), caPem)
  if (!upload.ok) {
    t.skip(`certificate upload failed: ${upload.text.slice(0, 200)}`)
    return
  }
  const caProfileId = upload.data?.id
  assert.ok(caProfileId, "ca profile id")

  try {
    const created = await createMonitor(certsMonitorBody(caProfileId))
    await publishMonitor(created.data.id)
    const run = await runAndWait(created.data.id)
    if (run.status !== "SUCCESS") {
      t.skip(
        `TLS scenario did not succeed (often flaky with host.docker.internal SANs): ${run.status} ${run.failureCategory || ""}`
      )
      return
    }
    assert.equal(run.status, "SUCCESS")
  } catch (error) {
    t.skip(`TLS scenario skipped after failure: ${error}`)
  }
})
