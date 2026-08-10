import { useEffect, useState } from "react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { CircleAlert, LoaderCircle, ShieldCheck } from "lucide-react"

import type { DraftMonitorPreviewContract } from "@/lib/api-client/contracts"
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
            <p className="mt-0.5 text-xs text-muted-foreground">
              Real requests against your targets ·{" "}
              <span className="font-mono tabular-nums text-foreground/80">
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
              className="flex items-center gap-3 text-sm text-muted-foreground"
            >
              <span
                className="relative flex size-2.5 shrink-0"
                aria-hidden
              >
                <span className="absolute inset-0 rounded-full bg-primary/35 motion-safe:animate-ping motion-reduce:animate-none" />
                <span className="relative size-2.5 rounded-full bg-primary" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
                {step.name || `Step ${index + 1}`}
              </span>
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
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

  const failed = Boolean(previewError) || preview?.status === "FAILED"
  const succeeded = preview?.status === "SUCCESS"

  return (
    <Alert
      className={
        succeeded
          ? "mb-5 border-success/30 bg-success-soft/40 motion-safe:animate-[preview-settle_420ms_cubic-bezier(0.22,1,0.36,1)_both]"
          : "mb-5"
      }
      role="status"
      aria-live="polite"
      variant={failed ? "destructive" : "default"}
    >
      {failed ? <CircleAlert /> : <ShieldCheck />}
      <AlertTitle>
        {previewError
          ? "Draft preview failed"
          : succeeded
            ? "Journey cleared"
            : `Draft preview ${preview?.status.toLowerCase().replaceAll("_", " ")}`}
      </AlertTitle>
      <AlertDescription>
        {previewError ? (
          previewError
        ) : preview ? (
          <div className="space-y-3">
            <p>
              {succeeded
                ? `${preview.steps.length} step${preview.steps.length === 1 ? "" : "s"} answered in ${preview.durationMs.toLocaleString()} ms. Live execution was not persisted and did not change the monitor.`
                : `${preview.steps.length} step${preview.steps.length === 1 ? "" : "s"} executed in ${preview.durationMs.toLocaleString()} ms. ${preview.failureReason || "This real execution was not persisted and did not change the monitor."}`}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {preview.steps.map((previewStep, index) => (
                <li
                  key={previewStep.stepDefinitionId}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background/70 p-2 motion-safe:animate-[preview-step-in_360ms_cubic-bezier(0.22,1,0.36,1)_both]"
                  style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {previewStep.stepName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {previewStep.status} ·{" "}
                      {previewStep.durationMs.toLocaleString()} ms
                      {previewStep.errorMessage
                        ? ` · ${previewStep.errorMessage}`
                        : ""}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onEditStep({
                        requestKey: Date.now(),
                        stepId: previewStep.stepDefinitionId,
                        section: failureSection(previewStep),
                        field: "section",
                      })
                    }
                  >
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
            <style>{`
              @keyframes preview-settle {
                from { opacity: 0.72; transform: translateY(4px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @keyframes preview-step-in {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @media (prefers-reduced-motion: reduce) {
                .motion-safe\\:animate-\\[preview-settle_420ms_cubic-bezier\\(0\\.22\\,1\\,0\\.36\\,1\\)_both\\],
                .motion-safe\\:animate-\\[preview-step-in_360ms_cubic-bezier\\(0\\.22\\,1\\,0\\.36\\,1\\)_both\\] {
                  animation: none !important;
                }
              }
            `}</style>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  )
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
