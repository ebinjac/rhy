import { useEffect, useRef, useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Archive,
  ChartNoAxesCombined,
  Check,
  CircleAlert,
  Copy,
  FileClock,
  FilePenLine,
  History,
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  Workflow,
} from "lucide-react"

import { MonitorImportDialog } from "@/features/monitors/monitor-import-dialog"
import type { ImportedMonitorDraft } from "@/features/monitors/monitor-import"
import type { MonitorStatus } from "@/features/monitors/seed-data"
import {
  listMonitorOperationalStatus,
  OperationalStatusBadge,
} from "@/components/operational-status"
import {
  createMonitor,
  listMonitorPage,
  mutateMonitor,
  permanentlyDeleteMonitors,
  runMonitor,
} from "@/lib/api-client/monitors"
import { PageContainer } from "@/components/page-container"
import { PageEmptyState } from "@/components/page-empty-state"

export const Route = createFileRoute("/monitors/")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(typeof search.status === "string" && search.status
      ? { status: search.status }
      : {}),
    ...(typeof search.application === "string" && search.application
      ? { application: search.application }
      : {}),
    ...(positivePage(search.page) > 1
      ? { page: positivePage(search.page) }
      : {}),
    ...(typeof search.cursor === "string" && search.cursor
      ? { cursor: search.cursor }
      : {}),
    ...(typeof search.trail === "string" && search.trail
      ? { trail: search.trail }
      : {}),
  }),
  loader: ({ location }) => {
    const search = location.search as {
      q?: string
      status?: string
      application?: string
      cursor?: string
    }
    return listMonitorPage({
      data: {
        query: search.q,
        status: search.status,
        applicationId: search.application,
        cursor: search.cursor,
        limit: 25,
      },
    })
  },
  component: MonitorsPage,
})

const STATUS_FILTER_OPTIONS: [MonitorStatus, string][] = [
  ["healthy", "Healthy"],
  ["failing", "Failing"],
  ["warning", "Warning"],
  ["paused", "Paused"],
  ["unknown", "Unknown"],
]

const FILTER_ALL_LABELS: Record<string, string> = {
  Status: "All statuses",
  Application: "All applications",
}

function MonitorsPage() {
  const { monitors, applications, total, nextCursor } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const query = search.q ?? ""
  const status = search.status ?? ""
  const applicationId = search.application ?? ""
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTargets, setDeleteTargets] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [bulkPending, setBulkPending] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const importCreationId = useRef("")
  const [queryInput, setQueryInput] = useState(query)
  const hasActiveFilters = Boolean(query.trim() || status || applicationId)
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(search.page ?? 1, pageCount)
  const visible = monitors
  const visibleIDs = visible.map((monitor) => monitor.id)
  const allVisibleSelected =
    visibleIDs.length > 0 && visibleIDs.every((id) => selected.has(id))
  const someVisibleSelected = visibleIDs.some((id) => selected.has(id))

  useEffect(() => setQueryInput(query), [query])
  useEffect(() => {
    if (queryInput === query) return
    const timer = window.setTimeout(() => {
      void navigate({
        search: (previous) => ({
          ...previous,
          q: queryInput || undefined,
          page: undefined,
          cursor: undefined,
          trail: undefined,
        }),
        replace: true,
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [navigate, query, queryInput])

  function updateSearch(
    patch: Partial<{
      q: string | undefined
      status: string | undefined
      application: string | undefined
      page: number | undefined
      cursor: string | undefined
      trail: string | undefined
    }>
  ) {
    const filtersChanged =
      Object.hasOwn(patch, "q") ||
      Object.hasOwn(patch, "status") ||
      Object.hasOwn(patch, "application")
    void navigate({
      search: (previous) => ({
        ...previous,
        ...patch,
        ...(filtersChanged
          ? { page: undefined, cursor: undefined, trail: undefined }
          : {}),
      }),
      replace: true,
    })
  }

  function toggleMonitor(monitorID: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(monitorID)
      else next.delete(monitorID)
      return next
    })
  }

  function toggleAllVisible(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const id of visibleIDs) {
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

  async function importMonitor(draft: ImportedMonitorDraft) {
    importCreationId.current ||= crypto.randomUUID()
    const name = draft.name.slice(0, 255)
    const result = await createMonitor({
      data: {
        creationId: importCreationId.current,
        name,
        slug: uniqueImportSlug(name, monitors.map((monitor) => monitor.slug)),
        description: draft.description.slice(0, 2000),
        ownerId: "",
        tags: ["imported", draft.source],
        definition: draft.definition,
        enabled: false,
        schedule: {
          type: "MANUAL",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          jitterSeconds: 0,
          concurrencyPolicy: "SKIP_IF_RUNNING",
          missedRunPolicy: "SKIP",
        },
      },
    })
    if (!result.ok) {
      if (result.monitorId) {
        const monitorId = result.monitorId
        importCreationId.current = ""
        toast.warning(
          `${result.message} The imported draft is available for review.`
        )
        await router.invalidate()
        await navigate({
          to: "/monitors/$monitorId/edit",
          params: { monitorId },
        })
        return
      }
      throw new Error(result.message)
    }
    importCreationId.current = ""
    toast.success(
      `${draft.source === "postman" ? "Postman collection" : "cURL request"} imported as a draft monitor.`
    )
    await router.invalidate()
    await navigate({
      to: "/monitors/$monitorId/edit",
      params: { monitorId: result.monitor.id },
    })
  }

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError("")
    const result = await permanentlyDeleteMonitors({
      data: { monitorIds: deleteTargets },
    })
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.message)
      return
    }
    setDeleteOpen(false)
    setSelected((current) => {
      const next = new Set(current)
      for (const id of deleteTargets) next.delete(id)
      return next
    })
    setDeleteTargets([])
    toast.success(
      `${deleteTargets.length} monitor${deleteTargets.length === 1 ? "" : "s"} permanently deleted.`
    )
    await router.invalidate()
  }

  async function bulkAction(action: "enable" | "disable" | "archive") {
    setBulkPending(action)
    setDeleteError("")
    const results = await Promise.all(
      [...selected].map((monitorId) =>
        mutateMonitor({ data: { monitorId, action } })
      )
    )
    setBulkPending("")
    const failed = results.filter((result) => !result.ok)
    if (failed.length) {
      setDeleteError(
        `${failed.length} selected monitor${failed.length === 1 ? "" : "s"} could not be updated. Check publish and archive state.`
      )
    } else {
      setSelected(new Set())
      toast.success(
        `${results.length} monitor${results.length === 1 ? "" : "s"} updated.`
      )
    }
    await router.invalidate()
  }

  const targetNames = monitors
    .filter((monitor) => deleteTargets.includes(monitor.id))
    .map((monitor) => monitor.name)

  function SelectAllCheckbox() {
    return (
      <Checkbox
        aria-label="Select all visible monitors"
        aria-checked={
          someVisibleSelected && !allVisibleSelected
            ? "mixed"
            : allVisibleSelected
        }
        checked={allVisibleSelected}
        onCheckedChange={(checked) => toggleAllVisible(checked === true)}
      />
    )
  }

  return (
    <PageContainer>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Monitors
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define, publish, and operate synthetic API workflows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => setImportOpen(true)}
          >
            <Upload data-icon="inline-start" /> Import
          </Button>
          <Button
            render={<Link to="/monitors/new" />}
            nativeButton={false}
            size="lg"
          >
            <Plus data-icon="inline-start" /> New monitor
          </Button>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center">
        <div className="relative w-full max-w-md">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search monitors"
            className="h-9 pl-9"
            placeholder="Search by name, application, slug, or tag"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 lg:ml-auto">
          <ListFilter
            label="Status"
            value={status}
            onChange={(value) => updateSearch({ status: value })}
            options={STATUS_FILTER_OPTIONS}
          />
          <ListFilter
            label="Application"
            value={applicationId}
            onChange={(value) => updateSearch({ application: value })}
            options={applications.map((application) => [
              application.id,
              application.name,
            ])}
          />
        </div>
      </div>

      {selected.size ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-primary/8 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-medium">
              {selected.size} monitor{selected.size === 1 ? "" : "s"} selected
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Enable, pause, archive, or permanently delete the selected
              monitors.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!!bulkPending}
              type="button"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
            <Button
              disabled={!!bulkPending}
              type="button"
              variant="outline"
              onClick={() => void bulkAction("enable")}
            >
              <Play /> Enable
            </Button>
            <Button
              disabled={!!bulkPending}
              type="button"
              variant="outline"
              onClick={() => void bulkAction("disable")}
            >
              <Pause /> Pause
            </Button>
            <Button
              disabled={!!bulkPending}
              type="button"
              variant="outline"
              onClick={() => void bulkAction("archive")}
            >
              <Archive /> Archive
            </Button>
            <Button
              disabled={!!bulkPending}
              type="button"
              variant="destructive"
              onClick={() => requestDelete([...selected])}
            >
              <Trash2 data-icon="inline-start" /> Delete permanently
            </Button>
          </div>
        </div>
      ) : null}
      {deleteError && !deleteOpen ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {deleteError}
        </p>
      ) : null}

      {visible.length ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-b-0 rounded-b-none bg-muted/45 px-4 py-2.5 lg:hidden">
          <SelectAllCheckbox />
          <span className="text-xs font-medium text-muted-foreground">
            Select all on this page
          </span>
        </div>
      ) : null}

      <div
        className={`overflow-hidden rounded-xl border ${visible.length ? "mt-0 rounded-t-none border-t-0 lg:mt-4 lg:rounded-t-xl lg:border-t" : "mt-4"}`}
      >
        <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/45 hover:bg-muted/45">
                <TableHead className="w-10">
                  <SelectAllCheckbox />
                </TableHead>
                <TableHead>Monitor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Application</TableHead>
                <TableHead>Success · 24h</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((monitor) => (
                <TableRow
                  className={
                    selected.has(monitor.id) ? "bg-primary/5" : undefined
                  }
                  key={`desktop-${monitor.id}`}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${monitor.name}`}
                      checked={selected.has(monitor.id)}
                      onCheckedChange={(checked) =>
                        toggleMonitor(monitor.id, checked === true)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Workflow
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <Link
                          className="truncate text-sm font-medium hover:underline"
                          params={{ monitorId: monitor.id }}
                          to="/monitors/$monitorId"
                        >
                          {monitor.name}
                        </Link>
                      </div>
                      <p className="mt-1 truncate pl-6 text-xs text-muted-foreground">
                        {monitor.description}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <OperationalStatusBadge
                      status={listMonitorOperationalStatus(
                        monitor.status,
                        monitor.successRate
                      )}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {monitor.application}
                  </TableCell>
                  <TableCell>
                    <AvailabilityValue value={monitor.successRate} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {monitor.lastRun}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <RunButton monitor={monitor} />
                      <Button
                        aria-label={`View run history for ${monitor.name}`}
                        render={
                          <Link
                            params={{ monitorId: monitor.id }}
                            to="/monitors/$monitorId/runs"
                          />
                        }
                        nativeButton={false}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <History />
                      </Button>
                      <Button
                        aria-label={`View metrics for ${monitor.name}`}
                        render={
                          <Link
                            params={{ monitorId: monitor.id }}
                            to="/monitors/$monitorId/metrics"
                          />
                        }
                        nativeButton={false}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <ChartNoAxesCombined />
                      </Button>
                      <MonitorActions
                        monitor={monitor}
                        onDelete={() => requestDelete([monitor.id])}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <ul className="divide-y lg:hidden">
          {visible.map((monitor) => (
            <li
              className={`grid grid-cols-[24px_1fr] gap-3 px-4 py-4 ${selected.has(monitor.id) ? "bg-primary/5" : ""}`}
              key={`mobile-${monitor.id}`}
            >
              <Checkbox
                aria-label={`Select ${monitor.name}`}
                checked={selected.has(monitor.id)}
                onCheckedChange={(checked) =>
                  toggleMonitor(monitor.id, checked === true)
                }
              />
              <div className="min-w-0 space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Workflow
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <Link
                      className="truncate text-sm font-medium hover:underline"
                      params={{ monitorId: monitor.id }}
                      to="/monitors/$monitorId"
                    >
                      {monitor.name}
                    </Link>
                  </div>
                  <p className="mt-1 truncate pl-6 text-xs text-muted-foreground">
                    {monitor.description}
                  </p>
                  <p className="mt-1 pl-6 text-xs text-muted-foreground">
                    {monitor.cadence}
                  </p>
                </div>
                <dl className="grid gap-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-xs font-medium text-muted-foreground">
                      Status
                    </dt>
                    <dd>
                      <OperationalStatusBadge
                        status={listMonitorOperationalStatus(
                          monitor.status,
                          monitor.successRate
                        )}
                      />
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-xs font-medium text-muted-foreground">
                      Application
                    </dt>
                    <dd className="text-muted-foreground">
                      {monitor.application}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-xs font-medium text-muted-foreground">
                      Success · 24h
                    </dt>
                    <dd>
                      <AvailabilityValue value={monitor.successRate} />
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-xs font-medium text-muted-foreground">
                      Last run
                    </dt>
                    <dd className="text-muted-foreground">{monitor.lastRun}</dd>
                  </div>
                </dl>
                <div className="flex justify-end gap-1">
                  <RunButton monitor={monitor} />
                  <Button
                    aria-label={`View run history for ${monitor.name}`}
                    render={
                      <Link
                        params={{ monitorId: monitor.id }}
                        to="/monitors/$monitorId/runs"
                      />
                    }
                    nativeButton={false}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <History />
                  </Button>
                  <Button
                    aria-label={`View metrics for ${monitor.name}`}
                    render={
                      <Link
                        params={{ monitorId: monitor.id }}
                        to="/monitors/$monitorId/metrics"
                      />
                    }
                    nativeButton={false}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <ChartNoAxesCombined />
                  </Button>
                  <MonitorActions
                    monitor={monitor}
                    onDelete={() => requestDelete([monitor.id])}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>

        {!monitors.length && !hasActiveFilters ? (
          <PageEmptyState
            className="mt-0 border-0"
            title="No monitors yet"
            description="Create a monitor to start publishing and operating synthetic API workflows."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setImportOpen(true)}
                >
                  <Upload data-icon="inline-start" /> Import collection
                </Button>
                <Button
                  render={<Link to="/monitors/new" />}
                  nativeButton={false}
                >
                  <Plus data-icon="inline-start" /> New monitor
                </Button>
              </div>
            }
          />
        ) : !monitors.length ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium">No monitors match</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasActiveFilters
                ? "Try a different name, application, slug, tag, or clear filters."
                : "Try a different name, application, slug, or tag."}
            </p>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>
          Showing {monitors.length ? (page - 1) * pageSize + 1 : 0}–
          {Math.min(page * pageSize, total)} of {total} matching monitors
        </p>
        <div className="flex items-center gap-2">
          <Button
            aria-label="Previous monitor page"
            disabled={page === 1}
            onClick={() => {
              const trail = decodeCursorTrail(search.trail)
              const previousCursor = trail.pop()
              updateSearch({
                page: Math.max(1, page - 1),
                cursor:
                  previousCursor && previousCursor !== "~"
                    ? previousCursor
                    : undefined,
                trail: encodeCursorTrail(trail),
              })
            }}
            size="sm"
            variant="outline"
          >
            Previous
          </Button>
          <span>
            Page {page} of {pageCount}
          </span>
          <Button
            aria-label="Next monitor page"
            disabled={!nextCursor}
            onClick={() => {
              const trail = decodeCursorTrail(search.trail)
              trail.push(search.cursor ?? "~")
              updateSearch({
                page: Math.min(pageCount, page + 1),
                cursor: nextCursor,
                trail: encodeCursorTrail(trail),
              })
            }}
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </div>
      </div>

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
                ? "monitor"
                : `${deleteTargets.length} monitors`}{" "}
              permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Rhythm will permanently remove{" "}
              {deleteTargets.length === 1 ? (
                <strong>{targetNames[0]}</strong>
              ) : (
                "the selected monitors"
              )}{" "}
              and all associated revisions, schedules, runs, diagnostics,
              alerts, and captured evidence.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTargets.length > 1 ? (
            <ul className="max-h-36 overflow-auto rounded-lg bg-muted/45 px-3 py-2 text-sm">
              {targetNames.map((name) => (
                <li className="truncate py-1" key={name}>
                  {name}
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
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              {deleting ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <MonitorImportDialog
        open={importOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) importCreationId.current = ""
          setImportOpen(nextOpen)
        }}
        onImport={importMonitor}
        actionLabel="Import as draft"
      />
    </PageContainer>
  )
}

function uniqueImportSlug(name: string, existing: string[]) {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 220) || "imported-monitor"
  const used = new Set(existing)
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function positivePage(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function decodeCursorTrail(value: string | undefined) {
  return value ? value.split(".").filter(Boolean) : []
}

function encodeCursorTrail(values: string[]) {
  return values.length ? values.join(".") : undefined
}

function formatAvailabilityPercent(value: number) {
  const rounded = Math.round(value * 10) / 10
  if (Number.isInteger(rounded)) return `${rounded}%`
  return `${rounded.toFixed(1)}%`
}

function availabilityToneClass(value: number) {
  if (value >= 99) return "text-success"
  if (value >= 95) return "text-warning-foreground"
  return "text-destructive"
}

function AvailabilityValue({ value }: { value: number | null }) {
  if (value === null || Number.isNaN(value)) {
    return <span className="text-sm text-muted-foreground">Not captured</span>
  }
  return (
    <span className={`font-mono text-sm ${availabilityToneClass(value)}`}>
      {formatAvailabilityPercent(value)}
    </span>
  )
}

function RunButton({
  monitor,
}: {
  monitor: ReturnType<typeof Route.useLoaderData>["monitors"][number]
}) {
  const [state, setState] = useState<"idle" | "running" | "success" | "failed">(
    "idle"
  )
  const [message, setMessage] = useState("")

  async function execute() {
    setState("running")
    setMessage("")
    const result = await runMonitor({
      data: { monitorId: monitor.id, revision: "draft" },
    })
    if (!result.ok) {
      setState("failed")
      setMessage(result.message)
      return
    }
    if (["QUEUED", "STARTING", "RUNNING"].includes(result.run.status)) {
      setState("success")
      setMessage("Run queued. Open run history for live diagnostics.")
    } else if (
      result.run.status === "SUCCESS" ||
      result.run.status === "SUCCESS_WITH_WARNINGS"
    ) {
      setState("success")
      setMessage(`Succeeded in ${result.run.durationMs} ms`)
    } else {
      setState("failed")
      setMessage(
        `${result.run.failureCategory ?? "Run failed"}: ${result.run.failureReason ?? "Check run diagnostics."}`
      )
    }
  }

  const label =
    state === "running"
      ? `Running ${monitor.name}`
      : state === "success"
        ? `${monitor.name}: ${message}`
        : state === "failed"
          ? `${monitor.name}: ${message}`
          : `Run draft ${monitor.name}`
  return (
    <Button
      type="button"
      aria-label={label}
      title={message || "Run current draft"}
      disabled={monitor.stepCount === 0 || state === "running"}
      onClick={execute}
      size="icon-sm"
      variant="ghost"
    >
      {state === "running" ? (
        <LoaderCircle className="animate-spin" />
      ) : state === "success" ? (
        <Check className="text-success" />
      ) : state === "failed" ? (
        <CircleAlert className="text-destructive" />
      ) : (
        <Play />
      )}
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
    </Button>
  )
}

function MonitorActions({
  monitor,
  onDelete,
}: {
  monitor: ReturnType<typeof Route.useLoaderData>["monitors"][number]
  onDelete: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  async function act(
    action: "publish" | "enable" | "disable" | "archive" | "restore" | "clone"
  ) {
    setPending(action)
    setMessage("")
    const result = await mutateMonitor({
      data: {
        monitorId: monitor.id,
        action,
        name: `${monitor.name} copy`,
        slug: `${monitor.slug}-copy-${Date.now().toString().slice(-6)}`,
      },
    })
    setPending(null)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setMessage(`${action[0].toUpperCase()}${action.slice(1)} completed`)
    await router.invalidate()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`More actions for ${monitor.name}`}
              disabled={pending !== null}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          {pending ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <MoreHorizontal />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            render={
              <Link
                params={{ monitorId: monitor.id }}
                to="/monitors/$monitorId/edit"
              />
            }
          >
            <FilePenLine /> Edit draft
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <Link
                params={{ monitorId: monitor.id }}
                to="/monitors/$monitorId/revisions"
              />
            }
          >
            <FileClock /> View revisions
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={monitor.state === "ARCHIVED"}
            onClick={() => act("publish")}
          >
            <Rocket /> Publish draft
          </DropdownMenuItem>
          {monitor.enabled ? (
            <DropdownMenuItem onClick={() => act("disable")}>
              <Pause /> Disable
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={
                !(["PUBLISHED", "DISABLED"] as string[]).includes(monitor.state)
              }
              onClick={() => act("enable")}
            >
              <Play /> Enable
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => act("clone")}>
            <Copy /> Clone monitor
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {monitor.state === "ARCHIVED" ? (
            <DropdownMenuItem onClick={() => act("restore")}>
              <RotateCcw /> Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => act("archive")}
            >
              <Archive /> Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 /> Delete permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
    </>
  )
}

function ListFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[][]
}) {
  const allLabel = FILTER_ALL_LABELS[label] ?? `All ${label.toLowerCase()}`
  return (
    <label className="text-xs font-medium">
      <span className="sr-only">{label}</span>
      <Select
        value={value || null}
        onValueChange={(next) => onChange(next ?? "")}
        items={[
          { value: null, label: allLabel },
          ...options.map(([optionValue, optionLabel]) => ({
            value: optionValue,
            label: optionLabel,
          })),
        ]}
      >
        <SelectTrigger className="h-9 min-w-36 font-normal">
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>{allLabel}</SelectItem>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
