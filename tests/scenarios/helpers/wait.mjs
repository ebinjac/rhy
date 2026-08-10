import { env } from "./env.mjs"
import { api, getRun } from "./api.mjs"

const TERMINAL = new Set([
  "SUCCESS",
  "SUCCESS_WITH_WARNINGS",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
  "ABORTED",
  "ERROR",
])

/**
 * @param {() => Promise<{ done: boolean, value?: any }>} probe
 * @param {{ timeoutMs?: number, intervalMs?: number, label?: string }} [options]
 */
export async function waitUntil(probe, options = {}) {
  const timeoutMs = options.timeoutMs ?? env.runTimeoutMs
  const intervalMs = options.intervalMs ?? env.pollMs
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await probe()
    if (last.done) return last.value
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(
    `Timed out waiting for ${options.label || "condition"} after ${timeoutMs}ms` +
      (last ? `; last=${JSON.stringify(last).slice(0, 300)}` : "")
  )
}

/**
 * Poll a run until it reaches a terminal status.
 * Prefer `?wait=true` on create; this is a fallback.
 * @param {string} runId
 * @param {{ timeoutMs?: number }} [options]
 */
export async function waitForRun(runId, options = {}) {
  return waitUntil(
    async () => {
      const result = await getRun(runId)
      const run = result.data?.run || result.data
      const status = run?.status
      if (status && TERMINAL.has(status)) {
        return { done: true, value: run }
      }
      return { done: false, value: run }
    },
    { ...options, label: `run ${runId}` }
  )
}

/**
 * Start a monitor run with wait=true, falling back to poll if needed.
 * @param {string} monitorId
 * @param {{ revision?: 'draft'|'published' }} [options]
 */
export async function runAndWait(monitorId, options = {}) {
  const revision = options.revision || "published"
  const response = await api(
    `/api/v1/monitors/${encodeURIComponent(monitorId)}/runs`,
    {
      method: "POST",
      query: { revision, wait: "true" },
      timeoutMs: env.runTimeoutMs,
    }
  )
  if (!response.ok) {
    throw new Error(
      `run monitor failed: ${response.status} ${response.text.slice(0, 400)}`
    )
  }
  const payload = response.data
  const run = payload?.run || payload
  if (run?.status && TERMINAL.has(run.status)) {
    return run
  }
  const runId = run?.id || payload?.runId
  if (!runId) {
    throw new Error(`run response missing id: ${response.text.slice(0, 400)}`)
  }
  return waitForRun(runId)
}

export { TERMINAL }
