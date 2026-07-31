import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type {
  ApiErrorResponse,
  ApiSuccess,
  JsonValue,
} from "@/lib/api-client/contracts"

export type BrowserMonitorStatus =
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "ANALYZING"
  | "SUCCESS"
  | "SUCCESS_WITH_WARNINGS"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "ABORTED"

export type BrowserLocator = {
  strategy:
    "ROLE" | "LABEL" | "TEST_ID" | "TEXT" | "PLACEHOLDER" | "CSS" | "XPATH"
  value: string
  name?: string
  exact?: boolean
  frame?: string
}

export type BrowserCheck = {
  id: string
  name: string
  kind:
    | "ELEMENT_VISIBLE"
    | "ELEMENT_HIDDEN"
    | "ELEMENT_ENABLED"
    | "ELEMENT_DISABLED"
    | "TEXT"
    | "COUNT"
    | "URL"
    | "TITLE"
    | "NO_JAVASCRIPT_ERRORS"
    | "NO_FAILED_REQUESTS"
    | "ACCESSIBILITY"
    | "PERFORMANCE"
  operator: string
  expected?: string
  threshold?: number
  gateMode: "BLOCKING" | "ADVISORY" | "EVIDENCE_ONLY"
  locator?: BrowserLocator
  enabled: boolean
}

export type BrowserGraphCheck = {
  source: "DOM" | "ACCESSIBILITY" | "NETWORK_JSON" | "VISUAL"
  responseUrlPattern?: string
  valuePath?: string
  seriesPath?: string
  timestampPath?: string
  aggregation:
    "LATEST" | "MINIMUM" | "MAXIMUM" | "AVERAGE" | "SUM" | "COUNT" | "P95"
  operator:
    | "GREATER_THAN"
    | "GREATER_OR_EQUAL"
    | "LESS_THAN"
    | "LESS_OR_EQUAL"
    | "EQUAL"
    | "NOT_EQUAL"
  threshold: number
  dropPercent?: number
  consecutiveRuns?: number
  gateMode: "BLOCKING" | "ADVISORY" | "EVIDENCE_ONLY"
  expectedSeries?: string[]
}

export type BrowserStep = {
  id: string
  name: string
  type:
    | "NAVIGATE"
    | "RELOAD"
    | "GO_BACK"
    | "GO_FORWARD"
    | "CLICK"
    | "DOUBLE_CLICK"
    | "FILL"
    | "CLEAR"
    | "SELECT"
    | "CHECK"
    | "UNCHECK"
    | "PRESS"
    | "HOVER"
    | "FOCUS"
    | "SCROLL"
    | "WAIT"
    | "EXTRACT"
    | "ASSERT"
    | "SCREENSHOT"
    | "GRAPH_CHECK"
  enabled: boolean
  locator?: BrowserLocator
  value?: string
  url?: string
  key?: string
  timeoutMs: number
  sensitive?: boolean
  waitUntil?: string
  checks?: BrowserCheck[]
  graph?: BrowserGraphCheck
  screenshot?: {
    fullPage: boolean
    checkpointId: string
    diffThreshold: number
    maskSelectors?: string[]
  }
}

export type BrowserMonitorDefinition = {
  schemaVersion: 1
  startUrl: string
  allowedOrigins: string[]
  profile: {
    browser: "chromium" | "firefox" | "webkit"
    viewportWidth: number
    viewportHeight: number
    deviceScaleFactor: number
    isMobile: boolean
    locale: string
    timezone: string
    colorScheme: "light" | "dark" | "no-preference"
    userAgent?: string
    networkProfile: string
  }
  authSessionId?: string
  agent: {
    agentId?: string
    groupId?: string
    requiredTags?: string[]
  }
  steps: BrowserStep[]
  artifactPolicy: {
    successScreenshotHours: number
    failureEvidenceDays: number
    captureTraceOnFailure: boolean
  }
  maskSelectors: string[]
}

export type BrowserMonitor = {
  id: string
  name: string
  slug: string
  description?: string
  applicationId?: string
  applicationName?: string
  serviceId?: string
  serviceName?: string
  environmentProfileId?: string
  environmentName?: string
  state: "DRAFT" | "PUBLISHED" | "ENABLED" | "DISABLED" | "ARCHIVED"
  health: "NO_SIGNAL" | "HEALTHY" | "DEGRADED" | "FAILING" | "PAUSED"
  enabled: boolean
  currentDraftRevisionId?: string
  latestPublishedRevisionId?: string
  frequencySeconds: number
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: BrowserMonitorStatus
  consecutiveFailures: number
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
}

export type BrowserMonitorRevision = {
  id: string
  monitorId: string
  revisionNumber: number
  status: "DRAFT" | "PUBLISHED"
  schemaVersion: number
  definition: BrowserMonitorDefinition
  changeSummary?: string
  publishedBy?: string
  publishedAt?: string
  createdBy: string
  createdAt: string
}

export type BrowserCheckResult = {
  id: string
  name: string
  kind: string
  gateMode: string
  passed: boolean
  expected?: JsonValue
  observed?: JsonValue
  error?: string
}

export type BrowserStepRun = {
  id: string
  stepDefinitionId: string
  stepOrder: number
  name: string
  type: string
  status: string
  durationMs: number
  locatorEvidence: Record<string, JsonValue>
  checkResults: BrowserCheckResult[]
  timing: Record<string, JsonValue>
  failureCategory?: string
  failureReason?: string
  startedAt?: string
  endedAt?: string
}

export type BrowserArtifact = {
  id: string
  runId?: string
  monitorId: string
  kind: string
  contentType: string
  byteSize: number
  captureState: string
  masked: boolean
  metadata?: Record<string, JsonValue>
  expiresAt?: string
  createdAt: string
}

export type BrowserRun = {
  id: string
  monitorId: string
  monitorName?: string
  revisionId: string
  status: BrowserMonitorStatus
  triggerType: string
  triggerSource?: string
  agentId?: string
  browserName: string
  browserVersion?: string
  agentImageVersion?: string
  viewport: Record<string, JsonValue>
  executionProfile: Record<string, JsonValue>
  metrics: Record<string, JsonValue>
  graphEvidence: Array<Record<string, JsonValue>>
  visualEvidence: Array<Record<string, JsonValue>>
  networkSummary: Record<string, JsonValue>
  consoleEvents: Array<Record<string, JsonValue>>
  events: Array<{
    type: string
    message: string
    stepId?: string
    category?: string
    details?: Record<string, JsonValue>
    occurredAt: string
    durationMs?: number
  }>
  steps: BrowserStepRun[]
  artifacts: BrowserArtifact[]
  failureCategory?: string
  failureReason?: string
  failedStepId?: string
  queueDelayMs: number
  durationMs: number
  warningCount: number
  startedAt?: string
  endedAt?: string
  createdAt: string
}

export type BrowserPreview = {
  status: BrowserMonitorStatus
  browserName: string
  browserVersion: string
  agentImageVersion: string
  durationMs: number
  warningCount: number
  failureCategory?: string
  failureReason?: string
  failedStepId?: string
  metrics: Record<string, JsonValue>
  graphEvidence: Array<Record<string, JsonValue>>
  visualEvidence: Array<Record<string, JsonValue>>
  networkSummary: Record<string, JsonValue>
  consoleEvents: Array<Record<string, JsonValue>>
  events: BrowserRun["events"]
  steps: BrowserStepRun[]
  artifacts: Array<{
    kind: string
    checkpointId?: string
    contentType: string
    contentBase64: string
    masked: boolean
  }>
}

export type BrowserStatistics = {
  sampleCount: number
  minimumMs?: number
  averageMs?: number
  p50Ms?: number
  p75Ms?: number
  p90Ms?: number
  p95Ms?: number
  p99Ms?: number
  maximumMs?: number
  standardDeviation: number
}

export type BrowserMetrics = {
  monitorId: string
  range: string
  runCount: number
  successRate: number
  failureRate: number
  journey: BrowserStatistics
  metricDistributions: Record<string, BrowserStatistics>
  series: Array<Record<string, JsonValue>>
  graphSeries: Array<Record<string, JsonValue>>
  failureCategories: Record<string, number>
}

export type BrowserBaseline = {
  id: string
  monitorId: string
  revisionId: string
  checkpointId: string
  fingerprint: string
  artifactId: string
  status: "PROPOSED" | "APPROVED" | "SUPERSEDED"
  browserVersion: string
  agentImageVersion: string
  viewport: Record<string, JsonValue>
  approvedBy?: string
  approvedAt?: string
  createdAt: string
}

export type BrowserAuthSession = {
  id: string
  name: string
  applicationId?: string
  environmentProfileId?: string
  mode: string
  allowedOrigins: string[]
  status: string
  expiresAt?: string
  lastValidatedAt?: string
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
}

const baseURL = () => process.env.RHYTHM_API_URL ?? "http://localhost:8080"

function asRecord(value: unknown): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {}
}

function asRecordArray(value: unknown): Array<Record<string, JsonValue>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, JsonValue> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item))
      )
    : []
}

function normalizeBrowserStepRun(step: BrowserStepRun): BrowserStepRun {
  return {
    ...step,
    locatorEvidence: asRecord(step.locatorEvidence),
    checkResults: Array.isArray(step.checkResults) ? step.checkResults : [],
    timing: asRecord(step.timing),
  }
}

/**
 * API responses can include legacy evidence written before a collection was
 * captured. Normalize those nullable collections at the transport boundary so
 * every route receives the stable arrays and objects promised by this client.
 */
export function normalizeBrowserRun(run: BrowserRun): BrowserRun {
  return {
    ...run,
    viewport: asRecord(run.viewport),
    executionProfile: asRecord(run.executionProfile),
    metrics: asRecord(run.metrics),
    graphEvidence: asRecordArray(run.graphEvidence),
    visualEvidence: asRecordArray(run.visualEvidence),
    networkSummary: asRecord(run.networkSummary),
    consoleEvents: asRecordArray(run.consoleEvents),
    events: Array.isArray(run.events) ? run.events : [],
    steps: Array.isArray(run.steps)
      ? run.steps.map(normalizeBrowserStepRun)
      : [],
    artifacts: Array.isArray(run.artifacts) ? run.artifacts : [],
  }
}

function normalizeBrowserStatistics(
  statistics: BrowserStatistics | null | undefined
): BrowserStatistics {
  return {
    sampleCount:
      typeof statistics?.sampleCount === "number" ? statistics.sampleCount : 0,
    minimumMs: statistics?.minimumMs,
    averageMs: statistics?.averageMs,
    p50Ms: statistics?.p50Ms,
    p75Ms: statistics?.p75Ms,
    p90Ms: statistics?.p90Ms,
    p95Ms: statistics?.p95Ms,
    p99Ms: statistics?.p99Ms,
    maximumMs: statistics?.maximumMs,
    standardDeviation:
      typeof statistics?.standardDeviation === "number"
        ? statistics.standardDeviation
        : 0,
  }
}

export function normalizeBrowserMetrics(
  metrics: BrowserMetrics
): BrowserMetrics {
  const distributions =
    metrics.metricDistributions &&
    typeof metrics.metricDistributions === "object"
      ? metrics.metricDistributions
      : {}

  return {
    ...metrics,
    journey: normalizeBrowserStatistics(metrics.journey),
    metricDistributions: Object.fromEntries(
      Object.entries(distributions).map(([key, statistics]) => [
        key,
        normalizeBrowserStatistics(statistics),
      ])
    ),
    series: asRecordArray(metrics.series),
    graphSeries: asRecordArray(metrics.graphSeries),
    failureCategories:
      metrics.failureCategories && typeof metrics.failureCategories === "object"
        ? metrics.failureCategories
        : {},
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseURL()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(120000),
  })
  if (!response.ok) {
    let message = `Rhythm API returned ${response.status}`
    try {
      const failure = (await response.json()) as ApiErrorResponse
      message = failure.error.message || message
    } catch {
      // Preserve the safe status-only message for non-JSON upstream failures.
    }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return ((await response.json()) as ApiSuccess<T>).data
}

const idSchema = z.object({ monitorId: z.string().min(1) })
const runIDSchema = z.object({ runId: z.string().min(1) })
const definitionSchema = z.custom<BrowserMonitorDefinition>((value) =>
  Boolean(value && typeof value === "object")
)

export const listBrowserMonitors = createServerFn({ method: "GET" }).handler(
  () => json<BrowserMonitor[]>("/api/v1/browser-monitors")
)

export const getBrowserMonitor = createServerFn({ method: "GET" })
  .validator(idSchema)
  .handler(({ data }) =>
    json<BrowserMonitor>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}`
    )
  )

export const createBrowserMonitor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      description: z.string(),
      applicationId: z.string(),
      serviceId: z.string(),
      environmentProfileId: z.string(),
      frequencySeconds: z.number().int().min(60),
      enabled: z.boolean(),
      definition: definitionSchema,
    })
  )
  .handler(({ data }) =>
    json<BrowserMonitor>("/api/v1/browser-monitors", {
      method: "POST",
      body: JSON.stringify(data),
    })
  )

export const updateBrowserMonitor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      input: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        applicationId: z.string().optional(),
        serviceId: z.string().optional(),
        environmentProfileId: z.string().optional(),
        frequencySeconds: z.number().int().min(60).optional(),
        enabled: z.boolean().optional(),
      }),
    })
  )
  .handler(({ data }) =>
    json<BrowserMonitor>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}`,
      { method: "PATCH", body: JSON.stringify(data.input) }
    )
  )

export const deleteBrowserMonitor = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(({ data }) =>
    json<void>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}`,
      { method: "DELETE" }
    )
  )

export const listBrowserMonitorRevisions = createServerFn({ method: "GET" })
  .validator(idSchema)
  .handler(({ data }) =>
    json<BrowserMonitorRevision[]>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/revisions`
    )
  )

export const saveBrowserMonitorDraft = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      definition: definitionSchema,
    })
  )
  .handler(({ data }) =>
    json<BrowserMonitorRevision>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/draft`,
      { method: "PUT", body: JSON.stringify({ definition: data.definition }) }
    )
  )

export const publishBrowserMonitor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      changeSummary: z.string(),
    })
  )
  .handler(({ data }) =>
    json<BrowserMonitorRevision>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/publish`,
      {
        method: "POST",
        body: JSON.stringify({ changeSummary: data.changeSummary }),
      }
    )
  )

export const previewBrowserMonitor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      definition: definitionSchema,
    })
  )
  .handler(({ data }) =>
    json<BrowserPreview>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/preview`,
      { method: "POST", body: JSON.stringify({ definition: data.definition }) }
    )
  )

export const previewUnsavedBrowserMonitor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      environmentProfileId: z.string(),
      definition: definitionSchema,
    })
  )
  .handler(({ data }) =>
    json<BrowserPreview>("/api/v1/browser-monitors/preview", {
      method: "POST",
      body: JSON.stringify(data),
    })
  )

export const runBrowserMonitor = createServerFn({ method: "POST" })
  .validator(z.object({ monitorId: z.string().min(1), revision: z.string() }))
  .handler(async ({ data }) => {
    const result = await json<{ run: BrowserRun; diagnosticsUrl: string }>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/runs`,
      { method: "POST", body: JSON.stringify({ revision: data.revision }) }
    )
    return { ...result, run: normalizeBrowserRun(result.run) }
  })

export const listBrowserRuns = createServerFn({ method: "GET" })
  .validator(
    z.object({ monitorId: z.string().min(1), limit: z.number().optional() })
  )
  .handler(async ({ data }) => {
    const runs = await json<BrowserRun[]>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/runs?limit=${data.limit ?? 50}`
    )
    return Array.isArray(runs) ? runs.map(normalizeBrowserRun) : []
  })

export const getBrowserRun = createServerFn({ method: "GET" })
  .validator(runIDSchema)
  .handler(async ({ data }) =>
    normalizeBrowserRun(
      await json<BrowserRun>(
        `/api/v1/browser-runs/${encodeURIComponent(data.runId)}/diagnostics`
      )
    )
  )

export const cancelBrowserRun = createServerFn({ method: "POST" })
  .validator(runIDSchema)
  .handler(({ data }) =>
    json<BrowserRun>(
      `/api/v1/browser-runs/${encodeURIComponent(data.runId)}/cancel`,
      { method: "POST" }
    )
  )

export const getBrowserMetrics = createServerFn({ method: "GET" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      range: z.enum(["24h", "7d", "30d", "90d"]),
    })
  )
  .handler(async ({ data }) =>
    normalizeBrowserMetrics(
      await json<BrowserMetrics>(
        `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/metrics?range=${data.range}`
      )
    )
  )

export const listBrowserBaselines = createServerFn({ method: "GET" })
  .validator(idSchema)
  .handler(({ data }) =>
    json<BrowserBaseline[]>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/baselines`
    )
  )

export const proposeBrowserBaseline = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      runId: z.string().min(1),
      artifactId: z.string().min(1),
      checkpointId: z.string().min(1),
    })
  )
  .handler(({ data }) =>
    json<BrowserBaseline>(
      `/api/v1/browser-monitors/${encodeURIComponent(data.monitorId)}/baselines`,
      {
        method: "POST",
        body: JSON.stringify({
          runId: data.runId,
          artifactId: data.artifactId,
          checkpointId: data.checkpointId,
        }),
      }
    )
  )

export const approveBrowserBaseline = createServerFn({ method: "POST" })
  .validator(z.object({ baselineId: z.string().min(1) }))
  .handler(({ data }) =>
    json<BrowserBaseline>(
      `/api/v1/browser-baselines/${encodeURIComponent(data.baselineId)}/approve`,
      { method: "POST" }
    )
  )

export const deleteBrowserBaseline = createServerFn({ method: "POST" })
  .validator(z.object({ baselineId: z.string().min(1) }))
  .handler(({ data }) =>
    json<void>(
      `/api/v1/browser-baselines/${encodeURIComponent(data.baselineId)}`,
      { method: "DELETE" }
    )
  )

export const listBrowserAuthSessions = createServerFn({
  method: "GET",
}).handler(() => json<BrowserAuthSession[]>("/api/v1/browser-auth-sessions"))
