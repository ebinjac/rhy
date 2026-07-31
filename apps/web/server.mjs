import { createHash } from "node:crypto"
import { createReadStream, statSync } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { Readable } from "node:stream"
import { createBrotliCompress, createGzip, constants } from "node:zlib"

import application from "./dist/server/server.js"

const host = process.env.HOST ?? "0.0.0.0"
const port = Number.parseInt(process.env.PORT ?? "3000", 10)
const clientRoot = join(process.cwd(), "apps/web/dist/client")
const etags = new Map()

const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.url === "/healthz" || incoming.url === "/livez") {
      outgoing.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      })
      outgoing.end('{"status":"ok","service":"rhythm-web"}')
      return
    }
    if (incoming.url === "/internal/web-vitals" && incoming.method === "POST") {
      await forwardWebVital(incoming, outgoing)
      return
    }
    if (await serveStatic(incoming, outgoing)) return

    const origin = `http://${incoming.headers.host ?? `${host}:${port}`}`
    const request = new Request(new URL(incoming.url ?? "/", origin), {
      method: incoming.method,
      headers: incoming.headers,
      body:
        incoming.method === "GET" || incoming.method === "HEAD"
          ? undefined
          : Readable.toWeb(incoming),
      duplex: "half",
    })
    const response = await application.fetch(request)
    await sendResponse(incoming, outgoing, response)
  } catch (error) {
    console.error("rhythm web request failed", error)
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      })
    }
    outgoing.end('{"error":"Rhythm web could not render this request."}')
  }
})

server.keepAliveTimeout = 65_000
server.headersTimeout = 70_000
server.requestTimeout = 30_000
server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "rhythm web listening",
      host,
      port,
    })
  )
})

async function serveStatic(request, response) {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`
  )
  const pathname = decodeURIComponent(url.pathname)
  if (
    pathname === "/" ||
    (!pathname.startsWith("/assets/") &&
      !pathname.match(
        /^\/(?:favicon\.ico|brand-logo\.png|manifest\.json|robots\.txt)$/
      ))
  ) {
    return false
  }
  const relative = normalize(pathname).replace(/^[/\\]+/, "")
  const absolute = join(clientRoot, relative)
  if (!absolute.startsWith(clientRoot)) return false
  let details
  try {
    details = await stat(absolute)
  } catch {
    return false
  }
  if (!details.isFile()) return false

  const etag = strongETag(absolute)
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, {
      ETag: etag,
      "Cache-Control": cacheControl(pathname),
    })
    response.end()
    return true
  }
  const encoding = acceptedEncoding(request)
  const headers = {
    "Cache-Control": cacheControl(pathname),
    "Content-Type": contentType(absolute),
    ETag: etag,
    Vary: "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
  }
  if (encoding) headers["Content-Encoding"] = encoding
  response.writeHead(200, headers)
  const source = createReadStream(absolute)
  if (encoding === "br") {
    source
      .pipe(
        createBrotliCompress({
          params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
        })
      )
      .pipe(response)
  } else if (encoding === "gzip") {
    source.pipe(createGzip({ level: 6 })).pipe(response)
  } else {
    source.pipe(response)
  }
  return true
}

async function sendResponse(request, outgoing, response) {
  const headers = Object.fromEntries(response.headers.entries())
  const setCookies = response.headers.getSetCookie?.() ?? []
  if (setCookies.length > 0) headers["set-cookie"] = setCookies
  if (!headers["cache-control"]) {
    headers["cache-control"] = "private, no-cache, no-store"
  }
  headers.vary = appendVary(headers.vary, "Accept-Encoding")
  headers["x-content-type-options"] = "nosniff"

  const encoding = shouldCompress(request, response)
    ? acceptedEncoding(request)
    : null
  if (encoding) {
    headers["content-encoding"] = encoding
    delete headers["content-length"]
  }
  outgoing.writeHead(response.status, headers)
  if (!response.body || request.method === "HEAD") {
    outgoing.end()
    return
  }
  const source = Readable.fromWeb(response.body)
  if (encoding === "br") {
    source
      .pipe(
        createBrotliCompress({
          params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
        })
      )
      .pipe(outgoing)
  } else if (encoding === "gzip") {
    source.pipe(createGzip({ level: 5 })).pipe(outgoing)
  } else {
    source.pipe(outgoing)
  }
}

function shouldCompress(request, response) {
  if (response.status === 204 || response.status === 304) return false
  if (response.headers.has("content-encoding")) return false
  const type = response.headers.get("content-type") ?? ""
  return /(?:text\/|json|javascript|svg|xml)/i.test(type) && Boolean(acceptedEncoding(request))
}

function acceptedEncoding(request) {
  const value = request.headers["accept-encoding"] ?? ""
  if (/\bbr\b/.test(value)) return "br"
  if (/\bgzip\b/.test(value)) return "gzip"
  return null
}

function cacheControl(pathname) {
  return pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600, stale-while-revalidate=86400"
}

function strongETag(path) {
  const details = statSync(path)
  const cacheKey = `${path}:${details.size}:${details.mtimeMs}`
  const cached = etags.get(cacheKey)
  if (cached) return cached
  const digest = createHash("sha256")
    .update(cacheKey)
    .digest("base64url")
  const value = `"${digest}"`
  etags.set(cacheKey, value)
  return value
}

function appendVary(current, value) {
  const parts = new Set(
    String(current ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  )
  parts.add(value)
  return [...parts].join(", ")
}

function contentType(path) {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8"
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".woff2":
      return "font/woff2"
    case ".png":
      return "image/png"
    case ".svg":
      return "image/svg+xml"
    case ".ico":
      return "image/x-icon"
    case ".txt":
      return "text/plain; charset=utf-8"
    default:
      return "application/octet-stream"
  }
}

async function forwardWebVital(incoming, outgoing) {
  const chunks = []
  let size = 0
  for await (const chunk of incoming) {
    size += chunk.length
    if (size > 4096) {
      outgoing.writeHead(413, { "Cache-Control": "no-store" })
      outgoing.end()
      return
    }
    chunks.push(chunk)
  }
  try {
    const api = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(`${api}/internal/web-vitals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(2000),
    })
    outgoing.writeHead(response.ok ? 204 : response.status, {
      "Cache-Control": "no-store",
    })
  } catch {
    outgoing.writeHead(204, { "Cache-Control": "no-store" })
  }
  outgoing.end()
}
