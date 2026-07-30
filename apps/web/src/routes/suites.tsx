import { useEffect, useId, useRef, useState } from "react"
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
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ArrowRight,
  Boxes,
  Check,
  CircleAlert,
  FilePenLine,
  GitBranch,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react"

import type {
  DynatraceEnvironmentBindingContract,
  ValidationSuiteContract,
  ValidationSuiteRunContract,
} from "@/lib/api-client/contracts"
import { listMonitors } from "@/lib/api-client/monitors"
import { listUnifiedAlerts } from "@/lib/api-client/opensearch-alerts"
import {
  createSuite,
  deleteSuite,
  listDeploymentValidations,
  listSuites,
  runSuite,
  updateSuite,
} from "@/lib/api-client/suites"
import { listELFApplications, listELFQueries } from "@/lib/api-client/elf"
import { listApplicationEnvironments } from "@/lib/api-client/dynatrace"
import { DeploymentWorkflow } from "@/features/suites/deployment-workflow"
import { PageContainer } from "@/components/page-container"

export const Route = createFileRoute("/suites")({
  loader: async () => {
    const [
      suites,
      monitorResult,
      elfQueries,
      deploymentRuns,
      applications,
      openSearchAlerts,
    ] = await Promise.all([
      listSuites(),
      listMonitors(),
      listELFQueries(),
      listDeploymentValidations(),
      listELFApplications(),
      listUnifiedAlerts({
        data: { sourceType: "OPENSEARCH_ALERTING", state: "", applicationId: "", serviceId: "", severity: "" },
      }).catch(() => []),
    ])
    const applicationEnvironments = Object.fromEntries(
      await Promise.all(
        applications.map(async (application) => [
          application.id,
          await listApplicationEnvironments({
            data: { applicationId: application.id },
          }).catch(() => []),
        ])
      )
    )
    return {
      suites,
      monitors: monitorResult.monitors,
      elfQueries,
      deploymentRuns,
      applications,
      openSearchAlerts,
      applicationEnvironments,
    }
  },
  component: SuitesPage,
})

type DraftCheck = {
  id: string
  kind:
    | "MONITOR"
    | "ELF_QUERY"
    | "OPENSEARCH_ALERT"
    | "DYNATRACE_INFRASTRUCTURE"
  monitorId: string
  queryId: string
  receiverId: string
  externalMonitorId: string
  externalTriggerId: string
  externalMonitorName: string
  externalTriggerName: string
  name: string
  required: boolean
  applicationId: string
  environmentBindingId: string
  serviceIds: string[]
  ruleIds: string[]
  gateMode: "ADVISORY" | "BLOCKING"
}

function alertOptionValue(alert: {
  receiverId?: string
  externalMonitorId?: string
  externalTriggerId?: string
  externalMonitorName?: string
  externalTriggerName?: string
}) {
  return [
    alert.receiverId ?? "",
    alert.externalMonitorId ?? "",
    alert.externalTriggerId ?? "",
    alert.externalMonitorName ?? "",
    alert.externalTriggerName ?? "",
  ].join("::")
}
type DraftStage = {
  id: string
  name: string
  order: number
  checks: DraftCheck[]
}

function SuitesPage() {
  const {
    suites,
    monitors,
    elfQueries,
    deploymentRuns,
    applications,
    openSearchAlerts,
    applicationEnvironments,
  } = Route.useLoaderData()
  const router = useRouter()
  const formErrorId = useId()
  const nameFieldId = useId()
  const runResultRef = useRef<HTMLElement>(null)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null)
  const [view, setView] = useState<"templates" | "deployments">("templates")
  const [deploymentOpen, setDeploymentOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [environment, setEnvironment] = useState("production")
  const [parallelism, setParallelism] = useState(2)
  const [failFast, setFailFast] = useState(true)
  const [timeoutSeconds, setTimeoutSeconds] = useState(900)
  const [baselinePolicy, setBaselinePolicy] = useState("NONE")
  const [notificationPolicy, setNotificationPolicy] = useState("FAILURES")
  const firstCheck = (): DraftCheck => ({
    id: "",
    kind: "MONITOR",
    monitorId: monitors[0]?.id ?? "",
    queryId: "",
    receiverId: "",
    externalMonitorId: "",
    externalTriggerId: "",
    externalMonitorName: "",
    externalTriggerName: "",
    name: monitors[0]?.name ?? "",
    required: true,
    applicationId: "",
    environmentBindingId: "",
    serviceIds: [],
    ruleIds: [],
    gateMode: "ADVISORY",
  })
  const alertOptions = (() => {
    const seen = new Set<string>()
    return openSearchAlerts.filter((alert) => {
      if (alert.sourceType !== "OPENSEARCH_ALERTING" || !alert.receiverId) {
        return false
      }
      const key = alertOptionValue(alert)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })()
  const [stages, setStages] = useState<DraftStage[]>([
    {
      id: "stage-1",
      name: "Availability and log checks",
      order: 1,
      checks: [{ ...firstCheck(), id: "stage-1-check-1" }],
    },
  ])
  const [pending, setPending] = useState(false)
  const [runningID, setRunningID] = useState("")
  const [message, setMessage] = useState("")
  const [latestRun, setLatestRun] = useState<ValidationSuiteRunContract | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] =
    useState<ValidationSuiteContract | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")

  useEffect(() => {
    if (!latestRun) return
    runResultRef.current?.focus()
  }, [latestRun])

  function resetBuilder() {
    setEditingSuiteId(null)
    setName("")
    setDescription("")
    setEnvironment("production")
    setParallelism(2)
    setFailFast(true)
    setTimeoutSeconds(900)
    setBaselinePolicy("NONE")
    setNotificationPolicy("FAILURES")
    setStages([
      {
        id: "stage-1",
        name: "Availability and log checks",
        order: 1,
        checks: [{ ...firstCheck(), id: "stage-1-check-1" }],
      },
    ])
  }

  function openCreateBuilder() {
    resetBuilder()
    setMessage("")
    setView("templates")
    setBuilderOpen(true)
  }

  function openEditBuilder(suite: ValidationSuiteContract) {
    setEditingSuiteId(suite.id)
    setName(suite.name)
    setDescription(suite.description ?? "")
    setEnvironment(suite.environment || "production")
    setParallelism(suite.parallelism)
    setFailFast(suite.failFast)
    setTimeoutSeconds(suite.timeoutSeconds)
    setBaselinePolicy(suite.baselinePolicy || "NONE")
    setNotificationPolicy(suite.notificationPolicy || "FAILURES")
    setStages(
      suite.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        order: stage.order,
        checks: stage.checks.map((check) => ({
          id: check.id,
          kind: check.kind,
          monitorId: check.monitorId ?? "",
          queryId: check.queryId ?? "",
          receiverId: check.receiverId ?? "",
          externalMonitorId: check.externalMonitorId ?? "",
          externalTriggerId: check.externalTriggerId ?? "",
          externalMonitorName: check.externalMonitorName ?? "",
          externalTriggerName: check.externalTriggerName ?? "",
          name: check.name ?? "",
          required: check.required,
          applicationId: check.applicationId ?? "",
          environmentBindingId: check.environmentBindingId ?? "",
          serviceIds: check.serviceIds ?? [],
          ruleIds: check.ruleIds ?? [],
          gateMode: check.gateMode ?? "ADVISORY",
        })),
      }))
    )
    setMessage("")
    setBuilderOpen(true)
    setView("templates")
  }

  function closeBuilder() {
    setBuilderOpen(false)
    resetBuilder()
  }

  function updateStage(
    index: number,
    update: (stage: DraftStage) => DraftStage
  ) {
    setStages((current) =>
      current.map((stage, position) =>
        position === index ? update(stage) : stage
      )
    )
  }
  function addStage() {
    setStages((current) => [
      ...current,
      {
        id: `stage-${current.length + 1}`,
        name: "",
        order: current.length + 1,
        checks: [
          { ...firstCheck(), id: `stage-${current.length + 1}-check-1` },
        ],
      },
    ])
  }
  function addCheck(stageIndex: number) {
    updateStage(stageIndex, (stage) => ({
      ...stage,
      checks: [
        ...stage.checks,
        { ...firstCheck(), id: `${stage.id}-check-${stage.checks.length + 1}` },
      ],
    }))
  }
  async function save() {
    setPending(true)
    setMessage("")
    const payload = {
      name,
      description,
      environment,
      stages,
      parallelism,
      failFast,
      timeoutSeconds,
      baselinePolicy,
      notificationPolicy,
    }
    const result = editingSuiteId
      ? await updateSuite({ data: { ...payload, suiteId: editingSuiteId } })
      : await createSuite({ data: payload })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      document.getElementById(nameFieldId)?.focus()
      return
    }
    closeBuilder()
    await router.invalidate()
  }
  async function execute(suiteID: string) {
    setRunningID(suiteID)
    setLatestRun(null)
    setMessage("")
    const result = await runSuite({
      data: {
        suiteId: suiteID,
        deploymentStart: new Date(Date.now() - 15 * 60_000).toISOString(),
      },
    })
    setRunningID("")
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setLatestRun(result.run)
  }

  function requestDelete(suite: ValidationSuiteContract) {
    setDeleteTarget(suite)
    setDeleteError("")
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError("")
    const result = await deleteSuite({ data: { suiteId: deleteTarget.id } })
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.message)
      return
    }
    setDeleteOpen(false)
    if (editingSuiteId === deleteTarget.id) closeBuilder()
    setDeleteTarget(null)
    await router.invalidate()
  }

  const saveDisabled =
    pending ||
    !name ||
    stages.some(
      (stage) =>
        !stage.name ||
        stage.checks.some((check) => {
          if (check.kind === "MONITOR") return !check.monitorId
          if (check.kind === "ELF_QUERY") return !check.queryId
          if (check.kind === "DYNATRACE_INFRASTRUCTURE") {
            return !check.applicationId || !check.environmentBindingId
          }
          return (
            !check.receiverId ||
            !(
              check.externalMonitorId ||
              check.externalMonitorName ||
              check.externalTriggerId ||
              check.externalTriggerName
            )
          )
        })
    )

  return (
    <PageContainer>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Release assurance
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold text-balance">
            Validation suites
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
            Compose published monitors, ELF queries, and OpenSearch alerts into
            deterministic, pipeline-ready validation suites.
          </p>
        </div>
        {view === "templates" ? (
          <Button
            onClick={() =>
              builderOpen && !editingSuiteId
                ? closeBuilder()
                : openCreateBuilder()
            }
          >
            <Plus /> New suite
          </Button>
        ) : (
          <Button onClick={() => setDeploymentOpen((value) => !value)}>
            <Play /> Run deployment validation
          </Button>
        )}
      </div>

      <Tabs
        value={view}
        onValueChange={(value) => {
          if (value === "templates" || value === "deployments") setView(value)
        }}
        className="mt-6 gap-0"
      >
        <TabsList
          aria-label="Validation suite views"
          variant="line"
          className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0"
        >
          <TabsTrigger
            value="templates"
            className="rounded-none px-3 py-2 data-active:bg-transparent"
          >
            Suite templates
          </TabsTrigger>
          <TabsTrigger
            value="deployments"
            className="rounded-none px-3 py-2 data-active:bg-transparent"
          >
            Deployment runs
          </TabsTrigger>
        </TabsList>

        {message ? (
          <div
            id={formErrorId}
            role="alert"
            aria-live="assertive"
            className="mt-5 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            {message}
          </div>
        ) : null}

        <TabsContent value="templates" className="mt-0 outline-none">
          {builderOpen ? (
            <section
              className="mt-6 rounded-xl border bg-muted/15 p-4 sm:p-5"
              aria-labelledby="suite-builder-title"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2
                    id="suite-builder-title"
                    className="font-heading text-lg font-semibold"
                  >
                    {editingSuiteId ? "Edit suite" : "New suite"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {editingSuiteId
                      ? "Update stages, checks, and gate behavior for this template."
                      : "Compose ordered stages from published monitors, ELF queries, and OpenSearch alerts."}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={closeBuilder} disabled={pending}>
                  Cancel
                </Button>
              </div>
              <form
                aria-describedby={message ? formErrorId : undefined}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!saveDisabled) void save()
                }}
              >
                <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                  <Field
                    htmlFor={nameFieldId}
                    label="Suite name"
                    error={Boolean(message && !name.trim())}
                  >
                    <Input
                      id={nameFieldId}
                      value={name}
                      aria-invalid={Boolean(message && !name.trim())}
                      aria-describedby={message ? formErrorId : undefined}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Production deployment gate"
                      required
                    />
                  </Field>
                  <Field label="Environment">
                    <Input
                      value={environment}
                      onChange={(event) => setEnvironment(event.target.value)}
                    />
                  </Field>
                  <Field label="Description" wide>
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Checks required before production traffic is promoted."
                    />
                  </Field>
                  <Field label="Parallel checks">
                    <Input
                      min={1}
                      max={20}
                      type="number"
                      value={parallelism}
                      onChange={(event) =>
                        setParallelism(Number(event.target.value))
                      }
                    />
                  </Field>
                  <label className="flex min-h-11 items-center gap-2 self-end pb-1 text-sm sm:pb-2">
                    <Checkbox
                      checked={failFast}
                      onCheckedChange={(checked) =>
                        setFailFast(checked === true)
                      }
                    />{" "}
                    Stop after a required stage fails
                  </label>
                </div>

                <details className="mt-5 rounded-lg border bg-background">
                  <summary className="cursor-pointer px-3 py-3 text-sm font-medium sm:px-4">
                    Gate behavior
                  </summary>
                  <div className="grid gap-3 border-t px-3 py-3 sm:grid-cols-3 sm:gap-4 sm:px-4 sm:py-4">
                    <Field label="Overall timeout (seconds)">
                      <Input
                        min={30}
                        max={7200}
                        type="number"
                        value={timeoutSeconds}
                        onChange={(event) =>
                          setTimeoutSeconds(Number(event.target.value))
                        }
                      />
                    </Field>
                    <Field label="Baseline policy">
                      <Select
                        value={baselinePolicy}
                        onValueChange={(value) => {
                          if (value == null) return
                          setBaselinePolicy(value)
                        }}
                        items={[
                          { value: "NONE", label: "No baseline comparison" },
                          {
                            value: "WARN",
                            label: "Warn when baseline is thin",
                          },
                          {
                            value: "REQUIRE",
                            label: "Require baseline samples",
                          },
                        ]}
                      >
                        <SelectTrigger aria-label="Gate mode" className="h-9 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">
                            No baseline comparison
                          </SelectItem>
                          <SelectItem value="WARN">
                            Warn when baseline is thin
                          </SelectItem>
                          <SelectItem value="REQUIRE">
                            Require baseline samples
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Notification policy">
                      <Select
                        value={notificationPolicy}
                        onValueChange={(value) => {
                          if (value == null) return
                          setNotificationPolicy(value)
                        }}
                        items={[
                          { value: "NONE", label: "No notifications" },
                          { value: "FAILURES", label: "Notify on failures" },
                          { value: "ALWAYS", label: "Notify on every run" },
                        ]}
                      >
                        <SelectTrigger aria-label="Environment" className="h-9 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">No notifications</SelectItem>
                          <SelectItem value="FAILURES">
                            Notify on failures
                          </SelectItem>
                          <SelectItem value="ALWAYS">
                            Notify on every run
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </details>

                <div className="mt-6 divide-y rounded-xl border bg-background">
                  {stages.map((stage, stageIndex) => (
                    <div key={stage.id} className="p-3 sm:p-4">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {stageIndex + 1}
                        </span>
                        <Input
                          aria-label={`Stage ${stageIndex + 1} name`}
                          className="min-w-0 flex-1 font-medium sm:max-w-md"
                          value={stage.name}
                          onChange={(event) =>
                            updateStage(stageIndex, (current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          placeholder="Stage name"
                          required
                        />
                        {stages.length > 1 ? (
                          <Button
                            type="button"
                            aria-label="Remove stage"
                            className="ml-auto min-h-11 min-w-11"
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setStages((current) =>
                                current
                                  .filter((_, index) => index !== stageIndex)
                                  .map((item, index) => ({
                                    ...item,
                                    order: index + 1,
                                  }))
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                      <div className="mt-3 space-y-2 sm:mt-4">
                        {stage.checks.map((check, checkIndex) => (
                          <div
                            key={check.id}
                            className="grid items-center gap-2 rounded-lg bg-muted/40 p-2.5 sm:grid-cols-[130px_1fr_auto_auto] sm:p-3"
                          >
                            <Select
                              value={check.kind}
                              onValueChange={(value) => {
                                if (value == null) return
                                const kind = value
                                const firstAlert = alertOptions[0]
                                const firstApplication = applications[0]
                                const firstEnvironment = firstApplication
                                  ? applicationEnvironments[
                                      firstApplication.id
                                    ]?.[0]
                                  : undefined
                                updateStage(stageIndex, (current) => ({
                                  ...current,
                                  checks: current.checks.map((item, index) =>
                                    index === checkIndex
                                      ? {
                                          ...item,
                                          kind,
                                          monitorId:
                                            kind === "MONITOR"
                                              ? (monitors[0]?.id ?? "")
                                              : "",
                                          queryId:
                                            kind === "ELF_QUERY"
                                              ? (elfQueries[0]?.id ?? "")
                                              : "",
                                          receiverId:
                                            kind === "OPENSEARCH_ALERT"
                                              ? (firstAlert?.receiverId ?? "")
                                              : "",
                                          externalMonitorId:
                                            kind === "OPENSEARCH_ALERT"
                                              ? (firstAlert?.externalMonitorId ??
                                                "")
                                              : "",
                                          externalTriggerId:
                                            kind === "OPENSEARCH_ALERT"
                                              ? (firstAlert?.externalTriggerId ??
                                                "")
                                              : "",
                                          externalMonitorName:
                                            kind === "OPENSEARCH_ALERT"
                                              ? (firstAlert?.externalMonitorName ??
                                                "")
                                              : "",
                                          externalTriggerName:
                                            kind === "OPENSEARCH_ALERT"
                                              ? (firstAlert?.externalTriggerName ??
                                                "")
                                              : "",
                                          applicationId:
                                            kind ===
                                            "DYNATRACE_INFRASTRUCTURE"
                                              ? (firstApplication?.id ?? "")
                                              : "",
                                          environmentBindingId:
                                            kind ===
                                            "DYNATRACE_INFRASTRUCTURE"
                                              ? (firstEnvironment?.id ?? "")
                                              : "",
                                          serviceIds: [],
                                          ruleIds: [],
                                          gateMode: "ADVISORY",
                                          name:
                                            kind === "MONITOR"
                                              ? (monitors[0]?.name ?? "")
                                              : kind === "ELF_QUERY"
                                                ? (elfQueries[0]?.name ?? "")
                                                : kind ===
                                                    "DYNATRACE_INFRASTRUCTURE"
                                                  ? "Dynatrace infrastructure"
                                                : (firstAlert?.title ??
                                                  firstAlert?.externalTriggerName ??
                                                  ""),
                                          required:
                                            kind !== "ELF_QUERY" &&
                                            kind !==
                                              "DYNATRACE_INFRASTRUCTURE",
                                        }
                                      : item
                                  ),
                                }))
                              }}
                              items={[
                                { value: "MONITOR", label: "Monitor" },
                                { value: "ELF_QUERY", label: "ELF query" },
                                {
                                  value: "OPENSEARCH_ALERT",
                                  label: "OpenSearch alert",
                                },
                                {
                                  value: "DYNATRACE_INFRASTRUCTURE",
                                  label: "Dynatrace infrastructure",
                                },
                              ]}
                            >
                              <SelectTrigger
                                aria-label="Check type"
                                className="h-9 w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="MONITOR">Monitor</SelectItem>
                                <SelectItem value="ELF_QUERY">
                                  ELF query
                                </SelectItem>
                                <SelectItem value="OPENSEARCH_ALERT">
                                  OpenSearch alert
                                </SelectItem>
                                <SelectItem value="DYNATRACE_INFRASTRUCTURE">
                                  Dynatrace infrastructure
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            {check.kind === "MONITOR" ? (
                              <Select
                                value={check.monitorId || null}
                                onValueChange={(value) => {
                                  if (value == null) return
                                  const monitor = monitors.find(
                                    (item) => item.id === value
                                  )
                                  updateStage(stageIndex, (current) => ({
                                    ...current,
                                    checks: current.checks.map((item, index) =>
                                      index === checkIndex
                                        ? {
                                            ...item,
                                            monitorId: value,
                                            name: monitor?.name ?? "",
                                          }
                                        : item
                                    ),
                                  }))
                                }}
                                items={monitors.map((monitor) => ({
                                  value: monitor.id,
                                  label: `${monitor.name} · ${monitor.state}`,
                                }))}
                              >
                                <SelectTrigger
                                  aria-label="Monitor"
                                  className="h-9 w-full min-w-0"
                                >
                                  <SelectValue placeholder="Select monitor" />
                                </SelectTrigger>
                                <SelectContent>
                                  {monitors.map((monitor) => (
                                    <SelectItem
                                      key={monitor.id}
                                      value={monitor.id}
                                    >
                                      {monitor.name} · {monitor.state}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : check.kind === "ELF_QUERY" ? (
                              <Select
                                value={check.queryId || null}
                                onValueChange={(value) => {
                                  if (value == null) return
                                  const query = elfQueries.find(
                                    (item) => item.id === value
                                  )
                                  updateStage(stageIndex, (current) => ({
                                    ...current,
                                    checks: current.checks.map((item, index) =>
                                      index === checkIndex
                                        ? {
                                            ...item,
                                            queryId: value,
                                            name: query?.name ?? "",
                                            required:
                                              query?.gateMode === "BLOCKING",
                                          }
                                        : item
                                    ),
                                  }))
                                }}
                                items={elfQueries.map((query) => ({
                                  value: query.id,
                                  label: `${query.name} · ${query.gateMode}`,
                                }))}
                              >
                                <SelectTrigger
                                  aria-label="ELF query"
                                  className="h-9 w-full min-w-0"
                                >
                                  <SelectValue placeholder="Select ELF query" />
                                </SelectTrigger>
                                <SelectContent>
                                  {elfQueries.map((query) => (
                                    <SelectItem
                                      key={query.id}
                                      value={query.id}
                                    >
                                      {query.name} · {query.gateMode}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : check.kind ===
                              "DYNATRACE_INFRASTRUCTURE" ? (
                              <div className="grid gap-2 sm:grid-cols-2">
                                <Select
                                  value={check.applicationId || null}
                                  onValueChange={(value) => {
                                    if (value == null) return
                                    const environment =
                                      applicationEnvironments[value]?.[0]
                                    const application = applications.find(
                                      (item) => item.id === value
                                    )
                                    updateStage(stageIndex, (current) => ({
                                      ...current,
                                      checks: current.checks.map(
                                        (item, index) =>
                                          index === checkIndex
                                            ? {
                                                ...item,
                                                applicationId: value,
                                                environmentBindingId:
                                                  environment?.id ?? "",
                                                name: `${application?.name ?? "Application"} infrastructure`,
                                              }
                                            : item
                                      ),
                                    }))
                                  }}
                                >
                                  <SelectTrigger
                                    aria-label="Dynatrace application"
                                    className="h-9 w-full min-w-0"
                                  >
                                    <SelectValue placeholder="Application" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {applications.map((application) => (
                                      <SelectItem
                                        key={application.id}
                                        value={application.id}
                                      >
                                        {application.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Select
                                  value={check.environmentBindingId || null}
                                  onValueChange={(value) => {
                                    if (value == null) return
                                    updateStage(stageIndex, (current) => ({
                                      ...current,
                                      checks: current.checks.map(
                                        (item, index) =>
                                          index === checkIndex
                                            ? {
                                                ...item,
                                                environmentBindingId: value,
                                              }
                                            : item
                                      ),
                                    }))
                                  }}
                                >
                                  <SelectTrigger
                                    aria-label="Dynatrace application environment"
                                    className="h-9 w-full min-w-0"
                                  >
                                    <SelectValue placeholder="Environment" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(
                                      applicationEnvironments[
                                        check.applicationId
                                      ] ?? []
                                    ).map(
                                      (
                                        environment: DynatraceEnvironmentBindingContract
                                      ) => (
                                      <SelectItem
                                        key={environment.id}
                                        value={environment.id}
                                      >
                                        {environment.environmentName} ·{" "}
                                        {environment.dynatraceConfigured
                                          ? "configured"
                                          : "setup required"}
                                      </SelectItem>
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : (
                              <Select
                                value={
                                  check.receiverId
                                    ? alertOptionValue(check)
                                    : null
                                }
                                onValueChange={(value) => {
                                  if (value == null) return
                                  const alert = alertOptions.find(
                                    (item) => alertOptionValue(item) === value
                                  )
                                  if (!alert) return
                                  updateStage(stageIndex, (current) => ({
                                    ...current,
                                    checks: current.checks.map((item, index) =>
                                      index === checkIndex
                                        ? {
                                            ...item,
                                            receiverId: alert.receiverId ?? "",
                                            externalMonitorId:
                                              alert.externalMonitorId ?? "",
                                            externalTriggerId:
                                              alert.externalTriggerId ?? "",
                                            externalMonitorName:
                                              alert.externalMonitorName ?? "",
                                            externalTriggerName:
                                              alert.externalTriggerName ?? "",
                                            name:
                                              alert.title ||
                                              alert.externalTriggerName ||
                                              alert.externalMonitorName ||
                                              "",
                                          }
                                        : item
                                    ),
                                  }))
                                }}
                                items={alertOptions.map((alert) => ({
                                  value: alertOptionValue(alert),
                                  label: `${alert.title} · ${alert.applicationName || "App"} · ${alert.state}`,
                                }))}
                              >
                                <SelectTrigger
                                  aria-label="OpenSearch alert"
                                  className="h-9 w-full min-w-0"
                                >
                                  <SelectValue
                                    placeholder={
                                      alertOptions.length
                                        ? "Select OpenSearch alert"
                                        : "No received alerts yet"
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {alertOptions.map((alert) => (
                                    <SelectItem
                                      key={alert.id}
                                      value={alertOptionValue(alert)}
                                    >
                                      {alert.title} ·{" "}
                                      {alert.applicationName || "App"} ·{" "}
                                      {alert.state}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            <label className="flex min-h-11 items-center gap-2 text-xs">
                              <Checkbox
                                disabled={check.kind === "ELF_QUERY"}
                                checked={check.required}
                                onCheckedChange={(checked) =>
                                  updateStage(stageIndex, (current) => ({
                                    ...current,
                                    checks: current.checks.map((item, index) =>
                                      index === checkIndex
                                        ? {
                                            ...item,
                                            required: checked === true,
                                            ...(item.kind ===
                                            "DYNATRACE_INFRASTRUCTURE"
                                              ? {
                                                  gateMode:
                                                    checked === true
                                                      ? ("BLOCKING" as const)
                                                      : ("ADVISORY" as const),
                                                }
                                              : {}),
                                          }
                                        : item
                                    ),
                                  }))
                                }
                              />
                              {check.kind === "ELF_QUERY"
                                ? check.required
                                  ? "Blocking"
                                  : "Advisory"
                                : check.kind ===
                                    "DYNATRACE_INFRASTRUCTURE"
                                  ? check.gateMode === "BLOCKING"
                                    ? "Blocking"
                                    : "Advisory"
                                : "Required"}
                            </label>
                            {stage.checks.length > 1 ? (
                              <Button
                                type="button"
                                aria-label="Remove check"
                                className="min-h-11 min-w-11"
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  updateStage(stageIndex, (current) => ({
                                    ...current,
                                    checks: current.checks.filter(
                                      (_, index) => index !== checkIndex
                                    ),
                                  }))
                                }
                              >
                                <Trash2 />
                              </Button>
                            ) : (
                              <span className="hidden size-11 sm:block" />
                            )}
                          </div>
                        ))}
                      </div>
                      <Button
                        type="button"
                        className="mt-3"
                        size="sm"
                        variant="outline"
                        onClick={() => addCheck(stageIndex)}
                      >
                        <Plus /> Add check
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="outline" onClick={addStage}>
                    <GitBranch /> Add stage
                  </Button>
                  <Button type="submit" disabled={pending || saveDisabled}>
                    {pending ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Check />
                    )}{" "}
                    {editingSuiteId ? "Save changes" : "Save suite"}
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          {latestRun ? (
            <RunResult run={latestRun} resultRef={runResultRef} />
          ) : null}

          <section className="mt-8" aria-labelledby="suite-list-heading">
            <h2
              id="suite-list-heading"
              className="font-heading text-lg font-semibold"
            >
              Validation suites
            </h2>
            {suites.length ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {suites.map((suite) => (
                  <article className="rounded-xl border p-4 sm:p-5" key={suite.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{suite.name}</h3>
                        <Badge variant="secondary">
                          {suite.environment || "Any environment"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {suite.description ||
                          `${suite.stages.length} ordered stage${suite.stages.length === 1 ? "" : "s"}`}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {suite.stages.map((stage) => (
                          <span
                            key={stage.id}
                            className="rounded-md bg-muted px-2 py-1"
                          >
                            {stage.order}. {stage.name} · {stage.checks.length}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4">
                      <span className="text-xs text-muted-foreground">
                        {suite.parallelism} parallel ·{" "}
                        {suite.failFast ? "fail fast" : "run all"}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          className="min-h-11 px-3 max-lg:min-w-11"
                          disabled={runningID === suite.id}
                          size="sm"
                          onClick={() => execute(suite.id)}
                        >
                          {runningID === suite.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Play />
                          )}{" "}
                          <span className="max-sm:sr-only">Run</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                aria-label={`More actions for ${suite.name}`}
                                className="min-h-11 min-w-11"
                                size="icon"
                                variant="ghost"
                              />
                            }
                          >
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-48">
                            <DropdownMenuItem
                              onClick={() => openEditBuilder(suite)}
                            >
                              <FilePenLine /> Edit suite
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={runningID === suite.id}
                              onClick={() => execute(suite.id)}
                            >
                              {runningID === suite.id ? (
                                <LoaderCircle className="animate-spin" />
                              ) : (
                                <Play />
                              )}{" "}
                              Run suite
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => requestDelete(suite)}
                            >
                              <Trash2 /> Delete permanently
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed px-4 py-14 text-center">
                <Boxes
                  className="mx-auto size-7 text-muted-foreground"
                  aria-hidden
                />
                <p className="mt-3 font-medium">No validation suites yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Build a staged release suite from published monitors, ELF
                  queries, and OpenSearch alerts.
                </p>
                <Button className="mt-5" onClick={openCreateBuilder}>
                  <Plus /> New suite
                </Button>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="deployments" className="mt-0 outline-none">
          <DeploymentWorkflow
            suites={suites}
            applications={applications}
            runs={deploymentRuns}
            open={deploymentOpen}
            onOpenChange={setDeploymentOpen}
          />
        </TabsContent>
      </Tabs>

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
            <AlertDialogTitle>Delete suite permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Rhythm will permanently remove{" "}
              <strong>{deleteTarget?.name}</strong> and its suite runs and
              deployment validations.
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
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
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

function RunResult({
  run,
  resultRef,
}: {
  run: ValidationSuiteRunContract
  resultRef: React.RefObject<HTMLElement | null>
}) {
  const allowed = run.gateDecision !== "BLOCK"
  return (
    <section
      ref={resultRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className={`mt-6 rounded-xl border p-4 outline-none sm:p-5 ${allowed ? "border-success/30 bg-success-soft/45" : "border-destructive/30 bg-destructive/5"}`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          {allowed ? (
            <Check className="size-5 text-success-foreground" aria-hidden />
          ) : (
            <CircleAlert className="size-5 text-destructive" aria-hidden />
          )}
          <div>
            <p className="font-heading text-lg font-semibold">
              Gate decision: {run.gateDecision.replaceAll("_", " ")}
            </p>
            <p className="text-sm text-muted-foreground">
              {run.status} · {run.durationMs} ms · {run.results.length} checks
            </p>
          </div>
        </div>
        <Badge variant="secondary">{run.triggerType}</Badge>
      </div>
      <div className="mt-4 divide-y rounded-lg border bg-background">
        {run.results.map((result) => (
          <div
            className="flex flex-col justify-between gap-2 p-3 text-sm sm:flex-row sm:items-center"
            key={result.checkId}
          >
            <div>
              <p className="font-medium">
                {result.name ||
                  result.monitorId ||
                  result.queryId ||
                  result.externalTriggerName ||
                  result.externalMonitorName}
              </p>
              <p className="text-xs text-muted-foreground">
                {result.stageName} ·{" "}
                {result.kind === "ELF_QUERY"
                  ? `${result.gateMode} · ${result.hitCount ?? 0} hits`
                  : result.kind === "OPENSEARCH_ALERT"
                    ? `${result.alertState || "not observed"}${result.required ? " · Required" : " · Optional"}`
                    : result.required
                      ? "Required"
                      : "Optional"}
                {result.failureReason ? ` · ${result.failureReason}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                className={
                  result.status === "SUCCESS"
                    ? "bg-success-soft text-success-foreground"
                    : "bg-destructive/10 text-destructive"
                }
                variant="secondary"
              >
                {result.status}
              </Badge>
              {result.monitorRunId && result.monitorId ? (
                <Link
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  params={{ monitorId: result.monitorId }}
                  search={{ run: result.monitorRunId }}
                  to="/monitors/$monitorId/runs"
                >
                  Diagnostics <ArrowRight className="size-3" />
                </Link>
              ) : result.queryId ? (
                <Link
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  params={{ queryId: result.queryId }}
                  to="/elf/$queryId"
                >
                  Log evidence <ArrowRight className="size-3" />
                </Link>
              ) : result.kind === "OPENSEARCH_ALERT" ? (
                <Link
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  to="/alerts"
                >
                  Alerts <ArrowRight className="size-3" />
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Field({
  label,
  wide,
  htmlFor,
  error,
  children,
}: {
  label: string
  wide?: boolean
  htmlFor?: string
  error?: boolean
  children: React.ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`text-xs font-medium ${wide ? "md:col-span-2" : ""} ${error ? "text-destructive" : ""}`}
    >
      {label}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}
