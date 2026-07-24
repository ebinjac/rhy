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
import { DeploymentWorkflow } from "@/features/suites/deployment-workflow"

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
    return {
      suites,
      monitors: monitorResult.monitors,
      elfQueries,
      deploymentRuns,
      applications,
      openSearchAlerts,
    }
  },
  component: SuitesPage,
})

type DraftCheck = {
  id: string
  kind: "MONITOR" | "ELF_QUERY" | "OPENSEARCH_ALERT"
  monitorId: string
  queryId: string
  receiverId: string
  externalMonitorId: string
  externalTriggerId: string
  externalMonitorName: string
  externalTriggerName: string
  name: string
  required: boolean
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
  } = Route.useLoaderData()
  const router = useRouter()
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

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Release assurance
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold">
            Validation suites
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose published monitors into deterministic, pipeline-ready
            deployment gates.
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
      <div
        className="mt-6 flex gap-1 border-b"
        role="tablist"
        aria-label="Validation suite views"
      >
        <Button
          className="rounded-b-none"
          variant={view === "templates" ? "secondary" : "ghost"}
          role="tab"
          aria-selected={view === "templates"}
          onClick={() => setView("templates")}
        >
          Suite templates
        </Button>
        <Button
          className="rounded-b-none"
          variant={view === "deployments" ? "secondary" : "ghost"}
          role="tab"
          aria-selected={view === "deployments"}
          onClick={() => setView("deployments")}
        >
          Deployment runs
        </Button>
      </div>
      {message ? (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="size-4" />
          {message}
        </div>
      ) : null}
      {view === "templates" && builderOpen ? (
        <section className="mt-6 rounded-xl border bg-muted/15 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-semibold">
                {editingSuiteId ? "Edit suite" : "New suite"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {editingSuiteId
                  ? "Update stages, checks, and gate behavior for this template."
                  : "Compose ordered stages from published monitors and ELF queries."}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={closeBuilder}>
              Cancel
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Suite name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production deployment gate"
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
                onChange={(event) => setParallelism(Number(event.target.value))}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Checkbox
                checked={failFast}
                onCheckedChange={(checked) => setFailFast(checked === true)}
              />{" "}
              Stop after a required stage fails
            </label>
          </div>
          <div className="mt-6 space-y-4">
            {stages.map((stage, stageIndex) => (
              <div
                key={stage.id}
                className="rounded-xl border bg-background p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {stageIndex + 1}
                  </span>
                  <Input
                    aria-label={`Stage ${stageIndex + 1} name`}
                    className="max-w-md font-medium"
                    value={stage.name}
                    onChange={(event) =>
                      updateStage(stageIndex, (current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Stage name"
                  />
                  {stages.length > 1 ? (
                    <Button
                      aria-label="Remove stage"
                      className="ml-auto"
                      size="icon-sm"
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
                <div className="mt-4 space-y-2">
                  {stage.checks.map((check, checkIndex) => (
                    <div
                      key={check.id}
                      className="grid items-center gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[130px_1fr_auto_auto]"
                    >
                      <Select
                        value={check.kind}
                        onValueChange={(value) => {
                          if (value == null) return
                          const kind = value as DraftCheck["kind"]
                          const firstAlert = alertOptions[0]
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
                                        ? (firstAlert?.externalMonitorId ?? "")
                                        : "",
                                    externalTriggerId:
                                      kind === "OPENSEARCH_ALERT"
                                        ? (firstAlert?.externalTriggerId ?? "")
                                        : "",
                                    externalMonitorName:
                                      kind === "OPENSEARCH_ALERT"
                                        ? (firstAlert?.externalMonitorName ?? "")
                                        : "",
                                    externalTriggerName:
                                      kind === "OPENSEARCH_ALERT"
                                        ? (firstAlert?.externalTriggerName ?? "")
                                        : "",
                                    name:
                                      kind === "MONITOR"
                                        ? (monitors[0]?.name ?? "")
                                        : kind === "ELF_QUERY"
                                          ? (elfQueries[0]?.name ?? "")
                                          : (firstAlert?.title ??
                                            firstAlert?.externalTriggerName ??
                                            ""),
                                    required: kind !== "ELF_QUERY",
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
                          <SelectItem value="ELF_QUERY">ELF query</SelectItem>
                          <SelectItem value="OPENSEARCH_ALERT">
                            OpenSearch alert
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
                              <SelectItem key={monitor.id} value={monitor.id}>
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
                                      required: query?.gateMode === "BLOCKING",
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
                              <SelectItem key={query.id} value={query.id}>
                                {query.name} · {query.gateMode}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                                {alert.applicationName || "App"} · {alert.state}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          disabled={check.kind === "ELF_QUERY"}
                          checked={check.required}
                          onCheckedChange={(checked) =>
                            updateStage(stageIndex, (current) => ({
                              ...current,
                              checks: current.checks.map((item, index) =>
                                index === checkIndex
                                  ? { ...item, required: checked === true }
                                  : item
                              ),
                            }))
                          }
                        />
                        {check.kind === "ELF_QUERY"
                          ? check.required
                            ? "Blocking"
                            : "Advisory"
                          : "Required"}
                      </label>
                      {stage.checks.length > 1 ? (
                        <Button
                          aria-label="Remove check"
                          size="icon-sm"
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
                        <span className="size-8" />
                      )}
                    </div>
                  ))}
                </div>
                <Button
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
            <Button variant="outline" onClick={addStage}>
              <GitBranch /> Add stage
            </Button>
            <Button
              disabled={
                pending ||
                !name ||
                stages.some(
                  (stage) =>
                    !stage.name ||
                    stage.checks.some((check) => {
                      if (check.kind === "MONITOR") return !check.monitorId
                      if (check.kind === "ELF_QUERY") return !check.queryId
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
              }
              onClick={save}
            >
              {pending ? <LoaderCircle className="animate-spin" /> : <Check />}{" "}
              {editingSuiteId ? "Save changes" : "Save suite"}
            </Button>
          </div>
        </section>
      ) : null}
      {view === "templates" && latestRun ? <RunResult run={latestRun} /> : null}
      <section className={view === "templates" ? "mt-8" : "hidden"}>
        <h2 className="font-heading text-lg font-semibold">Deployment gates</h2>
        {suites.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {suites.map((suite) => (
              <article className="rounded-xl border p-5" key={suite.id}>
                <div className="flex items-start gap-3">
                  <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Boxes className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
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
                </div>
                <div className="mt-5 flex items-center justify-between border-t pt-4">
                  <span className="text-xs text-muted-foreground">
                    {suite.parallelism} parallel ·{" "}
                    {suite.failFast ? "fail fast" : "run all"}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      disabled={runningID === suite.id}
                      size="sm"
                      onClick={() => execute(suite.id)}
                    >
                      {runningID === suite.id ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Play />
                      )}{" "}
                      Run gate
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label={`More actions for ${suite.name}`}
                            size="icon-sm"
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
                          Run gate
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
          <div className="mt-4 rounded-xl border border-dashed py-14 text-center">
            <Boxes className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 font-medium">No validation suites</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Build a staged release gate from published monitors.
            </p>
          </div>
        )}
      </section>
      {view === "deployments" ? (
        <DeploymentWorkflow
          suites={suites}
          applications={applications}
          runs={deploymentRuns}
          open={deploymentOpen}
          onOpenChange={setDeploymentOpen}
        />
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
    </div>
  )
}

function RunResult({ run }: { run: ValidationSuiteRunContract }) {
  const allowed = run.gateDecision !== "BLOCK"
  return (
    <section
      className={`mt-6 rounded-xl border p-5 ${allowed ? "border-success/30 bg-success-soft/45" : "border-destructive/30 bg-destructive/5"}`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          {allowed ? (
            <Check className="size-5 text-success-foreground" />
          ) : (
            <CircleAlert className="size-5 text-destructive" />
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
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`text-xs font-medium ${wide ? "md:col-span-2" : ""}`}>
      {label}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}
