import { env } from "./env.mjs"

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} body
   * @param {string} method
   * @param {string} path
   */
  constructor(status, body, method, path) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 400)}`)
    this.name = "ApiError"
    this.status = status
    this.body = body
    this.method = method
    this.path = path
  }
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string>, timeoutMs?: number, query?: Record<string, string|undefined> }} [options]
 */
export async function api(path, options = {}) {
  const method = options.method || "GET"
  const url = new URL(path.startsWith("http") ? path : `${env.apiURL}${path}`)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
  }
  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  }
  let body
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json"
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body)
  } else if (options.body instanceof FormData) {
    body = options.body
  }
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  })
  const text = await response.text()
  /** @type {unknown} */
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text,
    json,
    data: json && typeof json === "object" && "data" in json ? /** @type {any} */ (json).data : json,
  }
}

/**
 * @param {string} path
 * @param {Parameters<typeof api>[1]} [options]
 */
export async function apiOk(path, options = {}) {
  const result = await api(path, options)
  if (!result.ok) {
    throw new ApiError(
      result.status,
      result.text,
      options.method || "GET",
      path
    )
  }
  return result
}

let apiReachableCache = /** @type {boolean | null} */ (null)

/** Probe Rhythm API /health (or root). Cached per process. */
export async function isApiReachable() {
  if (apiReachableCache !== null) return apiReachableCache
  try {
    const response = await fetch(`${env.apiURL}/health`, {
      signal: AbortSignal.timeout(2500),
    })
    apiReachableCache = response.ok
  } catch {
    apiReachableCache = false
  }
  return apiReachableCache
}

/**
 * Skip the current test when the API is down.
 * @param {import('node:test').TestContext} t
 */
export async function skipIfApiDown(t) {
  if (!(await isApiReachable())) {
    t.skip(`Rhythm API unreachable at ${env.apiURL}`)
    return true
  }
  return false
}

export async function createMonitor(definitionInput) {
  return apiOk("/api/v1/monitors", {
    method: "POST",
    body: definitionInput,
  })
}

export async function publishMonitor(monitorId, changeSummary = "scenario publish") {
  return apiOk(`/api/v1/monitors/${encodeURIComponent(monitorId)}/publish`, {
    method: "POST",
    body: { changeSummary },
  })
}

export async function enableMonitor(monitorId) {
  return apiOk(`/api/v1/monitors/${encodeURIComponent(monitorId)}/enable`, {
    method: "POST",
  })
}

/**
 * @param {string} monitorId
 * @param {{ revision?: 'draft'|'published', wait?: boolean, timeoutMs?: number }} [options]
 */
export async function runMonitor(monitorId, options = {}) {
  const revision = options.revision || "published"
  const wait = options.wait !== false
  return api(`/api/v1/monitors/${encodeURIComponent(monitorId)}/runs`, {
    method: "POST",
    query: {
      revision,
      wait: wait ? "true" : undefined,
    },
    timeoutMs: options.timeoutMs ?? env.runTimeoutMs,
  })
}

export async function getRun(runId) {
  return apiOk(`/api/v1/runs/${encodeURIComponent(runId)}`)
}

export async function createSecret(name, value, description = "scenario secret") {
  return apiOk("/api/v1/config/secrets", {
    method: "POST",
    body: {
      name,
      description,
      config: {
        provider: "LOCAL",
        value,
      },
    },
  })
}

export async function createProxy(name, url, description = "scenario proxy") {
  return apiOk("/api/v1/config/proxies", {
    method: "POST",
    body: {
      name,
      description,
      profileType: "HTTP",
      config: { url },
    },
  })
}

export async function testProxy(profileId, targetUrl) {
  return api(`/api/v1/config/proxies/${encodeURIComponent(profileId)}/test`, {
    method: "POST",
    body: { targetUrl },
    timeoutMs: 20_000,
  })
}

/**
 * Upload a TRUST_BUNDLE certificate profile from PEM text.
 * @param {string} name
 * @param {string} caPem
 */
export async function uploadTrustBundle(name, caPem) {
  const form = new FormData()
  form.set("name", name)
  form.set("description", "scenario trust bundle")
  form.set("purpose", "TRUST_BUNDLE")
  form.set("password", "")
  form.set("keyPassword", "")
  form.set("alias", "")
  form.set(
    "caBundle",
    new Blob([caPem], { type: "application/x-pem-file" }),
    "ca.pem"
  )
  return api("/api/v1/config/certificates/upload", {
    method: "POST",
    body: form,
    timeoutMs: 30_000,
  })
}

export async function createNotificationWebhook(name, url) {
  return apiOk("/api/v1/config/notifications", {
    method: "POST",
    body: {
      name,
      description: "scenario webhook",
      profileType: "WEBHOOK",
      config: { url },
    },
  })
}

export async function listAlerts(state = "OPEN") {
  return api("/api/v1/alerts", { query: { state } })
}

export async function createBrowserMonitor(input) {
  return api("/api/v1/browser-monitors", {
    method: "POST",
    body: input,
    timeoutMs: 20_000,
  })
}

export async function publishBrowserMonitor(
  monitorId,
  changeSummary = "scenario browser publish"
) {
  return api(
    `/api/v1/browser-monitors/${encodeURIComponent(monitorId)}/publish`,
    {
      method: "POST",
      body: { changeSummary },
      timeoutMs: 20_000,
    }
  )
}

/**
 * @param {string} monitorId
 * @param {{ revision?: string }} [options]
 */
export async function runBrowserMonitor(monitorId, options = {}) {
  return api(`/api/v1/browser-monitors/${encodeURIComponent(monitorId)}/runs`, {
    method: "POST",
    body: { revision: options.revision || "draft" },
    timeoutMs: env.runTimeoutMs,
  })
}

export async function listBrowserMonitorRuns(monitorId, limit = 5) {
  return api(
    `/api/v1/browser-monitors/${encodeURIComponent(monitorId)}/runs`,
    { query: { limit: String(limit) } }
  )
}
