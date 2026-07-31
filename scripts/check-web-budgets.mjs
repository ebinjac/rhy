import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { gzipSync } from "node:zlib"

const root = new URL("../apps/web/dist/client/", import.meta.url)
const assets = new URL("assets/", root)
const limits = {
  sharedJavaScriptGzip: Number(process.env.RHYTHM_BUDGET_SHARED_JS_GZIP || 110 * 1024),
  sharedCSSGzip: Number(process.env.RHYTHM_BUDGET_SHARED_CSS_GZIP || 35 * 1024),
  routeChunkGzip: Number(process.env.RHYTHM_BUDGET_ROUTE_CHUNK_GZIP || 150 * 1024),
}
const entries = await readdir(assets)
const measurements = []
for (const entry of entries) {
  if (!entry.endsWith(".js") && !entry.endsWith(".css")) continue
  const path = join(assets.pathname, entry)
  const body = await readFile(path)
  measurements.push({
    entry,
    raw: (await stat(path)).size,
    gzip: gzipSync(body, { level: 9 }).length,
  })
}

const sharedJavaScript = measurements
  .filter((item) => item.entry.startsWith("index-") && item.entry.endsWith(".js"))
  .sort((left, right) => right.raw - left.raw)[0]
const sharedCSS = measurements
  .filter((item) => item.entry.startsWith("index-") && item.entry.endsWith(".css"))
  .sort((left, right) => right.raw - left.raw)[0]
const failures = []
check("shared JavaScript", sharedJavaScript, limits.sharedJavaScriptGzip)
check("shared CSS", sharedCSS, limits.sharedCSSGzip)
for (const item of measurements.filter((candidate) => candidate.entry.endsWith(".js"))) {
  if (item === sharedJavaScript) continue
  if (item.gzip > limits.routeChunkGzip) {
    failures.push(
      `${item.entry} is ${kilobytes(item.gzip)} gzip; route chunks must be ≤ ${kilobytes(limits.routeChunkGzip)}`
    )
  }
}
console.log(
  JSON.stringify(
    {
      sharedJavaScript,
      sharedCSS,
      largestRouteChunks: measurements
        .filter((item) => item.entry.endsWith(".js") && item !== sharedJavaScript)
        .sort((left, right) => right.gzip - left.gzip)
        .slice(0, 5),
    },
    null,
    2
  )
)
if (failures.length > 0) {
  console.error(`Web performance budgets failed:\n- ${failures.join("\n- ")}`)
  process.exitCode = 1
}

function check(label, measurement, limit) {
  if (!measurement) {
    failures.push(`${label} output could not be identified`)
    return
  }
  if (measurement.gzip > limit) {
    failures.push(
      `${basename(measurement.entry)} is ${kilobytes(measurement.gzip)} gzip; ${label} must be ≤ ${kilobytes(limit)}`
    )
  }
}

function kilobytes(value) {
  return `${(value / 1024).toFixed(1)} KB`
}
