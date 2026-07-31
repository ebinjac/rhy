import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  AlertTriangle,
  Check,
  Clock3,
  Eye,
  ImagePlus,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"

import { PageContainer } from "@/components/page-container"
import {
  approveBrowserBaseline,
  deleteBrowserBaseline,
  getBrowserRun,
  listBrowserBaselines,
  listBrowserRuns,
  proposeBrowserBaseline,
} from "@/lib/api-client/browser-monitoring"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/ui-monitoring/$monitorId/baselines")({
  loader: async ({ params }) => {
    const [baselines, runSummaries] = await Promise.all([
      listBrowserBaselines({ data: { monitorId: params.monitorId } }),
      listBrowserRuns({ data: { monitorId: params.monitorId, limit: 12 } }),
    ])
    const completed = runSummaries
      .filter((run) =>
        ["SUCCESS", "SUCCESS_WITH_WARNINGS"].includes(run.status)
      )
      .slice(0, 8)
    const runs = await Promise.all(
      completed.map((run) => getBrowserRun({ data: { runId: run.id } }))
    )
    return { baselines, runs }
  },
  component: BrowserBaselinesPage,
})

function BrowserBaselinesPage() {
  const { baselines, runs } = Route.useLoaderData()
  const { monitorId } = Route.useParams()
  const router = useRouter()
  const [pending, setPending] = useState("")
  const referencedArtifacts = new Set(
    baselines.map((baseline) => baseline.artifactId)
  )
  const candidates = runs.flatMap((run) =>
    run.artifacts
      .filter(
        (artifact) =>
          artifact.contentType === "image/png" &&
          !referencedArtifacts.has(artifact.id)
      )
      .map((artifact) => ({ run, artifact }))
  )

  async function propose(
    runID: string,
    artifactID: string,
    checkpointID: string
  ) {
    setPending(artifactID)
    try {
      await proposeBrowserBaseline({
        data: {
          monitorId,
          runId: runID,
          artifactId: artifactID,
          checkpointId: checkpointID,
        },
      })
      toast.success("Visual baseline proposed for review")
      await router.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Baseline was not proposed."
      )
    } finally {
      setPending("")
    }
  }

  async function approve(baselineID: string) {
    setPending(baselineID)
    try {
      await approveBrowserBaseline({ data: { baselineId: baselineID } })
      toast.success("Visual baseline approved")
      await router.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Baseline was not approved."
      )
    } finally {
      setPending("")
    }
  }

  async function remove(baselineID: string) {
    if (
      !window.confirm(
        "Delete this visual baseline? Runs using its execution profile will no longer compare against it."
      )
    )
      return
    setPending(baselineID)
    try {
      await deleteBrowserBaseline({ data: { baselineId: baselineID } })
      toast.success("Visual baseline deleted")
      await router.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Baseline was not deleted."
      )
    } finally {
      setPending("")
    }
  }

  return (
    <PageContainer as="main">
      <header>
        <h1 className="text-2xl font-semibold">Visual baselines</h1>
        <p className="mt-1 max-w-3xl text-sm/6 text-muted-foreground">
          Review expected UI evidence before it can determine a visual
          regression. Baselines remain scoped to revision, browser image,
          viewport, locale, timezone, and color scheme.
        </p>
      </header>

      <div className="mt-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="font-medium">Baselines never update silently</p>
          <p className="mt-1 text-sm/6 text-muted-foreground">
            Approving a new image supersedes only the comparable active
            baseline. Browser-image or font changes remain explicit so a
            rendering upgrade cannot hide a real product change.
          </p>
        </div>
      </div>

      <section className="mt-8" aria-labelledby="active-baselines">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold" id="active-baselines">
              Baseline library
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Approved, proposed, and superseded visual evidence.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {baselines.length} baseline{baselines.length === 1 ? "" : "s"}
          </span>
        </div>
        {baselines.length ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {baselines.map((baseline) => (
              <article
                className="overflow-hidden rounded-xl border"
                key={baseline.id}
              >
                <a
                  className="block bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/api/browser-artifacts/${baseline.artifactId}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <img
                    alt={`Visual baseline for ${baseline.checkpointId}`}
                    className="aspect-video w-full object-cover"
                    loading="lazy"
                    src={`/api/browser-artifacts/${baseline.artifactId}`}
                  />
                </a>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {baseline.checkpointId}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {baseline.fingerprint.slice(0, 16)}
                      </p>
                    </div>
                    <BaselineBadge status={baseline.status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Browser</dt>
                      <dd className="mt-0.5">
                        Chromium {baseline.browserVersion || "not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Captured</dt>
                      <dd className="mt-0.5">
                        {formatDateTime(baseline.createdAt)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex gap-2 border-t pt-4">
                    {baseline.status === "PROPOSED" ? (
                      <Button
                        className="flex-1"
                        disabled={pending === baseline.id}
                        onClick={() => void approve(baseline.id)}
                        size="sm"
                      >
                        {pending === baseline.id ? (
                          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                        ) : (
                          <Check />
                        )}
                        Approve
                      </Button>
                    ) : null}
                    <Button
                      aria-label={`Delete baseline ${baseline.checkpointId}`}
                      className={
                        baseline.status === "PROPOSED" ? "" : "ml-auto"
                      }
                      disabled={pending === baseline.id}
                      onClick={() => void remove(baseline.id)}
                      size="icon"
                      variant="destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
            <Eye className="size-6 text-primary" />
            <p className="mt-3 font-medium">No visual baseline yet</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Add a visual checkpoint, complete a successful run, then propose
              its masked screenshot below.
            </p>
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="baseline-candidates">
        <div>
          <h2 className="text-lg font-semibold" id="baseline-candidates">
            Recent eligible evidence
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Masked screenshots from recent successful runs that are not already
            attached to a baseline.
          </p>
        </div>
        {candidates.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {candidates.map(({ run, artifact }) => {
              const checkpoint =
                readString(artifact.metadata?.checkpointId) ||
                readString(artifact.metadata?.stepId) ||
                artifact.kind.toLowerCase().replaceAll("_", "-")
              return (
                <article
                  className="overflow-hidden rounded-xl border"
                  key={artifact.id}
                >
                  <img
                    alt={`Masked visual evidence from run ${run.id.slice(0, 8)}`}
                    className="aspect-video w-full bg-muted/30 object-cover"
                    loading="lazy"
                    src={`/api/browser-artifacts/${artifact.id}`}
                  />
                  <div className="p-3">
                    <p className="truncate text-sm font-medium">{checkpoint}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDateTime(run.createdAt)} · {run.id.slice(0, 8)}
                    </p>
                    <Button
                      className="mt-3 h-9 w-full"
                      disabled={pending === artifact.id}
                      onClick={() =>
                        void propose(run.id, artifact.id, checkpoint)
                      }
                      size="sm"
                      variant="outline"
                    >
                      {pending === artifact.id ? (
                        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <ImagePlus />
                      )}
                      Propose baseline
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            No unassigned visual evidence is available. Complete a successful
            run containing a screenshot checkpoint.
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function BaselineBadge({
  status,
}: {
  status: "PROPOSED" | "APPROVED" | "SUPERSEDED"
}) {
  if (status === "APPROVED")
    return (
      <Badge
        className="bg-success-soft text-success-foreground"
        variant="secondary"
      >
        <Check />
        Approved
      </Badge>
    )
  if (status === "PROPOSED")
    return (
      <Badge
        className="bg-warning-soft text-warning-foreground"
        variant="secondary"
      >
        <Clock3 />
        Proposed
      </Badge>
    )
  return (
    <Badge variant="outline">
      <Eye />
      Superseded
    </Badge>
  )
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}
