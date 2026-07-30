import { useEffect, useState } from "react"
import { Link, useRouter } from "@tanstack/react-router"
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
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CloudCog,
  DatabaseZap,
  Gauge,
  Layers3,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
} from "lucide-react"

import type {
  ConfigurationProfileContract,
  DynatraceConfigurationContract,
  DynatraceEntityContract,
  DynatraceEnvironmentBindingContract,
  DynatraceResourceMappingContract,
  DynatraceResourcePreviewContract,
  DynatraceRuleContract,
  DynatraceRunContract,
  ELFApplicationContract,
} from "@/lib/api-client/contracts"
import {
  discoverDynatraceResources,
  ensureApplicationDynatraceContext,
  listDynatraceManagementZones,
  previewDynatraceResources,
  runDynatraceQuery,
  saveDynatraceConfiguration,
  saveDynatraceRules,
  testDynatraceConnection,
} from "@/lib/api-client/dynatrace"
import { formatDateTime } from "@/lib/format-date"

type View = "overview" | "connection" | "resources" | "metrics" | "rules" | "history"

const views: Array<{ value: View; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "connection", label: "Connection" },
  { value: "resources", label: "Resources" },
  { value: "metrics", label: "Metrics" },
  { value: "rules", label: "Rules" },
  { value: "history", label: "History" },
]

export function DynatraceWorkspace({
  application,
  bindings,
  configurations,
  telemetryProfiles,
  runs,
}: {
  application: ELFApplicationContract
  bindings: DynatraceEnvironmentBindingContract[]
  configurations: Record<string, DynatraceConfigurationContract | null>
  telemetryProfiles: ConfigurationProfileContract[]
  runs: DynatraceRunContract[]
}) {
  const router = useRouter()
  const initialBindingId = bindings[0]?.id ?? ""
  const [view, setView] = useState<View>(
    initialBindingId && configurations[initialBindingId]
      ? "resources"
      : "connection"
  )
  const [bindingId, setBindingId] = useState(bindings[0]?.id ?? "")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const configuration = configurations[bindingId] ?? null
  const binding = bindings.find((candidate) => candidate.id === bindingId)
  const environmentRuns = runs.filter(
    (run) => !bindingId || run.environmentBindingId === bindingId
  )
  const latestRun = environmentRuns[0]

  async function prepareDynatrace() {
    setPending(true)
    setMessage("")
    const result = await ensureApplicationDynatraceContext({
      data: { applicationId: application.id },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success("Dynatrace workspace prepared.")
    setBindingId(result.binding.id)
    setView("connection")
    await router.invalidate()
  }

  if (!bindings.length) {
    return (
      <section aria-labelledby="dynatrace-heading">
        <WorkspaceHeader />
        <div className="mt-7 grid gap-8 border-y bg-muted/15 py-7 lg:grid-cols-[1fr_.9fr]">
          <div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CloudCog className="size-5" />
            </div>
            <h3 className="mt-4 text-xl font-semibold">
              Choose the infrastructure to monitor
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Start with the Dynatrace management zone that owns this
              application, then select its Hydra services or TIMS servers.
              Rhythm uses the application&apos;s existing{" "}
              <strong>{application.environment || "application"}</strong>{" "}
              context automatically.
            </p>
            <ol className="mt-5 space-y-3 text-sm">
              {[
                "Connect to the approved Amex Dynatrace tenant.",
                "Choose one or more management zones.",
                "Select application services, servers, or host groups.",
                "Preview the exact resources before saving.",
              ].map((item, index) => (
                <li className="flex gap-3" key={item}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="self-start border-l pl-0 lg:pl-8">
            <p className="text-sm font-medium">Infrastructure scope</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-lg border bg-background p-4">
                <Layers3 className="size-5 text-primary" />
                <p className="mt-3 font-medium">Hydra services</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select from {application.services.length} registered
                  application service
                  {application.services.length === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <Server className="size-5 text-primary" />
                <p className="mt-3 font-medium">TIMS servers</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose hosts or host groups returned by Dynatrace.
                </p>
              </div>
            </div>
            {message ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {message}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() => void prepareDynatrace()}
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}
                Choose management zone and resources
              </Button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="dynatrace-heading">
      <WorkspaceHeader />
      <div className="mt-5 flex flex-col justify-between gap-3 border-y py-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {application.environment || binding?.environmentType || "Application"}
          </Badge>
          <Badge variant={configuration ? "secondary" : "outline"}>
            {configuration ? "Configured" : "Setup required"}
          </Badge>
          {configuration?.lastTestStatus === "SUCCESS" ? (
            <Badge className="bg-success-soft text-success-foreground">
              Connection verified
            </Badge>
          ) : null}
        </div>
        <Button
          nativeButton={false}
          render={
            <Link search={{ kind: "telemetry" }} to="/configuration" />
          }
          size="sm"
          variant="outline"
        >
          Manage connections
        </Button>
      </div>

      <nav
        aria-label="Dynatrace sections"
        className="mt-5 flex gap-1 overflow-x-auto border-b"
      >
        {views.map((item) => (
          <button
            aria-current={view === item.value ? "page" : undefined}
            className={`h-11 shrink-0 border-b-2 px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              view === item.value
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            key={item.value}
            onClick={() => setView(item.value)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="pt-6">
        {view === "overview" ? (
          configuration ? (
            <DynatraceOverview
              application={application}
              binding={binding!}
              configuration={configuration}
              latestRun={latestRun}
            />
          ) : (
            <SetupRequiredNotice
              onContinue={() => setView("connection")}
              title="Overview unlocks after the Dynatrace connection is saved"
            />
          )
        ) : null}
        {view === "connection" ? (
          <ConfigurationEditor
            application={application}
            binding={binding!}
            existing={configuration}
            onSaved={() => setView("resources")}
            telemetryProfiles={telemetryProfiles}
          />
        ) : null}
        {view === "resources" ? (
          configuration ? (
            <ResourcePanel
              application={application}
              applicationId={application.id}
              bindingId={bindingId}
              configuration={configuration}
            />
          ) : (
            <SetupRequiredNotice
              onContinue={() => setView("connection")}
              title="Save the Dynatrace connection first"
              detail="Management zones and Hydra/TIMS resources are chosen on this tab after a connection profile is saved."
            />
          )
        ) : null}
        {view === "metrics" ? (
          configuration ? (
            <MetricsPanel
              applicationId={application.id}
              bindingId={bindingId}
              configuration={configuration}
              latestRun={latestRun}
            />
          ) : (
            <SetupRequiredNotice
              onContinue={() => setView("connection")}
              title="Metrics unlock after the Dynatrace connection is saved"
            />
          )
        ) : null}
        {view === "rules" ? (
          configuration ? (
            <RulesPanel
              applicationId={application.id}
              bindingId={bindingId}
              rules={configuration.rules}
            />
          ) : (
            <SetupRequiredNotice
              onContinue={() => setView("connection")}
              title="Rules unlock after the Dynatrace connection is saved"
            />
          )
        ) : null}
        {view === "history" ? (
          <HistoryPanel runs={environmentRuns} />
        ) : null}
      </div>
    </section>
  )
}

function WorkspaceHeader() {
  return (
    <header>
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-semibold" id="dynatrace-heading">
          Dynatrace infrastructure
        </h2>
        <Badge variant="outline">Environment API v2</Badge>
      </div>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
        Govern Hydra and TIMS resources, inspect CPU and memory, and compare
        immutable infrastructure evidence before and after a deployment.
      </p>
    </header>
  )
}

function SetupRequiredNotice({
  detail = "Open Connection, select the approved Dynatrace profile, then save to continue.",
  onContinue,
  title,
}: {
  detail?: string
  onContinue: () => void
  title: string
}) {
  return (
    <div className="rounded-lg border bg-muted/15 px-5 py-6">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{detail}</p>
      <Button className="mt-4" onClick={onContinue}>
        Open Connection
      </Button>
    </div>
  )
}

function ManagementZoneEditor({
  availableZones = [],
  onChange,
  zones,
}: {
  availableZones?: string[]
  onChange: (zones: string[]) => void
  zones: string[]
}) {
  const [draft, setDraft] = useState("")

  function toggleZone(zone: string) {
    onChange(
      zones.includes(zone)
        ? zones.filter((candidate) => candidate !== zone)
        : [...zones, zone]
    )
  }

  function addDraft() {
    const value = draft.trim()
    if (!value) return
    if (!zones.includes(value)) {
      onChange([...zones, value])
    }
    setDraft("")
  }

  return (
    <div className="space-y-4">
      {availableZones.length ? (
        <div className="flex flex-wrap gap-2">
          {availableZones.map((zone) => {
            const selected = zones.includes(zone)
            return (
              <Button
                aria-pressed={selected}
                key={zone}
                onClick={() => toggleZone(zone)}
                size="sm"
                variant={selected ? "default" : "outline"}
              >
                {selected ? <CheckCircle2 /> : <Layers3 />}
                {zone}
              </Button>
            )
          })}
        </div>
      ) : null}
      {zones.length ? (
        <div className="flex flex-wrap gap-2">
          {zones.map((zone) =>
            availableZones.includes(zone) ? null : (
              <Badge key={zone} variant="secondary">
                {zone}
                <button
                  aria-label={`Remove ${zone}`}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleZone(zone)}
                  type="button"
                >
                  ×
                </button>
              </Badge>
            )
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No management zones selected yet.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Management zone name"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              addDraft()
            }
          }}
          placeholder='Zone name, e.g. AI_Firewall'
          value={draft}
        />
        <Button
          disabled={!draft.trim()}
          onClick={addDraft}
          type="button"
          variant="outline"
        >
          <Plus />
          Add zone
        </Button>
      </div>
      {zones.length ? (
        <div className="rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          mzSelector=mzName({zones.map((zone) => `"${zone}"`).join(", ")})
        </div>
      ) : null}
    </div>
  )
}

function ConfigurationEditor({
  application,
  binding,
  existing,
  onSaved,
  telemetryProfiles,
}: {
  application: ELFApplicationContract
  binding: DynatraceEnvironmentBindingContract
  existing: DynatraceConfigurationContract | null
  onSaved?: () => void
  telemetryProfiles: ConfigurationProfileContract[]
}) {
  const router = useRouter()
  const [connectionProfileId, setConnectionProfileId] = useState(
    existing?.connectionProfileId ?? telemetryProfiles[0]?.id ?? ""
  )
  const [credentialSecretRef, setCredentialSecretRef] = useState(
    existing?.credentialSecretRef ?? ""
  )
  const [hydra, setHydra] = useState(
    existing?.platforms.includes("HYDRA") ?? true
  )
  const [tims, setTims] = useState(
    existing?.platforms.includes("TIMS") ?? true
  )
  const [hydraCpuMetric, setHydraCpuMetric] = useState(
    existing?.metricMappings.hydraCpu ??
      "builtin:containers.cpu.usagePercent"
  )
  const [hydraMemoryMetric, setHydraMemoryMetric] = useState(
    existing?.metricMappings.hydraMemory ??
      "builtin:containers.memory.usagePercent"
  )
  const [timsCpuMetric, setTimsCpuMetric] = useState(
    existing?.metricMappings.timsCpu ??
      existing?.metricMappings.cpu ??
      "builtin:host.cpu.usage"
  )
  const [timsMemoryMetric, setTimsMemoryMetric] = useState(
    existing?.metricMappings.timsMemory ??
      existing?.metricMappings.memory ??
      "builtin:host.mem.usage"
  )
  const [baselineHours, setBaselineHours] = useState(
    Math.round((existing?.baselineWindowSeconds ?? 86400) / 3600)
  )
  const [stabilizationMinutes, setStabilizationMinutes] = useState(
    Math.round((existing?.stabilizationSeconds ?? 600) / 60)
  )
  const [postMinutes, setPostMinutes] = useState(
    Math.round((existing?.postWindowSeconds ?? 900) / 60)
  )
  const [managementZones, setManagementZones] = useState(
    existing?.managementZones ?? []
  )
  const [pending, setPending] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    setConnectionProfileId(
      existing?.connectionProfileId ?? telemetryProfiles[0]?.id ?? ""
    )
    setManagementZones(existing?.managementZones ?? [])
  }, [
    binding.id,
    existing?.connectionProfileId,
    existing?.managementZones,
    telemetryProfiles,
  ])

  async function save() {
    setPending(true)
    setMessage("")
    const result = await saveDynatraceConfiguration({
      data: {
        applicationId: application.id,
        environmentBindingId: binding.id,
        connectionProfileId,
        credentialSecretRef,
        platforms: [
          ...(hydra ? (["HYDRA"] as const) : []),
          ...(tims ? (["TIMS"] as const) : []),
        ],
        managementZones,
        metricMappings: {
          cpu: timsCpuMetric.trim(),
          memory: timsMemoryMetric.trim(),
          hydraCpu: hydraCpuMetric.trim(),
          hydraMemory: hydraMemoryMetric.trim(),
          timsCpu: timsCpuMetric.trim(),
          timsMemory: timsMemoryMetric.trim(),
        },
        baselineWindowSeconds: baselineHours * 3600,
        stabilizationSeconds: stabilizationMinutes * 60,
        postWindowSeconds: postMinutes * 60,
        enabled: true,
        resourceMappings: existing?.resourceMappings ?? [],
        rules: existing?.rules ?? [],
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success("Dynatrace configuration saved.")
    await router.invalidate()
    if (!existing) onSaved?.()
  }

  async function test() {
    setTesting(true)
    setMessage("")
    const result = await testDynatraceConnection({
      data: {
        applicationId: application.id,
        environmentBindingId: binding.id,
      },
    })
    setTesting(false)
    if (!result.ok) {
      setMessage(result.message ?? "Dynatrace connection test failed.")
      return
    }
    toast.success(
      `Dynatrace verified in ${result.result?.latencyMs ?? 0} ms with metrics.read and entities.read.`
    )
    await router.invalidate()
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h3 className="text-xl font-semibold">
            {existing ? "Connection and defaults" : "Configure Dynatrace"}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tokens remain secret references. Rhythm sends them only as an
            Api-Token header and stores no resolved credential values.
          </p>
        </div>
        {existing ? (
          <Button
            disabled={testing}
            onClick={() => void test()}
            variant="outline"
          >
            {testing ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <ShieldCheck />
            )}
            Test connection
          </Button>
        ) : null}
      </div>

      <div className="mt-6 grid gap-x-6 gap-y-5 lg:grid-cols-2">
        <Field
          label="Dynatrace connection"
          help="Only administrator-approved telemetry profiles are available."
        >
          <div>
            <Select
              value={connectionProfileId || null}
              onValueChange={(value) => setConnectionProfileId(value ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select Dynatrace connection" />
              </SelectTrigger>
              <SelectContent>
                {telemetryProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name} ·{" "}
                    {String(profile.config.host ?? "Dynatrace")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!telemetryProfiles.length ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <p className="text-sm text-muted-foreground">
                  Create the approved Amex Dynatrace connection once, then
                  return here to choose management zones and continue to
                  Resources.
                </p>
                <Button
                  nativeButton={false}
                  render={
                    <Link search={{ kind: "telemetry" }} to="/configuration" />
                  }
                  size="sm"
                  variant="outline"
                >
                  Create connection
                </Button>
              </div>
            ) : null}
          </div>
        </Field>
        <Field
          label="Credential override"
          help="Optional secret:// alias. Leave empty to inherit the connection credential."
        >
          <Input
            autoComplete="off"
            className="font-mono"
            onChange={(event) => setCredentialSecretRef(event.target.value)}
            placeholder="secret://application-dynatrace-token"
            value={credentialSecretRef}
          />
        </Field>
        <Field
          label="Platforms"
          help="Select both when this application spans Hydra and TIMS."
        >
          <div className="grid grid-cols-2 gap-2">
            <ToggleCard
              active={hydra}
              description="Kubernetes workloads"
              icon={Layers3}
              label="Hydra"
              onClick={() => setHydra((current) => !current)}
            />
            <ToggleCard
              active={tims}
              description="Hosts and host groups"
              icon={Server}
              label="TIMS"
              onClick={() => setTims((current) => !current)}
            />
          </div>
        </Field>
      </div>

      <div className="mt-7 border-y py-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h4 className="font-medium">Management zones</h4>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Enter the Dynatrace management zone name for this application
              (for example <span className="font-mono">AI_Firewall</span>).
              After saving, use Resources to load more zones from Dynatrace or
              refine the selection.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <ManagementZoneEditor
            onChange={setManagementZones}
            zones={managementZones}
          />
        </div>
      </div>

      <div className="mt-7 border-y py-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h4 className="font-medium">Metric query profiles</h4>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Rhythm automatically requests average and maximum CPU and memory
              series. Hydra is split by container; TIMS is split by host.
            </p>
          </div>
          <Badge className="bg-success-soft text-success-foreground">
            Production query shape
          </Badge>
        </div>
        <div className="mt-4 divide-y rounded-lg border">
          {hydra ? (
            <QueryProfileRow
              detail="CPU and memory · average and maximum"
              label="Hydra"
              scope="Container-wise"
            />
          ) : null}
          {tims ? (
            <QueryProfileRow
              detail="CPU and memory · average and maximum"
              label="TIMS"
              scope="Host-wise"
            />
          ) : null}
        </div>
        <details className="mt-4 rounded-lg border bg-muted/15">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Advanced metric keys
          </summary>
          <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
            <MetricKeyField
              label="Hydra CPU"
              onChange={setHydraCpuMetric}
              value={hydraCpuMetric}
            />
            <MetricKeyField
              label="Hydra memory"
              onChange={setHydraMemoryMetric}
              value={hydraMemoryMetric}
            />
            <MetricKeyField
              label="TIMS CPU"
              onChange={setTimsCpuMetric}
              value={timsCpuMetric}
            />
            <MetricKeyField
              label="TIMS memory"
              onChange={setTimsMemoryMetric}
              value={timsMemoryMetric}
            />
          </div>
        </details>
      </div>

      <div className="mt-7 border-y py-5">
        <h4 className="font-medium">Deployment observation windows</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Baseline ends exactly at deployment start. Post collection begins
          after deployment completion and stabilization.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Baseline hours">
            <Input
              min={1}
              onChange={(event) =>
                setBaselineHours(Number(event.target.value) || 1)
              }
              type="number"
              value={baselineHours}
            />
          </Field>
          <Field label="Stabilization minutes">
            <Input
              min={0}
              onChange={(event) =>
                setStabilizationMinutes(Number(event.target.value) || 0)
              }
              type="number"
              value={stabilizationMinutes}
            />
          </Field>
          <Field label="Post window minutes">
            <Input
              min={1}
              onChange={(event) =>
                setPostMinutes(Number(event.target.value) || 1)
              }
              type="number"
              value={postMinutes}
            />
          </Field>
        </div>
      </div>

      {message ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end">
        <Button
          disabled={
            pending || !connectionProfileId || (!hydra && !tims)
          }
          onClick={() => void save()}
        >
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
          {existing ? "Save changes" : "Save and continue"}
        </Button>
      </div>
    </div>
  )
}

function DynatraceOverview({
  binding,
  configuration,
  latestRun,
}: {
  application: ELFApplicationContract
  binding: DynatraceEnvironmentBindingContract
  configuration: DynatraceConfigurationContract
  latestRun?: DynatraceRunContract
}) {
  const readiness = [
    {
      label: "Connection",
      ready: configuration.lastTestStatus === "SUCCESS",
      detail:
        configuration.lastTestStatus === "SUCCESS"
          ? `Verified ${configuration.lastTestAt ? formatDateTime(configuration.lastTestAt) : ""}`
          : "Run a connection test",
    },
    {
      label: "Resources",
      ready: configuration.resourceMappings.length > 0,
      detail: `${configuration.resourceMappings.length} governed mapping${configuration.resourceMappings.length === 1 ? "" : "s"}`,
    },
    {
      label: "Metrics",
      ready: Boolean(
        configuration.metricMappings.cpu ||
          configuration.metricMappings.memory
      ),
      detail: [
        configuration.metricMappings.cpu ? "CPU" : "",
        configuration.metricMappings.memory ? "memory" : "",
      ]
        .filter(Boolean)
        .join(" and "),
    },
    {
      label: "Gate rules",
      ready: configuration.rules.length > 0,
      detail: configuration.rules.length
        ? `${configuration.rules.length} explicit rule${configuration.rules.length === 1 ? "" : "s"}`
        : "Advisory evidence only",
    },
  ]
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          detail={binding.environmentName}
          icon={DatabaseZap}
          label="Environment"
          value={binding.environmentType}
        />
        <SummaryCard
          detail={configuration.baseUrl ?? "Approved endpoint"}
          icon={CloudCog}
          label="Connection"
          value={configuration.connectionName ?? "Dynatrace"}
        />
        <SummaryCard
          detail={configuration.platforms.join(" + ")}
          icon={Server}
          label="Resource scope"
          value={`${configuration.resourceMappings.length} mappings`}
        />
        <SummaryCard
          detail={
            latestRun
              ? `${latestRun.coveragePercent.toFixed(0)}% evidence coverage`
              : "Run the first infrastructure query"
          }
          icon={Activity}
          label="Latest evidence"
          value={latestRun?.status.replaceAll("_", " ") ?? "No data"}
        />
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <h3 className="text-lg font-semibold">Configuration readiness</h3>
          <div className="mt-3 divide-y border-y">
            {readiness.map((item) => (
              <div
                className="flex items-center justify-between gap-4 py-3"
                key={item.label}
              >
                <div className="flex items-center gap-3">
                  {item.ready ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <CircleAlert className="size-4 text-warning" />
                  )}
                  <span className="text-sm font-medium">{item.label}</span>
                </div>
                <span className="text-right text-sm text-muted-foreground">
                  {item.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold">Effective governance</h3>
          <dl className="mt-3 space-y-3 text-sm">
            <Description
              label="Credential"
              value={configuration.effectiveCredential || "Inherited"}
            />
            <Description
              label="Management zones"
              value={
                configuration.managementZones.join(", ") ||
                "No zone selected"
              }
            />
            <Description
              label="Configuration revision"
              value={`Revision ${configuration.revisionNumber}`}
            />
            <Description
              label="Missing data"
              value="Blocking rules fail on no data; partial data warns unless coverage fails."
            />
          </dl>
        </div>
      </div>
    </div>
  )
}

function ResourcePanel({
  application,
  applicationId,
  bindingId,
  configuration,
}: {
  application: ELFApplicationContract
  applicationId: string
  bindingId: string
  configuration: DynatraceConfigurationContract
}) {
  const router = useRouter()
  const [mappings, setMappings] = useState(configuration.resourceMappings)
  const [preview, setPreview] =
    useState<DynatraceResourcePreviewContract | null>(null)
  const [pending, setPending] = useState(false)
  const [loadingZones, setLoadingZones] = useState(false)
  const [availableZones, setAvailableZones] = useState<string[]>([])
  const [discoveredServers, setDiscoveredServers] = useState<
    DynatraceEntityContract[]
  >([])
  const [selectedZones, setSelectedZones] = useState(
    configuration.managementZones
  )
  const [message, setMessage] = useState("")

  function addMapping(platform: "HYDRA" | "TIMS" = "HYDRA") {
    setMappings((current) => [
      ...current,
      {
        platform,
        entityType: platform === "TIMS" ? "HOST" : "KUBERNETES_WORKLOAD",
        mappingType: platform === "TIMS" ? "HOST_GROUP" : "WORKLOAD",
        value: "",
        label: "",
        enabled: true,
      },
    ])
  }

  function toggleApplicationService(service: ELFApplicationContract["services"][number]) {
    setMappings((current) => {
      const selected = current.some(
        (mapping) =>
          mapping.platform === "HYDRA" && mapping.serviceId === service.id
      )
      if (selected) {
        return current.filter(
          (mapping) =>
            !(mapping.platform === "HYDRA" && mapping.serviceId === service.id)
        )
      }
      return [
        ...current,
        {
          serviceId: service.id,
          platform: "HYDRA",
          entityType: "KUBERNETES_WORKLOAD",
          mappingType: "WORKLOAD",
          value: service.name,
          label: service.name,
          enabled: true,
        },
      ]
    })
  }

  async function loadZones() {
    setLoadingZones(true)
    setMessage("")
    const result = await listDynatraceManagementZones({
      data: { applicationId, environmentBindingId: bindingId },
    })
    setLoadingZones(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setAvailableZones(result.zones)
    if (!result.zones.length) {
      setMessage("No management zones were returned for this credential.")
    }
  }

  async function discoverServers() {
    if (!selectedZones.length) {
      setMessage("Choose a management zone before finding servers.")
      return
    }
    setPending(true)
    setMessage("")
    const result = await discoverDynatraceResources({
      data: {
        applicationId,
        environmentBindingId: bindingId,
        platform: "TIMS",
        managementZones: selectedZones,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setDiscoveredServers(result.resources)
    if (!result.resources.length) {
      setMessage("No TIMS servers were found in the selected management zones.")
    }
  }

  function toggleServer(server: DynatraceEntityContract) {
    setMappings((current) => {
      const selected = current.some(
        (mapping) =>
          mapping.platform === "TIMS" &&
          mapping.mappingType === "ENTITY_ID" &&
          mapping.value === server.id
      )
      if (selected) {
        return current.filter(
          (mapping) =>
            !(
              mapping.platform === "TIMS" &&
              mapping.mappingType === "ENTITY_ID" &&
              mapping.value === server.id
            )
        )
      }
      return [
        ...current,
        {
          platform: "TIMS",
          entityType: "HOST",
          mappingType: "ENTITY_ID",
          value: server.id,
          label: server.name,
          enabled: true,
        },
      ]
    })
  }

  async function save() {
    const selectedMappings = mappings.filter((mapping) => mapping.value.trim())
    const selectedPlatforms = (["HYDRA", "TIMS"] as const).filter((platform) =>
      selectedMappings.some((mapping) => mapping.platform === platform)
    )
    if (!selectedZones.length) {
      setMessage("Choose at least one management zone before saving.")
      return
    }
    if (!selectedMappings.length) {
      setMessage("Choose at least one service, server, or resource.")
      return
    }
    setPending(true)
    setMessage("")
    const result = await saveDynatraceConfiguration({
      data: {
        applicationId,
        environmentBindingId: bindingId,
        connectionProfileId: configuration.connectionProfileId,
        credentialSecretRef: configuration.credentialSecretRef ?? "",
        platforms: [...selectedPlatforms],
        managementZones: selectedZones,
        metricMappings: {
          cpu: configuration.metricMappings.cpu ?? "",
          memory: configuration.metricMappings.memory ?? "",
          hydraCpu:
            configuration.metricMappings.hydraCpu ??
            "builtin:containers.cpu.usagePercent",
          hydraMemory:
            configuration.metricMappings.hydraMemory ??
            "builtin:containers.memory.usagePercent",
          timsCpu:
            configuration.metricMappings.timsCpu ??
            configuration.metricMappings.cpu ??
            "builtin:host.cpu.usage",
          timsMemory:
            configuration.metricMappings.timsMemory ??
            configuration.metricMappings.memory ??
            "builtin:host.mem.usage",
        },
        baselineWindowSeconds: configuration.baselineWindowSeconds,
        stabilizationSeconds: configuration.stabilizationSeconds,
        postWindowSeconds: configuration.postWindowSeconds,
        enabled: configuration.enabled,
        resourceMappings: selectedMappings,
        rules: configuration.rules,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success("Resource mappings saved.")
    await router.invalidate()
  }

  async function runPreview() {
    setPending(true)
    setMessage("")
    const result = await previewDynatraceResources({
      data: { applicationId, environmentBindingId: bindingId, serviceId: "" },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setPreview(result.preview)
  }

  return (
    <div>
      <div>
        <h3 className="text-xl font-semibold">Choose infrastructure scope</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Select a management zone first, then choose registered services or
          add TIMS servers. Only the resulting intersection is queried.
        </p>
      </div>

      <div className="mt-6 border-y py-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h4 className="font-medium">1. Management zones</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              Load zones from Dynatrace, or type a known zone name such as{" "}
              <span className="font-mono">AI_Firewall</span>.
            </p>
          </div>
          <Button
            disabled={loadingZones}
            onClick={() => void loadZones()}
            variant="outline"
          >
            {loadingZones ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {availableZones.length ? "Refresh zones" : "Load management zones"}
          </Button>
        </div>
        <div className="mt-4">
          <ManagementZoneEditor
            availableZones={availableZones}
            onChange={(zones) => {
              setDiscoveredServers([])
              setSelectedZones(zones)
            }}
            zones={selectedZones}
          />
        </div>
      </div>

      <div className="mt-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h4 className="font-medium">2. Services and servers</h4>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Application services become Hydra workload mappings. TIMS servers
            can be selected by host group, host name, tag, or entity ID.
          </p>
        </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || !selectedZones.length}
              onClick={() => void discoverServers()}
              variant="outline"
            >
              <RefreshCw /> Find TIMS servers
            </Button>
            <Button onClick={() => addMapping("TIMS")} variant="outline">
              <Server /> Add server or host group
            </Button>
            <Button onClick={() => addMapping("HYDRA")} variant="outline">
              <Plus /> Add Hydra resource
            </Button>
          </div>
        </div>
        {application.services.length ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {application.services.map((service) => {
              const selected = mappings.some(
                (mapping) =>
                  mapping.platform === "HYDRA" &&
                  mapping.serviceId === service.id
              )
              return (
                <button
                  aria-pressed={selected}
                  className={`flex min-h-14 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                  key={service.id}
                  onClick={() => toggleApplicationService(service)}
                  type="button"
                >
                  {selected ? (
                    <CheckCircle2 className="size-5 shrink-0 text-primary" />
                  ) : (
                    <Layers3 className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <span>
                    <span className="block text-sm font-medium">
                      {service.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Hydra workload
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
        {discoveredServers.length ? (
          <div className="mt-6">
            <p className="text-sm font-medium">
              TIMS servers in selected zones
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {discoveredServers.map((server) => {
                const selected = mappings.some(
                  (mapping) =>
                    mapping.platform === "TIMS" &&
                    mapping.mappingType === "ENTITY_ID" &&
                    mapping.value === server.id
                )
                return (
                  <button
                    aria-pressed={selected}
                    className={`flex min-h-14 items-center gap-3 rounded-lg border px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                    key={server.id}
                    onClick={() => toggleServer(server)}
                    type="button"
                  >
                    {selected ? (
                      <CheckCircle2 className="size-5 shrink-0 text-primary" />
                    ) : (
                      <Server className="size-5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {server.name || server.id}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {server.managementZones.join(", ")}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-5 space-y-3">
        {mappings.map((mapping, index) => (
          <div
            className="grid gap-3 border-y bg-muted/10 py-4 md:grid-cols-[.7fr_1fr_1.4fr_auto]"
            key={mapping.id ?? index}
          >
            <Select
              value={mapping.platform}
              onValueChange={(value) =>
                setMappings((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          platform: value ?? "HYDRA",
                          entityType:
                            value === "TIMS"
                              ? "HOST"
                              : "KUBERNETES_WORKLOAD",
                        }
                      : item
                  )
                )
              }
            >
              <SelectTrigger aria-label={`Mapping ${index + 1} platform`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HYDRA">Hydra</SelectItem>
                <SelectItem value="TIMS">TIMS</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={mapping.mappingType}
              onValueChange={(value) =>
                setMappings((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          mappingType:
                            value as DynatraceResourceMappingContract["mappingType"],
                        }
                      : item
                  )
                )
              }
            >
              <SelectTrigger aria-label={`Mapping ${index + 1} type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(mapping.platform === "TIMS"
                  ? ["HOST_GROUP", "HOST", "TAG", "ENTITY_ID"]
                  : [
                      "NAMESPACE",
                      "WORKLOAD",
                      "CONTAINER_GROUP",
                      "CLUSTER",
                      "TAG",
                      "ENTITY_ID",
                    ]
                ).map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replaceAll("_", " ").toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={`Mapping ${index + 1} value`}
              onChange={(event) =>
                setMappings((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, value: event.target.value }
                      : item
                  )
                )
              }
              placeholder={
                mapping.platform === "TIMS"
                  ? "Host group, tag, or entity ID"
                  : "Namespace, workload, cluster, tag, or entity ID"
              }
              value={mapping.value}
            />
            <Button
              aria-label={`Remove mapping ${index + 1}`}
              onClick={() =>
                setMappings((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index)
                )
              }
              variant="ghost"
            >
              Remove
            </Button>
          </div>
        ))}
        {!mappings.length ? (
          <div className="border-y py-10 text-center">
            <Server className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 font-medium">No resource mappings</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a governed mapping before querying Dynatrace.
            </p>
          </div>
        ) : null}
      </div>
      {message ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button disabled={pending} onClick={() => void save()}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
          Save mappings
        </Button>
        <Button
          disabled={pending || !mappings.some((mapping) => mapping.value.trim())}
          onClick={() => void runPreview()}
          variant="outline"
        >
          <RefreshCw /> Preview resources
        </Button>
      </div>
      {preview ? (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-semibold">Resource preview</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {preview.included.length} included · {preview.conflicts.length}{" "}
                conflicts · {preview.unmatchedRules.length} unmatched rules
              </p>
            </div>
            {preview.truncated ? <Badge variant="secondary">Truncated</Badge> : null}
          </div>
          <div className="mt-3 divide-y border-y">
            {preview.included.map((entity) => (
              <div
                className="flex items-start justify-between gap-4 py-3"
                key={entity.id}
              >
                <div>
                  <p className="text-sm font-medium">{entity.name}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {entity.id}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant="outline">{entity.platform}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entity.managementZones.join(", ") || "No management zone"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MetricsPanel({
  applicationId,
  bindingId,
  configuration,
  latestRun,
}: {
  applicationId: string
  bindingId: string
  configuration: DynatraceConfigurationContract
  latestRun?: DynatraceRunContract
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [platform, setPlatform] = useState<"HYDRA" | "TIMS">(
    configuration.platforms[0] ?? "HYDRA"
  )
  const [window, setWindow] = useState<"10m" | "1h" | "24h">("10m")

  async function run() {
    setPending(true)
    setMessage("")
    const to = new Date()
    const windowMilliseconds = {
      "10m": 10 * 60_000,
      "1h": 60 * 60_000,
      "24h": 24 * 60 * 60_000,
    }[window]
    const resolution =
      window === "24h" ? (platform === "TIMS" ? "1d" : "1h") : "10m"
    const from = new Date(to.getTime() - windowMilliseconds)
    const result = await runDynatraceQuery({
      data: {
        applicationId,
        environmentBindingId: bindingId,
        serviceId: "",
        platform,
        timeFrom: from.toISOString(),
        timeTo: to.toISOString(),
        resolution,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success("Dynatrace evidence collected.")
    await router.invalidate()
  }

  const selectedRun = latestRun?.platform
    ?.split(",")
    .includes(platform)
    ? latestRun
    : undefined
  const cards = ["CPU", "MEMORY"].map((metric) => ({
    metric,
    statistics: selectedRun?.summary[metric],
  }))
  const compiledSelectors =
    platform === "HYDRA"
      ? [
          'builtin:containers.cpu.usagePercent:splitBy("Container"):avg:names',
          'builtin:containers.cpu.usagePercent:splitBy("Container"):max:names',
          'builtin:containers.memory.usagePercent:splitBy("Container"):avg:names',
          'builtin:containers.memory.usagePercent:splitBy("Container"):max:names',
        ]
      : [
          'builtin:host.cpu.usage:splitBy("dt.entity.host"):avg:names',
          'builtin:host.cpu.usage:splitBy("dt.entity.host"):max:names',
          'builtin:host.mem.usage:splitBy("dt.entity.host"):avg:names',
          'builtin:host.mem.usage:splitBy("dt.entity.host"):max:names',
        ]
  const zoneSelector = `mzName(${configuration.managementZones
    .map((zone) => JSON.stringify(zone))
    .join(",")})`
  return (
    <div>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h3 className="text-xl font-semibold">Infrastructure metrics</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Actual measured values only. No data is never displayed as zero.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={platform}
            onValueChange={(value) =>
              setPlatform((value as "HYDRA" | "TIMS") ?? "HYDRA")
            }
          >
            <SelectTrigger aria-label="Infrastructure platform" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {configuration.platforms.map((item) => (
                <SelectItem key={item} value={item}>
                  {item === "HYDRA" ? "Hydra containers" : "TIMS hosts"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={window}
            onValueChange={(value) =>
              setWindow((value as "10m" | "1h" | "24h") ?? "10m")
            }
          >
            <SelectTrigger aria-label="Metrics time window" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10m">Last 10 min</SelectItem>
              <SelectItem value="1h">Last hour</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
            </SelectContent>
          </Select>
          <Button
            disabled={pending || !configuration.managementZones.length}
            onClick={() => void run()}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Play />}
            Run query
          </Button>
        </div>
      </div>
      <div className="mt-5 flex flex-col justify-between gap-3 rounded-lg border bg-muted/15 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          {platform === "HYDRA" ? (
            <Layers3 className="size-5 text-primary" />
          ) : (
            <Server className="size-5 text-primary" />
          )}
          <div>
            <p className="text-sm font-medium">
              {platform === "HYDRA"
                ? "Container-wise CPU and memory"
                : "Host-wise CPU and memory"}
            </p>
            <p className="text-xs text-muted-foreground">
              Average and maximum series ·{" "}
              {configuration.managementZones.join(", ") ||
                "Select a management zone first"}
            </p>
          </div>
        </div>
        <Badge variant="outline">
          {platform === "HYDRA"
            ? 'splitBy("Container")'
            : 'splitBy("dt.entity.host")'}
        </Badge>
      </div>
      <details className="mt-3 rounded-lg border bg-muted/10">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          Review the governed Dynatrace query
        </summary>
        <div className="space-y-4 border-t px-4 py-4">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <QueryFact label="API" value="/api/v2/metrics/query" />
            <QueryFact
              label="Management zones"
              value={
                configuration.managementZones.length
                  ? zoneSelector
                  : "Not configured"
              }
            />
            <QueryFact
              label="Resolution"
              value={
                window === "24h"
                  ? platform === "TIMS"
                    ? "1d"
                    : "1h"
                  : "10m"
              }
            />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Metric selectors
            </p>
            <div className="mt-2 space-y-1.5">
              {compiledSelectors.map((selector) => (
                <code
                  className="block overflow-x-auto rounded bg-muted px-3 py-2 text-xs"
                  key={selector}
                >
                  {selector}
                </code>
              ))}
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Rhythm sends these selectors together for one absolute time window.
            The credential remains masked and is never included in this
            preview.
          </p>
        </div>
      </details>
      {message ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {cards.map(({ metric, statistics }) => (
          <div className="border-y py-5" key={metric}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="size-4 text-primary" />
                <h4 className="font-medium">{metric}</h4>
              </div>
              <Badge variant="outline">
                {statistics?.sampleCount ?? 0} samples
              </Badge>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-4">
              <MetricValue label="Average" value={statistics?.average} />
              <MetricValue label="p95" value={statistics?.p95} />
              <MetricValue label="Maximum" value={statistics?.maximum} />
            </div>
          </div>
        ))}
      </div>
      {selectedRun ? (
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">Resource evidence</h4>
            <Badge variant="outline">
              {platform === "HYDRA" ? "Hydra containers" : "TIMS hosts"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedRun.coveredResourceCount} covered resources ·{" "}
            {selectedRun.coveragePercent.toFixed(1)}% metric-series coverage ·{" "}
            {formatDateTime(selectedRun.createdAt)}
          </p>
          <div className="mt-3 divide-y border-y">
            {selectedRun.resources.slice(0, 100).map((resource, index) => (
              <div
                className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                key={`${resource.resourceId}-${resource.metric}-${index}`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {resource.resourceName || resource.resourceId}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {resource.resourceType || "Resource"}
                  </p>
                </div>
                <Badge variant="outline">
                  {resource.metric} {resource.aggregation ?? "AVG"}
                </Badge>
                <strong>
                  {formatMetric(
                    resource.aggregation === "MAX"
                      ? resource.statistics.maximum
                      : resource.statistics.average,
                    resource.unit
                  )}
                </strong>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-8 border-y py-12 text-center">
          <Activity className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-medium">No infrastructure evidence yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the selected {platform === "HYDRA" ? "container" : "host"}{" "}
            query to collect bounded evidence for this platform.
          </p>
        </div>
      )}
    </div>
  )
}

function QueryFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-xs">{value}</p>
    </div>
  )
}

function RulesPanel({
  applicationId,
  bindingId,
  rules: initialRules,
}: {
  applicationId: string
  bindingId: string
  rules: DynatraceRuleContract[]
}) {
  const router = useRouter()
  const [rules, setRules] = useState(initialRules)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")

  function addRule() {
    setRules((current) => [
      ...current,
      {
        name: "CPU p95 guardrail",
        metric: "CPU",
        statistic: "P95",
        operator: "GT",
        threshold: 80,
        comparison: "ABSOLUTE",
        scope: "SERVICE",
        gateMode: "ADVISORY",
        minimumCoveragePercent: 90,
        consecutivePoints: 1,
        enabled: true,
      },
    ])
  }

  async function save() {
    setPending(true)
    setMessage("")
    const result = await saveDynatraceRules({
      data: {
        applicationId,
        environmentBindingId: bindingId,
        rules,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    toast.success("Dynatrace deployment rules saved.")
    await router.invalidate()
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h3 className="text-xl font-semibold">Deployment guardrails</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Evidence remains advisory until an explicit rule is saved. Blocking
            rules fail on no data; partial data warns unless coverage fails.
          </p>
        </div>
        <Button onClick={addRule} variant="outline">
          <Plus /> Add rule
        </Button>
      </div>
      <div className="mt-5 space-y-4">
        {rules.map((rule, index) => (
          <div className="border-y bg-muted/10 py-5" key={rule.id ?? index}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <Input
                aria-label={`Rule ${index + 1} name`}
                className="xl:col-span-2"
                onChange={(event) =>
                  updateRule(setRules, index, { name: event.target.value })
                }
                value={rule.name}
              />
              <RuleSelect
                label={`Rule ${index + 1} metric`}
                onChange={(value) =>
                  updateRule(setRules, index, {
                    metric: value as "CPU" | "MEMORY",
                  })
                }
                options={["CPU", "MEMORY"]}
                value={rule.metric}
              />
              <RuleSelect
                label={`Rule ${index + 1} statistic`}
                onChange={(value) =>
                  updateRule(setRules, index, {
                    statistic:
                      value as DynatraceRuleContract["statistic"],
                  })
                }
                options={["AVERAGE", "MAXIMUM", "LATEST", "P50", "P95"]}
                value={rule.statistic}
              />
              <RuleSelect
                label={`Rule ${index + 1} operator`}
                onChange={(value) =>
                  updateRule(setRules, index, {
                    operator: value as DynatraceRuleContract["operator"],
                  })
                }
                options={["GT", "GTE", "LT", "LTE", "EQ"]}
                value={rule.operator}
              />
              <Input
                aria-label={`Rule ${index + 1} threshold`}
                onChange={(event) =>
                  updateRule(setRules, index, {
                    threshold: Number(event.target.value),
                  })
                }
                type="number"
                value={rule.threshold}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <RuleSelect
                label={`Rule ${index + 1} comparison`}
                onChange={(value) =>
                  updateRule(setRules, index, {
                    comparison:
                      value as DynatraceRuleContract["comparison"],
                  })
                }
                options={[
                  "ABSOLUTE",
                  "BASELINE_ABSOLUTE",
                  "BASELINE_PERCENT",
                ]}
                value={rule.comparison}
              />
              <RuleSelect
                label={`Rule ${index + 1} gate mode`}
                onChange={(value) =>
                  updateRule(setRules, index, {
                    gateMode:
                      value as DynatraceRuleContract["gateMode"],
                  })
                }
                options={["ADVISORY", "BLOCKING"]}
                value={rule.gateMode}
              />
              <Input
                aria-label={`Rule ${index + 1} minimum coverage percent`}
                className="w-40"
                max={100}
                min={0}
                onChange={(event) =>
                  updateRule(setRules, index, {
                    minimumCoveragePercent:
                      Number(event.target.value) || undefined,
                  })
                }
                placeholder="Min coverage %"
                type="number"
                value={rule.minimumCoveragePercent ?? ""}
              />
              <Button
                onClick={() =>
                  setRules((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index)
                  )
                }
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        {!rules.length ? (
          <div className="border-y py-12 text-center">
            <ShieldCheck className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 font-medium">No deployment guardrails</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Queries remain advisory until you add an explicit CPU or memory
              rule.
            </p>
          </div>
        ) : null}
      </div>
      {message ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end">
        <Button disabled={pending} onClick={() => void save()}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
          Save rules
        </Button>
      </div>
    </div>
  )
}

function HistoryPanel({ runs }: { runs: DynatraceRunContract[] }) {
  return (
    <div>
      <h3 className="text-xl font-semibold">Query history</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Sanitized normalized evidence. Raw Dynatrace payloads and tokens are
        never retained.
      </p>
      <div className="mt-5 divide-y border-y">
        {runs.map((run) => (
          <div
            className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center"
            key={run.id}
          >
            <div>
              <p className="font-medium">{formatDateTime(run.createdAt)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(run.timeFrom)} – {formatDateTime(run.timeTo)}
                {run.correlationId ? ` · ${run.correlationId}` : ""}
              </p>
            </div>
            <Badge variant={run.status === "PASS" ? "secondary" : "outline"}>
              {run.status.replaceAll("_", " ").toLowerCase()}
            </Badge>
            <span className="text-sm">
              {run.coveragePercent.toFixed(0)}% coverage
            </span>
            <span className="text-sm text-muted-foreground">
              {run.resourceCount} resources
            </span>
          </div>
        ))}
        {!runs.length ? (
          <div className="py-12 text-center">
            <Clock3 className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 font-medium">No query history</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Metrics queries and deployment comparisons will appear here.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="border-t pt-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <p className="mt-2 text-lg font-semibold capitalize">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function MetricValue({
  label,
  value,
}: {
  label: string
  value?: number
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">
        {value == null ? "Not recorded" : value.toFixed(2)}
      </p>
    </div>
  )
}

function Field({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {help ? (
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {help}
        </span>
      ) : null}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

function QueryProfileRow({
  detail,
  label,
  scope,
}: {
  detail: string
  label: string
  scope: string
}) {
  return (
    <div className="flex flex-col justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      <Badge variant="outline">{scope}</Badge>
    </div>
  )
}

function MetricKeyField({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="space-y-2 text-sm font-medium">
      <span>{label}</span>
      <Input
        className="font-mono text-sm"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  )
}

function ToggleCard({
  active,
  icon: Icon,
  label,
  description,
  onClick,
}: {
  active: boolean
  icon: typeof Server
  label: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-20 border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4" /> {label}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {description}
      </span>
    </button>
  )
}

function Description({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function RuleSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? "")}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option.replaceAll("_", " ").toLowerCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function updateRule(
  setter: React.Dispatch<React.SetStateAction<DynatraceRuleContract[]>>,
  index: number,
  patch: Partial<DynatraceRuleContract>
) {
  setter((current) =>
    current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item
    )
  )
}

function formatMetric(value: number | undefined, unit?: string) {
  if (value == null) return "Not recorded"
  return `${value.toFixed(2)}${unit ? ` ${unit}` : ""}`
}
