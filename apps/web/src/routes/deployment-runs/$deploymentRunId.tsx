import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  ArrowLeft,
  Ban,
  CircleAlert,
  Download,
  FileJson,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react"

import { InfoHint } from "@/components/info-hint"
import { PageContainer } from "@/components/page-container"
import { AIDeploymentReportPanel } from "@/features/suites/ai-deployment-report"
import {
  BrowserMonitorResult,
  CheckRow,
  DynatraceRow,
  MonitorResult,
  ReasonList,
} from "@/features/suites/deployment-run-evidence"
import {
  decisionCopy,
  sortBrowsers,
  sortChecks,
  sortDynatrace,
  sortMonitors,
  summarizeValidation,
} from "@/features/suites/validation-summary"
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

const DESIGN_CONTRACT = `THESIS: A deployment validation report is a release-gate dossier: verdict first, failures first, evidence on demand. It refuses a sparse equal-weight status page.
OWN-WORLD: Amex blue operate chrome, dense typewriter hierarchy, existing Rhythm primitives. Status color is semantic only; red is reserved for a blocking gate.
STORY: An SRE sees whether the release may proceed, why, then generates a grounded AI report they can download.
FIRST VIEWPORT: Full-width verdict band with decision, counts, duration, and generate/download actions; findings open on failures.
FORM: Operate report / gate dossier. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md`

function DeploymentRunPage() {
  const initial = Route.useLoaderData()
  const { deploymentRunId } = Route.useParams()
  const [run, setRun] = useState(initial)
  const [pending, setPending] = useState("")
  const [message, setMessage] = useState("")
  const active = !terminal.has(run.status)

  useEffect(() => {
    setRun(initial)
    setMessage("")
  }, [initial, deploymentRunId])

  useEffect(() => {
    if (!active) return
    let disposed = false
    let loading = false
    const refresh = async () => {
      if (loading) return
      if (document.visibilityState !== "visible") return
      loading = true
      try {
        const next = await getDeploymentValidation({
          data: { runId: deploymentRunId },
        })
        if (!disposed) setRun(next)
      } catch {
        if (!disposed) setMessage("Live progress is temporarily unavailable.")
      } finally {
        loading = false
      }
    }
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [active, deploymentRunId])

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
  const complete = run.status === "COMPLETED" || run.status === "FAILED"
  const percent = run.progress.total
    ? Math.round((run.progress.completed / run.progress.total) * 100)
    : 0
  const counts = useMemo(() => summarizeValidation(run), [run])
  const monitors = useMemo(
    () => sortMonitors(report.monitors),
    [report.monitors]
  )
  const browsers = useMemo(
    () => sortBrowsers(report.browserMonitors),
    [report.browserMonitors]
  )
  const elfResults = useMemo(
    () => sortChecks(report.elfResults),
    [report.elfResults]
  )
  const alertResults = useMemo(
    () => sortChecks(report.alertResults),
    [report.alertResults]
  )
  const dynatraceResults = useMemo(
    () => sortDynatrace(report.dynatraceResults),
    [report.dynatraceResults]
  )
  const decision = run.gateDecision
  const verdictClass =
    decision === "BLOCK"
      ? "bg-destructive text-white"
      : decision === "ALLOW_WITH_WARNINGS"
        ? "bg-warning-soft text-warning-foreground"
        : decision === "ALLOW"
          ? "bg-sidebar text-sidebar-foreground"
          : "bg-muted text-foreground"

  return (
    <PageContainer as="main" padding="compact">
      <div
        className="sr-only"
        dangerouslySetInnerHTML={{ __html: `<!-- ${DESIGN_CONTRACT} -->` }}
      />
      <Link
        to="/suites"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Validation suites
      </Link>

      <section className={`mt-4 px-4 py-5 sm:px-6 ${verdictClass}`}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {decision === "BLOCK" ? (
                <CircleAlert className="size-5" aria-hidden />
              ) : (
                <ShieldCheck className="size-5" aria-hidden />
              )}
              <h1 className="font-heading text-2xl font-semibold">
                {run.suiteSnapshot.name}
              </h1>
              <Badge
                className="border-current/30 bg-transparent text-current"
                variant="outline"
              >
                {decision.replaceAll("_", " ")}
              </Badge>
              <Badge
                className="border-current/30 bg-transparent text-current"
                variant="outline"
              >
                {run.status.toLowerCase()}
              </Badge>
            </div>
            <p className="mt-3 max-w-3xl text-sm opacity-90">
              {decisionCopy(decision, counts.failed)}
            </p>
            <p className="mt-2 text-sm opacity-80">
              {run.deployment.version || "Unversioned deployment"}
              {run.deployment.commit ? ` · ${run.deployment.commit}` : ""}
              {run.deployment.environment
                ? ` · ${run.deployment.environment}`
                : ""}{" "}
              · deployed{" "}
              {new Date(run.deployment.deploymentStart).toLocaleString()}
              {" · "}
              {counts.durationLabel}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!terminal.has(run.status) ? (
              <Button
                variant="outline"
                className="border-current/40 bg-transparent text-current hover:bg-black/10"
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
              className="border-current/40 bg-transparent text-current hover:bg-black/10"
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
              variant="outline"
              className="border-current/40 bg-transparent text-current hover:bg-black/10"
              disabled={!complete || !!pending}
              onClick={() => download("pdf")}
            >
              {pending === "pdf" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Download />
              )}{" "}
              PDF
            </Button>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-current/20 pt-4 text-sm sm:grid-cols-4 lg:grid-cols-6">
          <Count label="Failed" value={String(counts.failed)} />
          <Count label="Passed" value={String(counts.passed)} />
          <Count label="Warnings" value={String(counts.warnings)} />
          <Count label="Checks" value={String(counts.total)} />
          <Count
            label="Evidence"
            value={`${run.progress.completed}/${run.progress.total}`}
          />
          <Count label="Phase" value={run.phase.toLowerCase().replaceAll("_", " ")} />
        </dl>
      </section>

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
        <Progress runMessage={run.progress.message} percent={percent} />
      ) : null}

      {report.reasons?.length || report.recommendation ? (
        <section className="mt-6" aria-labelledby="findings-heading">
          <h2
            className="font-heading text-lg font-semibold"
            id="findings-heading"
          >
            Why this {decision === "ALLOW" ? "passed" : "failed"}
          </h2>
          {report.recommendation ? (
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {report.recommendation}
            </p>
          ) : null}
          {report.reasons?.length || report.warnings?.length ? (
            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              <ReasonList
                title="Blocking reasons"
                values={report.reasons ?? []}
                danger
              />
              <ReasonList title="Warnings" values={report.warnings ?? []} />
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="mt-8">
        <AIDeploymentReportPanel
          complete={complete}
          runId={run.id}
          suiteName={run.suiteSnapshot.name}
        />
      </div>

      <section className="mt-8" aria-labelledby="monitor-comparisons-heading">
        <h2
          className="font-heading text-lg font-semibold"
          id="monitor-comparisons-heading"
        >
          API monitors
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Failed and regressed monitors first. Expand a row for steps, samples,
          and latency evidence.
        </p>
        <div className="mt-4 divide-y border-y">
          {monitors.map((monitor) => (
            <MonitorResult key={monitor.monitorId} monitor={monitor} />
          ))}
          {!monitors.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Monitor comparison evidence will appear after baseline capture.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="browser-comparisons-heading">
        <h2
          className="font-heading text-lg font-semibold"
          id="browser-comparisons-heading"
        >
          UI journeys
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Functional browser outcomes and controlled synthetic journey
          performance. Lab evidence, not real-user field data.
        </p>
        <div className="mt-4 divide-y border-y">
          {browsers.map((monitor) => (
            <BrowserMonitorResult
              key={monitor.browserMonitorId}
              monitor={monitor}
            />
          ))}
          {!browsers.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              This suite has no UI monitor checks, or browser evidence has not
              been captured yet.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="dynatrace-heading">
        <h2
          className="font-heading text-lg font-semibold"
          id="dynatrace-heading"
        >
          Dynatrace infrastructure
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          CPU and memory evidence captured before deployment and after the
          configured stabilization window. Missing measurements are never
          treated as zero.
        </p>
        <div className="mt-4 divide-y border-y">
          {dynatraceResults.map((result, index) => (
            <DynatraceRow
              key={`${result.checkId}-${result.serviceId ?? index}`}
              result={result}
            />
          ))}
          {!dynatraceResults.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Dynatrace checks have not run yet or this suite has none.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="elf-heading">
        <h2 className="font-heading text-lg font-semibold" id="elf-heading">
          ELF log checks
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Executed after monitor sampling, from deployment start through check
          time.
        </p>
        <div className="mt-4 divide-y border-y">
          {elfResults.map((result) => (
            <CheckRow
              key={result.checkId}
              queryId={result.queryId}
              result={result}
            />
          ))}
          {!elfResults.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              ELF checks have not run yet or this suite has none.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="alerts-heading">
        <h2 className="font-heading text-lg font-semibold" id="alerts-heading">
          OpenSearch alerts
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Passes when the selected receiver alert is not firing. Triggers at or
          after deployment start also fail the gate.
        </p>
        <div className="mt-4 divide-y border-y">
          {alertResults.map((result) => (
            <CheckRow
              alertsHref
              key={result.checkId}
              result={result}
            />
          ))}
          {!alertResults.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              OpenSearch alert checks have not run yet or this suite has none.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="gate-config-heading">
        <div className="flex items-center gap-2">
          <h2
            className="font-heading text-lg font-semibold"
            id="gate-config-heading"
          >
            How this gate was measured
          </h2>
          <InfoHint title="API response latency">
            Latency uses API response time only. Preparation, scripts,
            extraction, assertions, queue delay, and post-processing do not
            affect the performance gate.
          </InfoHint>
        </div>
        <dl className="mt-4 grid grid-cols-2 border-y sm:grid-cols-3 xl:grid-cols-5">
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
            label="Completed evidence"
            value={`${run.progress.completed}/${run.progress.total}`}
          />
        </dl>
      </section>
    </PageContainer>
  )
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs opacity-80">{label}</dt>
      <dd className="mt-0.5 font-medium capitalize">{value}</dd>
    </div>
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
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {help ? (
          <InfoHint className="size-5" title={label}>
            {help}
          </InfoHint>
        ) : null}
      </dt>
      <dd className="mt-1 truncate font-medium">{value}</dd>
    </div>
  )
}

function Progress({
  runMessage,
  percent,
}: {
  runMessage: string
  percent: number
}) {
  return (
    <section className="mt-6 border-y py-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <LoaderCircle className="size-4 animate-spin" />
          {runMessage}
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
