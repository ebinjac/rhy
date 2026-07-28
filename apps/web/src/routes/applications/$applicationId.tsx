import { useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Activity,
  AppWindow,
  BellRing,
  Braces,
  ChevronRight,
  FilePenLine,
  LoaderCircle,
  Plus,
  Layers3,
  RadioTower,
  Save,
  Server,
  Trash2,
} from "lucide-react"
import { z } from "zod"

import { OperationalStatusBadge } from "@/components/operational-status"
import type {
  ELFApplicationContract,
  ELFServiceContract,
} from "@/lib/api-client/contracts"
import {
  deleteELFService,
  listELFApplications,
  listELFQueries,
  saveELFApplication,
  saveELFService,
} from "@/lib/api-client/elf"
import { listMonitors } from "@/lib/api-client/monitors"
import {
  listOpenSearchAlertReceivers,
  listUnifiedAlerts,
} from "@/lib/api-client/opensearch-alerts"
import { listDeploymentValidations } from "@/lib/api-client/suites"
import { formatDateTime } from "@/lib/format-date"

const sectionSchema = z.object({
  section: z
    .enum([
      "overview",
      "services",
      "monitors",
      "queries",
      "alerts",
      "receivers",
    ])
    .optional()
    .catch("overview"),
})

export const Route = createFileRoute("/applications/$applicationId")({
  validateSearch: sectionSchema,
  loader: async ({ params }) => {
    const [
      applications,
      monitorResult,
      queries,
      alerts,
      receivers,
      deployments,
    ] = await Promise.all([
      listELFApplications(),
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
    ])
    const application = applications.find(
      (item) => item.id === params.applicationId
    )
    if (!application) throw new Error("Application not found")
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
    }
  },
  component: ApplicationWorkspace,
})

const tabs = [
  { value: "overview", label: "Overview", icon: AppWindow },
  { value: "services", label: "Services", icon: Server },
  { value: "monitors", label: "Monitors", icon: Activity },
  { value: "queries", label: "Log queries", icon: Braces },
  { value: "alerts", label: "Alerts", icon: BellRing },
  { value: "receivers", label: "Receivers", icon: RadioTower },
] as const

function ApplicationWorkspace() {
  const { application, monitors, queries, alerts, receivers, deployments } =
    Route.useLoaderData()
  const { section = "overview" } = Route.useSearch()
  const [editingApplication, setEditingApplication] = useState(false)
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

  return (
    <div>
      <div className="border-b bg-muted/15">
        <div className="mx-auto max-w-[1380px] px-4 pt-4 md:px-6">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Link className="hover:text-foreground" to="/applications">
              Applications
            </Link>
            <span aria-hidden="true">/</span>
            <span className="truncate text-foreground">{application.name}</span>
          </nav>
          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="mr-1 truncate text-xl font-semibold">
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
            {tabs.map((tab) => (
              <Link
                activeOptions={{ exact: true }}
                className={`flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  section === tab.value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                key={tab.value}
                params={{ applicationId: application.id }}
                search={{ section: tab.value }}
                to="/applications/$applicationId"
              >
                <tab.icon aria-hidden="true" className="size-4" />
                {tab.label}
                {tab.value === "alerts" && activeAlerts.length ? (
                  <Badge variant="secondary">{activeAlerts.length}</Badge>
                ) : null}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
        {editingApplication ? (
          <ApplicationSettings
            application={application}
            onClose={() => setEditingApplication(false)}
          />
        ) : null}
        {section === "overview" ? (
          <Overview
            activeAlerts={activeAlerts.length}
            application={application}
            deployments={deployments}
            monitors={monitors}
            queries={queries}
            receivers={receivers}
          />
        ) : null}
        {section === "services" ? (
          <ApplicationServices application={application} />
        ) : null}
        {section === "monitors" ? (
          <CollectionSection
            description="Synthetic monitors explicitly tagged to this application."
            empty="No monitors are linked to this application."
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
                <ChevronRight className="size-4" />
              </Link>
            ))}
          </CollectionSection>
        ) : null}
        {section === "queries" ? (
          <CollectionSection
            description="Governed OpenSearch queries tagged to this application."
            empty="No ELF queries are linked to this application."
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
                <ChevronRight className="size-4" />
              </Link>
            ))}
          </CollectionSection>
        ) : null}
        {section === "alerts" ? (
          <CollectionSection
            description="Rhythm and OpenSearch alerts owned by this application."
            empty="No alerts have been recorded for this application."
            title="Application alerts"
          >
            {alerts.map((alert) => (
              <div
                className="flex items-start justify-between gap-4 py-4"
                key={alert.id}
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
              </div>
            ))}
          </CollectionSection>
        ) : null}
        {section === "receivers" ? (
          <CollectionSection
            description="Application-bound endpoints for OpenSearch Alerting webhook delivery."
            empty="No OpenSearch alert receiver is configured."
            title="Alert receivers"
          >
            {receivers.map((receiver) => (
              <div
                className="flex items-start justify-between gap-4 py-4"
                key={receiver.id}
              >
                <div>
                  <p className="font-medium">{receiver.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {receiver.serviceName || "All services"} · last delivery{" "}
                    {receiver.lastDeliveryAt
                      ? formatDateTime(receiver.lastDeliveryAt)
                      : "not received"}
                  </p>
                </div>
                <Badge
                  className={
                    receiver.lastReconciliationStatus === "FAILED"
                      ? "bg-destructive/10 text-destructive"
                      : ""
                  }
                  variant="secondary"
                >
                  {receiver.enabled ? "Enabled" : "Paused"}
                </Badge>
              </div>
            ))}
          </CollectionSection>
        ) : null}
      </main>
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
  const [environment, setEnvironment] = useState(application.environment ?? "")
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
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </EditField>
        <EditField label="CAR ID">
          <Input
            className="font-mono"
            value={carId}
            onChange={(event) => setCarId(event.target.value)}
          />
        </EditField>
        <EditField label="Owner">
          <Input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          />
        </EditField>
        <EditField label="Environment">
          <Input
            value={environment}
            onChange={(event) => setEnvironment(event.target.value)}
          />
        </EditField>
        <EditField label="Default index pattern">
          <Input
            className="font-mono"
            value={indexPattern}
            onChange={(event) => setIndexPattern(event.target.value)}
          />
        </EditField>
        <EditField label="Default time field">
          <Input
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

  async function remove(serviceId: string, serviceName: string) {
    if (
      !window.confirm(
        `Delete ${serviceName}? Queries assigned to this service must be reassigned first.`
      )
    )
      return
    setPending(true)
    const result = await deleteELFService({
      data: { applicationId: application.id, serviceId },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success("Service deleted.")
    if (editingId === serviceId) reset()
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
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </EditField>
          <EditField label="Index pattern">
            <Input
              className="font-mono"
              value={indexPattern}
              onChange={(event) => setIndexPattern(event.target.value)}
              placeholder={application.defaultIndexPattern || "logs-*"}
            />
          </EditField>
          <EditField label="Time field">
            <Input
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
                disabled={pending}
                onClick={() => void remove(service.id, service.name)}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
        {!application.services.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No services are registered for this application.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function EditField({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <span className="mt-2 block">{children}</span>
      {help ? (
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {help}
        </span>
      ) : null}
    </label>
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
        <h2 className="text-2xl font-semibold">Application overview</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Ownership, monitoring coverage, log checks, alerts, and recent release
          evidence in one operational context.
        </p>
      </header>
      <section className="mt-7 grid divide-y rounded-lg border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
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
                <Layers3 className="mt-0.5 size-5 text-primary" />
                <div>
                  <p className="font-medium">Operational signals configured</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {monitors.length} synthetic monitor
                    {monitors.length === 1 ? "" : "s"} and {queries.length} log
                    quer{queries.length === 1 ? "y" : "ies"} are linked.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <BellRing className="mt-0.5 size-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">No monitoring signal</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Link a monitor or ELF query before treating this application
                    as healthy.
                  </p>
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
  empty,
  children,
}: {
  title: string
  description: string
  empty: string
  children: React.ReactNode
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children)
  return (
    <section>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 divide-y border-y">
        {hasChildren ? (
          children
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {empty}
          </p>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold capitalize">{value}</p>
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
