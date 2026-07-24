import { createFileRoute } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Check, CircleAlert, ScrollText } from "lucide-react"

import { listAuditEvents } from "@/lib/api-client/monitors"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/audit")({
  loader: () => listAuditEvents(),
  component: AuditPage,
})

function AuditPage() {
  const events = Route.useLoaderData()
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
      <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Governance
      </p>
      <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
        Audit log
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Immutable operator actions with outcomes and correlation IDs. Request
        bodies and secret values are never recorded.
      </p>
      <div className="mt-7 overflow-hidden rounded-xl border">
        <div className="hidden grid-cols-[170px_150px_1fr_120px_150px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <span>Time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Outcome</span>
          <span>Correlation</span>
        </div>
        {events.length ? (
          events.map((event) => (
            <div
              className="grid gap-2 border-b px-4 py-4 last:border-b-0 md:grid-cols-[170px_150px_1fr_120px_150px] md:items-center md:gap-4"
              key={event.id}
            >
              <span className="text-xs text-muted-foreground">
                {formatDateTime(event.createdAt)}
              </span>
              <span className="truncate text-sm">
                {event.actorId || "System"}
              </span>
              <div>
                <p className="text-sm font-medium">
                  {event.action.replaceAll("_", " ")}
                </p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {event.resourceType.toLowerCase()} ·{" "}
                  {event.resourceId.slice(0, 16)}
                </p>
              </div>
              <Badge
                className={
                  event.outcome === "SUCCESS"
                    ? "w-fit bg-success-soft text-success-foreground"
                    : "w-fit bg-destructive/10 text-destructive"
                }
                variant="secondary"
              >
                {event.outcome === "SUCCESS" ? <Check /> : <CircleAlert />}
                {event.outcome}
              </Badge>
              <span
                className="truncate font-mono text-xs text-muted-foreground"
                title={event.correlationId}
              >
                {event.correlationId || "—"}
              </span>
            </div>
          ))
        ) : (
          <div className="py-14 text-center">
            <ScrollText className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No mutations recorded yet.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
