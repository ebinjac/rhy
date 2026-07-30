import { useEffect, useRef, useState } from "react"
import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router"
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
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/components/sonner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Activity,
  AppWindow,
  ArrowLeft,
  BellRing,
  Braces,
  ChevronRight,
  CloudCog,
  FilePenLine,
  Layers3,
  LoaderCircle,
  Plus,
  RadioTower,
  Save,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { z } from "zod"

import { PageContainer } from "@/components/page-container"
import { OperationalStatusBadge } from "@/components/operational-status"
import { environmentChoices } from "@/features/applications/environment"
import { EditField } from "@/features/applications/form-field"
import { OpenSearchReceivers } from "@/features/applications/opensearch-receivers"
import { DynatraceWorkspace } from "@/features/applications/dynatrace-workspace"
import type {
  ELFApplicationContract,
  ELFServiceContract,
} from "@/lib/api-client/contracts"
import {
  getDynatraceConfiguration,
  listApplicationEnvironments,
  listDynatraceRuns,
} from "@/lib/api-client/dynatrace"
import {
  deleteELFService,
  getELFApplication,
  listELFQueries,
  saveELFApplication,
  saveELFService,
} from "@/lib/api-client/elf"
import {
  listConfigurationProfiles,
  listMonitors,
} from "@/lib/api-client/monitors"
import {
  listOpenSearchAlertReceivers,
  listUnifiedAlerts,
} from "@/lib/api-client/opensearch-alerts"
import { listDeploymentValidations } from "@/lib/api-client/suites"
import { formatDateTime } from "@/lib/format-date"

const sectionValues = [
  "overview",
  "services",
  "monitors",
  "queries",
  "alerts",
  "receivers",
  "dynatrace",
] as const

export const Route = createFileRoute("/applications/$applicationId")({
  validateSearch: (search: Record<string, unknown>) => {
    const section = z.enum(sectionValues).safeParse(search.section)
    const edit =
      search.edit === true || search.edit === "true" || search.edit === "1"
    return {
      ...(section.success ? { section: section.data } : {}),
      ...(edit ? { edit: true as const } : {}),
    }
  },
  loader: async ({ params }) => {
    const application = await getELFApplication({
      data: { applicationId: params.applicationId },
    })
    if (!application) throw notFound()

    const [
      monitorResult,
      queries,
      alerts,
      receivers,
      deployments,
      dynatraceBindings,
      telemetryProfiles,
      dynatraceRuns,
    ] = await Promise.all([
      listMonitors(),
      listELFQueries(),
      listUnifiedAlerts({
        data: {
          state: "",
          sourceType: "",
          applicationId: params.applicationId,
          serviceId: "",
          severity: "",
        },
      }),
      listOpenSearchAlertReceivers({
        data: { applicationId: params.applicationId },
      }),
      listDeploymentValidations(),
      listApplicationEnvironments({
        data: { applicationId: params.applicationId },
      }).catch(() => []),
      listConfigurationProfiles({ data: { kind: "telemetry" } }),
      listDynatraceRuns({
        data: {
          applicationId: params.applicationId,
          environmentBindingId: "",
        },
      }).catch(() => []),
    ])

    const dynatraceConfigurations = Object.fromEntries(
      await Promise.all(
        dynatraceBindings.map(async (binding) => [
          binding.id,
          await getDynatraceConfiguration({
            data: {
              applicationId: params.applicationId,
              environmentBindingId: binding.id,
            },
          }).catch(() => null),
        ])
      )
    )

    return {
      application,
      monitors: monitorResult.monitors.filter((monitor) =>
        application.monitorIds.includes(monitor.id)
      ),
      queries: queries.filter(
        (query) => query.applicationId === application.id
      ),
      alerts: alerts.filter((alert) => alert.applicationId === application.id),
      receivers,
      deployments: deployments.filter(
        (run) => run.deployment.applicationId === application.id
      ),
      dynatraceBindings,
      dynatraceConfigurations,
      dynatraceRuns,
      telemetryProfiles,
    }
  },
  component: ApplicationWorkspace,
  notFoundComponent: ApplicationNotFound,
})

const tabs = [
  { value: "overview", label: "Overview", icon: AppWindow },
  { value: "services", label: "Services", icon: Server },
  { value: "monitors", label: "Monitors", icon: Activity },
  { value: "queries", label: "Log queries", icon: Braces },
  { value: "alerts", label: "Alerts", icon: BellRing },
  { value: "receivers", label: "Receivers", icon: RadioTower },
  { value: "dynatrace", label: "Dynatrace", icon: CloudCog },
] as const

function ApplicationNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 md:px-6">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Application not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This application may have been deleted, or the link is incorrect.
      </p>
      <Button
        className="mt-6"
        nativeButton={false}
        render={<Link aria-label="Back to applications" to="/applications" />}
      >
        <ArrowLeft data-icon="inline-start" />
        Back to applications
      </Button>
    </div>
  )
}

function ApplicationWorkspace() {
  const {
    application,
    monitors,
    queries,
    alerts,
    receivers,
    deployments,
    dynatraceBindings,
    dynatraceConfigurations,
    dynatraceRuns,
    telemetryProfiles,
  } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const activeSection = search.section ?? "overview"
  const [editingApplication, setEditingApplication] = useState(
    Boolean(search.edit)
  )
  const tabRefs = useRef<
    Partial<Record<(typeof tabs)[number]["value"], HTMLAnchorElement | null>>
  >({})
  const activeAlerts = alerts.filter((alert) =>
    ["OPEN", "ACKNOWLEDGED", "ERROR"].includes(alert.state)
  )
  const status =
    activeAlerts.some((alert) =>
      ["CRITICAL", "HIGH"].includes(alert.severity)
    ) || deployments[0]?.gateDecision === "BLOCK"
      ? "CRITICAL"
      : activeAlerts.length ||
          deployments[0]?.gateDecision === "ALLOW_WITH_WARNINGS"
        ? "ATTENTION"
        : monitors.length === 0 && queries.length === 0
          ? "UNMONITORED"
          : "HEALTHY"

  useEffect(() => {
    if (!search.edit) return
    setEditingApplication(true)
    void navigate({
      search: search.section ? { section: search.section } : {},
      replace: true,
    })
  }, [search.edit, search.section, navigate])

  useEffect(() => {
    const node = tabRefs.current[activeSection]
    if (!node) return
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    node.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    })
  }, [activeSection])

  return (
    <div>
      <div className="border-b bg-muted/15">
        <PageContainer padding="tabs">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Link
              activeOptions={{ exact: true }}
              className="hover:text-foreground"
              to="/applications"
            >
              Applications
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="truncate text-foreground">
              {application.name}
            </span>
          </nav>
          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="mr-1 truncate text-xl font-semibold text-balance">
                {application.name}
              </h1>
              <OperationalStatusBadge status={status} />
              {application.carId ? (
                <Badge variant="outline">CAR {application.carId}</Badge>
              ) : null}
              <Badge variant="secondary">
                {application.environment || "Any environment"}
              </Badge>
            </div>
            <Button
              className="shrink-0"
              onClick={() => setEditingApplication((current) => !current)}
              size="sm"
              variant="outline"
            >
              <FilePenLine />
              Edit
            </Button>
          </div>
          <nav
            aria-label={`${application.name} sections`}
            className="mt-3 flex min-w-0 gap-1 overflow-x-auto"
          >
            {tabs.map((tab) => {
              const isActive = activeSection === tab.value
              return (
                <Link
                  activeOptions={{ exact: true, includeSearch: true }}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    isActive
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  key={tab.value}
                  params={{ applicationId: application.id }}
                  ref={(node) => {
                    tabRefs.current[tab.value] = node
                  }}
                  search={
                    tab.value === "overview" ? {} : { section: tab.value }
                  }
                  to="/applications/$applicationId"
                >
                  <tab.icon aria-hidden="true" className="size-4" />
                  {tab.label}
                  {tab.value === "alerts" && activeAlerts.length ? (
                    <Badge variant="secondary">{activeAlerts.length}</Badge>
                  ) : null}
                </Link>
              )
            })}
          </nav>
        </PageContainer>
      </div>

      <PageContainer>
        {editingApplication ? (
          <ApplicationSettings
            application={application}
            onClose={() => setEditingApplication(false)}
          />
        ) : null}
        {activeSection === "overview" ? (
          <Overview
            activeAlerts={activeAlerts.length}
            application={application}
            deployments={deployments}
            monitors={monitors}
            queries={queries}
            receivers={receivers}
          />
        ) : null}
        {activeSection === "services" ? (
          <ApplicationServices application={application} />
        ) : null}
        {activeSection === "monitors" ? (
          <CollectionSection
            description="Synthetic monitors explicitly tagged to this application."
            emptyAction={
              <Button
                nativeButton={false}
                render={<Link aria-label="Create monitor" to="/monitors/new" />}
                size="sm"
              >
                <Plus data-icon="inline-start" /> Create monitor
              </Button>
            }
            emptyDescription="Link a monitor from the monitor editor, or create one and tag this application so coverage appears here."
            emptyTitle="No monitors linked"
            title="Linked monitors"
          >
            {monitors.map((monitor) => (
              <Link
                className="flex min-h-14 items-center justify-between gap-4 py-3 hover:text-primary"
                key={monitor.id}
                params={{ monitorId: monitor.id }}
                to="/monitors/$monitorId"
              >
                <div>
                  <p className="font-medium">{monitor.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {monitor.cadence} · {monitor.successRate ?? "No"}%
                    reliability
                  </p>
                </div>
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            ))}
          </CollectionSection>
        ) : null}
        {activeSection === "queries" ? (
          <CollectionSection
            description="Governed OpenSearch queries tagged to this application."
            emptyAction={
              <Button
                nativeButton={false}
                render={<Link aria-label="Open ELF library" to="/elf" />}
                size="sm"
                variant="outline"
              >
                <Plus data-icon="inline-start" /> Open ELF library
              </Button>
            }
            emptyDescription="Create or tag an ELF query with this application to track log-based coverage."
            emptyTitle="No log queries linked"
            title="Log queries"
          >
            {queries.map((query) => (
              <Link
                className="flex min-h-14 items-center justify-between gap-4 py-3 hover:text-primary"
                key={query.id}
                params={{ queryId: query.id }}
                to="/elf/$queryId"
              >
                <div>
                  <p className="font-medium">{query.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {query.serviceName || "All services"} ·{" "}
                    {query.gateMode.toLowerCase()}
                  </p>
                </div>
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            ))}
          </CollectionSection>
        ) : null}
        {activeSection === "alerts" ? (
          <CollectionSection
            description="Rhythm and OpenSearch alerts owned by this application."
            emptyAction={
              <Button
                nativeButton={false}
                render={
                  <Link
                    aria-label="Configure receivers"
                    params={{ applicationId: application.id }}
                    search={{ section: "receivers" }}
                    to="/applications/$applicationId"
                  />
                }
                size="sm"
                variant="outline"
              >
                <RadioTower data-icon="inline-start" /> Configure receivers
              </Button>
            }
            emptyDescription="When monitors fail or OpenSearch deliveries arrive, they will appear here. Configure a receiver to ingest OpenSearch alerts."
            emptyTitle="No alerts recorded"
            title="Application alerts"
          >
            {alerts.map((alert) => (
              <Link
                className="flex items-start justify-between gap-4 py-4 hover:text-primary"
                hash={`alert-${alert.id}`}
                key={alert.id}
                to="/alerts"
              >
                <div>
                  <p className="font-medium">{alert.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {alert.sourceType === "OPENSEARCH_ALERTING"
                      ? "OpenSearch Alerting"
                      : "Rhythm monitor"}{" "}
                    · {formatDateTime(alert.lastTriggeredAt ?? alert.createdAt)}
                  </p>
                </div>
                <Badge
                  variant={alert.state === "RESOLVED" ? "outline" : "secondary"}
                >
                  {alert.state.toLowerCase()}
                </Badge>
              </Link>
            ))}
          </CollectionSection>
        ) : null}
        {activeSection === "receivers" ? (
          <OpenSearchReceivers
            alerts={alerts}
            application={application}
            receivers={receivers}
            refresh={() => router.invalidate()}
          />
        ) : null}
        {activeSection === "dynatrace" ? (
          <DynatraceWorkspace
            application={application}
            bindings={dynatraceBindings}
            configurations={dynatraceConfigurations}
            telemetryProfiles={telemetryProfiles}
            runs={dynatraceRuns}
          />
        ) : null}
      </PageContainer>
    </div>
  )
}

function ApplicationSettings({
  application,
  onClose,
}: {
  application: ELFApplicationContract
  onClose: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(application.name)
  const [carId, setCarId] = useState(application.carId ?? "")
  const [owner, setOwner] = useState(application.owner ?? "")
  const [environment, setEnvironment] = useState(
    application.environment || "production"
  )
  const [indexPattern, setIndexPattern] = useState(
    application.defaultIndexPattern ?? ""
  )
  const [timeField, setTimeField] = useState(application.defaultTimeField)
  const [maskingRules, setMaskingRules] = useState(
    application.maskingRules.join("\n")
  )
  const [alertEmails, setAlertEmails] = useState(
    application.alertEmails.join(", ")
  )
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const envChoices = environmentChoices(environment, application.environment)

  async function save() {
    setPending(true)
    setMessage("")
    const result = await saveELFApplication({
      data: {
        id: application.id,
        name: name.trim(),
        carId: carId.trim(),
        owner: owner.trim(),
        environment: environment.trim(),
        defaultIndexPattern: indexPattern.trim(),
        defaultTimeField: timeField.trim() || "@timestamp",
        maskingRules: maskingRules
          .split(/[\n,]+/)
          .map((item: string) => item.trim())
          .filter(Boolean),
        semanticMapping: application.semanticMapping,
        alertEmails: alertEmails
          .split(/[\n,;]+/)
          .map((item: string) => item.trim())
          .filter(Boolean),
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success("Application settings saved.")
    await router.invalidate()
    onClose()
  }

  return (
    <section
      aria-labelledby="application-settings-heading"
      className="mb-8 border-y bg-muted/15 py-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="application-settings-heading"
            className="text-lg font-semibold"
          >
            Application settings
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ownership, ELF defaults, masking policy, and alert routing.
          </p>
        </div>
        <Button onClick={onClose} size="sm" variant="ghost">
          Close
        </Button>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <EditField label="Application name">
          <Input
            aria-label="Application name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </EditField>
        <EditField label="CAR ID">
          <Input
            aria-label="CAR ID"
            className="font-mono"
            value={carId}
            onChange={(event) => setCarId(event.target.value)}
          />
        </EditField>
        <EditField label="Owner">
          <Input
            aria-label="Owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          />
        </EditField>
        <EditField label="Environment">
          <Select
            value={environment}
            onValueChange={(value) => {
              if (value != null) setEnvironment(value)
            }}
          >
            <SelectTrigger aria-label="Environment" className="w-full">
              <SelectValue placeholder="Select environment" />
            </SelectTrigger>
            <SelectContent>
              {envChoices.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </EditField>
        <EditField label="Default index pattern">
          <Input
            aria-label="Default index pattern"
            className="font-mono"
            value={indexPattern}
            onChange={(event) => setIndexPattern(event.target.value)}
          />
        </EditField>
        <EditField label="Default time field">
          <Input
            aria-label="Default time field"
            className="font-mono"
            value={timeField}
            onChange={(event) => setTimeField(event.target.value)}
          />
        </EditField>
        <EditField
          label="Masking rules"
          help="One sensitive field path or pattern per line."
        >
          <Textarea
            aria-label="Masking rules"
            className="min-h-28 font-mono text-xs"
            value={maskingRules}
            onChange={(event) => setMaskingRules(event.target.value)}
          />
        </EditField>
        <EditField
          label="Alert destination emails"
          help="Comma or line separated."
        >
          <Textarea
            aria-label="Alert destination emails"
            className="min-h-28"
            value={alertEmails}
            onChange={(event) => setAlertEmails(event.target.value)}
          />
        </EditField>
      </div>
      {message ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button disabled={pending} onClick={onClose} variant="ghost">
          Cancel
        </Button>
        <Button disabled={pending || !name.trim()} onClick={() => void save()}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
          {pending ? "Saving…" : "Save application"}
        </Button>
      </div>
    </section>
  )
}

function ApplicationServices({
  application,
}: {
  application: ELFApplicationContract
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState("")
  const [name, setName] = useState("")
  const [indexPattern, setIndexPattern] = useState("")
  const [timeField, setTimeField] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<ELFServiceContract | null>(
    null
  )
  const [deleting, setDeleting] = useState(false)

  function reset() {
    setEditingId("")
    setName("")
    setIndexPattern("")
    setTimeField("")
    setMessage("")
  }

  async function save() {
    setPending(true)
    setMessage("")
    const result = await saveELFService({
      data: {
        applicationId: application.id,
        serviceId: editingId || undefined,
        name: name.trim(),
        indexPattern: indexPattern.trim(),
        timeField: timeField.trim(),
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success(editingId ? "Service updated." : "Service created.")
    reset()
    await router.invalidate()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setMessage("")
    const result = await deleteELFService({
      data: { applicationId: application.id, serviceId: deleteTarget.id },
    })
    setDeleting(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success("Service deleted.")
    if (editingId === deleteTarget.id) reset()
    setDeleteTarget(null)
    await router.invalidate()
  }

  return (
    <section aria-labelledby="application-services-heading">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2
            id="application-services-heading"
            className="text-2xl font-semibold"
          >
            Services
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Override the application index pattern and time field for each
            deployable service.
          </p>
        </div>
        <Button
          onClick={() => {
            reset()
            setName("New service")
          }}
          variant="outline"
        >
          <Plus /> Add service
        </Button>
      </div>
      {name || editingId ? (
        <div className="mt-5 grid gap-4 border-y bg-muted/15 py-5 md:grid-cols-3">
          <EditField label="Service name">
            <Input
              aria-label="Service name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </EditField>
          <EditField label="Index pattern">
            <Input
              aria-label="Index pattern"
              className="font-mono"
              value={indexPattern}
              onChange={(event) => setIndexPattern(event.target.value)}
              placeholder={application.defaultIndexPattern || "logs-*"}
            />
          </EditField>
          <EditField label="Time field">
            <Input
              aria-label="Time field"
              className="font-mono"
              value={timeField}
              onChange={(event) => setTimeField(event.target.value)}
              placeholder={application.defaultTimeField || "@timestamp"}
            />
          </EditField>
          <div className="flex gap-2 md:col-span-3 md:justify-end">
            <Button onClick={reset} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={pending || !name.trim()}
              onClick={() => void save()}
            >
              {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
              {editingId ? "Save service" : "Create service"}
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <div className="mt-6 divide-y border-y">
        {application.services.map((service: ELFServiceContract) => (
          <div
            className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"
            key={service.id}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{service.name}</p>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {service.indexPattern ||
                  application.defaultIndexPattern ||
                  "Platform default index"}{" "}
                · {service.timeField || application.defaultTimeField}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setEditingId(service.id)
                  setName(service.name)
                  setIndexPattern(service.indexPattern ?? "")
                  setTimeField(service.timeField ?? "")
                  setMessage("")
                }}
                size="sm"
                variant="outline"
              >
                <FilePenLine /> Edit
              </Button>
              <Button
                aria-label={`Delete ${service.name}`}
                disabled={pending || deleting}
                onClick={() => setDeleteTarget(service)}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
        {!application.services.length ? (
          <div className="py-12 text-center">
            <Server
              aria-hidden="true"
              className="mx-auto size-7 text-muted-foreground"
            />
            <h3 className="mt-3 font-medium">No services registered</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Add the first deployable service so ELF queries and receivers can
              target it.
            </p>
            <Button
              className="mt-4"
              size="sm"
              onClick={() => {
                reset()
                setName("New service")
              }}
            >
              <Plus /> Add service
            </Button>
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!deleting && !open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete service?</AlertDialogTitle>
            <AlertDialogDescription>
              Queries assigned to <strong>{deleteTarget?.name}</strong> must be
              reassigned first. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
              {deleting ? "Deleting…" : "Delete service"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function Overview({
  application,
  monitors,
  queries,
  activeAlerts,
  receivers,
  deployments,
}: {
  application: ReturnType<typeof Route.useLoaderData>["application"]
  monitors: ReturnType<typeof Route.useLoaderData>["monitors"]
  queries: ReturnType<typeof Route.useLoaderData>["queries"]
  activeAlerts: number
  receivers: ReturnType<typeof Route.useLoaderData>["receivers"]
  deployments: ReturnType<typeof Route.useLoaderData>["deployments"]
}) {
  return (
    <>
      <header>
        <h2 className="text-2xl font-semibold text-balance">
          Application overview
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
          Ownership, monitoring coverage, log checks, alerts, and recent release
          evidence in one operational context.
        </p>
      </header>
      <section
        aria-label="Key metrics"
        className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-b pb-5"
      >
        <Metric label="Linked monitors" value={String(monitors.length)} />
        <Metric label="Log queries" value={String(queries.length)} />
        <Metric label="Active alerts" value={String(activeAlerts)} />
        <Metric
          label="Latest deployment"
          value={
            deployments[0]?.gateDecision?.toLowerCase().replaceAll("_", " ") ??
            "Not recorded"
          }
        />
      </section>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-lg font-semibold">Ownership and routing</h3>
          <dl className="mt-3 divide-y border-y text-sm">
            <Definition
              label="CAR ID"
              value={application.carId || "Not assigned"}
            />
            <Definition
              label="Owner"
              value={application.owner || "Not assigned"}
            />
            <Definition
              label="Default index"
              value={application.defaultIndexPattern || "Platform default"}
            />
            <Definition
              label="Alert receivers"
              value={String(receivers.length)}
            />
          </dl>
        </section>
        <section>
          <h3 className="text-lg font-semibold">Coverage</h3>
          <div className="mt-3 border-y py-4">
            {monitors.length || queries.length ? (
              <div className="flex items-start gap-3">
                <Layers3
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-primary"
                />
                <div>
                  <p className="font-medium">Operational signals configured</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {countLabel(
                      monitors.length,
                      "synthetic monitor",
                      "synthetic monitors"
                    )}{" "}
                    and {countLabel(queries.length, "log query", "log queries")}{" "}
                    are linked.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <BellRing
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-muted-foreground"
                />
                <div>
                  <p className="font-medium">No monitoring signal</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Link a monitor or ELF query before treating this application
                    as healthy.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      nativeButton={false}
                      render={
                        <Link aria-label="Create monitor" to="/monitors/new" />
                      }
                      size="sm"
                      variant="outline"
                    >
                      <Plus data-icon="inline-start" /> Create monitor
                    </Button>
                    <Button
                      nativeButton={false}
                      render={<Link aria-label="Open ELF library" to="/elf" />}
                      size="sm"
                      variant="ghost"
                    >
                      Open ELF library
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

function CollectionSection({
  title,
  description,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  title: string
  description: string
  emptyTitle: string
  emptyDescription: string
  emptyAction?: React.ReactNode
  children: React.ReactNode
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children)
  return (
    <section>
      <h2 className="text-2xl font-semibold text-balance">{title}</h2>
      <p className="mt-1 text-sm text-pretty text-muted-foreground">
        {description}
      </p>
      <div className="mt-6 divide-y border-y">
        {hasChildren ? (
          children
        ) : (
          <div className="py-12 text-center">
            <h3 className="font-medium">{emptyTitle}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {emptyDescription}
            </p>
            {emptyAction ? (
              <div className="mt-4 flex justify-center">{emptyAction}</div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[7rem]">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium capitalize tabular-nums">
        {value}
      </p>
    </div>
  )
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}
