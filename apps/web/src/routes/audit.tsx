import { useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { CopyButton } from "@workspace/ui/components/copy-button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  ScrollText,
} from "lucide-react"

import { listAuditEvents } from "@/lib/api-client/monitors"
import { formatDateTime } from "@/lib/format-date"
import { PageContainer } from "@/components/page-container"

export const Route = createFileRoute("/audit")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(typeof search.outcome === "string" && search.outcome
      ? { outcome: search.outcome }
      : {}),
    ...(positivePage(search.page) > 1
      ? { page: positivePage(search.page) }
      : {}),
  }),
  loader: () => listAuditEvents(),
  component: AuditPage,
})

function AuditPage() {
  const events = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const query = search.q ?? ""
  const outcome = search.outcome ?? ""
  const pageSize = 25
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return events.filter(
      (event) =>
        (!outcome || event.outcome === outcome) &&
        (!needle ||
          [
            event.actorId,
            event.action,
            event.resourceType,
            event.resourceId,
            event.correlationId,
          ].some((value) => value?.toLowerCase().includes(needle)))
    )
  }, [events, outcome, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(search.page ?? 1, pageCount)
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  function updateSearch(
    patch: Partial<{ q: string; outcome: string; page: number }>
  ) {
    void navigate({
      search: (previous) => ({
        ...previous,
        ...patch,
        page: patch.page ?? 1,
      }),
      replace: true,
    })
  }

  function exportCSV() {
    const rows = [
      [
        "time",
        "actor",
        "action",
        "resourceType",
        "resourceId",
        "outcome",
        "correlationId",
      ],
      ...filtered.map((event) => [
        event.createdAt,
        event.actorId || "System",
        event.action,
        event.resourceType,
        event.resourceId,
        event.outcome,
        event.correlationId || "",
      ]),
    ]
    const csv = rows
      .map((row) =>
        row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")
      )
      .join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "rhythm-audit-events.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <PageContainer>
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
      <section className="mt-7 flex flex-col gap-3 border-y py-4 sm:flex-row sm:items-center">
        <Input
          aria-label="Search audit events"
          className="max-w-md"
          onChange={(event) => {
            updateSearch({ q: event.target.value })
          }}
          placeholder="Search actor, action, resource, correlation"
          value={query}
        />
        <Select
          value={outcome || null}
          onValueChange={(next) => updateSearch({ outcome: next ?? "" })}
          items={[
            { value: null, label: "All outcomes" },
            { value: "SUCCESS", label: "Success" },
            { value: "FAILURE", label: "Failure" },
          ]}
        >
          <SelectTrigger
            aria-label="Filter audit outcome"
            className="h-9 min-w-36 font-normal"
          >
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>All outcomes</SelectItem>
            <SelectItem value="SUCCESS">Success</SelectItem>
            <SelectItem value="FAILURE">Failure</SelectItem>
          </SelectContent>
        </Select>
        <Button className="sm:ml-auto" onClick={exportCSV} variant="outline">
          <Download />
          Export CSV
        </Button>
      </section>
      <p className="mt-3 text-xs text-muted-foreground">
        Audit history records user, worker, and system mutations. Retention is
        controlled by the workspace audit policy.
      </p>
      <div className="mt-4 overflow-hidden rounded-xl border">
        <div className="hidden grid-cols-[170px_150px_1fr_120px_150px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <span>Time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Outcome</span>
          <span>Correlation</span>
        </div>
        {visible.length ? (
          visible.map((event) => (
            <details className="group border-b last:border-b-0" key={event.id}>
              <summary className="grid cursor-pointer list-none gap-2 px-4 py-4 hover:bg-muted/25 md:grid-cols-[170px_150px_1fr_120px_150px] md:items-center md:gap-4">
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
              </summary>
              <div className="border-t bg-muted/15 px-4 py-4 text-xs">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Full resource ID</dt>
                    <dd className="mt-1 flex items-center gap-2 font-mono break-all">
                      {event.resourceId}
                      <CopyButton
                        label="Copy full resource ID"
                        size="icon-sm"
                        value={event.resourceId}
                        variant="ghost"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Event source</dt>
                    <dd className="mt-1">
                      {event.actorId
                        ? "Authenticated user or worker"
                        : "System"}
                    </dd>
                  </div>
                </dl>
              </div>
            </details>
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
      {filtered.length ? (
        <div className="mt-4 flex items-center justify-between gap-4 text-sm">
          <p className="text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}–
            {Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              aria-label="Previous audit page"
              disabled={page === 1}
              onClick={() => updateSearch({ page: Math.max(1, page - 1) })}
              size="icon"
              variant="outline"
            >
              <ChevronLeft />
            </Button>
            <span>
              Page {page} of {pageCount}
            </span>
            <Button
              aria-label="Next audit page"
              disabled={page === pageCount}
              onClick={() =>
                updateSearch({ page: Math.min(pageCount, page + 1) })
              }
              size="icon"
              variant="outline"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </PageContainer>
  )
}

function positivePage(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}
