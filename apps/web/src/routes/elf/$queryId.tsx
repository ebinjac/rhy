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
import { PageContainer } from "@/components/page-container"
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

type Outcome = {
  tone: "ok" | "error"
  text: string
}

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
  const [outcome, setOutcome] = useState<Outcome | null>(null)
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
      setOutcome({
        tone: "error",
        text: "Search body must be valid JSON before it can run.",
      })
      return null
    }
  }
  async function save() {
    const searchBody = body()
    if (!searchBody) return null
    if (!Number.isInteger(threshold) || threshold < 0) {
      setOutcome({
        tone: "error",
        text: "Enter a whole-number hit-count threshold of zero or greater.",
      })
      return null
    }
    setPending("save")
    try {
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
      if (!result.ok) {
        setOutcome({ tone: "error", text: result.message })
        return null
      }
      setOutcome({
        tone: "ok",
        text: `Saved immutable revision ${result.query.revisionNumber}.`,
      })
      await router.invalidate()
      return result.query
    } finally {
      setPending("")
    }
  }
  async function validate() {
    setPending("validate")
    try {
      const result = await validateELFQuery({ data: { queryId: loaded.id } })
      setProblems(result.problems)
      if (result.valid) {
        setOutcome({
          tone: "ok",
          text:
            result.policyNotes.length > 0
              ? result.policyNotes.join(" ")
              : "Validation passed. No policy problems found.",
        })
      } else {
        setOutcome({
          tone: "error",
          text: `${result.problems.length} policy problem${result.problems.length === 1 ? "" : "s"} found.`,
        })
      }
    } catch (error) {
      setProblems([])
      setOutcome({
        tone: "error",
        text: error instanceof Error ? error.message : "Validation failed.",
      })
    } finally {
      setPending("")
    }
  }
  async function execute(kind: "probe" | "test") {
    const saved = await save()
    if (!saved) return
    setPending(kind)
    try {
      const result = await runELFQuery({
        data: { queryId: loaded.id, mode: kind, windowSeconds, size: 100 },
      })
      if (!result.ok) {
        setOutcome({ tone: "error", text: result.message })
        return
      }
      setRun(result.run)
      setOutcome({
        tone: "ok",
        text:
          kind === "probe"
            ? `Probe found ${result.run.hitCount.toLocaleString()} matching events.`
            : `Check decision: ${result.run.decision}.`,
      })
    } finally {
      setPending("")
    }
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
    <div className="min-h-[calc(100svh-7rem)]">
      <header className="border-b py-4">
        <PageContainer
          padding="none"
          className="flex flex-col gap-4 lg:flex-row lg:items-center"
        >
          <div className="min-w-0 flex-1">
            <Link
              className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground md:min-h-0"
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
          <div className="flex flex-wrap gap-2">
            <Button
              className="max-md:min-h-11"
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
              className="max-md:min-h-11"
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
              className="max-md:min-h-11"
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
        </PageContainer>
      </header>
      <section className="border-b bg-muted/15 py-3">
        <PageContainer
          padding="none"
          className="flex flex-wrap items-end gap-x-6 gap-y-3"
        >          <div>
            <label
              htmlFor="elf-application"
              className="text-xs font-medium"
            >
              Application
            </label>
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
              <SelectTrigger
                id="elf-application"
                className="mt-1 min-w-48 max-md:min-h-11"
              >
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
          </div>
          <div>
            <label htmlFor="elf-service" className="text-xs font-medium">
              Service
            </label>
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
              <SelectTrigger
                id="elf-service"
                className="mt-1 min-w-44 max-md:min-h-11"
              >
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
          </div>
          <Context label="Resolved index" value={resolvedIndex} mono />
          <Context label="Time field" value={resolvedTimeField} mono />
          <div className="ml-auto">
            <label htmlFor="elf-range" className="text-xs font-medium">
              Range
            </label>
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
              <SelectTrigger
                id="elf-range"
                className="mt-1 max-md:min-h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="300">Last 5 minutes</SelectItem>
                <SelectItem value="900">Last 15 minutes</SelectItem>
                <SelectItem value="3600">Last hour</SelectItem>
                <SelectItem value="86400">Last 24 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PageContainer>
      </section>
      <WorkbenchModeNavigator mode={mode} setMode={setMode} />
      {outcome ? (
        <div
          role={outcome.tone === "error" ? "alert" : "status"}
          aria-live={outcome.tone === "error" ? "assertive" : "polite"}
          className={`border-b py-2.5 text-sm ${
            outcome.tone === "error"
              ? "bg-destructive/5 text-destructive"
              : "bg-primary/5 text-foreground"
          }`}
        >
          <PageContainer padding="none">{outcome.text}</PageContainer>
        </div>
      ) : null}
      <PageContainer
        padding="none"
        className="grid lg:grid-cols-[minmax(420px,44%)_minmax(0,1fr)]"
      >
        <section className="min-w-0 border-b lg:border-r lg:border-b-0">
          {mode === "explore" ? (
            <>
              <div className="flex min-h-11 items-center gap-2 border-b px-3">
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
                  className="max-md:min-h-11"
                  onClick={() => {
                    try {
                      setCode(JSON.stringify(JSON.parse(code), null, 2))
                      setOutcome({
                        tone: "ok",
                        text: "Formatted query JSON.",
                      })
                    } catch {
                      setOutcome({
                        tone: "error",
                        text: "Search body is not valid JSON.",
                      })
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
                      ariaLabel: "OpenSearch query JSON",
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
            <div
              className="space-y-2 border-t p-4"
              role="alert"
              aria-live="assertive"
            >
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
      </PageContainer>
    </div>
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
  const indexedSamples = useMemo(
    () =>
      run?.samples.map((sample, index) => ({
        sample,
        index,
        searchText: JSON.stringify(sample).toLowerCase(),
      })) ?? [],
    [run]
  )
  const samples = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return indexedSamples
    return indexedSamples.filter((item) => item.searchText.includes(needle))
  }, [indexedSamples, filter])
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
          hint="Exact total matching OpenSearch documents — not limited by the sample logs shown below."
        />
        <Metric label="OpenSearch took" value={`${run.openSearchTookMs} ms`} />
        <Metric label="Round trip" value={`${run.roundTripMs} ms`} />
        <Metric label="Decision" value={run.decision} state={run.decision} />
      </div>
      {run.failureReason ? (
        <div
          className="flex gap-2 border-b bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
          aria-live="assertive"
        >
          <CircleAlert className="mt-0.5 size-4" />
          <div>
            <p className="font-medium">{run.failureCategory}</p>
            <p>{run.failureReason}</p>
          </div>
        </div>
      ) : null}
      <Tabs defaultValue="logs" className="gap-0">
        <div className="overflow-x-auto border-b px-3">
          <TabsList variant="line" className="max-md:h-11">
            <TabsTrigger value="logs" className="max-md:min-h-11">
              <TableProperties />
              Logs
            </TabsTrigger>
            <TabsTrigger value="fields" className="max-md:min-h-11">
              <Layers3 />
              Fields
            </TabsTrigger>
            <TabsTrigger value="aggregations" className="max-md:min-h-11">
              <Gauge />
              Aggregations
            </TabsTrigger>
            <TabsTrigger value="raw" className="max-md:min-h-11">
              <FileJson2 />
              Raw
            </TabsTrigger>
            <TabsTrigger value="debug" className="max-md:min-h-11">
              <Code2 />
              Debug
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="logs">
          <div className="border-b p-3">
            <label htmlFor="elf-evidence-filter" className="sr-only">
              Filter loaded evidence
            </label>
            <div className="relative">
              <Filter className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="elf-evidence-filter"
                aria-label="Filter loaded evidence"
                className="pl-9 max-md:min-h-11"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter loaded evidence"
              />
            </div>
          </div>
          <div className="max-h-[560px] divide-y overflow-auto">
            {samples.map(({ sample, index }) => (
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
        type="button"
        aria-expanded={open}
        className="grid w-full gap-2 px-4 py-3 text-left hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset max-md:min-h-11 sm:grid-cols-[160px_72px_130px_minmax(0,1fr)]"
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
        <Button
          size="sm"
          variant="outline"
          className="max-md:min-h-11"
          onClick={onEditQuery}
        >
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
        <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-muted-foreground hover:bg-muted/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset max-md:min-h-11 max-md:flex max-md:items-center">
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
      <p className="text-xs text-muted-foreground">{label}</p>
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
        <div className="text-xs font-medium">
          OpenSearch measure
          <span className="mt-1 block h-9 rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
            hits.total.value
          </span>
        </div>
        <div>
          <label
            htmlFor="elf-pass-comparison"
            className="text-xs font-medium"
          >
            Comparison
          </label>
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
            <SelectTrigger
              id="elf-pass-comparison"
              aria-label="Pass-condition comparison"
              className="mt-1 w-full max-md:min-h-11"
            >
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
        </div>
        <label className="text-xs font-medium" htmlFor="elf-hit-threshold">
          Threshold
          <Input
            id="elf-hit-threshold"
            className="mt-1 max-md:min-h-11"
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
        <p id="elf-gate-impact-label" className="text-xs font-medium">
          Gate impact
        </p>
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="radiogroup"
          aria-labelledby="elf-gate-impact-label"
        >
          <Button
            size="sm"
            className="max-md:min-h-11"
            variant={gateMode === "BLOCKING" ? "default" : "outline"}
            role="radio"
            aria-checked={gateMode === "BLOCKING"}
            onClick={() => setGateMode("BLOCKING")}
          >
            Blocking
          </Button>
          <Button
            size="sm"
            className="max-md:min-h-11"
            variant={gateMode === "ADVISORY" ? "default" : "outline"}
            role="radio"
            aria-checked={gateMode === "ADVISORY"}
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
    <nav className="border-b bg-muted/10 py-2" aria-label="ELF query workflow">
      <PageContainer
        padding="none"
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
      >
        <div
          className="inline-flex w-full rounded-lg border bg-background p-0.5 sm:w-auto"
          role="group"
          aria-label="Workbench mode"
        >
          <button
            type="button"
            aria-pressed={mode === "explore"}
            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:flex-none ${
              mode === "explore"
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }`}
            onClick={() => setMode("explore")}
          >
            <Search className="size-4 shrink-0" />
            Explore logs
          </button>
          <button
            type="button"
            aria-pressed={mode === "check"}
            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:flex-none ${
              mode === "check"
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }`}
            onClick={() => setMode("check")}
          >
            <ShieldCheck className="size-4 shrink-0" />
            Deployment check
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === "explore"
            ? "Inspect matching logs, then configure a deployment check."
            : "Set the hit-count pass condition and whether failure blocks release."}
        </p>
      </PageContainer>
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
      <Button
        size="sm"
        variant="outline"
        className="max-md:min-h-11"
        onClick={onConfigureCheck}
      >
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
      <p className="text-xs text-muted-foreground">{label}</p>
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
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-heading text-lg font-semibold ${state === "FAIL" ? "text-destructive" : state === "PASS" ? "text-success-foreground" : ""}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs leading-4 text-muted-foreground">{hint}</p>
      ) : null}
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
    <div className="grid h-[520px] place-items-center bg-muted text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" />
        Loading query editor…
      </span>
    </div>
  )
}
