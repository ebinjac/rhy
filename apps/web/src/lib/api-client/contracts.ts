export type ApiMeta = {
  requestId: string
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type ApiSuccess<T> = {
  data: T
  meta: ApiMeta
}

export type ApiErrorResponse = {
  error: {
    code: string
    message: string
    details?: {
      fields?: Array<{ path: string; message: string }>
    }
  }
  meta: ApiMeta
}

export type MonitorContract = {
  id: string
  name: string
  slug: string
  description?: string
  ownerId?: string
  tags: string[]
  environmentId?: string
  state: "DRAFT" | "PUBLISHED" | "ENABLED" | "DISABLED" | "ARCHIVED"
  health: "UNKNOWN" | "HEALTHY" | "WARNING" | "FAILING" | "PAUSED"
  enabled: boolean
  stepCount: number
  scheduleSummary?: string
  successRate24h?: number
  lastLatencyMs?: number
  lastRunAt?: string
  currentDraftRevisionId?: string
  latestPublishedRevisionId?: string
  updatedAt: string
}

export type RevisionContract = {
  id: string
  monitorId: string
  revisionNumber: number
  status: "DRAFT" | "PUBLISHED"
  schemaVersion: number
  definition: Record<string, JsonValue>
  changeSummary?: string
  publishedBy?: string
  publishedAt?: string
  createdBy: string
  createdAt: string
}

export type ScheduleContract = {
  id?: string
  monitorId?: string
  type: "MANUAL" | "INTERVAL" | "CRON"
  expression?: string
  intervalSeconds?: number
  timezone: string
  jitterSeconds: number
  concurrencyPolicy: "SKIP_IF_RUNNING" | "QUEUE" | "ALLOW"
  missedRunPolicy: "SKIP" | "RUN_ONCE"
  active: boolean
  nextRunAt?: string
}

export type AlertContract = {
  id: string
  sourceType: "RHYTHM_MONITOR" | "OPENSEARCH_ALERTING"
  monitorId?: string
  monitorName?: string
  applicationId?: string
  applicationName?: string
  applicationCarId?: string
  serviceId?: string
  serviceName?: string
  receiverId?: string
  state: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "SUPPRESSED" | "ERROR"
  upstreamState?: "ACTIVE" | "ACKNOWLEDGED" | "COMPLETED" | "DELETED" | "ERROR"
  severity: "INFO" | "LOW" | "WARNING" | "HIGH" | "CRITICAL"
  title: string
  description?: string
  failureCategory?: string
  failedStepId?: string
  consecutiveFailures: number
  externalMonitorId?: string
  externalMonitorName?: string
  externalMonitorType?: "QUERY_LEVEL" | "BUCKET_LEVEL" | "DOCUMENT_LEVEL"
  externalTriggerId?: string
  externalTriggerName?: string
  externalAlertId?: string
  bucketKey?: string
  hitCount?: number
  evidence: Record<string, JsonValue>
  dashboardUrl?: string
  firstTriggeredAt?: string
  lastTriggeredAt?: string
  lastReceivedAt?: string
  lastReconciledAt?: string
  acknowledgedAt?: string
  acknowledgedBy?: string
  resolvedAt?: string
  createdAt: string
  updatedAt: string
}

export type AlertEventContract = {
  id: string
  eventType: string
  upstreamState?: string
  summary: string
  evidence: Record<string, JsonValue>
  occurredAt: string
}

export type OpenSearchAlertReceiverContract = {
  id: string
  applicationId: string
  applicationName: string
  applicationCarId?: string
  serviceId?: string
  serviceName?: string
  name: string
  enabled: boolean
  dashboardUrl?: string
  expectedMonitorTypes: Array<"QUERY_LEVEL" | "BUCKET_LEVEL" | "DOCUMENT_LEVEL">
  reconciliationIntervalSeconds: number
  lastDeliveryAt?: string
  lastReconciledAt?: string
  lastReconciliationStatus: "NOT_RUN" | "SUCCESS" | "FAILED"
  lastReconciliationError?: string
  createdAt: string
  updatedAt: string
  token?: string
}

export type OpenSearchAlertSetupContract = {
  receiverId: string
  webhookPath: string
  webhookUrl: string
  headers: Record<string, string>
  queryTemplate: string
  bucketTemplate: string
  documentTemplate: string
  dashboardSteps: string[]
  credentialWarning: string
}

export type OpenSearchAlertDeliveryContract = {
  id: string
  status: "ACCEPTED" | "PROCESSED" | "REJECTED" | "DUPLICATE"
  schemaVersion: string
  eventCount: number
  safeError?: string
  evidence: Record<string, JsonValue>
  receivedAt: string
  processedAt?: string
}

export type AuditEventContract = {
  id: string
  actorId?: string
  action: string
  resourceType: string
  resourceId: string
  outcome: "SUCCESS" | "FAILURE"
  correlationId?: string
  createdAt: string
}
export type ConfigurationProfileContract = {
  id: string
  kind:
    | "ENVIRONMENT"
    | "SECRET_REFERENCE"
    | "CERTIFICATE"
    | "PROXY"
    | "AUTH"
    | "NOTIFICATION"
    | "TELEMETRY"
  name: string
  description?: string
  profileType: string
  config: Record<string, JsonValue>
  active: boolean
  updatedAt: string
}

export type ValidationSuiteContract = {
  id: string
  name: string
  description?: string
  environment?: string
  stages: Array<{
    id: string
    name: string
    order: number
    checks: Array<{
      id: string
      kind: "MONITOR" | "ELF_QUERY" | "OPENSEARCH_ALERT"
      monitorId?: string
      queryId?: string
      receiverId?: string
      externalMonitorId?: string
      externalTriggerId?: string
      externalMonitorName?: string
      externalTriggerName?: string
      name?: string
      required: boolean
    }>
  }>
  parallelism: number
  failFast: boolean
  timeoutSeconds: number
  baselinePolicy: string
  notificationPolicy: string
  updatedAt: string
}

export type ValidationSuiteRunContract = {
  id: string
  suiteId: string
  status:
    | "RUNNING"
    | "PASSED"
    | "PASSED_WITH_WARNINGS"
    | "FAILED"
    | "TIMED_OUT"
    | "CANCELLED"
  gateDecision: "PENDING" | "ALLOW" | "ALLOW_WITH_WARNINGS" | "BLOCK"
  triggerType: string
  triggerSource?: string
  results: Array<{
    stageId: string
    stageName: string
    checkId: string
    kind: "MONITOR" | "ELF_QUERY" | "OPENSEARCH_ALERT"
    monitorId?: string
    queryId?: string
    queryRevisionId?: string
    elfRunId?: string
    alertId?: string
    receiverId?: string
    externalMonitorId?: string
    externalTriggerId?: string
    externalMonitorName?: string
    externalTriggerName?: string
    alertState?: string
    upstreamState?: string
    name?: string
    required: boolean
    status: string
    monitorRunId?: string
    gateMode?: string
    decision?: string
    hitCount?: number
    resolvedIndex?: string
    failureCategory?: string
    failureReason?: string
    durationMs: number
  }>
  startedAt: string
  endedAt?: string
  durationMs: number
}

export type DeploymentDistributionContract = {
  sampleCount: number
  completedCount: number
  successCount: number
  failureCount: number
  timeoutCount: number
  successRate: number
  errorRate: number
  timeoutRate: number
  minMs?: number
  averageMs?: number
  p50Ms?: number
  p75Ms?: number
  p90Ms?: number
  p95Ms?: number
  p99Ms?: number
  maxMs?: number
  standardDeviationMs?: number
  failureCategories: Record<string, number>
  series: Array<{ runId?: string; valueMs: number; createdAt: string }>
}

export type DeploymentValidationRunContract = {
  id: string
  suiteId: string
  status:
    "QUEUED" | "RUNNING" | "CANCELLING" | "CANCELLED" | "FAILED" | "COMPLETED"
  phase: string
  gateDecision: "PENDING" | "ALLOW" | "ALLOW_WITH_WARNINGS" | "BLOCK"
  progress: { completed: number; total: number; message: string }
  deployment: {
    deploymentId?: string
    version?: string
    commit?: string
    applicationId?: string
    environment?: string
    notes?: string
    deploymentStart: string
  }
  configuration: {
    baselineWindow: "24h" | "7d" | "30d"
    sampleCount: number
    sampleIntervalSeconds: number
    minimumSamples: number
    regressionPercent: number
    regressionMinimumMs: number
    monitorRevisionIds?: Record<string, string>
    elfRevisionIds?: Record<string, string>
  }
  suiteSnapshot: ValidationSuiteContract
  report: {
    runId?: string
    suiteId?: string
    suiteName?: string
    status?: string
    gateDecision?: string
    recommendation?: string
    baselineFrom?: string
    baselineTo?: string
    postFrom?: string
    postTo?: string
    warnings?: string[]
    reasons?: string[]
    monitors?: Array<{
      checkId: string
      monitorId: string
      monitorName: string
      revisionId: string
      required: boolean
      baseline: DeploymentDistributionContract
      post: DeploymentDistributionContract
      classification: string
      deltaMs: number
      deltaPercent: number
      reasons: string[]
      samples: Array<{
        id: string
        monitorId: string
        monitorRunId?: string
        sampleNumber: number
        status: string
        durationMs: number
        failureCategory?: string
        createdAt: string
      }>
      steps: Array<{
        stepDefinitionId: string
        stepName: string
        baseline: DeploymentDistributionContract
        post: DeploymentDistributionContract
        classification: string
        deltaMs: number
        deltaPercent: number
      }>
    }>
    elfResults?: ValidationSuiteRunContract["results"]
    alertResults?: ValidationSuiteRunContract["results"]
    generatedAt?: string
  }
  failureReason?: string
  startedAt?: string
  endedAt?: string
  createdAt: string
  updatedAt: string
}

export type AgentContract = {
  id: string
  name: string
  groupId?: string
  version: string
  status: "ACTIVE" | "DRAINING" | "REVOKED"
  health: "HEALTHY" | "OFFLINE" | "DRAINING" | "AT_CAPACITY" | "REVOKED"
  tags: string[]
  capabilities: Record<string, JsonValue>
  maxConcurrency: number
  activeRuns: number
  lastHeartbeatAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export type RunContract = {
  id: string
  monitorId: string
  revisionId: string
  status:
    | "QUEUED"
    | "STARTING"
    | "RUNNING"
    | "SUCCESS"
    | "SUCCESS_WITH_WARNINGS"
    | "FAILED"
    | "TIMED_OUT"
    | "CANCELLED"
    | "ABORTED"
    | "SKIPPED_CONDITION"
  failureCategory?: string
  failureReason?: string
  queueDelayMs?: number
  warningCount: number
  durationMs: number
  startedAt?: string
  endedAt?: string
  createdAt: string
  triggerType: string
  triggerSource?: string
  agentId?: string
  failedStepId?: string
  executionContext?: Record<string, JsonValue>
  alertImpact?: Record<string, JsonValue>
  events?: RunEventContract[]
  steps?: StepRunContract[]
  setupScript?: ScriptResultContract
}

export type RunMetricPointContract = {
  runId: string
  status: RunContract["status"]
  failureCategory?: string
  createdAt: string
  apiResponseTimeMs?: number
  executionDurationMs: number
  preparationMs: number
  postProcessingMs: number
  networkTotalMs: number
  retryBackoffMs: number
  queueDelayMs: number
  retryCount: number
  warningCount: number
  spike: boolean
}

export type RunHistoryMetricsContract = {
  window: "24h" | "7d" | "30d" | "90d"
  windowStart: string
  windowEnd: string
  summary: {
    runCount: number
    measuredRunCount: number
    successRate: number
    errorRate: number
    timeoutRate: number
    averageResponseMs?: number
    latestResponseMs?: number
    latestChangePercent?: number
    standardDeviationMs?: number
    runsPerHour: number
    spikeCount: number
    averagePreparationMs?: number
    averagePostProcessingMs?: number
    averageExecutionMs?: number
    averageQueueDelayMs?: number
  }
  percentiles: {
    minMs?: number
    p50Ms?: number
    p75Ms?: number
    p90Ms?: number
    p95Ms?: number
    p99Ms?: number
    maxMs?: number
  }
  statusDistribution: Record<string, number>
  failureCategories: Record<string, number>
  points: RunMetricPointContract[]
}

export type ScriptProblemContract = {
  severity: "error" | "warning"
  message: string
  line: number
  column: number
  code: string
}
export type ScriptLogContract = {
  level: "log" | "info" | "warn" | "error" | "debug"
  message: string
  timestamp: string
}
export type ScriptTestContract = {
  name: string
  passed: boolean
  skipped?: boolean
  error?: string
}
export type ScriptChangeContract = {
  scope: string
  key: string
  operation: "added" | "updated" | "removed"
  before?: JsonValue
  after?: JsonValue
  state: string
}
export type ScriptResultContract = {
  status: "SUCCESS" | "FAILED"
  runtimeVersion: string
  durationMs: number
  logs: ScriptLogContract[]
  tests: ScriptTestContract[]
  variableChanges: ScriptChangeContract[]
  requestChanges: ScriptChangeContract[]
  auxiliaryRequests: Array<{
    method: string
    url: string
    status?: number
    durationMs: number
    error?: string
  }>
  variables: Record<string, string>
  environment: Record<string, string>
  collection: Record<string, string>
  request?: Record<string, JsonValue>
  problems: ScriptProblemContract[]
  errorCategory?: string
  errorMessage?: string
  errorLine?: number
  errorColumn?: number
  safeStack?: string
}

export type StepRunContract = {
  id: string
  runId: string
  stepDefinitionId: string
  stepOrder: number
  stepName: string
  stepType: string
  status: RunContract["status"]
  requestSummary?: Record<string, JsonValue>
  responseSummary?: Record<string, JsonValue>
  timing?: Record<string, JsonValue>
  tls?: Record<string, JsonValue>
  proxy?: Record<string, JsonValue>
  attemptCount: number
  attempts?: AttemptRunContract[]
  extractors: Array<{
    variable: string
    source: string
    value?: JsonValue
    sensitive: boolean
    success: boolean
    error?: string
  }>
  assertions: Array<{
    type: string
    expression: string
    expected: string
    observed?: JsonValue
    passed: boolean
    error?: string
  }>
  outputs?: Record<string, JsonValue>
  failureCategory?: string
  errorMessage?: string
  durationMs: number
  startedAt?: string
  endedAt?: string
  preRequestScript?: ScriptResultContract
}

export type AttemptRunContract = {
  id: string
  attemptNumber: number
  status: RunContract["status"]
  responseStatus?: number
  failureCategory?: string
  errorMessage?: string
  requestSummary?: Record<string, JsonValue>
  responseSummary?: Record<string, JsonValue>
  timing?: Record<string, JsonValue>
  tls?: Record<string, JsonValue>
  proxy?: Record<string, JsonValue>
  redirects?: Array<Record<string, JsonValue>>
  retryBackoffMs?: number
  startedAt: string
  endedAt: string
  durationMs: number
}

export type RunEventContract = {
  id: string
  sequence: number
  type: string
  status?: RunContract["status"]
  stepRunId?: string
  stepId?: string
  attemptNumber?: number
  category?: string
  message: string
  details?: Record<string, JsonValue>
  occurredAt: string
  durationMs?: number
}

export type StepBaselineContract = {
  sampleCount: number
  p50Ms?: number
  p95Ms?: number
  changePercent?: number
  classification: "INSUFFICIENT_HISTORY" | "NORMAL" | "REGRESSED" | "IMPROVED"
  mixedRevisions: boolean
}
export type StepInsightContract = {
  stepDefinitionId: string
  stepRunId: string
  rank: number
  durationMs: number
  durationShare: number
  apiResponseTimeMs?: number
  apiResponseShare?: number
  slowestPhase?: string
  slowestPhaseMs?: number
  baseline: StepBaselineContract
}
export type FailureDetailContract = {
  phase: string
  category: string
  title: string
  message: string
  stepId?: string
  stepName?: string
  attemptNumber?: number
  checkType?: string
  expected?: string
  observed?: JsonValue
  retryable: boolean
  helpCode: string
}
export type RunDiagnosticsContract = {
  run: RunContract
  analysis: {
    stepTimeMs: number
    overheadMs: number
    apiResponseTimeMs: number
    networkTimeMs: number
    preparationTimeMs: number
    postProcessingMs: number
    retryCount: number
    retryTimeMs: number
    slowestStepId?: string
    slowestStepName?: string
    slowestStepMs?: number
    slowestPhase?: string
    slowestPhaseMs?: number
    completedSteps: number
    failedSteps: number
    skippedSteps: number
  }
  primaryFailure?: FailureDetailContract
  steps: StepInsightContract[]
  events: RunEventContract[]
}

export type ELFSettingsContract = {
  baseUrl: string
  dashboardUrl?: string
  defaultIndexPattern: string
  timeoutSeconds: number
  allowedIndexPatterns: string[]
  tlsProfileId?: string
  proxyProfileId?: string
  authMode: "NONE" | "BASIC" | "BEARER"
  username?: string
  credentialSecretRef?: string
  updatedBy?: string
  updatedAt?: string
}
export type ELFServiceContract = {
  id: string
  applicationId: string
  name: string
  indexPattern?: string
  timeField?: string
  semanticMapping: Record<string, string>
  createdAt: string
  updatedAt: string
}
export type ELFApplicationContract = {
  id: string
  carId?: string
  name: string
  owner?: string
  environment?: string
  defaultIndexPattern?: string
  defaultTimeField: string
  maskingRules: string[]
  semanticMapping: Record<string, string>
  active: boolean
  services: ELFServiceContract[]
  monitorIds: string[]
  createdAt: string
  updatedAt: string
}
export type ELFFieldContract = {
  path: string
  type: string
  role?: string
  samples: JsonValue[]
  usage: number
}
export type ELFRunContract = {
  id: string
  queryId?: string
  revisionId?: string
  status: "SUCCESS" | "FAILED"
  decision: "PASS" | "FAIL" | "PENDING"
  gateMode: "BLOCKING" | "ADVISORY"
  applicationId?: string
  applicationName?: string
  serviceId?: string
  serviceName?: string
  resolvedIndex: string
  timeFrom: string
  timeTo: string
  hitCount: number
  openSearchTookMs: number
  roundTripMs: number
  shardSummary: Record<string, JsonValue>
  aggregations: Record<string, JsonValue>
  rawResponse: Record<string, JsonValue>
  samples: Array<Record<string, JsonValue>>
  sampleState: "CAPTURED" | "EXPIRED" | "NOT_CAPTURED"
  truncation: Record<string, JsonValue>
  fields: ELFFieldContract[]
  failureCategory?: string
  failureReason?: string
  debug: Record<string, JsonValue>
  createdAt: string
  completedAt?: string
}
export type ELFQueryContract = {
  id: string
  name: string
  description?: string
  applicationId: string
  applicationName: string
  serviceId?: string
  serviceName?: string
  indexOverride?: string
  active: boolean
  currentRevisionId: string
  revisionNumber: number
  searchBody: Record<string, JsonValue>
  defaultWindowSeconds: number
  checkKind: "EXPRESSION" | "HIT_COUNT" | "AGGREGATION"
  criteria: Record<string, JsonValue>
  gateMode: "BLOCKING" | "ADVISORY"
  discoveredSchema: ELFFieldContract[]
  semanticMapping: Record<string, string>
  lastRun?: ELFRunContract
  createdAt: string
  updatedAt: string
}
export type ELFValidationContract = {
  valid: boolean
  problems: Array<{ path: string; code: string; message: string }>
  compiledBody?: Record<string, JsonValue>
  policyNotes: string[]
}
