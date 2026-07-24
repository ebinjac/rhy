import { useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  ArrowLeft,
  Check,
  FileClock,
  LoaderCircle,
  RotateCcw,
} from "lucide-react"

import type { RevisionContract } from "@/lib/api-client/contracts"
import {
  listMonitorRevisions,
  restoreMonitorRevision,
} from "@/lib/api-client/monitors"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/monitors/$monitorId/revisions")({
  loader: ({ params }) =>
    listMonitorRevisions({ data: { monitorId: params.monitorId } }),
  component: RevisionsPage,
})
function RevisionsPage() {
  const revisions = Route.useLoaderData()
  const { monitorId } = Route.useParams()
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
      <Button
        render={<Link to="/monitors" />}
        nativeButton={false}
        variant="ghost"
      >
        <ArrowLeft /> Monitors
      </Button>
      <p className="mt-6 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Change management
      </p>
      <h1 className="mt-2 font-heading text-2xl font-semibold">
        Monitor revisions
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Published snapshots are immutable. Restore copies a snapshot into the
        editable draft.
      </p>
      <div className="mt-7 space-y-3">
        {revisions.map((revision) => (
          <RevisionRow
            key={revision.id}
            revision={revision}
            monitorId={monitorId}
          />
        ))}
      </div>
    </div>
  )
}
function RevisionRow({
  revision,
  monitorId,
}: {
  revision: RevisionContract
  monitorId: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  async function restore() {
    setPending(true)
    const result = await restoreMonitorRevision({
      data: { monitorId, revisionId: revision.id },
    })
    setPending(false)
    setMessage(result.message)
    if (result.ok) await router.invalidate()
  }
  return (
    <article className="rounded-xl border p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          className={`grid size-9 place-items-center rounded-lg ${revision.status === "PUBLISHED" ? "bg-success-soft text-success-foreground" : "bg-muted text-muted-foreground"}`}
        >
          {revision.status === "PUBLISHED" ? (
            <Check className="size-4" />
          ) : (
            <FileClock className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">Revision {revision.revisionNumber}</h2>
            <Badge variant="secondary">{revision.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {revision.changeSummary || "Current editable draft"}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {revision.id} ·{" "}
            {formatDateTime(revision.publishedAt || revision.createdAt)}
          </p>
          {message ? (
            <p
              className="mt-2 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {message}
            </p>
          ) : null}
        </div>
        {revision.status === "PUBLISHED" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={restore}
            disabled={pending}
          >
            {pending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RotateCcw />
            )}{" "}
            Restore to draft
          </Button>
        ) : null}
      </div>
    </article>
  )
}
