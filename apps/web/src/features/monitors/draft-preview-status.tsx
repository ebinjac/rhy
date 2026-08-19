import { useEffect, useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  CircleAlert,
  LoaderCircle,
  Pencil,
  ShieldCheck,
} from "lucide-react"

import type {
  DraftMonitorPreviewContract,
  JsonValue,
  ScriptResultContract,
  StepRunContract,
} from "@/lib/api-client/contracts"
import type {
  RequestDefinition,
  RequestWorkbenchFocusTarget,
} from "@/features/monitors/request-definition"

type DraftPreviewStatusProps = {
  previewing: boolean
  preview: DraftMonitorPreviewContract | null
  previewError: string
  definition: RequestDefinition
  onEditStep: (target: RequestWorkbenchFocusTarget) => void
  failureSection: (
    step: DraftMonitorPreviewContract["steps"][number]
  ) => RequestWorkbenchFocusTarget["section"]
}

const failedStatuses = new Set(["FAILED", "TIMED_OUT", "ABORTED"])

export function DraftPreviewStatus({
  previewing,
  preview,
  previewError,
  definition,
  onEditStep,
  failureSection,
}: DraftPreviewStatusProps) {
  const elapsedMs = useElapsedMs(previewing)

  if (previewing) {
    return (
      <section
        className="mb-5 overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.04] shadow-[0_1px_0_oklch(0.515_0.172_253.7_/_0.08)]"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex items-start gap-3 px-4 py-3.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight text-foreground">
              Walking the live journey
            </p>
            <p className="mt-0.5 text-xs text-foreground/70">
              Real requests against your targets ·{" "}
              <span className="font-mono tabular-nums text-foreground/85">
                {(elapsedMs / 1000).toFixed(1)}s
              </span>{" "}
              elapsed · not persisted
            </p>
          </div>
        </div>
        <div
          className="mx-4 h-0.5 overflow-hidden rounded-full bg-primary/10"
          aria-hidden
        >
          <div className="h-full w-1/3 origin-left rounded-full bg-primary motion-safe:animate-[preview-rail_1.4s_cubic-bezier(0.22,1,0.36,1)_infinite] motion-reduce:w-full motion-reduce:opacity-60" />
        </div>
        <ol className="mt-3 space-y-1.5 border-t border-primary/10 px-4 py-3">
          {definition.steps.map((step, index) => (
            <li
              key={step.id}
              className="flex items-center gap-3 text-sm text-foreground/70"
            >
              <span className="relative flex size-2.5 shrink-0" aria-hidden>
                <span className="absolute inset-0 rounded-full bg-primary/35 motion-safe:animate-ping motion-reduce:animate-none" />
                <span className="relative size-2.5 rounded-full bg-primary" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
                {step.name || `Step ${index + 1}`}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-foreground/55">
                in flight
              </span>
            </li>
          ))}
        </ol>
        <style>{`
          @keyframes preview-rail {
            0% { transform: translateX(-120%) scaleX(0.55); opacity: 0.55; }
            45% { opacity: 1; }
            100% { transform: translateX(320%) scaleX(0.55); opacity: 0.4; }
          }
        `}</style>
      </section>
    )
  }

  if (!preview && !previewError) return null

  const failed = Boolean(previewError) || Boolean(preview && failedStatuses.has(preview.status))
  const succeeded =
    preview?.status === "SUCCESS" || preview?.status === "SUCCESS_WITH_WARNINGS"
  const failedStep = preview?.steps.find((step) => failedStatuses.has(step.status))
  const title = previewError && !preview
    ? "Draft preview failed"
    : succeeded
      ? "Journey cleared"
      : "Journey failed"
  const durationLabel = preview ? formatDuration(preview.durationMs) : null
  const category = preview?.failureCategory
    ? labelize(preview.failureCategory)
    : failedStep?.failureCategory
      ? labelize(failedStep.failureCategory)
      : null
  const reason = preview?.failureReason || (!preview ? previewError : "")

  function editStep(step: StepRunContract) {
    onEditStep({
      requestKey: Date.now(),
      stepId: step.stepDefinitionId,
      section: failureSection(step),
      field: "section",
    })
  }

  return (
    <section
      className={
        succeeded
          ? "mb-5 rounded-xl border border-success/30 bg-success-soft/40 motion-safe:animate-[preview-settle_240ms_cubic-bezier(0.22,1,0.36,1)_both]"
          : "mb-5 rounded-xl border border-destructive/25 bg-destructive/[0.04] motion-safe:animate-[preview-settle_240ms_cubic-bezier(0.22,1,0.36,1)_both]"
      }
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
    >
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
        <span
          className={
            succeeded
              ? "mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success-foreground"
              : "mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"
          }
        >
          {failed ? (
            <CircleAlert className="size-5" aria-hidden />
          ) : (
            <ShieldCheck className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2
              className={
                succeeded
                  ? "font-heading text-xl font-semibold tracking-tight text-success-foreground"
                  : "font-heading text-xl font-semibold tracking-tight text-destructive"
              }
            >
              {title}
            </h2>
            {durationLabel ? (
              <p
                className={
                  succeeded
                    ? "font-mono text-base font-medium tabular-nums text-success-foreground"
                    : "font-mono text-base font-medium tabular-nums text-destructive"
                }
              >
                {durationLabel}
              </p>
            ) : null}
          </div>
          <p
            className={
              succeeded
                ? "mt-1 max-w-prose text-sm text-success-foreground/80"
                : "mt-1 max-w-prose text-sm text-destructive/80"
            }
          >
            {preview
              ? succeeded
                ? `${preview.steps.length} step${preview.steps.length === 1 ? "" : "s"} answered. Live execution was not persisted and did not change the monitor.`
                : [
                    category,
                    failedStep?.stepName,
                    `${preview.steps.length} step${preview.steps.length === 1 ? "" : "s"}`,
                    "not persisted",
                  ]
                    .filter(Boolean)
                    .join(" · ")
              : "The live walk did not start. The monitor was not changed."}
          </p>
        </div>
      </div>

      {failed && reason ? (
        <div className="border-t border-destructive/15 px-4 py-3.5 sm:px-5">
          <p className="max-w-prose text-base leading-relaxed whitespace-pre-wrap break-words text-destructive">
            {reason}
          </p>
        </div>
      ) : null}

      {preview?.setupScript?.status === "FAILED" ? (
        <SetupScriptBlock result={preview.setupScript} />
      ) : null}

      {preview?.steps.length ? (
        <ol
          className={
            succeeded
              ? "border-t border-success/20"
              : "border-t border-destructive/15"
          }
        >
          {preview.steps.map((previewStep, index) => {
            const stepFailed = failedStatuses.has(previewStep.status)
            const defined = definition.steps.find(
              (step) => step.id === previewStep.stepDefinitionId
            )
            const method =
              summaryString(previewStep.requestSummary, "method") ??
              defined?.request.method
            const httpStatus = stepHttpStatus(previewStep)
            const checks = stepFailed ? failedChecks(previewStep) : []
            const tone = succeeded
              ? "text-success-foreground/80"
              : stepFailed
                ? "text-destructive/80"
                : "text-foreground/70"
            const rowRule = succeeded
              ? "border-t border-success/15"
              : "border-t border-destructive/10"

            return (
              <li
                className={`${rowRule} px-4 py-3.5 first:border-t-0 sm:px-5`}
                key={previewStep.stepDefinitionId}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold tracking-tight text-foreground">
                        {previewStep.stepName || `Step ${index + 1}`}
                      </p>
                      <StatusBadge status={previewStep.status} />
                    </div>
                    <p className={`mt-1 font-mono text-sm tabular-nums ${tone}`}>
                      {[
                        method,
                        httpStatus !== undefined
                          ? `HTTP ${httpStatus}`
                          : stepFailed
                            ? "no response"
                            : null,
                        formatDuration(previewStep.durationMs),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={stepFailed ? "outline" : "ghost"}
                    aria-label={`Edit ${previewStep.stepName || `step ${index + 1}`}`}
                    onClick={() => editStep(previewStep)}
                  >
                    <Pencil data-icon="inline-start" />
                    Edit
                  </Button>
                </div>
                {checks.length ? (
                  <ul className="mt-3 space-y-3">
                    {checks.map((check, checkIndex) => (
                      <li key={`${check.kind}-${check.title}-${checkIndex}`}>
                        <p className="text-sm font-medium text-foreground">
                          {check.kind} · {check.title}
                        </p>
                        {check.detail ? (
                          <p className="mt-0.5 font-mono text-sm break-words text-destructive/80">
                            {check.detail}
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap break-words text-destructive">
                          {check.error}
                        </p>
                        {check.expected || check.observed ? (
                          <p className="mt-1.5 font-mono text-sm break-words text-destructive/90">
                            {check.expected ? `Expected ${check.expected}` : null}
                            {check.expected && check.observed ? " · " : null}
                            {check.observed ? `Observed ${check.observed}` : null}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : null}

      <style>{`
        @keyframes preview-settle {
          from { opacity: 0.82; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .motion-safe\\:animate-\\[preview-settle_240ms_cubic-bezier\\(0\\.22\\,1\\,0\\.36\\,1\\)_both\\] {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  )
}

function SetupScriptBlock({ result }: { result: ScriptResultContract }) {
  const error = scriptError(result)
  return (
    <div className="border-t border-destructive/15 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-semibold tracking-tight">Setup script</p>
        <StatusBadge status={result.status} />
      </div>
      {error ? (
        <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap break-words text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const success = status === "SUCCESS" || status === "SUCCESS_WITH_WARNINGS"
  const failed = failedStatuses.has(status)
  const label = success ? "SUCCESS" : failed ? "FAILED" : labelize(status)
  return (
    <Badge
      className={
        success
          ? "h-6 bg-success-soft px-2.5 text-[11px] font-semibold tracking-wide text-success-foreground"
          : failed
            ? "h-6 px-2.5 text-[11px] font-semibold tracking-wide"
            : "h-6 px-2.5 text-[11px] font-semibold tracking-wide"
      }
      variant={failed ? "destructive" : success ? "secondary" : "outline"}
    >
      {label}
    </Badge>
  )
}

type FailedCheck = {
  kind: string
  title: string
  detail?: string
  error: string
  expected?: string
  observed?: string
}

function failedChecks(step: StepRunContract): FailedCheck[] {
  const items: FailedCheck[] = []

  pushScriptFailures(items, step.preRequestScript, "Pre-request script")
  for (const assertion of step.assertions) {
    if (assertion.passed) continue
    items.push({
      kind: "Assertion",
      title: labelize(assertion.type) || "check",
      detail: assertion.expression || undefined,
      error: assertion.error || "Assertion did not pass.",
      expected: assertion.expected || undefined,
      observed: printable(assertion.observed),
    })
  }
  for (const extractor of step.extractors) {
    if (extractor.success) continue
    items.push({
      kind: "Extractor",
      title: extractor.variable || extractor.source || "value",
      detail: extractor.source !== extractor.variable ? extractor.source : undefined,
      error: extractor.error || "Extractor did not produce a value.",
    })
  }
  pushScriptFailures(items, step.testScript, "Test script")

  if (!items.length && step.errorMessage) {
    items.push({
      kind: "Step",
      title: step.failureCategory ? labelize(step.failureCategory) : "error",
      error: step.errorMessage,
    })
  }

  return items
}

function pushScriptFailures(
  items: FailedCheck[],
  result: ScriptResultContract | undefined,
  title: string
) {
  if (!result) return
  if (result.status === "FAILED") {
    items.push({
      kind: "Script",
      title,
      detail: [
        result.errorCategory ? labelize(result.errorCategory) : null,
        result.errorLine
          ? `Line ${result.errorLine}:${result.errorColumn ?? 1}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
      error: scriptError(result) || "Script failed.",
    })
  }
  for (const test of result.tests) {
    if (test.passed || test.skipped) continue
    items.push({
      kind: "Test",
      title: test.name || title,
      error: test.error || "Test failed.",
    })
  }
}

function scriptError(result: ScriptResultContract) {
  return result.errorMessage || result.safeStack || ""
}

function stepHttpStatus(step: StepRunContract) {
  const fromSummary = summaryNumber(step.responseSummary, "status")
  if (fromSummary !== undefined) return fromSummary
  const attempts = step.attempts
  if (!attempts?.length) return undefined
  return attempts[attempts.length - 1]?.responseStatus
}

function summaryString(
  summary: Record<string, JsonValue> | undefined,
  key: string
) {
  const value = summary?.[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

function summaryNumber(
  summary: Record<string, JsonValue> | undefined,
  key: string
) {
  const value = summary?.[key]
  return typeof value === "number" ? value : undefined
}

function formatDuration(value: number) {
  if (value < 1) return "<1 ms"
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)} s`
}

function labelize(value: string) {
  return value.replaceAll("_", " ")
}

function printable(value: JsonValue | undefined) {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

function useElapsedMs(active: boolean) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!active) {
      setElapsedMs(0)
      return
    }
    const started = performance.now()
    let frame = 0
    const tick = () => {
      setElapsedMs(performance.now() - started)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  return elapsedMs
}
