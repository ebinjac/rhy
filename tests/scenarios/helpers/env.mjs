/**
 * Scenario environment defaults.
 *
 * Host-run (default): API on localhost; monitor URLs use host.docker.internal so
 * Compose workers can reach the published test-target port.
 *
 * Compose-network: set RHYTHM_SCENARIO_NETWORK=compose to use service DNS names.
 */

const network = String(process.env.RHYTHM_SCENARIO_NETWORK || "host").toLowerCase()
const isCompose = network === "compose"

const testTargetPort = process.env.RHYTHM_TEST_TARGET_PORT || "18090"
const testTargetHttpsPort = process.env.RHYTHM_TEST_TARGET_HTTPS_PORT || "18443"

export const env = {
  network,
  isCompose,
  apiURL: process.env.RHYTHM_API_URL || "http://localhost:18080",
  webURL: process.env.RHYTHM_WEB_URL || "http://localhost:3100",
  testTargetURL:
    process.env.RHYTHM_TEST_TARGET_URL ||
    (isCompose
      ? "http://test-target:8080"
      : `http://host.docker.internal:${testTargetPort}`),
  testTargetHTTPSURL:
    process.env.RHYTHM_TEST_TARGET_HTTPS_URL ||
    (isCompose
      ? "https://test-target:8443"
      : `https://host.docker.internal:${testTargetHttpsPort}`),
  /** Host-reachable probe URL (scenarios run on host by default). */
  testTargetProbeURL:
    process.env.RHYTHM_TEST_TARGET_PROBE_URL ||
    `http://localhost:${testTargetPort}`,
  testTargetHTTPSProbeURL:
    process.env.RHYTHM_TEST_TARGET_HTTPS_PROBE_URL ||
    `https://localhost:${testTargetHttpsPort}`,
  runTimeoutMs: Number(process.env.RHYTHM_SCENARIO_RUN_TIMEOUT_MS || 45_000),
  pollMs: Number(process.env.RHYTHM_SCENARIO_POLL_MS || 500),
}

export function uniqueSlug(prefix) {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${stamp}-${rand}`.slice(0, 64)
}
