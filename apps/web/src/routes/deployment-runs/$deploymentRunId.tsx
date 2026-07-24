import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileJson,
  FileText,
  Info,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react"

import type {
  DeploymentDistributionContract,
  DeploymentValidationRunContract,
} from "@/lib/api-client/contracts"
import {
  cancelDeploymentValidation,
  downloadDeploymentReport,
  getDeploymentValidation,
} from "@/lib/api-client/suites"

export const Route = createFileRoute("/deployment-runs/$deploymentRunId")({
  loader: ({ params }) =>
    getDeploymentValidation({ data: { runId: params.deploymentRunId } }),
  component: DeploymentRunPage,
})

const terminal = new Set(["COMPLETED", "FAILED", "CANCELLED"])

function DeploymentRunPage() {
  const initial = Route.useLoaderData()
  const [run, setRun] = useState(initial)
  const [pending, setPending] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (terminal.has(run.status)) return
    const timer = window.setInterval(() => {
      void getDeploymentValidation({ data: { runId: run.id } })
        .then(setRun)
        .catch(() => setMessage("Live progress is temporarily unavailable."))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [run.id, run.status])

  async function cancel() {
    if (
      !window.confirm(
        "Cancel this deployment validation? Completed evidence will be retained."
      )
    )
      return
    setPending("cancel")
    const result = await cancelDeploymentValidation({ data: { runId: run.id } })
    setPending("")
    if (!result.ok)
      setMessage("The validation could not be cancelled on its current worker.")
  }

  async function download(format: "pdf" | "json") {
    setPending(format)
    try {
      const result = await downloadDeploymentReport({
        data: { runId: run.id, format },
      })
      const binary = atob(result.content)
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0)
      )
      const url = URL.createObjectURL(
        new Blob([bytes], { type: result.contentType })
      )
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setMessage(`Unable to download the ${format.toUpperCase()} report.`)
    } finally {
      setPending("")
    }
  }

  const report = run.report
  const complete = run.status === "COMPLETED"
  const percent = run.progress.total
    ? Math.round((run.progress.completed / run.progress.total) * 100)
    : 0
  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Link
            to="/suites"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Validation suites
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">
              {run.suiteSnapshot.name}
            </h1>
            <DecisionBadge decision={run.gateDecision} />
            <Badge variant="secondary">
              {run.phase.toLowerCase().replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {run.deployment.version || "Unversioned deployment"}
            {run.deployment.commit ? ` · ${run.deployment.commit}` : ""} ·
            deployed {new Date(run.deployment.deploymentStart).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!terminal.has(run.status) ? (
            <Button
              variant="outline"
              onClick={cancel}
              disabled={pending === "cancel"}
            >
              {pending === "cancel" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Ban />
              )}{" "}
              Cancel
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={!complete || !!pending}
            onClick={() => download("json")}
          >
            {pending === "json" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <FileJson />
            )}{" "}
            JSON
          </Button>
          <Button
            disabled={!complete || !!pending}
            onClick={() => download("pdf")}
          >
            {pending === "pdf" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Download />
            )}{" "}
            PDF report
          </Button>
        </div>
      </div>

      {message ? (
        <p
          className="mt-4 inline-flex items-center gap-2 text-sm text-destructive"
          role="alert"
        >
          <CircleAlert className="size-4" />
          {message}
        </p>
      ) : null}
      {!terminal.has(run.status) ? (
        <Progress run={run} percent={percent} />
      ) : null}

      {report.recommendation ? (
        <section
          className={`mt-6 border-y py-5 ${run.gateDecision === "BLOCK" ? "bg-destructive/5" : run.gateDecision === "ALLOW_WITH_WARNINGS" ? "bg-warning-soft/40" : "bg-success-soft/35"}`}
        >
          <div className="flex items-start gap-3 px-3 sm:px-5">
            {run.gateDecision === "BLOCK" ? (
              <CircleAlert className="mt-0.5 size-5 text-destructive" />
            ) : (
              <ShieldCheck className="mt-0.5 size-5 text-success-foreground" />
            )}
            <div>
              <h2 className="font-medium">Release recommendation</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {report.recommendation}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-7" aria-labelledby="overview-heading">
        <div className="flex items-center gap-2">
          <h2
            id="overview-heading"
            className="font-heading text-lg font-semibold"
          >
            Before and after
          </h2>
          <MetricInfo text="Latency uses API response time only. Preparation, scripts, extraction, assertions, queue delay, and post-processing do not affect the performance gate." />
        </div>
        <div className="mt-4 overflow-hidden border-y">
          <div className="grid grid-cols-2 divide-x sm:grid-cols-3 lg:grid-cols-9">
            <Metric
              label="Baseline window"
              value={run.configuration.baselineWindow}
              help="The historical period ending exactly at deployment start."
            />
            <Metric
              label="Post samples"
              value={String(run.configuration.sampleCount)}
              help="Controlled executions requested for each monitor."
            />
            <Metric
              label="Guardrail"
              value="25% + 100 ms"
              help="Both thresholds must be crossed by post p95 for a regression."
            />
            <Metric
              label="Minimum history"
              value={String(run.configuration.minimumSamples)}
              help="Fewer successful measurements are reported as insufficient history."
            />
            <Metric
              label="Monitors"
              value={String(report.monitors?.length ?? 0)}
            />
            <Metric
              label="ELF checks"
              value={String(report.elfResults?.length ?? 0)}
            />
            <Metric
              label="OS alerts"
              value={String(report.alertResults?.length ?? 0)}
            />
            <Metric
              label="Completed evidence"
              value={`${run.progress.completed}/${run.progress.total}`}
            />
            <Metric
              label="Decision"
              value={run.gateDecision.replaceAll("_", " ")}
            />
          </div>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="monitor-comparisons-heading">
        <h2
          id="monitor-comparisons-heading"
          className="font-heading text-lg font-semibold"
        >
          Monitor performance
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregate workflow latency and every measured HTTP step.
        </p>
        <div className="mt-4 divide-y border-y">
          {(report.monitors ?? []).map((monitor) => (
            <MonitorResult key={monitor.monitorId} monitor={monitor} />
          ))}
          {!report.monitors?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Monitor comparison evidence will appear after baseline capture.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="elf-heading">
        <h2 id="elf-heading" className="font-heading text-lg font-semibold">
          ELF deployment log checks
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Executed after monitor sampling, from deployment start through check
          time.
        </p>
        <div className="mt-4 divide-y border-y">
          {(report.elfResults ?? []).map((result) => (
            <div
              className="flex flex-col justify-between gap-2 py-4 sm:flex-row sm:items-center"
              key={result.checkId}
            >
              <div>
                <p className="font-medium">{result.name || result.queryId}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.gateMode} · {result.hitCount ?? 0} hits
                  {result.failureReason ? ` · ${result.failureReason}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={result.status} />
                {result.queryId ? (
                  <Link
                    to="/elf/$queryId"
                    params={{ queryId: result.queryId }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Evidence <ArrowRight className="size-3" />
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
          {!report.elfResults?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              ELF checks have not run yet or this suite has none.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading" className="font-heading text-lg font-semibold">
          OpenSearch alert checks
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Passes when the selected receiver alert is not firing. Triggers at or
          after deployment start also fail the gate.
        </p>
        <div className="mt-4 divide-y border-y">
          {(report.alertResults ?? []).map((result) => (
            <div
              className="flex flex-col justify-between gap-2 py-4 sm:flex-row sm:items-center"
              key={result.checkId}
            >
              <div>
                <p className="font-medium">
                  {result.name ||
                    result.externalTriggerName ||
                    result.externalMonitorName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.alertState || "not observed"}
                  {result.required ? " · Required" : " · Optional"}
                  {result.failureReason ? ` · ${result.failureReason}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={result.status} />
                <Link
                  to="/alerts"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Alerts <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
          ))}
          {!report.alertResults?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              OpenSearch alert checks have not run yet or this suite has none.
            </p>
          ) : null}
        </div>
      </section>

      {report.reasons?.length || report.warnings?.length ? (
        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <ReasonList
            title="Blocking reasons"
            values={report.reasons ?? []}
            danger
          />
          <ReasonList title="Warnings" values={report.warnings ?? []} />
        </section>
      ) : null}
    </main>
  )
}

function Progress({
  run,
  percent,
}: {
  run: DeploymentValidationRunContract
  percent: number
}) {
  return (
    <section className="mt-6 border-y py-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <LoaderCircle className="size-4 animate-spin" />
          {run.progress.message}
        </span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </section>
  )
}

type MonitorResultType = NonNullable<
  DeploymentValidationRunContract["report"]["monitors"]
>[number]
function MonitorResult({ monitor }: { monitor: MonitorResultType }) {
  return (
    <details className="group py-4">
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
            p95 {monitor.baseline.p95Ms ?? 0} ms → {monitor.post.p95Ms ?? 0} ms
            · {monitor.deltaPercent > 0 ? "+" : ""}
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
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <DistributionTable baseline={monitor.baseline} post={monitor.post} />
          <ComparisonChart baseline={monitor.baseline} post={monitor.post} />
        </div>
        {monitor.steps.length ? (
          <div className="mt-6">
            <h3 className="text-sm font-medium">HTTP-step comparison</h3>
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
                  {monitor.steps.map((step) => (
                    <tr
                      className="border-b last:border-0"
                      key={step.stepDefinitionId}
                    >
                      <td className="py-2.5 font-medium">{step.stepName}</td>
                      <td>{step.baseline.p95Ms ?? 0} ms</td>
                      <td>{step.post.p95Ms ?? 0} ms</td>
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
            {monitor.samples.map((sample) =>
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
        {monitor.reasons.length ? (
          <ul className="mt-5 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {monitor.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
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
      `${baseline.p50Ms ?? 0} ms`,
      `${post.p50Ms ?? 0} ms`,
      "Median response time.",
    ],
    [
      "p95",
      `${baseline.p95Ms ?? 0} ms`,
      `${post.p95Ms ?? 0} ms`,
      "95% of measured executions are at or below this value.",
    ],
    [
      "p99",
      `${baseline.p99Ms ?? 0} ms`,
      `${post.p99Ms ?? 0} ms`,
      "Tail latency covering 99% of measured executions.",
    ],
    [
      "Average",
      `${baseline.averageMs ?? 0} ms`,
      `${post.averageMs ?? 0} ms`,
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
      `${baseline.standardDeviationMs ?? 0} ms`,
      `${post.standardDeviationMs ?? 0} ms`,
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
            <MetricInfo text={help} />
          </span>
          <span>{before}</span>
          <span>{after}</span>
        </div>
      ))}
    </div>
  )
}
function ComparisonChart({
  baseline,
  post,
}: {
  baseline: DeploymentDistributionContract
  post: DeploymentDistributionContract
}) {
  const values = [
    baseline.p50Ms ?? 0,
    post.p50Ms ?? 0,
    baseline.p95Ms ?? 0,
    post.p95Ms ?? 0,
    baseline.p99Ms ?? 0,
    post.p99Ms ?? 0,
  ]
  const max = Math.max(...values, 1)
  return (
    <figure className="rounded-lg border p-4">
      <figcaption className="text-sm font-medium">
        Latency distribution
      </figcaption>
      <div className="mt-5 grid grid-cols-3 gap-4">
        {(["p50", "p95", "p99"] as const).map((label, index) => {
          const before = values[index * 2],
            after = values[index * 2 + 1]
          return (
            <div key={label}>
              <div className="flex h-32 items-end justify-center gap-2 border-b">
                <div
                  className="w-5 rounded-t bg-muted-foreground/35"
                  style={{ height: `${Math.max(3, (before / max) * 100)}%` }}
                  title={`Before ${before} ms`}
                />
                <div
                  className="w-5 rounded-t bg-primary"
                  style={{ height: `${Math.max(3, (after / max) * 100)}%` }}
                  title={`After ${after} ms`}
                />
              </div>
              <p className="mt-2 text-center text-xs font-medium">{label}</p>
            </div>
          )
        })}
      </div>
      <div className="mt-4 flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-muted-foreground/35" /> Before
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-primary" /> After
        </span>
      </div>
    </figure>
  )
}
function Metric({
  label,
  value,
  help,
}: {
  label: string
  value: string
  help?: string
}) {
  return (
    <div className="min-w-0 p-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {help ? <MetricInfo text={help} /> : null}
      </p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  )
}
function MetricInfo({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={text}
      title={text}
    >
      <Info className="size-3.5" />
    </button>
  )
}
function DecisionBadge({ decision }: { decision: string }) {
  return (
    <Badge
      className={
        decision === "BLOCK"
          ? "bg-destructive/10 text-destructive"
          : decision === "ALLOW"
            ? "bg-success-soft text-success-foreground"
            : decision === "ALLOW_WITH_WARNINGS"
              ? "bg-warning-soft text-warning-foreground"
              : ""
      }
      variant="secondary"
    >
      {decision.toLowerCase().replaceAll("_", " ")}
    </Badge>
  )
}
function ClassificationBadge({ value }: { value: string }) {
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
function StatusBadge({ status }: { status: string }) {
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
function ReasonList({
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
