import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  Check,
  CircleAlert,
  Clock3,
  Code2,
  Database,
  FileJson2,
  Filter,
  Gauge,
  Layers3,
  LoaderCircle,
  Play,
  Save,
  Search,
  ShieldCheck,
  TableProperties,
} from "lucide-react"

import type { ELFRunContract, JsonValue } from "@/lib/api-client/contracts"
import {
  getELFQuery,
  listELFApplications,
  runELFQuery,
  saveELFQuery,
  validateELFQuery,
} from "@/lib/api-client/elf"
import { formatDateTime } from "@/lib/format-date"

const MonacoEditor = lazy(async () => ({
  default: (await import("@monaco-editor/react")).default,
}))
export const Route = createFileRoute("/elf/$queryId")({
  loader: async ({ params }) => ({
    ...(await getELFQuery({ data: { queryId: params.queryId } })),
    applications: await listELFApplications(),
  }),
  component: ELFWorkbench,
})

function ELFWorkbench() {
  const loaded = Route.useLoaderData()
  const router = useRouter()
  const [mode, setMode] = useState<"explore" | "check">("explore")
  const [code, setCode] = useState(JSON.stringify(loaded.searchBody, null, 2))
  const [windowSeconds, setWindowSeconds] = useState(
    loaded.defaultWindowSeconds
  )
  const [gateMode, setGateMode] = useState(loaded.gateMode)
  const [applicationId, setApplicationId] = useState(loaded.applicationId)
  const [serviceId, setServiceId] = useState(loaded.serviceId ?? "")
  const [operator, setOperator] = useState(() => {
    const saved = String(loaded.criteria.operator ?? "EQ").toUpperCase()
    return ["LT", "LTE", "EQ", "NE", "GTE", "GT"].includes(saved) ? saved : "EQ"
  })
  const [threshold, setThreshold] = useState(Number(loaded.criteria.value ?? 0))
  const [run, setRun] = useState<ELFRunContract | null>(loaded.lastRun ?? null)
  const [pending, setPending] = useState<
    "save" | "probe" | "test" | "validate" | ""
  >("")
  const [message, setMessage] = useState("")
  const [problems, setProblems] = useState<
    Array<{ path: string; message: string }>
  >([])
  const [desktop, setDesktop] = useState(false)
  const [darkEditor, setDarkEditor] = useState(false)
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const sync = () => setDesktop(media.matches)
    const syncTheme = () =>
      setDarkEditor(document.documentElement.classList.contains("dark"))
    sync()
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    media.addEventListener("change", sync)
    return () => {
      media.removeEventListener("change", sync)
      observer.disconnect()
    }
  }, [])
  function body() {
    try {
      return JSON.parse(code) as Record<string, JsonValue>
    } catch {
      setMessage("Search body must be valid JSON before it can run.")
      return null
    }
  }
  async function save() {
    const searchBody = body()
    if (!searchBody) return null
    if (!Number.isInteger(threshold) || threshold < 0) {
      setMessage("Enter a whole-number hit-count threshold of zero or greater.")
      return null
    }
    setPending("save")
    setMessage("")
    const result = await saveELFQuery({
      data: {
        id: loaded.id,
        name: loaded.name,
        description: loaded.description ?? "",
        applicationId,
        serviceId,
        indexOverride: loaded.indexOverride ?? "",
        active: loaded.active,
        searchBody,
        defaultWindowSeconds: windowSeconds,
        checkKind: "HIT_COUNT",
        criteria: { operator, value: threshold },
        gateMode,
        semanticMapping: loaded.semanticMapping,
      },
    })
    setPending("")
    if (!result.ok) {
      setMessage(result.message)
      return null
    }
    setMessage(`Saved immutable revision ${result.query.revisionNumber}.`)
    await router.invalidate()
    return result.query
  }
  async function validate() {
    setPending("validate")
    setMessage("")
    try {
      const result = await validateELFQuery({ data: { queryId: loaded.id } })
      setProblems(result.problems)
      setMessage(
        result.valid
          ? result.policyNotes.join(" ")
          : `${result.problems.length} policy problem${result.problems.length === 1 ? "" : "s"} found.`
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Validation failed.")
    } finally {
      setPending("")
    }
  }
  async function execute(kind: "probe" | "test") {
    const saved = await save()
    if (!saved) return
    setPending(kind)
    setMessage("")
    const result = await runELFQuery({
      data: { queryId: loaded.id, mode: kind, windowSeconds, size: 100 },
    })
    setPending("")
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setRun(result.run)
    setMessage(
      kind === "probe"
        ? `Probe found ${result.run.hitCount.toLocaleString()} matching events.`
        : `Check decision: ${result.run.decision}.`
    )
  }
  const selectedApplication = loaded.applications.find(
    (application) => application.id === applicationId
  )
  const selectedService = selectedApplication?.services.find(
    (service) => service.id === serviceId
  )
  const resolvedIndex =
    loaded.indexOverride ||
    selectedService?.indexPattern ||
    selectedApplication?.defaultIndexPattern ||
    run?.resolvedIndex ||
    "ELF platform default"
  const resolvedTimeField =
    selectedService?.timeField ||
    selectedApplication?.defaultTimeField ||
    "@timestamp"
  return (
    <main className="min-h-[calc(100svh-7rem)]">
      <header className="border-b px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <Link
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              to="/elf"
            >
              <ArrowLeft className="size-3.5" />
              Queries
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="truncate font-heading text-xl font-semibold">
                {loaded.name}
              </h1>
              <Badge variant="outline">revision {loaded.revisionNumber}</Badge>
              <Badge
                variant={gateMode === "BLOCKING" ? "default" : "secondary"}
              >
                {gateMode}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void validate()}
              disabled={!!pending}
            >
              {pending === "validate" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Check />
              )}
              Validate
            </Button>
            <Button
              variant="outline"
              onClick={() => void save()}
              disabled={!!pending}
            >
              {pending === "save" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Save />
              )}
              Save
            </Button>
            <Button
              onClick={() =>
                void execute(mode === "explore" ? "probe" : "test")
              }
              disabled={!!pending}
            >
              {pending === "probe" || pending === "test" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Play />
              )}
              {mode === "explore" ? "Run probe" : "Test check"}
            </Button>
          </div>
        </div>
      </header>
      <section className="border-b bg-muted/15 px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-end gap-x-6 gap-y-3">
          <label className="text-xs font-medium">
            Application
            <Select
              value={applicationId}
              onValueChange={(value) => {
                if (value == null) return
                setApplicationId(value)
                setServiceId("")
              }}
              items={loaded.applications.map((application) => ({
                value: application.id,
                label: `${application.name}${application.carId ? ` · ${application.carId}` : ""}`,
              }))}
            >
              <SelectTrigger className="mt-1 min-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {loaded.applications.map((application) => (
                  <SelectItem key={application.id} value={application.id}>
                    {application.name}
                    {application.carId ? ` · ${application.carId}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-xs font-medium">
            Service
            <Select
              value={serviceId || null}
              onValueChange={(value) => setServiceId(value ?? "")}
              items={[
                { value: null, label: "All services" },
                ...(selectedApplication?.services ?? []).map((service) => ({
                  value: service.id,
                  label: service.name,
                })),
              ]}
            >
              <SelectTrigger className="mt-1 min-w-44">
                <SelectValue placeholder="All services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>All services</SelectItem>
                {(selectedApplication?.services ?? []).map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Context label="Resolved index" value={resolvedIndex} mono />
          <Context label="Time field" value={resolvedTimeField} mono />
          <label className="ml-auto text-xs font-medium">
            Range
            <Select
              value={String(windowSeconds)}
              onValueChange={(value) => {
                if (value == null) return
                setWindowSeconds(Number(value))
              }}
              items={{
                "300": "Last 5 minutes",
                "900": "Last 15 minutes",
                "3600": "Last hour",
                "86400": "Last 24 hours",
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="300">Last 5 minutes</SelectItem>
                <SelectItem value="900">Last 15 minutes</SelectItem>
                <SelectItem value="3600">Last hour</SelectItem>
                <SelectItem value="86400">Last 24 hours</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      </section>
      <WorkbenchModeNavigator mode={mode} setMode={setMode} />
      {message ? (
        <div
          className={`border-b px-4 py-2.5 text-sm md:px-6 ${problems.length ? "bg-destructive/5 text-destructive" : "bg-primary/5 text-foreground"}`}
        >
          {message}
        </div>
      ) : null}
      <div className="mx-auto grid max-w-[1480px] lg:grid-cols-[minmax(420px,44%)_minmax(0,1fr)]">
        <section className="min-w-0 border-b lg:border-r lg:border-b-0">
          {mode === "explore" ? (
            <>
              <div className="flex h-11 items-center gap-2 border-b px-3">
                <Braces className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  OpenSearch Query DSL
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  64 KB governed JSON
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    try {
                      setCode(JSON.stringify(JSON.parse(code), null, 2))
                    } catch {
                      setMessage("Search body is not valid JSON.")
                    }
                  }}
                >
                  Format
                </Button>
              </div>
              {desktop ? (
                <Suspense fallback={<EditorLoading />}>
                  <MonacoEditor
                    height="520px"
                    language="json"
                    theme={darkEditor ? "vs-dark" : "light"}
                    value={code}
                    onChange={(value) => {
                      setCode(value ?? "")
                      setProblems([])
                    }}
                    options={{
                      automaticLayout: true,
                      fontSize: 13,
                      lineHeight: 21,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      formatOnPaste: true,
                      padding: { top: 14, bottom: 14 },
                    }}
                  />
                </Suspense>
              ) : (
                <Textarea
                  aria-label="OpenSearch query JSON"
                  className="min-h-[420px] resize-y rounded-none border-0 font-mono text-xs leading-5"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                />
              )}
              <div className="border-t p-4">
                <ExploreHints onConfigureCheck={() => setMode("check")} />
              </div>
            </>
          ) : (
            <DeploymentCheckPanel
              queryName={loaded.name}
              resolvedIndex={resolvedIndex}
              windowSeconds={windowSeconds}
              code={code}
              gateMode={gateMode}
              setGateMode={setGateMode}
              operator={operator}
              setOperator={setOperator}
              threshold={threshold}
              setThreshold={setThreshold}
              onEditQuery={() => setMode("explore")}
            />
          )}
          {problems.length ? (
            <div className="space-y-2 border-t p-4">
              {problems.map((problem) => (
                <p
                  key={`${problem.path}-${problem.message}`}
                  className="flex gap-2 text-xs text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <code>{problem.path}</code> — {problem.message}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </section>
        <Results run={run} mode={mode} />
      </div>
    </main>
  )
}

function Results({
  run,
  mode,
}: {
  run: ELFRunContract | null
  mode: "explore" | "check"
}) {
  const [filter, setFilter] = useState("")
  const samples = useMemo(
    () =>
      run?.samples.filter((item) =>
        JSON.stringify(item).toLowerCase().includes(filter.toLowerCase())
      ) ?? [],
    [run, filter]
  )
  if (!run)
    return (
      <section className="grid min-h-[620px] place-items-center p-8 text-center">
        <div>
          <Database className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 font-medium">
            {mode === "check"
              ? "Test the check to inspect its decision"
              : "Run a probe to inspect evidence"}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {mode === "check"
              ? "Rhythm will run the saved query, evaluate the hit-count condition, and show the resulting evidence."
              : "Rhythm will apply the time boundary and safety policy, then show masked logs, fields, aggregations, and debug evidence."}
          </p>
        </div>
      </section>
    )
  return (
    <section className="min-w-0">
      <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
        <Metric
          label="hits.total.value"
          value={run.hitCount.toLocaleString()}
          hint="The exact total number of matching OpenSearch documents. It is not limited by the number of sample logs displayed."
        />
        <Metric label="OpenSearch took" value={`${run.openSearchTookMs} ms`} />
        <Metric label="Round trip" value={`${run.roundTripMs} ms`} />
        <Metric label="Decision" value={run.decision} state={run.decision} />
      </div>
      {run.failureReason ? (
        <div className="flex gap-2 border-b bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4" />
          <div>
            <p className="font-medium">{run.failureCategory}</p>
            <p>{run.failureReason}</p>
          </div>
        </div>
      ) : null}
      <Tabs defaultValue="logs" className="gap-0">
        <div className="overflow-x-auto border-b px-3">
          <TabsList variant="line">
            <TabsTrigger value="logs">
              <TableProperties />
              Logs
            </TabsTrigger>
            <TabsTrigger value="fields">
              <Layers3 />
              Fields
            </TabsTrigger>
            <TabsTrigger value="aggregations">
              <Gauge />
              Aggregations
            </TabsTrigger>
            <TabsTrigger value="raw">
              <FileJson2 />
              Raw
            </TabsTrigger>
            <TabsTrigger value="debug">
              <Code2 />
              Debug
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="logs">
          <div className="border-b p-3">
            <div className="relative">
              <Filter className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter loaded evidence"
              />
            </div>
          </div>
          <div className="max-h-[560px] divide-y overflow-auto">
            {samples.map((sample, index) => (
              <LogRow key={String(sample._id ?? index)} sample={sample} />
            ))}
            {!samples.length ? (
              <p className="p-10 text-center text-sm text-muted-foreground">
                No captured documents match this view.
              </p>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="fields">
          <div className="divide-y">
            {run.fields.map((field) => (
              <div
                key={field.path}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(150px,1fr)_90px_90px_minmax(120px,1.2fr)] sm:items-center"
              >
                <code className="text-xs break-all">{field.path}</code>
                <Badge className="w-fit" variant="outline">
                  {field.type}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {field.role || "Unmapped"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {field.samples.map(String).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="aggregations">
          <JSONBlock
            value={run.aggregations}
            empty="This query returned no aggregations."
          />
        </TabsContent>
        <TabsContent value="raw">
          <div className="border-b bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            Exact OpenSearch response structure. Sensitive values are replaced
            with <code>MASKED</code> before storage or display.
          </div>
          <JSONBlock
            value={run.rawResponse}
            empty="The upstream response was not recorded for this execution. Run the query again to capture it."
          />
        </TabsContent>
        <TabsContent value="debug">
          <div className="p-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Sanitized execution evidence. Authentication and sensitive values
              are never included.
            </p>
            <JSONBlock value={run.debug} />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
function LogRow({ sample }: { sample: Record<string, JsonValue> }) {
  const [open, setOpen] = useState(false)
  const time = String(sample["@timestamp"] ?? "")
  const level = String(
    sample["log.level"] ??
      (sample.log as Record<string, JsonValue> | undefined)?.level ??
      sample.level ??
      "INFO"
  )
  const service = String(
    (sample.service as Record<string, JsonValue> | undefined)?.name ??
      sample.service ??
      ""
  )
  const message = String(sample.message ?? "")
  return (
    <article>
      <button
        className="grid w-full gap-2 px-4 py-3 text-left hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset sm:grid-cols-[160px_72px_130px_minmax(0,1fr)]"
        onClick={() => setOpen((value) => !value)}
      >
        <time className="truncate font-mono text-xs text-muted-foreground">
          {time ? formatDateTime(time) : "No timestamp"}
        </time>
        <Badge
          className="w-fit"
          variant={
            level === "ERROR" || level === "FATAL" ? "destructive" : "outline"
          }
        >
          {level}
        </Badge>
        <span className="truncate text-xs">{service}</span>
        <span className="truncate text-sm">
          {message || "No message field"}
        </span>
      </button>
      {open ? (
        <pre className="overflow-auto border-t bg-muted/25 p-4 text-xs leading-5">
          {JSON.stringify(sample, null, 2)}
        </pre>
      ) : null}
    </article>
  )
}

function DeploymentCheckPanel({
  queryName,
  resolvedIndex,
  windowSeconds,
  code,
  gateMode,
  setGateMode,
  operator,
  setOperator,
  threshold,
  setThreshold,
  onEditQuery,
}: {
  queryName: string
  resolvedIndex: string
  windowSeconds: number
  code: string
  gateMode: "BLOCKING" | "ADVISORY"
  setGateMode: (value: "BLOCKING" | "ADVISORY") => void
  operator: string
  setOperator: (value: string) => void
  threshold: number
  setThreshold: (value: number) => void
  onEditQuery: () => void
}) {
  return (
    <div>
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Deployment check</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Define what the existing query result means for a deployment. This
              rule does not change which logs match.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onEditQuery}>
          <Braces />
          Edit query in Explore Logs
        </Button>
      </div>
      <div className="grid divide-y bg-muted/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <CheckContext label="Query" value={queryName} />
        <CheckContext label="Resolved index" value={resolvedIndex} mono />
        <CheckContext
          label="Evaluation window"
          value={formatWindow(windowSeconds)}
        />
      </div>
      <div className="border-t p-5">
        <RuleBuilder
          gateMode={gateMode}
          setGateMode={setGateMode}
          operator={operator}
          setOperator={setOperator}
          threshold={threshold}
          setThreshold={setThreshold}
        />
      </div>
      <details className="group border-t">
        <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-muted-foreground hover:bg-muted/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
          View query JSON
        </summary>
        <pre className="max-h-80 overflow-auto border-t bg-muted/20 p-4 text-xs leading-5">
          {code}
        </pre>
      </details>
    </div>
  )
}

function CheckContext({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 truncate text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function formatWindow(seconds: number) {
  if (seconds < 3600) return `Last ${seconds / 60} minutes`
  if (seconds < 86400)
    return `Last ${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`
  return `Last ${seconds / 86400} day${seconds === 86400 ? "" : "s"}`
}

function RuleBuilder({
  gateMode,
  setGateMode,
  operator,
  setOperator,
  threshold,
  setThreshold,
}: {
  gateMode: "BLOCKING" | "ADVISORY"
  setGateMode: (value: "BLOCKING" | "ADVISORY") => void
  operator: string
  setOperator: (value: string) => void
  threshold: number
  setThreshold: (value: number) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <h2 className="text-sm font-medium">Pass condition</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Compare the exact total returned by OpenSearch with a numeric threshold.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(180px,1fr)_170px_120px]">
        <label className="text-xs font-medium">
          OpenSearch measure
          <span className="mt-1 block h-9 rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
            hits.total.value
          </span>
        </label>
        <label className="text-xs font-medium">
          Comparison
          <Select
            value={operator}
            onValueChange={(value) => {
              if (value == null) return
              setOperator(value)
            }}
            items={Object.fromEntries(
              ["LT", "LTE", "EQ", "NE", "GTE", "GT"].map((value) => [
                value,
                operatorLabel(value),
              ])
            )}
          >
            <SelectTrigger className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["LT", "LTE", "EQ", "NE", "GTE", "GT"].map((value) => (
                <SelectItem key={value} value={value}>
                  {operatorLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="text-xs font-medium">
          Threshold
          <Input
            className="mt-1"
            type="number"
            min={0}
            step={1}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
        </label>
      </div>
      <p className="mt-3 rounded-md bg-primary/5 px-3 py-2 text-xs">
        Pass when <code>hits.total.value</code>{" "}
        {operatorLabel(operator).toLowerCase()} {threshold}.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        This is the exact total matching the query, even when only a limited
        number of sample documents are displayed.
      </p>
      <div className="mt-4 border-t pt-3">
        <p className="text-xs font-medium">Gate impact</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={gateMode === "BLOCKING" ? "default" : "outline"}
            onClick={() => setGateMode("BLOCKING")}
          >
            Blocking
          </Button>
          <Button
            size="sm"
            variant={gateMode === "ADVISORY" ? "default" : "outline"}
            onClick={() => setGateMode("ADVISORY")}
          >
            Advisory
          </Button>
          <p className="ml-1 self-center text-xs text-muted-foreground">
            {gateMode === "BLOCKING"
              ? "A failed check blocks the suite."
              : "A failed check allows with warnings."}
          </p>
        </div>
      </div>
    </div>
  )
}

function operatorLabel(operator: string) {
  return (
    {
      LT: "Less than (<)",
      LTE: "At most (≤)",
      GT: "Greater than (>)",
      GTE: "At least (≥)",
      EQ: "Equals (=)",
      NE: "Does not equal (≠)",
    }[operator] ?? operator
  )
}
function WorkbenchModeNavigator({
  mode,
  setMode,
}: {
  mode: "explore" | "check"
  setMode: (mode: "explore" | "check") => void
}) {
  return (
    <nav
      className="border-b bg-muted/10 px-4 py-4 md:px-6"
      aria-label="ELF query workflow"
    >
      <div className="mx-auto max-w-[1480px]">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">What do you want to do?</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Explore the matching logs first, then decide whether those matches
            should pass or block a deployment.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2" role="group">
          <button
            type="button"
            aria-pressed={mode === "explore"}
            className={`flex min-h-20 items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              mode === "explore"
                ? "border-primary bg-primary/7"
                : "border-border bg-background hover:bg-muted/30"
            }`}
            onClick={() => setMode("explore")}
          >
            <Search
              className={`mt-0.5 size-5 shrink-0 ${mode === "explore" ? "text-primary" : "text-muted-foreground"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                Explore logs
                {mode === "explore" ? (
                  <Badge variant="secondary">Current</Badge>
                ) : null}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Run the OpenSearch query and inspect matching logs, fields, and
                the raw response.
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "check"}
            className={`flex min-h-20 items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              mode === "check"
                ? "border-primary bg-primary/7"
                : "border-border bg-background hover:bg-muted/30"
            }`}
            onClick={() => setMode("check")}
          >
            <ShieldCheck
              className={`mt-0.5 size-5 shrink-0 ${mode === "check" ? "text-primary" : "text-muted-foreground"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                Configure deployment check
                {mode === "check" ? (
                  <Badge variant="secondary">Current</Badge>
                ) : null}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Compare <code>hits.total.value</code> with a threshold and
                choose whether failure blocks the release.
              </span>
            </span>
          </button>
        </div>
      </div>
    </nav>
  )
}

function ExploreHints({ onConfigureCheck }: { onConfigureCheck: () => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3 text-xs text-muted-foreground">
        <Clock3 className="mt-0.5 size-4 shrink-0" />
        <p>
          Run this query to inspect what matched. Rhythm applies the selected
          time range, exact hit counting, deterministic sorting, and execution
          limits.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onConfigureCheck}>
        Configure deployment check
        <ArrowRight />
      </Button>
    </div>
  )
}
function Context({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-sm ${mono ? "font-mono text-xs" : "font-medium"}`}
      >
        {value}
      </p>
    </div>
  )
}
function Metric({
  label,
  value,
  state,
  hint,
}: {
  label: string
  value: string
  state?: string
  hint?: string
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] text-muted-foreground" title={hint}>
        {label}
      </p>
      <p
        className={`mt-1 font-heading text-lg font-semibold ${state === "FAIL" ? "text-destructive" : state === "PASS" ? "text-success-foreground" : ""}`}
      >
        {value}
      </p>
    </div>
  )
}
function JSONBlock({ value, empty }: { value: unknown; empty?: string }) {
  if (value && typeof value === "object" && Object.keys(value).length === 0)
    return (
      <p className="p-10 text-center text-sm text-muted-foreground">
        {empty ?? "No data recorded."}
      </p>
    )
  return (
    <pre className="max-h-[560px] overflow-auto bg-muted/20 p-4 text-xs leading-5">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
function EditorLoading() {
  return (
    <div className="grid h-[520px] place-items-center bg-[#1e1e1e] text-sm text-white/70">
      <LoaderCircle className="mr-2 inline size-4 animate-spin" />
      Loading query editor…
    </div>
  )
}
