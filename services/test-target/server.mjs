#!/usr/bin/env node
/**
 * Rhythm test-target: mock HTTP(S) app for scenario and integration tests.
 * Zero dependencies. Listens on PORT (8080) and optionally HTTPS_PORT (8443).
 */
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8080)
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443)
const REQUIRE_CLIENT_CERT = /^(1|true|yes)$/i.test(
  process.env.REQUIRE_CLIENT_CERT || ""
)
const CERT_DIR = process.env.CERT_DIR || join(__dirname, "certs")
const WEBHOOK_LIMIT = 50

/** @type {Map<string, number>} */
const flakyCounters = new Map()
/** @type {Array<{ id: string, receivedAt: string, headers: Record<string, string>, body: unknown }>} */
const webhookCaptures = []

function sendJSON(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  })
  res.end(payload)
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks)
  const text = raw.toString("utf8")
  if (!text) return { raw: "", parsed: null }
  const ct = String(req.headers["content-type"] || "")
  if (ct.includes("application/json")) {
    try {
      return { raw: text, parsed: JSON.parse(text) }
    } catch {
      return { raw: text, parsed: text }
    }
  }
  return { raw: text, parsed: text }
}

function parseURL(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
}

function headerObject(req) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    out[key] = Array.isArray(value) ? value.join(", ") : String(value)
  }
  return out
}

function basicAuthorized(req) {
  const expected = "Basic " + Buffer.from("test:secret").toString("base64")
  return req.headers.authorization === expected
}

function bearerAuthorized(req) {
  return req.headers.authorization === "Bearer test-token"
}

function apiKeyAuthorized(req, url) {
  const header = req.headers["x-api-key"]
  if (header === "test-key") return true
  return url.searchParams.get("api_key") === "test-key"
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handle(req, res) {
  const url = parseURL(req)
  const path = url.pathname
  const method = (req.method || "GET").toUpperCase()

  try {
    if (method === "GET" && path === "/health") {
      return sendJSON(res, 200, { ok: true })
    }

    if (path === "/echo") {
      const body = await readBody(req)
      return sendJSON(res, 200, {
        method,
        url: url.pathname + url.search,
        headers: headerObject(req),
        query: Object.fromEntries(url.searchParams.entries()),
        body: body.parsed,
        rawBody: body.raw,
      })
    }

    if ((method === "GET" || method === "POST") && path === "/json") {
      await readBody(req)
      return sendJSON(res, 200, {
        token: "json-token-abc",
        orderId: "ORD-1001",
        nested: { a: 1 },
        user: { id: "user-7", name: "Ada" },
      })
    }

    if (method === "GET" && path === "/set-cookie") {
      return sendJSON(
        res,
        200,
        { set: true },
        { "Set-Cookie": "session=test-session; Path=/" }
      )
    }

    if (method === "GET" && path === "/cookie-echo") {
      return sendJSON(res, 200, {
        cookie: req.headers.cookie || "",
      })
    }

    const redirectMatch = path.match(/^\/redirect\/(\d+)$/)
    if (method === "GET" && redirectMatch) {
      const n = Number(redirectMatch[1])
      if (n <= 0) return sendJSON(res, 200, { redirected: true, remaining: 0 })
      res.writeHead(302, { Location: `/redirect/${n - 1}` })
      return res.end()
    }

    const statusMatch = path.match(/^\/status\/(\d+)$/)
    if (method === "GET" && statusMatch) {
      const code = Number(statusMatch[1])
      return sendJSON(res, code, { status: code })
    }

    if (method === "GET" && path === "/slow") {
      const ms = Math.min(Math.max(Number(url.searchParams.get("ms") || 0), 0), 60_000)
      await new Promise((r) => setTimeout(r, ms))
      return sendJSON(res, 200, { delayedMs: ms })
    }

    if (method === "GET" && path === "/retry-flaky") {
      const key = url.searchParams.get("key") || "default"
      if (url.searchParams.get("reset") === "1") {
        flakyCounters.set(key, 0)
        return sendJSON(res, 200, { reset: true, key, count: 0 })
      }
      const count = (flakyCounters.get(key) || 0) + 1
      flakyCounters.set(key, count)
      if (count <= 2) {
        return sendJSON(res, 503, { ok: false, attempt: count, retry: true })
      }
      return sendJSON(res, 200, { ok: true, attempt: count })
    }

    if (method === "GET" && path === "/basic-auth") {
      if (!basicAuthorized(req)) {
        return sendJSON(
          res,
          401,
          { error: "unauthorized" },
          { "WWW-Authenticate": 'Basic realm="test-target"' }
        )
      }
      return sendJSON(res, 200, { ok: true, auth: "basic" })
    }

    if (method === "GET" && path === "/bearer") {
      if (!bearerAuthorized(req)) {
        return sendJSON(res, 401, { error: "unauthorized" })
      }
      return sendJSON(res, 200, { ok: true, auth: "bearer" })
    }

    if (method === "GET" && path === "/api-key") {
      if (!apiKeyAuthorized(req, url)) {
        return sendJSON(res, 401, { error: "unauthorized" })
      }
      return sendJSON(res, 200, { ok: true, auth: "api-key" })
    }

    if (method === "POST" && path === "/oauth/token") {
      const body = await readBody(req)
      const grant =
        (body.parsed && typeof body.parsed === "object" && body.parsed.grant_type) ||
        url.searchParams.get("grant_type") ||
        ""
      const raw = String(body.raw || "")
      const looksRight =
        String(grant).includes("client_credentials") ||
        raw.includes("grant_type=client_credentials") ||
        raw.includes("client_credentials")
      if (!looksRight) {
        return sendJSON(res, 400, { error: "unsupported_grant_type" })
      }
      return sendJSON(res, 200, {
        access_token: "oauth-test-token",
        token_type: "Bearer",
        expires_in: 3600,
      })
    }

    if (method === "POST" && path === "/hmac") {
      await readBody(req)
      const signature = req.headers["x-signature"]
      if (!signature || String(signature).trim() === "") {
        return sendJSON(res, 401, { error: "missing signature" })
      }
      return sendJSON(res, 200, { ok: true, signature: String(signature) })
    }

    if (method === "GET" && path === "/jwt-audience") {
      const auth = String(req.headers.authorization || "")
      if (!auth.startsWith("Bearer ") || auth.length <= "Bearer ".length) {
        return sendJSON(res, 401, { error: "unauthorized" })
      }
      return sendJSON(res, 200, { ok: true, auth: "jwt" })
    }

    if (method === "GET" && path === "/headers-only") {
      return sendJSON(
        res,
        200,
        { ok: true },
        { "X-Extract-Me": "hello-extract" }
      )
    }

    if (method === "GET" && path === "/regex-body") {
      return sendText(
        res,
        200,
        `<html><body><p>ORDER-ID: ABC-12345</p></body></html>`,
        "text/html; charset=utf-8"
      )
    }

    if (method === "GET" && path === "/schema-ok") {
      return sendJSON(res, 200, {
        id: "ok-1",
        name: "valid",
        count: 3,
        active: true,
      })
    }

    if (method === "GET" && path === "/schema-bad") {
      return sendJSON(res, 200, {
        id: 123,
        name: null,
        count: "not-a-number",
      })
    }

    if (method === "GET" && path === "/browser/home") {
      return sendText(
        res,
        200,
        `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Rhythm Test Target</title></head>
<body>
  <h1>Rhythm Test Target</h1>
  <p>Browser monitor landing page.</p>
  <a href="/health">Health</a>
</body>
</html>`,
        "text/html; charset=utf-8"
      )
    }

    if (path === "/webhook/capture") {
      if (method === "POST") {
        const body = await readBody(req)
        const entry = {
          id: randomUUID(),
          receivedAt: new Date().toISOString(),
          headers: headerObject(req),
          body: body.parsed,
        }
        webhookCaptures.unshift(entry)
        while (webhookCaptures.length > WEBHOOK_LIMIT) webhookCaptures.pop()
        return sendJSON(res, 201, { ok: true, id: entry.id, stored: webhookCaptures.length })
      }
      if (method === "GET") {
        return sendJSON(res, 200, { items: webhookCaptures })
      }
      if (method === "DELETE") {
        webhookCaptures.length = 0
        return sendJSON(res, 200, { cleared: true })
      }
    }

    if (method === "GET" && path === "/proxy-only") {
      // Real "proxy-only" access is network topology. This endpoint always
      // succeeds and echoes forwarding headers for scenario inspection.
      return sendJSON(res, 200, {
        via: "direct",
        forwardedFor: req.headers["x-forwarded-for"] || null,
        viaHeader: req.headers.via || null,
      })
    }

    return sendJSON(res, 404, { error: "not_found", path, method })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return sendJSON(res, 500, { error: "internal", message })
  }
}

function startHttp() {
  const server = createHttpServer((req, res) => {
    void handle(req, res)
  })
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[test-target] HTTP listening on :${PORT}`)
  })
  return server
}

function startHttps() {
  const keyPath = join(CERT_DIR, "server-key.pem")
  const certPath = join(CERT_DIR, "server.pem")
  const caPath = join(CERT_DIR, "ca.pem")
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    console.log(
      `[test-target] HTTPS skipped (missing certs in ${CERT_DIR}). Run npm run certs.`
    )
    return null
  }
  /** @type {import('node:https').ServerOptions} */
  const options = {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }
  if (existsSync(caPath)) {
    options.ca = readFileSync(caPath)
  }
  if (REQUIRE_CLIENT_CERT) {
    options.requestCert = true
    options.rejectUnauthorized = true
  }
  const server = createHttpsServer(options, (req, res) => {
    void handle(req, res)
  })
  server.listen(HTTPS_PORT, "0.0.0.0", () => {
    console.log(
      `[test-target] HTTPS listening on :${HTTPS_PORT}` +
        (REQUIRE_CLIENT_CERT ? " (client cert required)" : "")
    )
  })
  return server
}

startHttp()
startHttps()
