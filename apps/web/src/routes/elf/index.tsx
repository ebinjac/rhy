import { useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  ArrowRight,
  Braces,
  Clock3,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react"

import { PageContainer } from "@/components/page-container"

import {
  deriveELFOperationalStatus,
  OperationalStatusBadge,
} from "@/components/operational-status"
import {
  listELFApplications,
  getELFSettings,
  listELFQueries,
  permanentlyDeleteELFQueries,
  saveELFQuery,
} from "@/lib/api-client/elf"

export const Route = createFileRoute("/elf/")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(positivePage(search.page) > 1
      ? { page: positivePage(search.page) }
      : {}),
  }),
  loader: async () => {
    const [queries, applications, settings] = await Promise.all([
      listELFQueries(),
      listELFApplications(),
      getELFSettings(),
    ])
    return { queries, applications, settings }
  },
  component: ELFQueriesPage,
})

function ELFQueriesPage() {
  const { queries, applications, settings } = Route.useLoaderData()
  const routeSearch = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selectedQueries, setSelectedQueries] = useState<Set<string>>(new Set())
  const [deleteTargets, setDeleteTargets] = useState<string[]>([])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "")
  const [serviceId, setServiceId] = useState(
    applications[0]?.services[0]?.id ?? ""
  )
  const selected = applications.find((item) => item.id === applicationId)
  const filtered = queries.filter((item) =>
    `${item.name} ${item.applicationName} ${item.serviceName}`
      .toLowerCase()
      .includes((routeSearch.q ?? "").toLowerCase())
  )
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(routeSearch.page ?? 1, pageCount)
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const visibleIds = visible.map((query) => query.id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedQueries.has(id))
  const someVisibleSelected = visibleIds.some((id) => selectedQueries.has(id))
  const targetNames = queries
    .filter((query) => deleteTargets.includes(query.id))
    .map((query) => query.name)

  function toggleQuery(queryId: string, checked: boolean) {
    setSelectedQueries((current) => {
      const next = new Set(current)
      if (checked) next.add(queryId)
      else next.delete(queryId)
      return next
    })
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedQueries((current) => {
      const next = new Set(current)
      for (const id of visibleIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function requestDelete(ids: string[]) {
    setDeleteTargets(ids)
    setDeleteError("")
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError("")
    const result = await permanentlyDeleteELFQueries({
      data: { queryIds: deleteTargets },
    })
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.message)
      return
    }
    setDeleteOpen(false)
    setSelectedQueries((current) => {
      const next = new Set(current)
      for (const id of deleteTargets) next.delete(id)
      return next
    })
    setDeleteTargets([])
    await router.invalidate()
  }
  async function create() {
    setPending(true)
    setMessage("")
    const result = await saveELFQuery({
      data: {
        name,
        description,
        applicationId,
        serviceId,
        indexOverride: "",
        active: true,
        searchBody: { query: { match_all: {} } },
        defaultWindowSeconds: 900,
        checkKind: "HIT_COUNT",
        criteria: { operator: "EQ", value: 0 },
        gateMode: "BLOCKING",
        semanticMapping: {},
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    await router.navigate({
      to: "/elf/$queryId",
      params: { queryId: result.query.id },
    })
  }
  return (
    <PageContainer as="main">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span
              className={`size-2 rounded-full ${settings ? "bg-success" : "bg-warning"}`}
            />
            {settings ? "ELF configured" : "ELF setup required"}
            <Link className="text-primary hover:underline" to="/elf/settings">
              {settings ? "Verify connection" : "Configure"}
            </Link>
          </div>
          <h1 className="mt-2 font-heading text-2xl font-semibold">
            Log queries
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Investigate application logs and promote a proven query into a
            release gate.
          </p>
        </div>
        <Button onClick={() => setCreating((value) => !value)}>
          <Plus />
          New query
        </Button>
      </header>
      {creating ? (
        <section className="mt-6 border-y bg-muted/15 py-5">
          <div className="grid gap-4 px-1 md:grid-cols-2">
            <Field label="Query name">
              <Input
                aria-label="Query name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Payment errors after deployment"
              />
            </Field>
            <Field label="Application">
              <Select
                value={applicationId}
                onValueChange={(value) => {
                  if (value == null) return
                  setApplicationId(value)
                  setServiceId(
                    applications.find((item) => item.id === value)?.services[0]
                      ?.id ?? ""
                  )
                }}
                items={applications.map((app) => ({
                  value: app.id,
                  label: `${app.name}${app.carId ? ` · ${app.carId}` : ""} · ${app.environment || "Any environment"}`,
                }))}
              >
                <SelectTrigger aria-label="Filter" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {applications.map((app) => (
                    <SelectItem key={app.id} value={app.id}>
                      {app.name}
                      {app.carId ? ` · ${app.carId}` : ""} ·{" "}
                      {app.environment || "Any environment"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Service">
              <Select
                value={serviceId || null}
                onValueChange={(value) => setServiceId(value ?? "")}
                items={[
                  { value: null, label: "All application services" },
                  ...(selected?.services ?? []).map((service) => ({
                    value: service.id,
                    label: service.name,
                  })),
                ]}
              >
                <SelectTrigger aria-label="Filter" className="h-9 w-full">
                  <SelectValue placeholder="All application services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All application services</SelectItem>
                  {selected?.services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Description">
              <Textarea
                aria-label="Description"
                className="min-h-20"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this query detects and when it should block a release."
              />
            </Field>
          </div>
          {message ? (
            <p className="mt-3 text-sm text-destructive">{message}</p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button
              disabled={pending || !name || !applicationId}
              onClick={create}
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ArrowRight />
              )}
              Open workbench
            </Button>
          </div>
        </section>
      ) : null}
      <div className="mt-7 flex items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search ELF queries"
            className="pl-9"
            value={routeSearch.q ?? ""}
            onChange={(event) =>
              void navigate({
                search: { q: event.target.value, page: 1 },
                replace: true,
              })
            }
            placeholder="Search queries, applications, or services"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} saved
        </span>
      </div>
      {selectedQueries.size ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-primary/8 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-medium">
              {selectedQueries.size} quer
              {selectedQueries.size === 1 ? "y" : "ies"} selected
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Deletion permanently removes query definitions and every saved
              revision. Historical run evidence remains available for audit.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelectedQueries(new Set())}
            >
              Clear selection
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => requestDelete([...selectedQueries])}
            >
              <Trash2 />
              Delete permanently
            </Button>
          </div>
        </div>
      ) : null}
      {filtered.length ? (
        <div className="mt-4 overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[24px_minmax(0,1.5fr)_minmax(180px,.7fr)_minmax(210px,.8fr)_120px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid md:items-center">
            <Checkbox
              aria-label="Select all visible ELF queries"
              aria-checked={
                someVisibleSelected && !allVisibleSelected
                  ? "mixed"
                  : allVisibleSelected
              }
              checked={allVisibleSelected}
              onCheckedChange={(checked) => toggleAllVisible(checked === true)}
            />
            <span>Query</span>
            <span>Application</span>
            <span>Latest result</span>
            <span className="text-right">Actions</span>
          </div>
          {visible.map((query) => (
            <article
              key={query.id}
              className={`group grid grid-cols-[24px_minmax(0,1fr)] gap-3 border-b px-4 py-4 last:border-b-0 hover:bg-muted/25 md:grid-cols-[24px_minmax(0,1.5fr)_minmax(180px,.7fr)_minmax(210px,.8fr)_120px] md:items-center md:gap-4 ${selectedQueries.has(query.id) ? "bg-primary/5" : ""}`}
            >
              <Checkbox
                aria-label={`Select ${query.name}`}
                checked={selectedQueries.has(query.id)}
                onCheckedChange={(checked) =>
                  toggleQuery(query.id, checked === true)
                }
              />
              <div className="min-w-0">
                <Link
                  className="font-medium hover:text-primary hover:underline"
                  to="/elf/$queryId"
                  params={{ queryId: query.id }}
                >
                  {query.name}
                </Link>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {query.description || "No description"}
                </p>
              </div>
              <div className="col-start-2 text-sm md:col-auto">
                <p>{query.applicationName}</p>
                <p className="text-xs text-muted-foreground">
                  {query.serviceName || "All services"} · revision{" "}
                  {query.revisionNumber}
                </p>
              </div>
              <div className="col-start-2 md:col-auto">
                {query.lastRun ? (
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <OperationalStatusBadge
                          status={deriveELFOperationalStatus(query.lastRun)}
                        />
                        <span className="text-sm font-medium">
                          {query.lastRun.hitCount.toLocaleString()} hits
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {query.lastRun.roundTripMs} ms round trip
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="size-4" />
                    Not probed yet
                  </p>
                )}
              </div>
              <div className="col-start-2 flex items-center justify-end gap-1 md:col-auto">
                <Badge
                  variant={
                    query.gateMode === "BLOCKING" ? "default" : "secondary"
                  }
                >
                  {query.gateMode}
                </Badge>
                <Button
                  aria-label="Open query"
                  nativeButton={false}
                  render={
                    <Link
                      aria-label={`Open ${query.name}`}
                      title={`Open ${query.name}`}
                      to="/elf/$queryId"
                      params={{ queryId: query.id }}
                    />
                  }
                  size="icon-sm"
                  title={`Open ${query.name}`}
                  variant="ghost"
                >
                  <ArrowRight />
                </Button>
                <Button
                  aria-label={`Delete ${query.name}`}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => requestDelete([query.id])}
                >
                  <Trash2 />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-8 border-y py-16 text-center">
          <Braces className="mx-auto size-7 text-muted-foreground" />
          <h2 className="mt-3 font-medium">No matching log queries</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a query, probe real logs, then define its release decision.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => setCreating(true)}
          >
            <ShieldCheck />
            Create first query
          </Button>
        </div>
      )}
      {filtered.length > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <Button
            aria-label="Previous ELF query page"
            disabled={page === 1}
            onClick={() =>
              void navigate({
                search: {
                  q: routeSearch.q ?? "",
                  page: Math.max(1, page - 1),
                },
                replace: true,
              })
            }
            size="sm"
            variant="outline"
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {pageCount} · {filtered.length} queries
          </span>
          <Button
            aria-label="Next ELF query page"
            disabled={page === pageCount}
            onClick={() =>
              void navigate({
                search: {
                  q: routeSearch.q ?? "",
                  page: Math.min(pageCount, page + 1),
                },
                replace: true,
              })
            }
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </div>
      ) : null}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Delete{" "}
              {deleteTargets.length === 1
                ? "query"
                : `${deleteTargets.length} queries`}{" "}
              permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Rhythm will permanently remove{" "}
              {deleteTargets.length === 1 ? (
                <strong>{targetNames[0]}</strong>
              ) : (
                "the selected queries"
              )}{" "}
              and every saved revision. Historical run evidence remains as a
              detached audit record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTargets.length > 1 ? (
            <ul className="max-h-36 overflow-auto rounded-lg bg-muted/45 px-3 py-2 text-sm">
              {targetNames.map((targetName) => (
                <li className="truncate py-1" key={targetName}>
                  {targetName}
                </li>
              ))}
            </ul>
          ) : null}
          {deleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              {deleting ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  )
}

function positivePage(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="text-xs font-medium">
      {label}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}
