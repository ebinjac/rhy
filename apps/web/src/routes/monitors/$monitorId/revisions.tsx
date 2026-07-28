import { useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
  const [compare, setCompare] = useState<Set<string>>(new Set())
  const selected = revisions.filter((revision) => compare.has(revision.id))
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
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          nativeButton={false}
          render={
            <Link
              params={{ monitorId }}
              to="/monitors/$monitorId/edit"
            />
          }
          variant="outline"
        >
          Open builder
        </Button>
        <span className="self-center text-xs text-muted-foreground">
          Select two revisions for a side-by-side definition comparison.
        </span>
      </div>
      {selected.length === 2 ? (
        <section className="mt-6" aria-labelledby="revision-comparison">
          <h2 id="revision-comparison" className="text-lg font-semibold">
            Revision comparison
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {selected.map((revision) => (
              <div className="min-w-0 rounded-lg border" key={revision.id}>
                <div className="border-b bg-muted/35 px-4 py-2 text-sm font-medium">
                  Revision {revision.revisionNumber} · {revision.status.toLowerCase()}
                </div>
                <pre className="max-h-[480px] overflow-auto p-4 font-mono text-xs leading-5">
                  {JSON.stringify(revision.definition, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="mt-7 space-y-3">
        {revisions.map((revision) => (
          <RevisionRow
            compare={compare.has(revision.id)}
            key={revision.id}
            onCompare={(checked) =>
              setCompare((current) => {
                const next = new Set(current)
                if (checked) {
                  if (next.size >= 2) next.delete(next.values().next().value!)
                  next.add(revision.id)
                } else {
                  next.delete(revision.id)
                }
                return next
              })
            }
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
  compare,
  onCompare,
}: {
  revision: RevisionContract
  monitorId: string
  compare: boolean
  onCompare: (checked: boolean) => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  async function restore() {
    if (
      !window.confirm(
        `Restore revision ${revision.revisionNumber}? This replaces the current editable draft but does not change the published revision.`
      )
    )
      return
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
        <Checkbox
          aria-label={`Compare revision ${revision.revisionNumber}`}
          checked={compare}
          onCheckedChange={(checked) => onCompare(checked === true)}
        />
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
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-primary">
              Inspect definition
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg border bg-muted/25 p-4 font-mono text-xs leading-5">
              {JSON.stringify(revision.definition, null, 2)}
            </pre>
          </details>
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
