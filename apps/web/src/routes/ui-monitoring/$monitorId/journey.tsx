import { useMemo, useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { CircleAlert, LoaderCircle, Play, Rocket, Save } from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"

import { PageContainer } from "@/components/page-container"
import { JourneyBuilder } from "@/features/ui-monitoring/journey-builder"
import { BrowserRunBadge } from "@/features/ui-monitoring/browser-monitor-status"
import {
  getBrowserMonitor,
  listBrowserMonitorRevisions,
  previewBrowserMonitor,
  publishBrowserMonitor,
  saveBrowserMonitorDraft,
} from "@/lib/api-client/browser-monitoring"
import type {
  BrowserMonitorDefinition,
  BrowserPreview,
} from "@/lib/api-client/browser-monitoring"

export const Route = createFileRoute("/ui-monitoring/$monitorId/journey")({
  loader: async ({ params }) => {
    const [monitor, revisions] = await Promise.all([
      getBrowserMonitor({ data: { monitorId: params.monitorId } }),
      listBrowserMonitorRevisions({ data: { monitorId: params.monitorId } }),
    ])
    const draft =
      revisions.find(
        (revision) => revision.id === monitor.currentDraftRevisionId
      ) ?? revisions[0]
    if (!draft) throw new Error("Browser journey definition was not found.")
    return { monitor, revisions, draft }
  },
  component: BrowserJourneyPage,
})

function BrowserJourneyPage() {
  const { monitor, draft } = Route.useLoaderData()
  const router = useRouter()
  const [definition, setDefinition] = useState<BrowserMonitorDefinition>(
    draft.definition
  )
  const [selectedStepID, setSelectedStepID] = useState(
    draft.definition.steps[0]?.id ?? ""
  )
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<BrowserPreview | null>(null)
  const [error, setError] = useState("")
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    JSON.stringify(draft.definition)
  )
  const fingerprint = useMemo(() => JSON.stringify(definition), [definition])
  const dirty = fingerprint !== savedFingerprint

  async function saveDraft() {
    setError("")
    setSaving(true)
    try {
      const revision = await saveBrowserMonitorDraft({
        data: { monitorId: monitor.id, definition },
      })
      setSavedFingerprint(JSON.stringify(revision.definition))
      toast.success(`Draft revision ${revision.revisionNumber} saved`)
      await router.invalidate()
      return true
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The browser draft was not saved."
      )
      return false
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    setPublishing(true)
    setError("")
    try {
      if (dirty && !(await saveDraft())) return
      const revision = await publishBrowserMonitor({
        data: {
          monitorId: monitor.id,
          changeSummary: "Browser journey published from workbench",
        },
      })
      toast.success(`Revision ${revision.revisionNumber} published`)
      await router.invalidate()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The browser journey was not published."
      )
    } finally {
      setPublishing(false)
    }
  }

  async function runPreview() {
    setPreviewing(true)
    setError("")
    try {
      setPreview(
        await previewBrowserMonitor({
          data: { monitorId: monitor.id, definition },
        })
      )
    } catch (reason) {
      setPreview(null)
      setError(
        reason instanceof Error
          ? reason.message
          : "The browser preview could not be completed."
      )
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <main>
      <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <PageContainer padding="header">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold">Journey workbench</h1>
                {dirty ? (
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-warning-foreground">
                    Unsaved changes
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    Draft saved
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Chromium · {definition.profile.viewportWidth} ×{" "}
                {definition.profile.viewportHeight} · revision{" "}
                {draft.revisionNumber}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={previewing}
                onClick={() => void runPreview()}
                variant="outline"
              >
                {previewing ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Play />
                )}
                Run preview
              </Button>
              <Button
                disabled={saving || !dirty}
                onClick={() => void saveDraft()}
                variant="outline"
              >
                {saving ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Save />
                )}
                Save draft
              </Button>
              <Button
                disabled={publishing || saving}
                onClick={() => void publish()}
              >
                {publishing ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Rocket />
                )}
                Publish
              </Button>
            </div>
          </div>
        </PageContainer>
      </div>

      <PageContainer padding="compact">
        {error ? (
          <div
            className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        <div className="mb-5 rounded-xl border bg-muted/15 px-4 py-3">
          <p className="text-sm font-medium">Execution boundary</p>
          <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
            {definition.startUrl}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Allowed navigation:{" "}
            {definition.allowedOrigins.length
              ? definition.allowedOrigins.join(", ")
              : "start origin only"}
          </p>
        </div>

        <JourneyBuilder
          onChange={(steps) =>
            setDefinition((current) => ({ ...current, steps }))
          }
          onSelectedStepIDChange={setSelectedStepID}
          selectedStepID={selectedStepID}
          steps={definition.steps}
        />

        {preview || previewing ? (
          <section className="mt-6 overflow-hidden rounded-xl border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
              <div>
                <p className="font-medium">Preview evidence</p>
                <p className="text-xs text-muted-foreground">
                  Preview is isolated and does not change scheduled history.
                </p>
              </div>
              {preview ? <BrowserRunBadge status={preview.status} /> : null}
            </div>
            {previewing ? (
              <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin text-primary motion-reduce:animate-none" />
                Executing the draft journey…
              </div>
            ) : preview ? (
              <div className="grid lg:grid-cols-[1fr_20rem]">
                <div className="bg-muted/30 p-3">
                  {preview.artifacts.find(
                    (artifact) => artifact.contentType === "image/png"
                  ) ? (
                    <img
                      alt="Masked browser preview"
                      className="max-h-[34rem] w-full rounded-lg object-contain"
                      src={`data:image/png;base64,${
                        preview.artifacts.find(
                          (artifact) => artifact.contentType === "image/png"
                        )?.contentBase64
                      }`}
                    />
                  ) : (
                    <p className="p-8 text-center text-sm text-muted-foreground">
                      Add a visual checkpoint to include a masked screenshot.
                    </p>
                  )}
                </div>
                <ol className="divide-y border-t lg:border-t-0 lg:border-l">
                  {preview.steps.map((step, index) => (
                    <li className="flex gap-3 px-4 py-3" key={step.id || index}>
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border text-[11px]">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {step.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {step.status.toLowerCase()} · {step.durationMs} ms
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>
        ) : null}
      </PageContainer>
    </main>
  )
}
