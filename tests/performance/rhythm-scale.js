import http from "k6/http"
import { check, sleep } from "k6"
import { Counter, Trend } from "k6/metrics"

const baseURL = __ENV.RHYTHM_API_URL || "http://localhost:18080"
const monitorIDs = (String(__ENV.RHYTHM_MONITOR_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean))
const duration = __ENV.RHYTHM_SCALE_DURATION || "24h"
const scheduledRate = Number(__ENV.RHYTHM_SCHEDULED_RATE || 8.34)
const manualBurst = Number(__ENV.RHYTHM_MANUAL_BURST || 100)

if (monitorIDs.length === 0) {
  throw new Error("RHYTHM_MONITOR_IDS must contain one or more monitor IDs")
}

const failedStarts = new Counter("rhythm_failed_run_starts")
const startLatency = new Trend("rhythm_run_start_latency", true)

export const options = {
  scenarios: {
    scheduled_capacity: {
      executor: "constant-arrival-rate",
      exec: "startScheduledEquivalent",
      rate: scheduledRate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: 32,
      maxVUs: 160,
    },
    manual_burst: {
      executor: "shared-iterations",
      exec: "startManualBurst",
      vus: Math.min(50, manualBurst),
      iterations: manualBurst,
      startTime: __ENV.RHYTHM_BURST_START || "2m",
      maxDuration: "5m",
    },
    read_models: {
      executor: "constant-vus",
      exec: "readOperationalModels",
      vus: Number(__ENV.RHYTHM_READ_VUS || 10),
      duration,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    rhythm_failed_run_starts: ["count==0"],
    rhythm_run_start_latency: ["p(95)<500"],
    "http_req_duration{name:overview}": ["p(95)<300"],
    "http_req_duration{name:monitor-list}": ["p(95)<250"],
    dropped_iterations: ["count==0"],
  },
}

export function startScheduledEquivalent() {
  startRun("MANUAL")
}

export function startManualBurst() {
  startRun("MANUAL")
}

export function readOperationalModels() {
  const responses = http.batch([
    ["GET", `${baseURL}/api/v1/overview`, null, { tags: { name: "overview" } }],
    ["GET", `${baseURL}/api/v1/monitors?limit=25`, null, { tags: { name: "monitor-list" } }],
  ])
  check(responses[0], { "overview is available": (response) => response.status === 200 })
  check(responses[1], { "monitor list is available": (response) => response.status === 200 })
  sleep(1)
}

function startRun(triggerType) {
  const monitorID = monitorIDs[Math.floor(Math.random() * monitorIDs.length)]
  const response = http.post(
    `${baseURL}/api/v1/monitors/${monitorID}/runs`,
    JSON.stringify({ mode: "published", triggerType }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "start-run" },
      timeout: "10s",
    }
  )
  startLatency.add(response.timings.duration)
  const accepted = check(response, {
    "run accepted durably": (value) => value.status === 202,
    "run id returned": (value) => {
      try {
        return Boolean(value.json("data.id"))
      } catch {
        return false
      }
    },
  })
  if (!accepted) failedStarts.add(1)
}
