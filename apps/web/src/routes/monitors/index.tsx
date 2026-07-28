import { useMemo, useState } from "react"
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
  Workflow,
} from "lucide-react"

import type { MonitorStatus } from "@/features/monitors/seed-data"
import {
  fromMonitorSummaryStatus,
  OperationalStatusBadge,
} from "@/components/operational-status"
import {
  listMonitors,
  mutateMonitor,
  permanentlyDeleteMonitors,
  runMonitor,
} from "@/lib/api-client/monitors"

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
  }),
  loader: () => listMonitors(),
  component: MonitorsPage,
})

const STATUS_FILTER_OPTIONS: [MonitorStatus, string][] = [
  ["healthy", "Healthy"],
  ["failing", "Failing"],
  ["warning", "Warning"],
  ["paused", "Paused"],
  ["unknown", "Unknown"],
]

function MonitorsPage() {
  const { monitors, applications } = Route.useLoaderData()
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
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      monitors.filter((monitor) => {
        if (status && monitor.status !== status) return false
        if (applicationId && monitor.applicationId !== applicationId)
          return false
        if (!normalizedQuery) return true
        return [
          monitor.name,
          monitor.description,
          monitor.application,
          monitor.slug,
        ].some((value) => value.toLowerCase().includes(normalizedQuery))
      }),
    [monitors, status, applicationId, normalizedQuery]
  )
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(search.page ?? 1, pageCount)
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const visibleIDs = visible.map((monitor) => monitor.id)
  const allVisibleSelected =
    visibleIDs.length > 0 && visibleIDs.every((id) => selected.has(id))
  const someVisibleSelected = visibleIDs.some((id) => selected.has(id))

  function updateSearch(
    patch: Partial<{
      q: string
      status: string
      application: string
      page: number
    }>
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
  return (
    <div className="mx-auto max-w-[1480px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Monitors
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define, publish, and operate synthetic API workflows.
          </p>
        </div>
        <Button
          render={<Link to="/monitors/new" />}
          nativeButton={false}
          size="lg"
        >
          <Plus data-icon="inline-start" /> New monitor
        </Button>
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
            placeholder="Search by name or tag"
            value={query}
            onChange={(event) => updateSearch({ q: event.target.value })}
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

      <div className="mt-4 overflow-hidden rounded-xl border">
        <div className="hidden grid-cols-[24px_minmax(270px,1.5fr)_115px_120px_110px_100px_90px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
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
          <span>Monitor</span>
          <span>Status</span>
          <span>Application</span>
          <span>Success · 24h</span>
          <span>Last run</span>
          <span className="text-right">Actions</span>
        </div>
        {visible.map((monitor) => (
          <div
            className={`grid grid-cols-[24px_1fr] gap-3 border-b px-4 py-4 last:border-b-0 hover:bg-muted/25 lg:grid-cols-[24px_minmax(270px,1.5fr)_115px_120px_110px_100px_90px] lg:items-center lg:gap-4 ${selected.has(monitor.id) ? "bg-primary/5" : ""}`}
            key={monitor.id}
          >
            <Checkbox
              aria-label={`Select ${monitor.name}`}
              checked={selected.has(monitor.id)}
              onCheckedChange={(checked) =>
                toggleMonitor(monitor.id, checked === true)
              }
            />
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
              <p className="mt-1 pl-6 text-xs text-muted-foreground lg:hidden">
                {monitor.application} · {monitor.cadence}
              </p>
            </div>
            <div className="col-start-2 lg:col-auto">
              <OperationalStatusBadge
                status={fromMonitorSummaryStatus(monitor.status)}
              />
            </div>
            <span className="col-start-2 text-sm text-muted-foreground lg:col-auto">
              {monitor.application}
            </span>
            <AvailabilityCell value={monitor.successRate} />
            <span className="col-start-2 text-sm text-muted-foreground lg:col-auto">
              {monitor.lastRun}
            </span>
            <div className="col-start-2 flex justify-end gap-1 lg:col-auto">
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
        ))}
        {!filtered.length ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium">No monitors found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a different name, application, tag, or slug.
            </p>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>
          Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–
          {Math.min(page * pageSize, filtered.length)} of {filtered.length}{" "}
          matching monitors · {monitors.length} total
        </p>
        <div className="flex items-center gap-2">
          <Button
            aria-label="Previous monitor page"
            disabled={page === 1}
            onClick={() => updateSearch({ page: Math.max(1, page - 1) })}
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
            disabled={page === pageCount}
            onClick={() =>
              updateSearch({ page: Math.min(pageCount, page + 1) })
            }
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
    </div>
  )
}

function positivePage(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
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

function AvailabilityCell({ value }: { value: number | null }) {
  if (value === null || Number.isNaN(value)) {
    return (
      <span className="col-start-2 text-sm text-muted-foreground lg:col-auto">
        Not captured
      </span>
    )
  }
  return (
    <span
      className={`col-start-2 font-mono text-sm lg:col-auto ${availabilityToneClass(value)}`}
    >
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
  const allLabel = `All ${label.toLowerCase()}s`
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
