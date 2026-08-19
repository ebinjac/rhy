import { lazy, Suspense } from "react"
import { Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
} from "lucide-react"

import { InfoHint } from "@/components/info-hint"
import { MetricsSkeleton } from "@/components/metrics-skeleton"
import type {
  DeploymentDistributionContract,
  DeploymentValidationRunContract,
} from "@/lib/api-client/contracts"
import {
  browserFailed,
  checkFailed,
  formatMilliseconds,
  monitorFailed,
} from "@/features/suites/validation-summary"

const ComparisonChart = lazy(async () => ({
  default: (await import("@/features/suites/deployment-run-charts"))
    .ComparisonChart,
}))
const TimeSeriesChart = lazy(async () => ({
  default: (await import("@/features/suites/deployment-run-charts"))
    .TimeSeriesChart,
}))

type MonitorResultType = NonNullable<
  DeploymentValidationRunContract["report"]["monitors"]
>[number]
type BrowserMonitorResultType = NonNullable<
  DeploymentValidationRunContract["report"]["browserMonitors"]
>[number]
type CheckResultType = NonNullable<
  DeploymentValidationRunContract["report"]["elfResults"]
>[number]
type DynatraceResultType = NonNullable<
  DeploymentValidationRunContract["report"]["dynatraceResults"]
>[number]

export function MonitorResult({ monitor }: { monitor: MonitorResultType }) {
  const failed = monitorFailed(monitor)
  return (
    <details className="group py-4" open={failed}>
      <summary className="flex cursor-pointer list-none flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{monitor.monitorName}</p>
            <ClassificationBadge value={monitor.classification} />
            <Badge variant="outline">
              {monitor.required ? "Required" : "Optional"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            p95 {formatMilliseconds(monitor.baseline.p95Ms)} →{" "}
            {formatMilliseconds(monitor.post.p95Ms)} ·{" "}
            {monitor.deltaPercent > 0 ? "+" : ""}
            {monitor.deltaPercent}%
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {monitor.post.successRate}% post success
          </span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="mt-5 border-t pt-5">
        {(monitor.reasons ?? []).length ? (
          <ul className="mb-5 list-disc space-y-1 pl-5 text-sm">
            {(monitor.reasons ?? []).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <DistributionTable baseline={monitor.baseline} post={monitor.post} />
          <Suspense fallback={<MetricsSkeleton chartsOnly />}>
            <ComparisonChart baseline={monitor.baseline} post={monitor.post} />
          </Suspense>
        </div>
        <Suspense fallback={<MetricsSkeleton chartsOnly />}>
          <TimeSeriesChart baseline={monitor.baseline} post={monitor.post} />
        </Suspense>
        {(monitor.steps ?? []).length ? (
          <div className="mt-6">
            <h3 className="text-sm font-medium">HTTP steps</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 font-medium">Step</th>
                    <th className="py-2 font-medium">Baseline p95</th>
                    <th className="py-2 font-medium">Post p95</th>
                    <th className="py-2 font-medium">Change</th>
                    <th className="py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(monitor.steps ?? []).map((step) => (
                    <tr
                      className="border-b last:border-0"
                      key={step.stepDefinitionId}
                    >
                      <td className="py-2.5 font-medium">{step.stepName}</td>
                      <td>{formatMilliseconds(step.baseline.p95Ms)}</td>
                      <td>{formatMilliseconds(step.post.p95Ms)}</td>
                      <td>
                        {step.deltaPercent > 0 ? "+" : ""}
                        {step.deltaPercent}%
                      </td>
                      <td>
                        <ClassificationBadge value={step.classification} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <div className="mt-6">
          <h3 className="text-sm font-medium">Post-validation executions</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {(monitor.samples ?? []).map((sample) =>
              sample.monitorRunId ? (
                <Link
                  key={sample.id}
                  to="/monitors/$monitorId/runs/$runId"
                  params={{
                    monitorId: monitor.monitorId,
                    runId: sample.monitorRunId,
                  }}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  <StatusDot status={sample.status} /> Sample{" "}
                  {sample.sampleNumber}
                </Link>
              ) : (
                <span
                  key={sample.id}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
                >
                  <StatusDot status={sample.status} /> Sample{" "}
                  {sample.sampleNumber}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </details>
  )
}

export function BrowserMonitorResult({
  monitor,
}: {
  monitor: BrowserMonitorResultType
}) {
  const failed = browserFailed(monitor)
  return (
    <details className="group py-4" open={failed}>
      <summary className="flex cursor-pointer list-none flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{monitor.monitorName}</p>
            <ClassificationBadge value={monitor.classification} />
            <Badge variant="outline">
              {monitor.required ? "Required" : "Optional"}
            </Badge>
            <Badge variant="secondary">Synthetic browser</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Journey p95 {formatMilliseconds(monitor.baseline.p95Ms)} →{" "}
            {formatMilliseconds(monitor.post.p95Ms)} ·{" "}
            {monitor.deltaPercent > 0 ? "+" : ""}
            {monitor.deltaPercent}%
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {monitor.post.successRate}% post success
          </span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="mt-5 border-t pt-5">
        {(monitor.reasons ?? []).length ? (
          <ul className="mb-5 list-disc space-y-1 pl-5 text-sm">
            {(monitor.reasons ?? []).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-5 xl:grid-cols-2">
          <DistributionTable baseline={monitor.baseline} post={monitor.post} />
          <Suspense fallback={<MetricsSkeleton chartsOnly />}>
            <ComparisonChart baseline={monitor.baseline} post={monitor.post} />
          </Suspense>
        </div>
        <Suspense fallback={<MetricsSkeleton chartsOnly />}>
          <TimeSeriesChart baseline={monitor.baseline} post={monitor.post} />
        </Suspense>
        <div className="mt-6">
          <h3 className="text-sm font-medium">Post-deployment journeys</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {(monitor.samples ?? []).map((sample) =>
              sample.browserRunId ? (
                <Link
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                  key={sample.id}
                  params={{
                    monitorId: monitor.browserMonitorId,
                    runId: sample.browserRunId,
                  }}
                  to="/ui-monitoring/$monitorId/runs/$runId"
                >
                  <StatusDot status={sample.status} /> Journey{" "}
                  {sample.sampleNumber}
                </Link>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
                  key={sample.id}
                >
                  <StatusDot status={sample.status} /> Journey{" "}
                  {sample.sampleNumber}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </details>
  )
}

export function CheckRow({
  result,
  queryId,
  alertsHref,
}: {
  result: CheckResultType
  queryId?: string
  alertsHref?: boolean
}) {
  const failed = checkFailed(result.status)
  return (
    <div
      className={`flex flex-col justify-between gap-2 py-4 sm:flex-row sm:items-center ${failed ? "bg-destructive/5" : ""}`}
    >
      <div>
        <p className="font-medium">
          {result.name ||
            result.externalTriggerName ||
            result.externalMonitorName ||
            result.queryId}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {result.gateMode ? `${result.gateMode} · ` : ""}
          {result.hitCount != null
            ? `${result.hitCount} hits`
            : result.alertState || "not observed"}
          {result.required ? " · Required" : " · Optional"}
          {result.failureReason ? ` · ${result.failureReason}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <StatusBadge status={result.status} />
        {queryId ? (
          <Link
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            params={{ queryId }}
            to="/elf/$queryId"
          >
            Evidence <ArrowRight className="size-3" />
          </Link>
        ) : null}
        {alertsHref ? (
          <Link
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            to="/alerts"
          >
            Alerts <ArrowRight className="size-3" />
          </Link>
        ) : null}
      </div>
    </div>
  )
}

export function DynatraceRow({ result }: { result: DynatraceResultType }) {
  const failed = checkFailed(result.status)
  return (
    <div className={`py-5 ${failed ? "bg-destructive/5" : ""}`}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="font-medium">{result.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.gateMode.toLowerCase()} · {result.baselineResourceCount}{" "}
            baseline resources · {result.postResourceCount} post resources
            {result.missingResources
              ? ` · ${result.missingResources} missing`
              : ""}
            {result.addedResources ? ` · ${result.addedResources} added` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={result.status} />
          <Link
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            params={{ applicationId: result.applicationId }}
            search={{ section: "dynatrace" }}
            to="/applications/$applicationId"
          >
            Dynatrace <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["CPU", "MEMORY"] as const).flatMap((metric) => {
          const before = result.baselineSummary[metric]
          const after = result.postSummary[metric]
          if (!before && !after) return []
          return [
            <div className="pl-3" key={`${metric}-p95`}>
              <p className="text-xs text-muted-foreground">{metric} p95</p>
              <p className="mt-1 font-medium">
                {before?.p95 == null ? "Not recorded" : before.p95.toFixed(2)}
                {" → "}
                {after?.p95 == null ? "Not recorded" : after.p95.toFixed(2)}
              </p>
            </div>,
            <div className="pl-3" key={`${metric}-average`}>
              <p className="text-xs text-muted-foreground">{metric} average</p>
              <p className="mt-1 font-medium">
                {before?.average == null
                  ? "Not recorded"
                  : before.average.toFixed(2)}
                {" → "}
                {after?.average == null
                  ? "Not recorded"
                  : after.average.toFixed(2)}
              </p>
            </div>,
          ]
        })}
      </div>
      {result.ruleResults.length ? (
        <div className="mt-4 space-y-2">
          {result.ruleResults.map((rule) => (
            <div
              className="flex items-start justify-between gap-4 text-sm"
              key={rule.ruleId}
            >
              <span>
                {rule.ruleName}
                <span className="ml-2 text-xs text-muted-foreground">
                  {rule.reason}
                </span>
              </span>
              <Badge variant="outline">{rule.status.toLowerCase()}</Badge>
            </div>
          ))}
        </div>
      ) : null}
      {result.failureReason ? (
        <p className="mt-3 text-sm text-destructive">{result.failureReason}</p>
      ) : null}
    </div>
  )
}

function DistributionTable({
  baseline,
  post,
}: {
  baseline: DeploymentDistributionContract
  post: DeploymentDistributionContract
}) {
  const rows: Array<[string, string, string, string]> = [
    [
      "p50",
      formatMilliseconds(baseline.p50Ms),
      formatMilliseconds(post.p50Ms),
      "Median response time.",
    ],
    [
      "p95",
      formatMilliseconds(baseline.p95Ms),
      formatMilliseconds(post.p95Ms),
      "95% of measured executions are at or below this value.",
    ],
    [
      "p99",
      formatMilliseconds(baseline.p99Ms),
      formatMilliseconds(post.p99Ms),
      "Tail latency covering 99% of measured executions.",
    ],
    [
      "Average",
      formatMilliseconds(baseline.averageMs),
      formatMilliseconds(post.averageMs),
      "Arithmetic mean of successful measured executions.",
    ],
    [
      "Success",
      `${baseline.successRate}%`,
      `${post.successRate}%`,
      "Successful completed executions divided by all completed executions.",
    ],
    [
      "Std deviation",
      formatMilliseconds(baseline.standardDeviationMs),
      formatMilliseconds(post.standardDeviationMs),
      "Variation around the average response time.",
    ],
  ]
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[1fr_1fr_1fr] bg-muted px-3 py-2 text-xs font-medium">
        <span>Metric</span>
        <span>Before</span>
        <span>After</span>
      </div>
      {rows.map(([label, before, after, help]) => (
        <div
          className="grid grid-cols-[1fr_1fr_1fr] border-t px-3 py-2.5 text-sm"
          key={label}
        >
          <span className="inline-flex items-center gap-1">
            {label}
            <InfoHint className="size-5" title={label}>
              {help}
            </InfoHint>
          </span>
          <span>{before}</span>
          <span>{after}</span>
        </div>
      ))}
    </div>
  )
}

export function ClassificationBadge({ value }: { value: string }) {
  return (
    <Badge
      className={
        value === "REGRESSED"
          ? "bg-destructive/10 text-destructive"
          : value === "IMPROVED"
            ? "bg-success-soft text-success-foreground"
            : value === "INSUFFICIENT_HISTORY"
              ? "bg-warning-soft text-warning-foreground"
              : ""
      }
      variant="secondary"
    >
      {value.toLowerCase().replaceAll("_", " ")}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={
        status === "SUCCESS"
          ? "bg-success-soft text-success-foreground"
          : "bg-destructive/10 text-destructive"
      }
      variant="secondary"
    >
      {status.toLowerCase()}
    </Badge>
  )
}

function StatusDot({ status }: { status: string }) {
  return status === "SUCCESS" || status === "SUCCESS_WITH_WARNINGS" ? (
    <Check className="size-3 text-success-foreground" />
  ) : (
    <CircleAlert className="size-3 text-destructive" />
  )
}

export function ReasonList({
  title,
  values,
  danger = false,
}: {
  title: string
  values: string[]
  danger?: boolean
}) {
  return (
    <div className="border-y py-4">
      <h2 className="inline-flex items-center gap-2 font-medium">
        {danger ? (
          <CircleAlert className="size-4 text-destructive" />
        ) : (
          <FileText className="size-4 text-warning-foreground" />
        )}
        {title}
      </h2>
      {values.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">None recorded.</p>
      )}
    </div>
  )
}
