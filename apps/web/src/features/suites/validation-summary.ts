import type { DeploymentValidationRunContract } from "@/lib/api-client/contracts"

type MonitorResult = NonNullable<
  DeploymentValidationRunContract["report"]["monitors"]
>[number]
type BrowserResult = NonNullable<
  DeploymentValidationRunContract["report"]["browserMonitors"]
>[number]
type CheckResult = NonNullable<
  DeploymentValidationRunContract["report"]["elfResults"]
>[number]
type DynatraceResult = NonNullable<
  DeploymentValidationRunContract["report"]["dynatraceResults"]
>[number]

export type ValidationCounts = {
  failed: number
  warnings: number
  passed: number
  total: number
  durationLabel: string
}

const FAILED_CLASSIFICATIONS = new Set(["REGRESSED"])
const WARNING_CLASSIFICATIONS = new Set(["INSUFFICIENT_HISTORY", "PENDING"])

export function checkFailed(status?: string) {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESS":
    case "SUCCESS_WITH_WARNINGS":
    case "PASSED":
    case "PASSED_WITH_WARNINGS":
    case "PENDING":
    case "":
      return false
    default:
      return true
  }
}

export function samplePassed(status?: string) {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESS":
    case "SUCCESS_WITH_WARNINGS":
    case "PASSED":
    case "PASSED_WITH_WARNINGS":
      return true
    default:
      return false
  }
}

export function monitorFailed(monitor: MonitorResult) {
  if (FAILED_CLASSIFICATIONS.has(monitor.classification)) return true
  if ((monitor.post.failureCount ?? 0) > 0) return true
  if ((monitor.samples ?? []).some((sample) => !samplePassed(sample.status))) {
    return true
  }
  return (monitor.steps ?? []).some(
    (step) =>
      FAILED_CLASSIFICATIONS.has(step.classification) ||
      (step.post.failureCount ?? 0) > 0
  )
}

export function browserFailed(monitor: BrowserResult) {
  if (FAILED_CLASSIFICATIONS.has(monitor.classification)) return true
  if ((monitor.post.failureCount ?? 0) > 0) return true
  return (monitor.samples ?? []).some((sample) => !samplePassed(sample.status))
}

export function monitorWarned(monitor: MonitorResult) {
  return (
    !monitorFailed(monitor) &&
    WARNING_CLASSIFICATIONS.has(monitor.classification)
  )
}

export function browserWarned(monitor: BrowserResult) {
  return (
    !browserFailed(monitor) &&
    WARNING_CLASSIFICATIONS.has(monitor.classification)
  )
}

function rank(failed: boolean, warned: boolean, required: boolean) {
  if (failed && required) return 0
  if (failed) return 1
  if (warned) return 2
  return 3
}

export function sortMonitors(items: MonitorResult[] | undefined) {
  return [...(items ?? [])].sort(
    (left, right) =>
      rank(monitorFailed(left), monitorWarned(left), left.required) -
      rank(monitorFailed(right), monitorWarned(right), right.required)
  )
}

export function sortBrowsers(items: BrowserResult[] | undefined) {
  return [...(items ?? [])].sort(
    (left, right) =>
      rank(browserFailed(left), browserWarned(left), left.required) -
      rank(browserFailed(right), browserWarned(right), right.required)
  )
}

export function sortChecks(items: CheckResult[] | undefined) {
  return [...(items ?? [])].sort((left, right) => {
    const leftFailed = checkFailed(left.status)
    const rightFailed = checkFailed(right.status)
    return (
      rank(leftFailed, false, left.required) -
      rank(rightFailed, false, right.required)
    )
  })
}

export function sortDynatrace(items: DynatraceResult[] | undefined) {
  return [...(items ?? [])].sort((left, right) => {
    const leftFailed = checkFailed(left.status)
    const rightFailed = checkFailed(right.status)
    return (
      rank(leftFailed, false, left.required) -
      rank(rightFailed, false, right.required)
    )
  })
}

export function formatDuration(
  startedAt?: string,
  endedAt?: string
): string {
  if (!startedAt || !endedAt) return "Duration not recorded"
  const started = Date.parse(startedAt)
  const ended = Date.parse(endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return "Duration not recorded"
  }
  const total = Math.round((ended - started) / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  return remain ? `${hours}h ${remain}m` : `${hours}h`
}

export function summarizeValidation(
  run: DeploymentValidationRunContract
): ValidationCounts {
  const report = run.report
  const monitors = report.monitors ?? []
  const browsers = report.browserMonitors ?? []
  const elf = report.elfResults ?? []
  const alerts = report.alertResults ?? []
  const dynatrace = report.dynatraceResults ?? []
  let failed = 0
  let warnings = 0
  let passed = 0
  for (const monitor of monitors) {
    if (monitorFailed(monitor)) failed += 1
    else if (monitorWarned(monitor)) warnings += 1
    else passed += 1
  }
  for (const monitor of browsers) {
    if (browserFailed(monitor)) failed += 1
    else if (browserWarned(monitor)) warnings += 1
    else passed += 1
  }
  for (const check of [...elf, ...alerts, ...dynatrace]) {
    if (checkFailed(check.status)) failed += 1
    else passed += 1
  }
  warnings += report.warnings?.length ?? 0
  return {
    failed,
    warnings,
    passed,
    total: monitors.length + browsers.length + elf.length + alerts.length + dynatrace.length,
    durationLabel: formatDuration(run.startedAt, run.endedAt),
  }
}

export function decisionCopy(decision: string, failed: number) {
  if (decision === "BLOCK") {
    return failed
      ? `Block this release. ${failed} required check${failed === 1 ? "" : "s"} failed the gate.`
      : "Block this release. Rhythm recorded a blocking gate decision."
  }
  if (decision === "ALLOW_WITH_WARNINGS") {
    return "Allow with warnings. Review the advisory findings before promoting."
  }
  if (decision === "ALLOW") {
    return "Allow this release. Required checks passed the gate."
  }
  return "Gate decision is still pending."
}

export function formatMilliseconds(value?: number) {
  return value === undefined || value === null
    ? "Not recorded"
    : `${value.toLocaleString()} ms`
}
