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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  AppWindow,
  BellRing,
  Copy,
  Mail,
  ExternalLink,
  FilePenLine,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Webhook,
} from "lucide-react"

import type {
  DeploymentValidationRunContract,
  ELFApplicationContract,
  OpenSearchAlertDeliveryContract,
  OpenSearchAlertReceiverContract,
  OpenSearchAlertSetupContract,
} from "@/lib/api-client/contracts"
import { listDeploymentValidations } from "@/lib/api-client/suites"
import {
  createELFService,
  deleteELFApplication,
  listELFApplications,
  listELFQueries,
  saveELFApplication,
} from "@/lib/api-client/elf"
import {
  getOpenSearchAlertSetup,
  listOpenSearchAlertDeliveries,
  listOpenSearchAlertReceivers,
  listUnifiedAlerts,
  receiverAction,
  saveOpenSearchAlertReceiver,
} from "@/lib/api-client/opensearch-alerts"

const ENVIRONMENT_OPTIONS = [
  "production",
  "staging",
  "development",
  "qa",
] as const

export const Route = createFileRoute("/applications/")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(typeof search.environment === "string" &&
    search.environment &&
    search.environment !== "ALL"
      ? { environment: search.environment }
      : {}),
    ...(positivePage(search.page) > 1
      ? { page: positivePage(search.page) }
      : {}),
  }),
  loader: async () => {
    const [applications, receivers, alerts, deploymentRuns, queries] =
      await Promise.all([
        listELFApplications(),
        listOpenSearchAlertReceivers({ data: { applicationId: "" } }),
        listUnifiedAlerts({
          data: {
            state: "",
            sourceType: "OPENSEARCH_ALERTING",
            applicationId: "",
            serviceId: "",
            severity: "",
          },
        }),
        listDeploymentValidations(),
        listELFQueries(),
      ])
    return { applications, receivers, alerts, deploymentRuns, queries }
  },
  component: ApplicationsPage,
})

function ApplicationsPage() {
  const { applications, receivers, alerts, deploymentRuns, queries } =
    Route.useLoaderData()
  const routeSearch = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [name, setName] = useState("")
  const [carId, setCarId] = useState("")
  const [owner, setOwner] = useState("")
  const [environment, setEnvironment] = useState("production")
  const [index, setIndex] = useState("")
  const [alertEmails, setAlertEmails] = useState("")
  const [deleteTarget, setDeleteTarget] =
    useState<ELFApplicationContract | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const query = routeSearch.q ?? ""
  const environmentFilter = routeSearch.environment ?? "ALL"

  const editingApplication = editingId
    ? applications.find((item) => item.id === editingId)
    : undefined

  function resetForm() {
    setEditingId(null)
    setName("")
    setCarId("")
    setOwner("")
    setEnvironment("production")
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
        id: editingId ?? undefined,
        carId,
        name,
        owner,
        environment,
        defaultIndexPattern: index,
        defaultTimeField: editingApplication?.defaultTimeField ?? "@timestamp",
        maskingRules: editingApplication?.maskingRules ?? [
          "authorization",
          "cookie",
          "password",
          "secret",
          "token",
          "customer.email",
        ],
        semanticMapping: editingApplication?.semanticMapping ?? {
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
    if (!editingId) {
      closeForm()
    } else {
      setMessage("")
    }
    await router.invalidate()
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
    if (editingId === deleteTarget.id) {
      closeForm()
    }
    setDeleteTarget(null)
    await router.invalidate()
  }

  const environmentChoices = Array.from(
    new Set([
      ...ENVIRONMENT_OPTIONS,
      environment,
      ...applications.map((item) => item.environment || "").filter(Boolean),
    ])
  )
  const filteredApplications = applications.filter((application) => {
    const searchValue =
      `${application.name} ${application.carId ?? ""} ${application.owner ?? ""}`.toLowerCase()
    return (
      searchValue.includes(query.trim().toLowerCase()) &&
      (environmentFilter === "ALL" ||
        application.environment === environmentFilter)
    )
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
    <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            Application registry
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Maintain CAR IDs, ownership, environments, and the services that
            make up each internal application.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          New application
        </Button>
      </header>

      {formOpen ? (
        <section
          aria-label={editingId ? "Edit application" : "Create application"}
          className="mt-6 border-y bg-muted/15 py-5"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">
                {editingId ? "Edit application" : "New application"}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                CAR ID must be unique across the registry.
              </p>
            </div>
            {editingId ? (
              <Button size="sm" variant="ghost" onClick={closeForm}>
                Close
              </Button>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Application name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Checkout"
              />
            </Field>
            <Field label="CAR ID" hint="Internal application identifier">
              <Input
                className="font-mono"
                maxLength={64}
                value={carId}
                onChange={(event) => setCarId(event.target.value)}
                placeholder="CAR-10428"
              />
            </Field>
            <Field label="Owner">
              <Input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="Commerce Platform"
              />
            </Field>
            <Field label="Environment">
              <Select
                value={environment}
                onValueChange={(value) => {
                  if (value != null) setEnvironment(value)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  {environmentChoices.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Default ELF index pattern">
              <Input
                className="font-mono"
                value={index}
                onChange={(event) => setIndex(event.target.value)}
                placeholder="checkout-logs-*"
              />
            </Field>
            <Field
              label="Alert destination emails"
              hint="Comma-separated. Used for monitor and OpenSearch alerts tied to this application."
            >
              <Textarea
                className="min-h-20"
                value={alertEmails}
                onChange={(event) => setAlertEmails(event.target.value)}
                placeholder="oncall@example.com, platform@example.com"
              />
            </Field>
          </div>
          {!alertEmails.trim() ? (
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Mail className="mt-0.5 size-3.5 shrink-0" />
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
            <Button disabled={pending || !name.trim()} onClick={save}>
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : editingId ? (
                <Save />
              ) : (
                <Plus />
              )}
              {editingId ? "Save changes" : "Create application"}
            </Button>
          </div>

          {editingApplication ? (
            <>
              <div className="my-6 border-t" />
              <ApplicationServices
                application={editingApplication}
                refresh={() => router.invalidate()}
              />
              <div className="my-6 border-t" />
              <OpenSearchReceivers
                application={editingApplication}
                receivers={receivers.filter(
                  (receiver) => receiver.applicationId === editingApplication.id
                )}
                refresh={() => router.invalidate()}
              />
              <div className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                {editingApplication.maskingRules.length} masking rules ·{" "}
                {Object.keys(editingApplication.semanticMapping).length}{" "}
                semantic fields
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {applications.length ? (
        <section
          aria-label="Application filters"
          className="mt-7 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row"
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
          <Select
            value={environmentFilter}
            onValueChange={(value) => {
              if (value != null) {
                void navigate({
                  search: {
                    ...routeSearch,
                    environment: value,
                    page: 1,
                  },
                  replace: true,
                })
              }
            }}
          >
            <SelectTrigger
              aria-label="Filter applications by environment"
              className="w-full sm:w-52"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All environments</SelectItem>
              {environmentChoices.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>
      ) : null}

      <div
        className={`${applications.length ? "mt-4" : "mt-7"} overflow-hidden rounded-xl border`}
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45 hover:bg-muted/45">
              <TableHead>Application</TableHead>
              <TableHead>CAR ID</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead className="hidden sm:table-cell">Services</TableHead>
              <TableHead className="hidden lg:table-cell">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleApplications.map((application) => {
              const appAlerts = alerts.filter(
                (alert) => alert.applicationId === application.id
              )
              const appRuns = deploymentRuns.filter(
                (run) => run.deployment.applicationId === application.id
              )
              const activeAlertCount = appAlerts.filter(
                (alert) => alert.state === "OPEN" || alert.state === "ERROR"
              ).length
              return (
                <TableRow key={application.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <AppWindow className="size-4 shrink-0 text-muted-foreground" />
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
                  <TableCell>
                    <Badge variant="secondary">
                      {application.environment || "Any environment"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    <span className="inline-flex items-center gap-1.5">
                      <Server className="size-3.5" />
                      {application.services.length}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <ApplicationStatus
                      activeAlertCount={activeAlertCount}
                      monitored={
                        application.monitorIds.length > 0 ||
                        queries.some(
                          (query) => query.applicationId === application.id
                        )
                      }
                      latestRun={appRuns[0]}
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
                            router.navigate({
                              to: "/applications/$applicationId",
                              params: { applicationId: application.id },
                            })
                          }
                        >
                          <FilePenLine /> Open workspace
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
          <div className="py-16 text-center">
            <Layers3 className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-3 font-medium">No applications registered</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Create an application first, then add the deployable services that
              belong to it.
            </p>
          </div>
        ) : !visibleApplications.length ? (
          <div className="py-12 text-center">
            <h2 className="font-medium">No applications match</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Adjust the search or environment filter.
            </p>
          </div>
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
    </main>
  )
}

function positivePage(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function ApplicationStatus({
  activeAlertCount,
  monitored,
  latestRun,
}: {
  activeAlertCount: number
  monitored: boolean
  latestRun?: DeploymentValidationRunContract
}) {
  if (activeAlertCount > 0) {
    return (
      <Badge className="bg-destructive/10 text-destructive" variant="secondary">
        <BellRing className="size-3" />
        {activeAlertCount} active alert{activeAlertCount === 1 ? "" : "s"}
      </Badge>
    )
  }
  if (latestRun?.gateDecision === "BLOCK") {
    return (
      <Badge className="bg-destructive/10 text-destructive" variant="secondary">
        Deployment blocked
      </Badge>
    )
  }
  if (latestRun?.gateDecision === "ALLOW_WITH_WARNINGS") {
    return (
      <Badge
        className="bg-warning-soft text-warning-foreground"
        variant="secondary"
      >
        Deployment warnings
      </Badge>
    )
  }
  if (!monitored) {
    return <Badge variant="secondary">Unmonitored</Badge>
  }
  return <span className="text-sm text-muted-foreground">Healthy</span>
}

function ApplicationServices({
  application,
  refresh,
}: {
  application: ELFApplicationContract
  refresh: () => Promise<void>
}) {
  const [addingService, setAddingService] = useState(false)
  const [serviceName, setServiceName] = useState("")
  const [serviceIndex, setServiceIndex] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")

  async function addService() {
    setPending(true)
    setMessage("")
    const result = await createELFService({
      data: {
        applicationId: application.id,
        name: serviceName,
        indexPattern: serviceIndex,
        timeField: "@timestamp",
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setAddingService(false)
    setServiceName("")
    setServiceIndex("")
    await refresh()
  }

  return (
    <section aria-labelledby={`services-${application.id}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id={`services-${application.id}`} className="font-medium">
            Services
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Services inherit application log settings unless overridden.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddingService((value) => !value)}
        >
          <Plus /> Add service
        </Button>
      </div>
      <div className="mt-3 divide-y border-y">
        {application.services.map((service) => (
          <div
            key={service.id}
            className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <Server className="size-4 text-muted-foreground" />
              {service.name}
            </span>
            <code className="text-xs break-all text-muted-foreground">
              {service.indexPattern ||
                application.defaultIndexPattern ||
                "ELF platform default"}
            </code>
          </div>
        ))}
        {!application.services.length ? (
          <p className="py-4 text-sm text-muted-foreground">
            No services yet. Add the first deployable service for this
            application.
          </p>
        ) : null}
      </div>
      {addingService ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Service name">
            <Input
              value={serviceName}
              onChange={(event) => setServiceName(event.target.value)}
              placeholder="checkout-api"
            />
          </Field>
          <Field label="Index override" hint="Optional">
            <Input
              className="font-mono"
              value={serviceIndex}
              onChange={(event) => setServiceIndex(event.target.value)}
              placeholder="checkout-api-*"
            />
          </Field>
          <Button
            disabled={pending || !serviceName.trim()}
            onClick={addService}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Add service
          </Button>
        </div>
      ) : null}
      {message ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  )
}

function OpenSearchReceivers({
  application,
  receivers,
  refresh,
}: {
  application: ELFApplicationContract
  receivers: OpenSearchAlertReceiverContract[]
  refresh: () => Promise<void>
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("OpenSearch production alerts")
  const [serviceId, setServiceId] = useState("")
  const [dashboardUrl, setDashboardUrl] = useState(
    "http://localhost:15601/app/alerting"
  )
  const [pending, setPending] = useState("")
  const [message, setMessage] = useState("")
  const [issuedToken, setIssuedToken] = useState("")
  const [setup, setSetup] = useState<OpenSearchAlertSetupContract | null>(null)
  const [deliveries, setDeliveries] = useState<
    OpenSearchAlertDeliveryContract[]
  >([])

  async function createReceiver() {
    setPending("create")
    setMessage("")
    const result = await saveOpenSearchAlertReceiver({
      data: {
        applicationId: application.id,
        name,
        serviceId,
        enabled: true,
        dashboardUrl,
        expectedMonitorTypes: ["QUERY_LEVEL", "BUCKET_LEVEL", "DOCUMENT_LEVEL"],
        reconciliationIntervalSeconds: 60,
      },
    })
    setPending("")
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setIssuedToken(result.receiver.token ?? "")
    const nextSetup = await getOpenSearchAlertSetup({
      data: { receiverId: result.receiver.id },
    })
    setSetup(nextSetup)
    setDeliveries([])
    setCreating(false)
    await refresh()
  }

  async function showSetup(receiverId: string) {
    setPending(`setup:${receiverId}`)
    const [nextSetup, nextDeliveries] = await Promise.all([
      getOpenSearchAlertSetup({ data: { receiverId } }),
      listOpenSearchAlertDeliveries({ data: { receiverId } }),
    ]).finally(() => setPending(""))
    setSetup(nextSetup)
    setDeliveries(nextDeliveries)
    setIssuedToken("")
  }

  async function toggleReceiver(receiver: OpenSearchAlertReceiverContract) {
    setPending(`toggle:${receiver.id}`)
    setMessage("")
    const result = await saveOpenSearchAlertReceiver({
      data: {
        receiverId: receiver.id,
        applicationId: receiver.applicationId,
        name: receiver.name,
        serviceId: receiver.serviceId ?? "",
        enabled: !receiver.enabled,
        dashboardUrl: receiver.dashboardUrl ?? "",
        expectedMonitorTypes: receiver.expectedMonitorTypes,
        reconciliationIntervalSeconds: receiver.reconciliationIntervalSeconds,
      },
    })
    setPending("")
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setMessage(receiver.enabled ? "Receiver paused." : "Receiver resumed.")
    await refresh()
  }

  async function act(
    receiver: OpenSearchAlertReceiverContract,
    action: "delete" | "rotate-token" | "test" | "reconcile"
  ) {
    if (
      action === "delete" &&
      !window.confirm(
        `Delete ${receiver.name}? OpenSearch deliveries to its URL will stop working.`
      )
    )
      return
    setPending(`${action}:${receiver.id}`)
    setMessage("")
    const result = await receiverAction({
      data: { receiverId: receiver.id, action },
    })
    setPending("")
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    if (action === "rotate-token" && result.data && "token" in result.data) {
      setIssuedToken(String(result.data.token ?? ""))
      setSetup(
        await getOpenSearchAlertSetup({ data: { receiverId: receiver.id } })
      )
    }
    setMessage(
      action === "test"
        ? "Sanitized test alert created."
        : action === "reconcile"
          ? "Reconciliation completed."
          : action === "rotate-token"
            ? "Token rotated. The previous token remains valid for 15 minutes."
            : "Receiver deleted."
    )
    await refresh()
  }

  return (
    <section aria-labelledby={`receivers-${application.id}`}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3
            id={`receivers-${application.id}`}
            className="inline-flex items-center gap-2 font-medium"
          >
            <Webhook className="size-4" /> OpenSearch alert receivers
          </h3>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Receive Alerting monitor notifications here and assign them to this
            application without trusting ownership fields in the payload.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreating((value) => !value)}
        >
          <Plus /> New receiver
        </Button>
      </div>

      {creating ? (
        <div className="mt-4 grid gap-3 border-y py-4 md:grid-cols-3">
          <Field label="Receiver name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Service" hint="Optional">
            <Select
              value={serviceId || "__all__"}
              onValueChange={(value) => {
                if (value == null) return
                setServiceId(value === "__all__" ? "" : value)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All application services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  All application services
                </SelectItem>
                {application.services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="OpenSearch dashboard URL">
            <Input
              value={dashboardUrl}
              onChange={(event) => setDashboardUrl(event.target.value)}
            />
          </Field>
          <div className="flex justify-end md:col-span-3">
            <Button
              disabled={pending === "create" || !name.trim()}
              onClick={createReceiver}
            >
              {pending === "create" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Webhook />
              )}
              Create receiver
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 divide-y border-y">
        {receivers.map((receiver) => (
          <div
            key={receiver.id}
            className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{receiver.name}</span>
                <Badge variant="secondary">
                  {receiver.enabled ? "Enabled" : "Paused"}
                </Badge>
                <Badge
                  className={
                    receiver.lastReconciliationStatus === "FAILED"
                      ? "bg-destructive/10 text-destructive"
                      : ""
                  }
                  variant="secondary"
                >
                  Sync{" "}
                  {receiver.lastReconciliationStatus
                    .toLowerCase()
                    .replace("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {receiver.serviceName || "All services"} · every{" "}
                {receiver.reconciliationIntervalSeconds}s
                {receiver.lastDeliveryAt
                  ? ` · last delivery ${new Date(receiver.lastDeliveryAt).toLocaleString()}`
                  : " · awaiting first delivery"}
              </p>
              {receiver.lastReconciliationError ? (
                <p className="mt-1 text-xs text-destructive">
                  {receiver.lastReconciliationError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => showSetup(receiver.id)}
              >
                {pending === `setup:${receiver.id}` ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ExternalLink />
                )}
                Setup
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => act(receiver, "test")}
              >
                Test
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => act(receiver, "reconcile")}
              >
                <RefreshCw /> Sync
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${receiver.enabled ? "Pause" : "Resume"} ${receiver.name}`}
                disabled={pending === `toggle:${receiver.id}`}
                onClick={() => toggleReceiver(receiver)}
              >
                {receiver.enabled ? <Pause /> : <Play />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Rotate token for ${receiver.name}`}
                onClick={() => act(receiver, "rotate-token")}
              >
                <RotateCw />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${receiver.name}`}
                onClick={() => act(receiver, "delete")}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
        {!receivers.length ? (
          <p className="py-4 text-sm text-muted-foreground">
            No receivers yet. Create one to bring OpenSearch monitor alerts into
            Rhythm’s alert inbox.
          </p>
        ) : null}
      </div>

      {setup ? (
        <ReceiverSetup
          setup={setup}
          token={issuedToken}
          deliveries={deliveries}
          onClose={() => setSetup(null)}
        />
      ) : null}
      {message ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}

function ReceiverSetup({
  setup,
  token,
  deliveries,
  onClose,
}: {
  setup: OpenSearchAlertSetupContract
  token: string
  deliveries: OpenSearchAlertDeliveryContract[]
  onClose: () => void
}) {
  const [template, setTemplate] = useState<"query" | "bucket" | "document">(
    "query"
  )
  const selected =
    template === "query"
      ? setup.queryTemplate
      : template === "bucket"
        ? setup.bucketTemplate
        : setup.documentTemplate
  async function copy(value: string) {
    await navigator.clipboard.writeText(value)
  }
  return (
    <div className="mt-5 border-y bg-background py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="font-medium">Connect OpenSearch Notifications</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Copy these values into a Custom webhook channel, then paste the
            matching message template into the monitor action.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {token ? (
        <div className="mt-4 rounded-lg bg-warning-soft p-3 text-sm">
          <p className="font-medium">Copy the new token now</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Rhythm stores only its hash and cannot show it again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md bg-background px-3 py-2 text-xs break-all">
              {token}
            </code>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Copy receiver token"
              onClick={() => copy(token)}
            >
              <Copy />
            </Button>
          </div>
        </div>
      ) : null}
      <SetupValue label="Webhook URL" value={setup.webhookUrl} copy={copy} />
      <SetupValue
        label="Authorization header"
        value={token ? `Bearer ${token}` : "Bearer <receiver-token>"}
        copy={copy}
      />
      <div className="mt-4">
        <p className="text-xs font-medium">Message template</p>
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="tablist"
          aria-label="OpenSearch monitor type"
        >
          {(["query", "bucket", "document"] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant={template === kind ? "default" : "outline"}
              onClick={() => setTemplate(kind)}
            >
              {kind[0].toUpperCase() + kind.slice(1)} level
            </Button>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-2">
          <pre className="max-h-52 min-w-0 flex-1 overflow-auto rounded-lg bg-muted p-3 text-xs break-all whitespace-pre-wrap">
            {selected}
          </pre>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Copy message template"
            onClick={() => copy(selected)}
          >
            <Copy />
          </Button>
        </div>
      </div>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {setup.dashboardSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-warning-foreground">
        {setup.credentialWarning}
      </p>
      <div className="mt-5 border-t pt-4">
        <p className="text-xs font-medium">Recent deliveries</p>
        {deliveries.length ? (
          <div className="mt-2 divide-y rounded-md border">
            {deliveries.slice(0, 5).map((delivery) => (
              <div
                key={delivery.id}
                className="flex flex-col justify-between gap-1 px-3 py-2 text-xs sm:flex-row sm:items-center"
              >
                <span>
                  <Badge variant="secondary">
                    {delivery.status.toLowerCase()}
                  </Badge>{" "}
                  {delivery.eventCount}{" "}
                  {delivery.eventCount === 1 ? "event" : "events"}
                </span>
                <span
                  className={
                    delivery.safeError
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {delivery.safeError ||
                    new Date(delivery.receivedAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            No deliveries received yet. Use Test after closing setup to verify
            the alert inbox.
          </p>
        )}
      </div>
    </div>
  )
}

function SetupValue({
  label,
  value,
  copy,
}: {
  label: string
  value: string
  copy: (value: string) => Promise<void>
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-medium">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-xs break-all">
          {value}
        </code>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={`Copy ${label}`}
          onClick={() => copy(value)}
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="text-xs font-medium">
      <span className="flex items-center justify-between gap-3">
        {label}
        {hint ? (
          <span className="font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}
