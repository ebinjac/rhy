import { useMemo, useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Activity,
  CircleAlert,
  Clock3,
  MonitorCheck,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "@workspace/ui/components/sonner"

import { PageContainer } from "@/components/page-container"
import { PageEmptyState } from "@/components/page-empty-state"
import {
  BrowserHealthBadge,
  formatFrequency,
} from "@/features/ui-monitoring/browser-monitor-status"
import {
  deleteBrowserMonitor,
  listBrowserMonitors,
} from "@/lib/api-client/browser-monitoring"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/ui-monitoring/")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(typeof search.health === "string" && search.health
      ? { health: search.health }
      : {}),
  }),
  loader: () => listBrowserMonitors(),
  component: UIMonitoringPage,
})

function UIMonitoringPage() {
  const monitors = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const query = (search.q ?? "").trim().toLowerCase()
  const health = search.health ?? "ALL"
  const filtered = useMemo(
    () =>
      monitors.filter((monitor) => {
        if (
          health !== "ALL" &&
          (health === "PAUSED"
            ? monitor.enabled
            : !monitor.enabled || monitor.health !== health)
        )
          return false
        if (!query) return true
        return [
          monitor.name,
          monitor.description ?? "",
          monitor.applicationName ?? "",
          monitor.serviceName ?? "",
          monitor.slug,
        ].some((value) => value.toLowerCase().includes(query))
      }),
    [health, monitors, query]
  )
  const failing = monitors.filter(
    (monitor) => monitor.enabled && monitor.health === "FAILING"
  ).length
  const scheduled = monitors.filter((monitor) => monitor.enabled).length

  async function removeMonitor() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteBrowserMonitor({
        data: { monitorId: deleteTarget.id },
      })
      toast.success("UI monitor permanently deleted")
      setDeleteTarget(null)
      await router.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The UI monitor was not deleted."
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <PageContainer as="main">
      <header className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            UI monitoring
          </h1>
          <p className="mt-1 max-w-2xl text-sm/6 text-muted-foreground">
            Validate page readiness, critical browser journeys, visual
            checkpoints, graphs, accessibility, and controlled synthetic
            performance.
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link to="/ui-monitoring/new" />}
          size="lg"
        >
          <Plus />
          Create UI monitor
        </Button>
      </header>

      <section
        aria-label="UI monitoring summary"
        className="mt-7 grid divide-y rounded-lg border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        <Summary
          icon={MonitorCheck}
          label="Browser monitors"
          value={String(monitors.length)}
          detail="Published browser journeys"
        />
        <Summary
          icon={Clock3}
          label="Scheduled"
          value={String(scheduled)}
          detail="Running continuously"
        />
        <Summary
          critical={failing > 0}
          icon={failing ? CircleAlert : Activity}
          label="Need attention"
          value={String(failing)}
          detail={
            failing
              ? "Inspect the latest failed journeys"
              : "No current browser failure"
          }
        />
      </section>

      <section className="mt-8" aria-labelledby="browser-monitor-list">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h2 className="sr-only" id="browser-monitor-list">
            Browser monitors
          </h2>
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search UI monitors"
              className="h-11 pl-9 sm:h-9"
              onChange={(event) =>
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    q: event.target.value || undefined,
                  }),
                  replace: true,
                })
              }
              placeholder="Search by monitor, application, or service"
              value={search.q ?? ""}
            />
          </div>
          <Select
            onValueChange={(value) =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  health: value === "ALL" ? undefined : (value ?? undefined),
                }),
                replace: true,
              })
            }
            value={health}
          >
            <SelectTrigger
              aria-label="Filter by health"
              className="h-11 w-full sm:h-9 sm:w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All health states</SelectItem>
              <SelectItem value="HEALTHY">Healthy</SelectItem>
              <SelectItem value="DEGRADED">Degraded</SelectItem>
              <SelectItem value="FAILING">Failing</SelectItem>
              <SelectItem value="NO_SIGNAL">No signal</SelectItem>
              <SelectItem value="PAUSED">Paused</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground sm:ml-auto">
            {filtered.length} of {monitors.length}
          </p>
        </div>

        {!monitors.length ? (
          <PageEmptyState
            className="mt-6 min-h-80 justify-center"
            icon={<MonitorCheck aria-hidden="true" />}
            title="Monitor a real browser journey"
            description="Begin with a start URL and page-readiness checkpoint. Add user actions, graph rules, visual baselines, and performance budgets when the journey needs them."
            action={
              <Button
                nativeButton={false}
                render={<Link to="/ui-monitoring/new" />}
              >
                <Plus />
                Create first UI monitor
              </Button>
            }
          />
        ) : !filtered.length ? (
          <PageEmptyState
            className="mt-6"
            title="No UI monitor matches these filters."
            description="Clear filters to see the full UI monitor inventory."
            action={
              <Button
                onClick={() => void navigate({ search: {}, replace: true })}
                variant="outline"
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <div className="mt-4 hidden overflow-hidden rounded-xl border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Monitor</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Application / service</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Latest run</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((monitor) => (
                    <TableRow key={monitor.id}>
                      <TableCell>
                        <Link
                          className="font-medium hover:text-primary hover:underline"
                          params={{ monitorId: monitor.id }}
                          to="/ui-monitoring/$monitorId"
                        >
                          {monitor.name}
                        </Link>
                        <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                          {monitor.description || monitor.slug}
                        </p>
                      </TableCell>
                      <TableCell>
                        <BrowserHealthBadge monitor={monitor} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {monitor.applicationName || "Not linked"}
                        {monitor.serviceName ? (
                          <span className="block text-xs text-muted-foreground">
                            {monitor.serviceName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        {monitor.enabled
                          ? formatFrequency(monitor.frequencySeconds)
                          : "Paused"}
                        <span className="block text-xs text-muted-foreground">
                          {monitor.nextRunAt
                            ? `Next ${formatDateTime(monitor.nextRunAt)}`
                            : "No next execution"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {monitor.lastStatus
                          ?.replaceAll("_", " ")
                          .toLowerCase() ?? "Not run"}
                        <span className="block text-xs text-muted-foreground">
                          {monitor.lastRunAt
                            ? formatDateTime(monitor.lastRunAt)
                            : "No evidence yet"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                aria-label={`Actions for ${monitor.name}`}
                                size="icon"
                                variant="ghost"
                              />
                            }
                          >
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              render={
                                <Link
                                  params={{ monitorId: monitor.id }}
                                  to="/ui-monitoring/$monitorId/journey"
                                />
                              }
                            >
                              Edit journey
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() =>
                                setDeleteTarget({
                                  id: monitor.id,
                                  name: monitor.name,
                                })
                              }
                            >
                              <Trash2 />
                              Delete permanently
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 grid gap-3 md:hidden">
              {filtered.map((monitor) => (
                <article className="rounded-xl border p-4" key={monitor.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        className="font-medium hover:text-primary hover:underline"
                        params={{ monitorId: monitor.id }}
                        to="/ui-monitoring/$monitorId"
                      >
                        {monitor.name}
                      </Link>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {monitor.applicationName || "No application"}
                        {monitor.serviceName ? ` · ${monitor.serviceName}` : ""}
                      </p>
                    </div>
                    <BrowserHealthBadge monitor={monitor} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Schedule
                      </dt>
                      <dd className="mt-0.5">
                        {monitor.enabled
                          ? formatFrequency(monitor.frequencySeconds)
                          : "Paused"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Latest outcome
                      </dt>
                      <dd className="mt-0.5">
                        {monitor.lastStatus
                          ?.replaceAll("_", " ")
                          .toLowerCase() ?? "Not run"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex gap-2">
                    <Button
                      className="h-11 flex-1"
                      nativeButton={false}
                      render={
                        <Link
                          params={{ monitorId: monitor.id }}
                          to="/ui-monitoring/$monitorId"
                        />
                      }
                      variant="outline"
                    >
                      View monitor
                    </Button>
                    <Button
                      aria-label={`Delete ${monitor.name}`}
                      className="size-11"
                      onClick={() =>
                        setDeleteTarget({ id: monitor.id, name: monitor.name })
                      }
                      size="icon"
                      variant="destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete this UI monitor?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} and its revisions, run history, screenshots,
              visual baselines, and browser evidence will be permanently
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              Keep monitor
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void removeMonitor()
              }}
              variant="destructive"
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  )
}

function Summary({
  icon: Icon,
  label,
  value,
  detail,
  critical = false,
}: {
  icon: typeof MonitorCheck
  label: string
  value: string
  detail: string
  critical?: boolean
}) {
  return (
    <div className="p-4 md:p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon
          aria-hidden="true"
          className={
            critical ? "size-4 text-destructive" : "size-4 text-primary"
          }
        />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
