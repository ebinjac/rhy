import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { Readable } from "node:stream"

loadRuntimeEnvironment()

const role = String(process.env.RHYTHM_SERVICE_ROLE || "")
  .trim()
  .toLowerCase()
const children = new Set()
let shuttingDown = false

if (role === "standalone") {
  initializeChromiumTrust()
  start(
    "rhythm-browser-agent",
    "node",
    ["services/browser-agent/server.mjs"],
    browserEnvironment()
  )
  process.env.RHYTHM_BROWSER_RUNNER_URL = "http://127.0.0.1:8091"
  startScriptRunner(
    Number(process.env.RHYTHM_SCRIPT_RUNNER_CONCURRENCY || 4)
  )
  startAPI("all", "127.0.0.1:18080")
  startWeb()
} else if (role === "frontdoor") {
  startScriptRunner(2)
  startAPI("api", "127.0.0.1:18080")
  startWeb()
} else if (role === "control") {
  startAPI("control", "0.0.0.0:8080")
} else if (role === "api-executor") {
  startScriptRunner(Number(process.env.RHYTHM_SCRIPT_RUNNER_CONCURRENCY || 16))
  startAPI("worker", "0.0.0.0:8080")
} else if (role === "browser-executor") {
  initializeChromiumTrust()
  start(
    "rhythm-browser-agent",
    "node",
    ["services/browser-agent/server.mjs"],
    browserEnvironment()
  )
  process.env.RHYTHM_BROWSER_RUNNER_URL = "http://127.0.0.1:8091"
  startAPI("browser", "127.0.0.1:18080")
  startBrowserGateway()
} else {
  throw new Error(
    "RHYTHM_SERVICE_ROLE must be standalone, frontdoor, control, api-executor, or browser-executor"
  )
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal))
}

function startAPI(runtimeRole, address) {
  start(`rhythm-api-${runtimeRole}`, "/opt/rhythm/bin/rhythm-api", [], {
    ...process.env,
    RHYTHM_ROLE: runtimeRole,
    RHYTHM_HTTP_ADDR: address,
  })
}

function startWeb() {
  start("rhythm-web", "node", ["apps/web/server.mjs"], {
    ...process.env,
    HOST: "0.0.0.0",
    PORT: "8080",
    RHYTHM_API_URL: "http://127.0.0.1:18080",
  })
}

function startScriptRunner(concurrency) {
  start("rhythm-script-runner", "/opt/rhythm/bin/rhythm-script-runner", [], {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TZ: process.env.TZ,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE,
    RHYTHM_SCRIPT_RUNNER_ADDR: "127.0.0.1:8090",
    RHYTHM_SCRIPT_RUNNER_TOKEN: process.env.RHYTHM_SCRIPT_RUNNER_TOKEN,
    RHYTHM_SCRIPT_RUNNER_CONCURRENCY: String(concurrency),
  })
  process.env.RHYTHM_SCRIPT_RUNNER_URL = "http://127.0.0.1:8090"
}

function start(name, command, args, env) {
  const child = spawn(command, args, { env, stdio: "inherit" })
  child.rhythmName = name
  children.add(child)
  child.on("exit", (code, signal) => {
    children.delete(child)
    if (!shuttingDown) {
      process.stderr.write(
        `${JSON.stringify({ level: "error", message: "critical child exited", child: name, code, signal })}\n`
      )
      shutdown("SIGTERM", code || 1)
    }
  })
  return child
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill(signal)
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL")
    process.exit(exitCode)
  }, 12_000)
  timer.unref()
  Promise.all(
    [...children].map(
      (child) => new Promise((resolve) => child.once("exit", resolve))
    )
  ).then(() => process.exit(exitCode))
}

function loadRuntimeEnvironment() {
  const path =
    process.env.RHYTHM_RUNTIME_ENV_FILE || "/opt/epaas/vault/secrets/secrets"
  if (!existsSync(path)) {
    process.stderr.write(
      `${JSON.stringify({ level: "warn", message: "optional Hydra runtime environment file is unavailable", path })}\n`
    )
    return
  }
  const seen = new Set()
  const protectedKeys = new Set([
    "RHYTHM_SERVICE_ROLE",
    "RHYTHM_ENVIRONMENT",
    "RHYTHM_AUTH_MODE",
    "RHYTHM_HTTP_ADDR",
  ])
  for (const [index, rawLine] of readFileSync(path, "utf8")
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator < 1) {
      process.stderr.write(
        `${JSON.stringify({ level: "warn", message: "ignored invalid runtime environment line", line: index + 1 })}\n`
      )
      continue
    }
    const key = line.slice(0, separator).trim()
    // Hydra vault properties may start with lowercase or underscore (e.g. _vault***).
    // Do not impose casing or character-class rules on keys — only skip empties/duplicates.
    if (!key || seen.has(key)) {
      process.stderr.write(
        `${JSON.stringify({ level: "warn", message: "ignored empty or duplicate runtime environment key", line: index + 1 })}\n`
      )
      continue
    }
    if (protectedKeys.has(key)) {
      process.stderr.write(
        `${JSON.stringify({ level: "warn", message: "ignored protected runtime environment key", key })}\n`
      )
      continue
    }
    seen.add(key)
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function browserEnvironment() {
  const allowed = [
    "PATH",
    "HOME",
    "TZ",
    "NODE_ENV",
    "NODE_USE_SYSTEM_CA",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "PLAYWRIGHT_BROWSERS_PATH",
    "RHYTHM_UNRESTRICTED_OUTBOUND",
  ]
  const environment = Object.fromEntries(
    allowed.map((key) => [key, process.env[key]]).filter(([, value]) => value)
  )
  for (const [key, value] of Object.entries(process.env)) {
    if (
      (key.startsWith("RHYTHM_BROWSER_") ||
        key.startsWith("RHYTHM_CHROMIUM_")) &&
      value !== undefined
    ) {
      environment[key] = value
    }
  }
  environment.RHYTHM_BROWSER_AGENT_ADDR = "127.0.0.1"
  environment.RHYTHM_BROWSER_AGENT_PORT = "8091"
  environment.RHYTHM_BROWSER_RUNNER_TOKEN =
    process.env.RHYTHM_BROWSER_RUNNER_TOKEN
  return environment
}

function initializeChromiumTrust() {
  const certificate = String(
    process.env.RHYTHM_CORPORATE_CA_FILE ||
      process.env.RHYTHM_CORPORATE_CA_PATH ||
      ""
  ).trim()
  if (!certificate) return
  const home = process.env.HOME || "/tmp/rhythm"
  const database = `${home}/.pki/nssdb`
  mkdirSync(database, { recursive: true })
  if (!existsSync(`${database}/cert9.db`)) {
    const initialized = spawnSync("certutil", [
      "-N",
      "--empty-password",
      "-d",
      `sql:${database}`,
    ])
    if (initialized.status !== 0)
      throw new Error("Chromium NSS database could not be initialized")
  }
  const imported = spawnSync("certutil", [
    "-A",
    "-d",
    `sql:${database}`,
    "-n",
    "rhythm-corporate-ca",
    "-t",
    "C,,",
    "-i",
    certificate,
  ])
  if (imported.status !== 0)
    throw new Error("Corporate CA could not be imported into Chromium NSS")
}

function startBrowserGateway() {
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (
        incoming.method === "GET" &&
        (incoming.url === "/livez" ||
          incoming.url === "/healthz" ||
          incoming.url === "/health")
      ) {
        outgoing.writeHead(200, { "Content-Type": "application/json" })
        outgoing.end('{"status":"ok","service":"rhythm-browser-executor"}')
        return
      }
      if (incoming.method === "GET" && incoming.url === "/readyz") {
        const [api, browser] = await Promise.all([
          fetch("http://127.0.0.1:18080/readyz", {
            signal: AbortSignal.timeout(2_000),
          }),
          fetch("http://127.0.0.1:8091/healthz", {
            signal: AbortSignal.timeout(2_000),
          }),
        ])
        outgoing.writeHead(api.ok && browser.ok ? 200 : 503, {
          "Content-Type": "application/json",
        })
        outgoing.end(
          JSON.stringify({
            status: api.ok && browser.ok ? "ok" : "degraded",
            service: "rhythm-browser-executor",
          })
        )
        return
      }
      const targetBase =
        incoming.url === "/metrics"
          ? "http://127.0.0.1:18080"
          : "http://127.0.0.1:8091"
      const headers = { ...incoming.headers }
      for (const name of [
        "connection",
        "content-length",
        "host",
        "keep-alive",
        "transfer-encoding",
        "upgrade",
      ]) {
        delete headers[name]
      }
      const response = await fetch(new URL(incoming.url || "/", targetBase), {
        method: incoming.method,
        headers,
        body:
          incoming.method === "GET" || incoming.method === "HEAD"
            ? undefined
            : Readable.toWeb(incoming),
        duplex: "half",
        signal: AbortSignal.timeout(30_000),
      })
      outgoing.writeHead(
        response.status,
        Object.fromEntries(response.headers.entries())
      )
      if (response.body) Readable.fromWeb(response.body).pipe(outgoing)
      else outgoing.end()
    } catch {
      outgoing.writeHead(503, { "Content-Type": "application/json" })
      outgoing.end('{"status":"degraded","service":"rhythm-browser-executor"}')
    }
  })
  server.listen(8080, "0.0.0.0")
  const close = () => server.close()
  process.on("SIGINT", close)
  process.on("SIGTERM", close)
}
