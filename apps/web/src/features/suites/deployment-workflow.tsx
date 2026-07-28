import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  GitCommit,
  LoaderCircle,
  Play,
  ShieldCheck,
} from "lucide-react"

import type {
  DeploymentValidationRunContract,
  DeploymentBaselinePreviewContract,
  ELFApplicationContract,
  ValidationSuiteContract,
} from "@/lib/api-client/contracts"
import {
  previewDeploymentBaseline,
  startDeploymentValidation,
} from "@/lib/api-client/suites"

export function DeploymentWorkflow({
  suites,
  applications,
  runs,
  open,
  onOpenChange,
}: {
  suites: ValidationSuiteContract[]
  applications: ELFApplicationContract[]
  runs: DeploymentValidationRunContract[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [suiteId, setSuiteId] = useState(suites[0]?.id ?? "")
  const [applicationId, setApplicationId] = useState("")
  const [environment, setEnvironment] = useState("production")
  const [deploymentId, setDeploymentId] = useState("")
  const [version, setVersion] = useState("")
  const [commit, setCommit] = useState("")
  const [notes, setNotes] = useState("")
  const [deploymentStart, setDeploymentStart] = useState(
    new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16)
  )
  const [baselineWindow, setBaselineWindow] = useState<"24h" | "7d" | "30d">(
    "24h"
  )
  const [sampleCount, setSampleCount] = useState(10)
  const [sampleIntervalSeconds, setSampleIntervalSeconds] = useState(5)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [baselinePreview, setBaselinePreview] =
    useState<DeploymentBaselinePreviewContract | null>(null)
  const [baselineLoading, setBaselineLoading] = useState(false)
  const [baselineError, setBaselineError] = useState("")
  const suite = suites.find((candidate) => candidate.id === suiteId)
  const monitorCount = useMemo(
    () =>
      new Set(
        suite?.stages.flatMap((stage) =>
          stage.checks
            .filter((check) => check.kind === "MONITOR")
            .map((check) => check.monitorId)
        ) ?? []
      ).size,
    [suite]
  )
  const elfCount = useMemo(
    () =>
      new Set(
        suite?.stages.flatMap((stage) =>
          stage.checks
            .filter((check) => check.kind === "ELF_QUERY")
            .map((check) => check.queryId)
        ) ?? []
      ).size,
    [suite]
  )
  const alertCount = useMemo(
    () =>
      suite?.stages.reduce(
        (total, stage) =>
          total +
          stage.checks.filter((check) => check.kind === "OPENSEARCH_ALERT")
            .length,
        0
      ) ?? 0,
    [suite]
  )
  const estimatedSeconds = Math.max(0, sampleCount - 1) * sampleIntervalSeconds

  useEffect(() => {
    if (step !== 2 || !suiteId || !deploymentStart) return
    let cancelled = false
    setBaselineLoading(true)
    setBaselineError("")
    const start = new Date(deploymentStart)
    if (Number.isNaN(start.getTime())) {
      setBaselineLoading(false)
      setBaselineError("Enter a valid deployment start time.")
      return
    }
    void previewDeploymentBaseline({
      data: {
        suiteId,
        deploymentStart: start.toISOString(),
        baselineWindow,
        sampleCount,
        sampleIntervalSeconds,
      },
    })
      .then((result) => {
        if (!cancelled) setBaselinePreview(result)
      })
      .catch((error) => {
        if (!cancelled) {
          setBaselinePreview(null)
          setBaselineError(
            error instanceof Error
              ? error.message
              : "Unable to preview the baseline."
          )
        }
      })
      .finally(() => {
        if (!cancelled) setBaselineLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    step,
    suiteId,
    deploymentStart,
    baselineWindow,
    sampleCount,
    sampleIntervalSeconds,
  ])

  async function start() {
    setPending(true)
    setMessage("")
    const result = await startDeploymentValidation({
      data: {
        suiteId,
        deploymentId,
        version,
        commit,
        applicationId,
        environment,
        notes,
        deploymentStart: new Date(deploymentStart).toISOString(),
        baselineWindow,
        sampleCount,
        sampleIntervalSeconds,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    await navigate({
      to: "/deployment-runs/$deploymentRunId",
      params: { deploymentRunId: result.run.id },
    })
  }

  return (
    <>
      {open ? (
        <section
          className="mt-5 border-y bg-muted/15 py-5"
          aria-labelledby="deployment-wizard-title"
        >
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <h2
                id="deployment-wizard-title"
                className="font-heading text-lg font-semibold"
              >
                Run deployment validation
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Snapshot pre-deployment performance, collect controlled
                post-deployment samples, then evaluate ELF logs and OpenSearch
                alerts.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
          <ol
            className="mt-5 grid gap-2 sm:grid-cols-4"
            aria-label="Deployment validation steps"
          >
            {["Context", "Baseline", "Sampling", "Review"].map(
              (label, index) => (
                <li
                  key={label}
                  className={`flex items-center gap-2 border-b pb-2 text-sm ${step === index + 1 ? "border-primary font-medium text-foreground" : "text-muted-foreground"}`}
                >
                  <span
                    className={`grid size-6 place-items-center rounded-full text-xs ${step > index + 1 ? "bg-success-soft text-success-foreground" : step === index + 1 ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    {step > index + 1 ? (
                      <Check className="size-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {label}
                </li>
              )
            )}
          </ol>
          <div className="mt-5 min-h-52">
            {step === 1 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Field label="Suite template">
                  <Select
                    value={suiteId || null}
                    onValueChange={(value) => setSuiteId(value ?? "")}
                    items={suites.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="Select suite" />
                    </SelectTrigger>
                    <SelectContent>
                      {suites.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Application" hint="Optional">
                  <Select
                    value={applicationId || null}
                    onValueChange={(value) => setApplicationId(value ?? "")}
                    items={[
                      { value: null, label: "No application filter" },
                      ...applications.map((item) => ({
                        value: item.id,
                        label: `${item.name} · ${item.carId || "No CAR ID"}`,
                      })),
                    ]}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="No application filter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>No application filter</SelectItem>
                      {applications.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} · {item.carId || "No CAR ID"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Environment">
                  <Input
                    value={environment}
                    onChange={(event) => setEnvironment(event.target.value)}
                  />
                </Field>
                <Field label="Deployment ID" hint="Optional">
                  <Input
                    value={deploymentId}
                    onChange={(event) => setDeploymentId(event.target.value)}
                    placeholder="deploy-2026-07-22-143"
                  />
                </Field>
                <Field label="Version" hint="Optional">
                  <Input
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="v2.18.0"
                  />
                </Field>
                <Field label="Commit" hint="Optional">
                  <Input
                    className="font-mono"
                    value={commit}
                    onChange={(event) => setCommit(event.target.value)}
                    placeholder="7f31c2a"
                  />
                </Field>
                <Field label="Deployment start">
                  <Input
                    type="datetime-local"
                    value={deploymentStart}
                    onChange={(event) => setDeploymentStart(event.target.value)}
                  />
                </Field>
                <Field label="Release notes" hint="Optional" wide>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="What changed in this deployment?"
                  />
                </Field>
              </div>
            ) : null}
            {step === 2 ? (
              <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
                <div>
                  <Field label="Historical baseline window">
                    <Select
                      value={baselineWindow}
                      onValueChange={(value) => {
                        if (value == null) return
                        setBaselineWindow(value)
                      }}
                      items={[
                        { value: "24h", label: "Previous 24 hours" },
                        { value: "7d", label: "Previous 7 days" },
                        { value: "30d", label: "Previous 30 days" },
                      ]}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">Previous 24 hours</SelectItem>
                        <SelectItem value="7d">Previous 7 days</SelectItem>
                        <SelectItem value="30d">Previous 30 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Rhythm uses successful runs from the same published revision
                    and stops the window exactly at deployment start.
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">Baseline readiness</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Successful API-timing samples from the current published
                        revision only.
                      </p>
                    </div>
                    {baselineLoading ? (
                      <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>
                  {baselineError ? (
                    <p className="mt-3 text-sm text-destructive" role="alert">
                      {baselineError}
                    </p>
                  ) : baselinePreview ? (
                    <div className="mt-3 divide-y border-y">
                      {baselinePreview.monitors.map((monitor) => (
                        <div
                          className="flex items-start justify-between gap-4 py-3 text-sm"
                          key={monitor.monitorId}
                        >
                          <div>
                            <p className="font-medium">{monitor.monitorName}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {monitor.reason ||
                                "Same-revision baseline is ready."}
                            </p>
                          </div>
                          <Badge
                            className={
                              monitor.compatible
                                ? "bg-success-soft text-success-foreground"
                                : "bg-warning-soft text-warning-foreground"
                            }
                            variant="secondary"
                          >
                            {monitor.sampleCount} sample
                            {monitor.sampleCount === 1 ? "" : "s"}
                          </Badge>
                        </div>
                      ))}
                      {!baselinePreview.monitors.length ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          This suite has no monitor checks.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-4 border-y py-3 text-sm">
                    <p className="font-medium">Performance guardrail</p>
                    <p className="mt-1 text-muted-foreground">
                      Block when post-deployment p95 is both 25% and 100 ms
                      slower than baseline p95. Fewer than five baseline samples
                      produces a warning.
                    </p>
                    {baselinePreview?.blockingDependencies.length ? (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-destructive">
                        {baselinePreview.blockingDependencies.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {step === 3 ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Samples per monitor">
                  <Input
                    type="number"
                    min={3}
                    max={50}
                    value={sampleCount}
                    onChange={(event) =>
                      setSampleCount(Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="Interval between samples (seconds)">
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={sampleIntervalSeconds}
                    onChange={(event) =>
                      setSampleIntervalSeconds(Number(event.target.value))
                    }
                  />
                </Field>
                <div className="flex flex-wrap gap-x-6 gap-y-2 border-y py-4 text-sm md:col-span-2">
                  <span>
                    <strong>{monitorCount}</strong> monitors
                  </span>
                  <span>
                    <strong>{sampleCount * monitorCount}</strong> executions
                  </span>
                  <span>
                    <strong>{elfCount}</strong> ELF checks
                  </span>
                  <span>
                    <strong>{alertCount}</strong> OpenSearch alerts
                  </span>
                  <span>
                    <strong>
                      up to{" "}
                      {Math.max(
                        1,
                        Math.ceil(
                          (baselinePreview?.estimatedMaximumSeconds ??
                            estimatedSeconds) / 60
                        )
                      )}{" "}
                      min
                    </strong>{" "}
                    from monitor timeouts, intervals, and suite parallelism
                  </span>
                </div>
              </div>
            ) : null}
            {step === 4 ? (
              <div className="divide-y border-y text-sm">
                <ReviewRow
                  label="Suite"
                  value={suite?.name || "Not selected"}
                  icon={ShieldCheck}
                />
                <ReviewRow
                  label="Deployment"
                  value={`${version || "Unversioned"} · ${new Date(deploymentStart).toLocaleString()}`}
                  icon={GitCommit}
                />
                <ReviewRow
                  label="Baseline"
                  value={`${baselineWindow} before deployment · API response time only`}
                  icon={Clock3}
                />
                <ReviewRow
                  label="Post validation"
                  value={`${sampleCount} samples per monitor · ${sampleIntervalSeconds}s interval · ELF then OpenSearch alerts`}
                  icon={Play}
                />
              </div>
            ) : null}
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
          <div className="mt-5 flex justify-between border-t pt-4">
            <Button
              variant="outline"
              disabled={step === 1 || pending}
              onClick={() => setStep((current) => current - 1)}
            >
              Back
            </Button>
            {step < 4 ? (
              <Button
                disabled={!suiteId || !deploymentStart}
                onClick={() => setStep((current) => current + 1)}
              >
                Continue <ArrowRight />
              </Button>
            ) : (
              <Button disabled={pending || !suiteId} onClick={start}>
                {pending ? <LoaderCircle className="animate-spin" /> : <Play />}
                Start validation
              </Button>
            )}
          </div>
        </section>
      ) : null}

      <section className="mt-7" aria-labelledby="deployment-runs-heading">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2
              id="deployment-runs-heading"
              className="font-heading text-lg font-semibold"
            >
              Deployment runs
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Before/after performance and log-validation reports.
            </p>
          </div>
        </div>
        {runs.length ? (
          <div className="mt-4 divide-y border-y">
            {runs.map((run) => (
              <DeploymentRunRow key={run.id} run={run} />
            ))}
          </div>
        ) : (
          <div className="mt-4 border-y py-12 text-center">
            <ShieldCheck className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 font-medium">No deployment validations yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start one to compare pre- and post-deployment behavior.
            </p>
          </div>
        )}
      </section>
    </>
  )
}

function DeploymentRunRow({ run }: { run: DeploymentValidationRunContract }) {
  const percent = run.progress.total
    ? Math.round((run.progress.completed / run.progress.total) * 100)
    : 0
  return (
    <article className="flex flex-col gap-3 py-4 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{run.suiteSnapshot.name}</p>
          <DecisionBadge decision={run.gateDecision} />
          <Badge variant="secondary">
            {run.phase.toLowerCase().replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {run.deployment.version ||
            run.deployment.deploymentId ||
            "Unversioned deployment"}{" "}
          · {new Date(run.deployment.deploymentStart).toLocaleString()}
        </p>
        {run.status !== "COMPLETED" &&
        run.status !== "FAILED" &&
        run.status !== "CANCELLED" ? (
          <div className="mt-2 max-w-lg">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {run.progress.message} {percent}%
            </p>
          </div>
        ) : null}
      </div>
      <Link
        to="/deployment-runs/$deploymentRunId"
        params={{ deploymentRunId: run.id }}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        View report <ArrowRight className="size-4" />
      </Link>
    </article>
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
function ReviewRow({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof Clock3
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div>
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-muted-foreground">{value}</p>
      </div>
    </div>
  )
}
function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string
  hint?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`text-xs font-medium ${wide ? "md:col-span-2" : ""}`}>
      <span className="flex justify-between gap-3">
        {label}
        {hint ? (
          <span className="font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}
