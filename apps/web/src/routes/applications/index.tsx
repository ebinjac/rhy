import { useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
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
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  AppWindow,
  BellRing,
  FilePenLine,
  Layers3,
  LoaderCircle,
  Mail,
  MoreHorizontal,
  Plus,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react"

import { FormField } from "@/features/applications/form-field"
import type { ELFApplicationContract } from "@/lib/api-client/contracts"
import {
  deleteELFApplication,
  listELFApplications,
  listELFQueries,
  saveELFApplication,
} from "@/lib/api-client/elf"
import { listUnifiedAlerts } from "@/lib/api-client/opensearch-alerts"
import { PageContainer } from "@/components/page-container"
import { PageEmptyState } from "@/components/page-empty-state"

export const Route = createFileRoute("/applications/")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(positivePage(search.page) > 1
      ? { page: positivePage(search.page) }
      : {}),
  }),
  loader: async () => {
    const [applications, alerts, queries] = await Promise.all([
      listELFApplications(),
      listUnifiedAlerts({
        data: {
          state: "",
          sourceType: "OPENSEARCH_ALERTING",
          applicationId: "",
          serviceId: "",
          severity: "",
        },
      }),
      listELFQueries(),
    ])
    return { applications, alerts, queries }
  },
  component: ApplicationsPage,
})

function ApplicationsPage() {
  const { applications, alerts, queries } = Route.useLoaderData()
  const routeSearch = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [name, setName] = useState("")
  const [carId, setCarId] = useState("")
  const [owner, setOwner] = useState("")
  const [index, setIndex] = useState("")
  const [alertEmails, setAlertEmails] = useState("")
  const [deleteTarget, setDeleteTarget] =
    useState<ELFApplicationContract | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const query = routeSearch.q ?? ""

  function resetForm() {
    setName("")
    setCarId("")
    setOwner("")
    setIndex("")
    setAlertEmails("")
    setMessage("")
  }

  function openCreate() {
    resetForm()
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    resetForm()
  }

  async function save() {
    setPending(true)
    setMessage("")
    const parsedEmails = alertEmails
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    const result = await saveELFApplication({
      data: {
        carId,
        name,
        owner,
        environment: "",
        defaultIndexPattern: index,
        defaultTimeField: "@timestamp",
        maskingRules: [
          "authorization",
          "cookie",
          "password",
          "secret",
          "token",
          "customer.email",
        ],
        semanticMapping: {
          "@timestamp": "time",
          "log.level": "level",
          message: "message",
          "service.name": "service",
          "trace.id": "trace",
          "http.route": "endpoint",
        },
        alertEmails: parsedEmails,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    closeForm()
    await router.invalidate()
    if (result.application?.id) {
      await router.navigate({
        to: "/applications/$applicationId",
        params: { applicationId: result.application.id },
      })
    }
  }

  function requestDelete(application: ELFApplicationContract) {
    setDeleteTarget(application)
    setDeleteError("")
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError("")
    const result = await deleteELFApplication({
      data: { applicationId: deleteTarget.id },
    })
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.message)
      return
    }
    setDeleteOpen(false)
    setDeleteTarget(null)
    await router.invalidate()
  }

  const filteredApplications = applications.filter((application) => {
    const searchValue =
      `${application.name} ${application.carId ?? ""} ${application.owner ?? ""}`.toLowerCase()
    return searchValue.includes(query.trim().toLowerCase())
  })
  const pageSize = 25
  const pageCount = Math.max(
    1,
    Math.ceil(filteredApplications.length / pageSize)
  )
  const currentPage = Math.min(routeSearch.page ?? 1, pageCount)
  const visibleApplications = filteredApplications.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  return (
    <PageContainer>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-balance">
            Application registry
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Maintain CAR IDs, ownership, and the services that make up each
            internal application.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          New application
        </Button>
      </header>

      {formOpen ? (
        <section
          aria-label="Create application"
          className="mt-6 border-y bg-muted/15 py-5"
        >
          <div className="mb-4">
            <h2 className="font-medium">New application</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              CAR ID must be unique across the registry.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FormField label="Application name">
              <Input aria-label="Application name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Checkout"
              />
            </FormField>
            <FormField
              label="CAR ID"
              hint="Internal application identifier"
            >
              <Input aria-label="CAR ID"
                className="font-mono"
                maxLength={64}
                value={carId}
                onChange={(event) => setCarId(event.target.value)}
                placeholder="CAR-10428"
              />
            </FormField>
            <FormField label="Owner">
              <Input aria-label="Owner"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="Commerce Platform"
              />
            </FormField>
            <FormField label="Default ELF index pattern">
              <Input aria-label="Default ELF index pattern"
                className="font-mono"
                value={index}
                onChange={(event) => setIndex(event.target.value)}
                placeholder="checkout-logs-*"
              />
            </FormField>
            <FormField
              label="Alert destination emails"
              hint="Comma-separated. Used for monitor and OpenSearch alerts tied to this application."
            >
              <Textarea aria-label="Alert destination emails"
                className="min-h-20"
                value={alertEmails}
                onChange={(event) => setAlertEmails(event.target.value)}
                placeholder="oncall@example.com, platform@example.com"
              />
            </FormField>
          </div>
          {!alertEmails.trim() ? (
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Mail aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Add recipient emails for this application so SMTP alert delivery
              knows where to send. Global fallback addresses can also be set on
              the EMAIL channel under Configuration → Notifications.
            </p>
          ) : null}
          {message ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {message}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
            <Button disabled={pending || !name.trim()} onClick={() => void save()}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Create application
            </Button>
          </div>
        </section>
      ) : null}

      {applications.length ? (
        <section
          aria-label="Application filters"
          className="mt-7 flex flex-col gap-3 border-b pb-4 sm:flex-row"
        >
          <Input
            aria-label="Search applications"
            className="sm:max-w-sm"
            value={query}
            onChange={(event) => {
              void navigate({
                search: {
                  ...routeSearch,
                  q: event.target.value,
                  page: 1,
                },
                replace: true,
              })
            }}
            placeholder="Search name, CAR ID, or owner"
          />
        </section>
      ) : null}

      <div
        className={`${applications.length ? "mt-4" : "mt-7"} overflow-hidden rounded-xl border`}
      >
        <Table>
          <TableCaption className="sr-only">
            Registered applications with CAR ID, owner, service count, and
            operational status.
          </TableCaption>
          <TableHeader>
            <TableRow className="bg-muted/45 hover:bg-muted/45">
              <TableHead scope="col">Application</TableHead>
              <TableHead scope="col">CAR ID</TableHead>
              <TableHead className="hidden md:table-cell" scope="col">
                Owner
              </TableHead>
              <TableHead className="hidden sm:table-cell" scope="col">
                Services
              </TableHead>
              <TableHead className="hidden lg:table-cell" scope="col">
                Status
              </TableHead>
              <TableHead className="text-right" scope="col">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleApplications.map((application) => {
              const appAlerts = alerts.filter(
                (alert) => alert.applicationId === application.id
              )
              const activeAlertCount = appAlerts.filter(
                (alert) => alert.state === "OPEN" || alert.state === "ERROR"
              ).length
              return (
                <TableRow key={application.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <AppWindow
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className="truncate font-medium hover:text-primary hover:underline"
                            params={{ applicationId: application.id }}
                            to="/applications/$applicationId"
                          >
                            {application.name}
                          </Link>
                          {application.active ? (
                            <Badge
                              className="bg-success-soft text-success-foreground"
                              variant="secondary"
                            >
                              Active
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
                          {application.owner || "No owner assigned"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-sm font-medium">
                      {application.carId || "Not assigned"}
                    </code>
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] truncate text-sm text-muted-foreground md:table-cell">
                    {application.owner || "No owner assigned"}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    <span className="inline-flex items-center gap-1.5">
                      <Server aria-hidden="true" className="size-3.5" />
                      {application.services.length}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <ApplicationStatus
                      activeAlertCount={activeAlertCount}
                      monitored={
                        application.monitorIds.length > 0 ||
                        queries.some(
                          (item) => item.applicationId === application.id
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label={`More actions for ${application.name}`}
                            size="icon-sm"
                            variant="ghost"
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-48">
                        <DropdownMenuItem
                          onClick={() =>
                            void router.navigate({
                              to: "/applications/$applicationId",
                              params: { applicationId: application.id },
                            })
                          }
                        >
                          <FilePenLine /> Open workspace
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void router.navigate({
                              to: "/applications/$applicationId",
                              params: { applicationId: application.id },
                              search: { edit: true },
                            })
                          }
                        >
                          <FilePenLine /> Edit settings
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => requestDelete(application)}
                        >
                          <Trash2 /> Delete permanently
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {!applications.length ? (
          <PageEmptyState
            className="mt-0 border-0"
            icon={<Layers3 aria-hidden="true" />}
            title="No applications registered"
            description="Create an application first, then add the deployable services that belong to it."
            action={
              <Button onClick={openCreate}>
                <Plus /> New application
              </Button>
            }
          />
        ) : !visibleApplications.length ? (
          <PageEmptyState
            className="mt-0 border-0"
            title="No applications match"
            description="Adjust the search to find an application."
          />
        ) : null}
      </div>
      {applications.length ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Showing {visibleApplications.length} of{" "}
            {filteredApplications.length} matching applications
          </p>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <Button
                disabled={currentPage === 1}
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigate({
                    search: {
                      ...routeSearch,
                      page: Math.max(1, currentPage - 1),
                    },
                    replace: true,
                  })
                }
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {currentPage} of {pageCount}
              </span>
              <Button
                disabled={currentPage === pageCount}
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigate({
                    search: {
                      ...routeSearch,
                      page: Math.min(pageCount, currentPage + 1),
                    },
                    replace: true,
                  })
                }
              >
                Next
              </Button>
            </div>
          ) : null}
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
            <AlertDialogTitle>Delete application permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Rhythm will permanently remove{" "}
              <strong>{deleteTarget?.name}</strong>, its services, OpenSearch
              alert receivers, and monitor links. Historical alerts and ELF runs
              keep evidence but lose the application association. Delete or
              reassign ELF queries first if any still reference this
              application.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
              onClick={() => void confirmDelete()}
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
    </PageContainer>
  )
}

function positivePage(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function ApplicationStatus({
  activeAlertCount,
  monitored,
}: {
  activeAlertCount: number
  monitored: boolean
}) {
  if (activeAlertCount > 0) {
    return (
      <Badge className="bg-destructive/10 text-destructive" variant="secondary">
        <BellRing className="size-3" />
        {activeAlertCount} active alert{activeAlertCount === 1 ? "" : "s"}
      </Badge>
    )
  }
  if (!monitored) {
    return <Badge variant="secondary">Unmonitored</Badge>
  }
  return <span className="text-sm text-muted-foreground">Healthy</span>
}
