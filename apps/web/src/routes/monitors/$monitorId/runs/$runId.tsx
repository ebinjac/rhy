import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { AlertTriangle, ArrowLeft, Ban, Check, ChevronRight, CircleAlert, Clock3, Code2, Database, FileJson, FileSearch, Gauge, Info, LoaderCircle, Network, RefreshCw, Search, ShieldCheck, Timer, Waypoints, X } from "lucide-react"

import type { JsonValue, RunContract, RunDiagnosticsContract, ScriptResultContract, StepInsightContract, StepRunContract } from "@/lib/api-client/contracts"
import { cancelRun, getRunDiagnostics } from "@/lib/api-client/monitors"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/monitors/$monitorId/runs/$runId")({
  loader: ({ params }) => getRunDiagnostics({ data: { runId: params.runId } }),
  component: RunDiagnosticsPage,
})

const activeStatuses = new Set(["QUEUED", "STARTING", "RUNNING"])
const phaseOrder = ["preparationMs", "secretFetchMs", "dnsMs", "proxyConnectMs", "connectMs", "tlsHandshakeMs", "requestWriteMs", "serverWaitMs", "downloadMs", "extractionMs", "assertionMs"]
const phaseLabels: Record<string, string> = { preparationMs: "Preparation", secretFetchMs: "Secret fetch", dnsMs: "DNS", proxyConnectMs: "Proxy", connectMs: "TCP connect", tlsHandshakeMs: "TLS", requestWriteMs: "Request write", serverWaitMs: "Server wait", timeToFirstByteMs: "Time to first byte", downloadMs: "Download", extractionMs: "Extraction", assertionMs: "Assertions", totalMs: "Total" }
const phaseHelp: Record<string, { origin: "Rhythm" | "Network" | "Target"; description: string }> = {
  preparationMs: { origin: "Rhythm", description: "Work before the outbound request: pre-request actions and JavaScript, variables and templates, secret/auth resolution, cookies, proxy/TLS configuration, and request construction." },
  secretFetchMs: { origin: "Rhythm", description: "Time spent resolving referenced secrets from the configured secret provider. Secret values are never included in diagnostics." },
  dnsMs: { origin: "Network", description: "Time for the execution agent to resolve the target hostname to an IP address." },
  proxyConnectMs: { origin: "Network", description: "Time required to establish the configured proxy route or tunnel before connecting to the target." },
  connectMs: { origin: "Network", description: "Time for the execution agent to establish the TCP connection to the target or proxy." },
  tlsHandshakeMs: { origin: "Network", description: "Time to negotiate encryption, validate the server certificate, and establish the secure TLS session." },
  requestWriteMs: { origin: "Network", description: "Time to send the HTTP request headers and body from the execution agent." },
  serverWaitMs: { origin: "Target", description: "Time from finishing the request write until the first response byte. This primarily reflects target processing plus network latency." },
  downloadMs: { origin: "Network", description: "Time to read the response body after response headers and the first byte arrive." },
  extractionMs: { origin: "Rhythm", description: "Time Rhythm spends parsing the response and evaluating configured extractors." },
  assertionMs: { origin: "Rhythm", description: "Time Rhythm spends evaluating response assertions and success criteria." },
}

function RunDiagnosticsPage() {
  const initial = Route.useLoaderData()
  const { runId } = Route.useParams()
  const [diagnostics, setDiagnostics] = useState(initial)
  const [selectedStepID, setSelectedStepID] = useState(initial.primaryFailure?.stepId ?? initial.analysis.slowestStepId ?? initial.run.steps?.[0]?.stepDefinitionId ?? "")
  const [cancelling, setCancelling] = useState(false)
  const [cancelMessage, setCancelMessage] = useState("")
  const active = activeStatuses.has(diagnostics.run.status)

  useEffect(() => {
    if (!active) return
    let disposed = false
    let loading = false
    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const next = await getRunDiagnostics({ data: { runId } })
        if (!disposed) {
          setDiagnostics(next)
          if (!selectedStepID && next.run.steps?.[0]) setSelectedStepID(next.run.steps[0].stepDefinitionId)
        }
      } finally { loading = false }
    }
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [active, runId, selectedStepID])

  const selectedStep = diagnostics.run.steps?.find((step) => step.stepDefinitionId === selectedStepID) ?? diagnostics.run.steps?.[0]
  const selectedInsight = diagnostics.steps.find((step) => step.stepDefinitionId === selectedStep?.stepDefinitionId)
  async function requestCancel() {
    if (!window.confirm("Cancel this execution? The active request will be interrupted and later steps will not run.")) return
    setCancelling(true); setCancelMessage("")
    const result = await cancelRun({ data: { runId } })
    setCancelling(false)
    if (!result.ok) setCancelMessage(result.message)
  }

  return <div className="mx-auto max-w-[1500px] px-4 py-5 md:px-6 md:py-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button render={<Link params={{ monitorId: diagnostics.run.monitorId }} to="/monitors/$monitorId/runs" />} nativeButton={false} variant="ghost"><ArrowLeft /> Run history</Button>
      {active ? <Button disabled={cancelling} onClick={requestCancel} variant="outline">{cancelling ? <LoaderCircle className="animate-spin" /> : <Ban />} Cancel run</Button> : null}
    </div>
    {cancelMessage ? <p className="mt-3 text-sm text-destructive">{cancelMessage}</p> : null}
    <RunHeader diagnostics={diagnostics} />
    {diagnostics.primaryFailure ? <FailurePanel failure={diagnostics.primaryFailure} /> : <SuccessInsight diagnostics={diagnostics} />}
    {diagnostics.run.setupScript ? <section className="mt-6"><h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold"><Code2 className="size-4"/>Monitor setup script</h2><ScriptEvidence result={diagnostics.run.setupScript}/></section> : null}
    <Waterfall diagnostics={diagnostics} selectedStepID={selectedStep?.stepDefinitionId ?? ""} onSelect={setSelectedStepID} />
    <section className="mt-7 lg:grid lg:grid-cols-[270px_minmax(0,1fr)] lg:gap-6">
      <StepRail diagnostics={diagnostics} selectedStepID={selectedStep?.stepDefinitionId ?? ""} onSelect={setSelectedStepID} />
      <div className="mt-5 min-w-0 lg:mt-0">{selectedStep ? <StepPanel run={diagnostics.run} step={selectedStep} insight={selectedInsight} events={diagnostics.events} /> : <PendingSteps active={active} />}</div>
    </section>
  </div>
}

function RunHeader({ diagnostics }: { diagnostics: RunDiagnosticsContract }) {
  const { run, analysis } = diagnostics
  const context = run.executionContext ?? {}
  const successful = run.status === "SUCCESS" || run.status === "SUCCESS_WITH_WARNINGS"
  return <header className="mt-4 border-y py-6">
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={run.status} /><span className="font-mono text-xs text-muted-foreground">{run.id}</span>{activeStatuses.has(run.status) ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCw className="size-3 animate-spin" /> Updating live</span> : null}</div><h1 className="mt-3 font-heading text-2xl font-semibold tracking-tight">Run diagnostics</h1><p className="mt-1 text-sm text-muted-foreground">{formatDateTime(run.startedAt ?? run.createdAt)} · {run.triggerType.toLowerCase().replaceAll("_", " ")}</p></div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4 xl:grid-cols-3"><Meta label="Revision" value={`#${printable(context.revisionNumber)}`} mono /><Meta label="Agent" value={printable(context.agentId ?? run.agentId) || "Local worker"} mono /><Meta label="Environment" value={printable(context.environmentId) || "Default"} /><Meta label="Trigger source" value={run.triggerSource || "System"} /><Meta label="Started" value={formatDateTime(run.startedAt ?? run.createdAt)} /><Meta label="Ended" value={run.endedAt ? formatDateTime(run.endedAt) : "In progress"} /></dl>
    </div>
    <div className="mt-6 flex flex-wrap divide-x rounded-xl border bg-muted/20"><Metric label="API response time" value={activeStatuses.has(run.status) ? "In progress" : analysis.apiResponseTimeMs ? formatDuration(analysis.apiResponseTimeMs) : "Not recorded"} icon={Gauge} /><Metric label="Execution duration" value={activeStatuses.has(run.status) ? "In progress" : formatDuration(run.durationMs)} icon={Timer} /><Metric label="Preparation" value={formatDuration(analysis.preparationTimeMs)} icon={Clock3} /><Metric label="Post-processing" value={formatDuration(analysis.postProcessingMs)} icon={Check} /><Metric label="Queue delay" value={run.queueDelayMs ? formatDuration(run.queueDelayMs) : "Not queued"} icon={Clock3} /><Metric label="Retries" value={String(analysis.retryCount)} icon={RefreshCw} /><Metric label="Warnings" value={String(run.warningCount)} icon={successful ? Check : AlertTriangle} /></div>
  </header>
}

function FailurePanel({ failure }: { failure: NonNullable<RunDiagnosticsContract["primaryFailure"]> }) {
  return <section aria-labelledby="failure-heading" className="mt-6 rounded-xl border border-destructive/25 bg-destructive/5 p-5"><div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"><CircleAlert className="size-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 id="failure-heading" className="font-heading text-lg font-semibold text-destructive">{failure.title}</h2><Badge variant="outline">{failure.phase.replaceAll("_", " ")}</Badge>{failure.retryable ? <Badge variant="secondary">Retryable</Badge> : null}</div><p className="mt-1 max-w-3xl text-sm">{failure.message || "The execution did not reach its expected outcome."}</p><dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm"><Meta label="Failed step" value={failure.stepName || failure.stepId || "Unknown"} /><Meta label="Category" value={failure.category.replaceAll("_", " ")} /><Meta label="Attempt" value={failure.attemptNumber ? String(failure.attemptNumber) : "—"} />{failure.expected ? <Meta label="Expected" value={failure.expected} mono /> : null}{failure.observed !== undefined ? <Meta label="Observed" value={printable(failure.observed)} mono /> : null}</dl><p className="mt-4 text-xs text-muted-foreground">Next check: {helpText(failure.helpCode)}</p></div></div></section>
}

function SuccessInsight({ diagnostics }: { diagnostics: RunDiagnosticsContract }) {
  const slowest = diagnostics.steps.find((item) => item.stepDefinitionId === diagnostics.analysis.slowestStepId)
  const regression = diagnostics.steps.find((item) => item.baseline.classification === "REGRESSED")
  return <section className="mt-6 flex flex-col gap-4 rounded-xl border p-5 md:flex-row md:items-center md:justify-between"><div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success-foreground"><Check className="size-5" /></span><div><h2 className="font-medium">Execution completed successfully</h2><p className="mt-1 text-sm text-muted-foreground">All required steps, extractors, and assertions reached their expected outcome.</p></div></div><div className="text-sm md:text-right"><p className="font-medium">Slowest API · {diagnostics.analysis.slowestStepName || "Not recorded"}</p><p className="mt-0.5 text-muted-foreground">{slowest?.apiResponseTimeMs ? `${formatDuration(slowest.apiResponseTimeMs)} API response · ${formatDuration(slowest.durationMs)} execution` : "API timing was not recorded"}{regression ? ` · ${regression.baseline.changePercent}% slower than median` : ""}</p></div></section>
}

function Waterfall({ diagnostics, selectedStepID, onSelect }: { diagnostics: RunDiagnosticsContract; selectedStepID: string; onSelect: (id: string) => void }) {
  const total = Math.max(diagnostics.run.durationMs, ...diagnostics.steps.map((item) => item.durationMs), 1)
  return <section className="mt-7" aria-labelledby="waterfall-heading"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="waterfall-heading" className="font-heading text-lg font-semibold">Execution waterfall</h2><p className="mt-0.5 text-sm text-muted-foreground">Step contribution to total runtime. Select a row to inspect its evidence.</p></div><p className="text-xs text-muted-foreground">Orchestration overhead {formatDuration(diagnostics.analysis.overheadMs)}</p></div><div className="mt-4 overflow-hidden rounded-xl border">{(diagnostics.run.steps ?? []).map((step) => { const insight = diagnostics.steps.find((item) => item.stepDefinitionId === step.stepDefinitionId); const width = Math.max(2, step.durationMs / total * 100); return <button aria-pressed={selectedStepID === step.stepDefinitionId} className="grid w-full gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[minmax(180px,280px)_minmax(180px,1fr)_90px] sm:items-center" key={step.id} onClick={() => onSelect(step.stepDefinitionId)}><div className="min-w-0"><p className="truncate text-sm font-medium">{step.stepOrder}. {step.stepName}</p><p className="mt-0.5 text-xs text-muted-foreground">{step.stepType.replaceAll("_", " ")} · {insight?.durationShare ?? 0}%</p></div><div className="h-7 rounded-md bg-muted p-1"><div className={`h-full min-w-1 rounded-sm ${step.status === "SUCCESS" ? "bg-primary/75" : step.status === "SKIPPED_CONDITION" ? "bg-muted-foreground/35" : "bg-destructive"}`} style={{ width: `${width}%` }} /></div><div className="flex items-center justify-between gap-2 sm:justify-end"><BaselineBadge baseline={insight?.baseline} /><span className="font-mono text-xs">{formatDuration(step.durationMs)}</span></div></button> })}{!diagnostics.run.steps?.length ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">Waiting for the first step to start…</p> : null}</div></section>
}

function StepRail({ diagnostics, selectedStepID, onSelect }: { diagnostics: RunDiagnosticsContract; selectedStepID: string; onSelect: (id: string) => void }) {
  return <nav aria-label="Execution steps" className="lg:sticky lg:top-5 lg:self-start"><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Workflow steps</h2><span className="text-xs text-muted-foreground">{diagnostics.run.steps?.length ?? 0}</span></div><div className="overflow-hidden rounded-xl border">{(diagnostics.run.steps ?? []).map((step) => { const insight=diagnostics.steps.find((item)=>item.stepDefinitionId===step.stepDefinitionId); return <button aria-current={selectedStepID===step.stepDefinitionId ? "step" : undefined} className={`flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${selectedStepID===step.stepDefinitionId ? "bg-muted" : "hover:bg-muted/40"}`} key={step.id} onClick={()=>onSelect(step.stepDefinitionId)}><StatusIcon status={step.status} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{step.stepOrder}. {step.stepName}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatDuration(step.durationMs)} · {insight?.durationShare ?? 0}%</p></div><ChevronRight className="size-4 text-muted-foreground" /></button>})}</div></nav>
}

function StepPanel({ run, step, insight, events }: { run: RunContract; step: StepRunContract; insight?: StepInsightContract; events: RunDiagnosticsContract["events"] }) {
  return <section className="min-w-0 overflow-hidden rounded-xl border"><header className="flex flex-col gap-3 border-b bg-muted/25 px-5 py-4 sm:flex-row sm:items-center"><StatusIcon status={step.status} /><div className="min-w-0 flex-1"><h2 className="font-heading text-lg font-semibold">{step.stepOrder}. {step.stepName}</h2><p className="mt-0.5 text-xs text-muted-foreground">{step.stepType.replaceAll("_", " ")} · {step.status.replaceAll("_", " ")}</p></div><div className="text-left sm:text-right"><p className="font-mono text-sm font-medium">{insight?.apiResponseTimeMs ? `${formatDuration(insight.apiResponseTimeMs)} API` : "API time not recorded"}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatDuration(step.durationMs)} execution · API rank #{insight?.rank ?? "—"}</p></div></header>{step.errorMessage ? <div className="border-b bg-destructive/5 px-5 py-3 text-sm text-destructive"><strong>{step.failureCategory?.replaceAll("_", " ")}</strong> · {step.errorMessage}</div> : null}
    <Tabs defaultValue="overview" className="min-w-0"><div className="overflow-x-auto border-b px-4 pt-2"><TabsList variant="line"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="pre-request">Pre-request</TabsTrigger><TabsTrigger value="request">Request</TabsTrigger><TabsTrigger value="response">Response</TabsTrigger><TabsTrigger value="checks">Checks</TabsTrigger><TabsTrigger value="attempts">Attempts</TabsTrigger><TabsTrigger value="network">Network</TabsTrigger><TabsTrigger value="events">Events</TabsTrigger></TabsList></div>
      <TabsContent className="p-5" value="overview"><OverviewTab run={run} step={step} insight={insight} /></TabsContent>
      <TabsContent className="p-5" value="pre-request">{step.preRequestScript?<ScriptEvidence result={step.preRequestScript}/>:<EmptyEvidence text="No JavaScript pre-request evidence was recorded for this step."/>}</TabsContent>
      <TabsContent className="p-5" value="request"><EvidenceView title="Rendered request" value={step.requestSummary} icon={Network} /></TabsContent>
      <TabsContent className="p-5" value="response"><EvidenceView title="Response evidence" value={step.responseSummary} icon={Database} /></TabsContent>
      <TabsContent className="p-5" value="checks"><ChecksTab step={step} /></TabsContent>
      <TabsContent className="p-5" value="attempts"><AttemptsTab step={step} /></TabsContent>
      <TabsContent className="p-5" value="network"><NetworkTab step={step} /></TabsContent>
      <TabsContent className="p-5" value="events"><EventsTab events={events.filter((event)=>!event.stepId || event.stepId===step.stepDefinitionId || event.details?.stepId===step.stepDefinitionId)} /></TabsContent>
    </Tabs>
  </section>
}

function ScriptEvidence({result}:{result:ScriptResultContract}){return <div className="overflow-hidden rounded-xl border"><header className="flex flex-wrap items-center gap-3 border-b bg-muted/25 px-4 py-3"><StatusIcon status={result.status==="SUCCESS"?"SUCCESS":"FAILED"}/><div><p className="text-sm font-medium">JavaScript · {result.runtimeVersion}</p><p className="text-xs text-muted-foreground">{formatDuration(result.durationMs)} · {result.tests.length} tests · {result.logs.length} logs · {result.auxiliaryRequests.length} auxiliary requests</p></div>{result.errorCategory?<Badge className="ml-auto" variant="destructive">{result.errorCategory.replaceAll("_"," ")}</Badge>:null}</header>{result.errorMessage?<div className="border-b bg-destructive/5 px-4 py-3"><p className="text-sm text-destructive">{result.errorMessage}</p>{result.errorLine?<p className="mt-1 font-mono text-xs text-muted-foreground">Line {result.errorLine}:{result.errorColumn??1}</p>:null}</div>:null}<div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0"><section className="p-4"><h4 className="text-xs font-semibold text-muted-foreground">Console</h4><div className="mt-2 max-h-56 overflow-auto font-mono text-xs">{result.logs.length?result.logs.map((log,index)=><p className="border-b py-1.5 last:border-0" key={`${log.timestamp}-${index}`}><span className="mr-2 text-muted-foreground">{log.level}</span>{log.message}</p>):<p className="py-3 text-muted-foreground">No console output.</p>}</div></section><section className="p-4"><h4 className="text-xs font-semibold text-muted-foreground">Tests and mutations</h4><div className="mt-2 space-y-2 text-xs">{result.tests.map((test,index)=><p key={`${test.name}-${index}`}><span className={test.passed?"text-success":"text-destructive"}>{test.passed?"✓":"×"}</span> {test.name}{test.error?` · ${test.error}`:""}</p>)}{[...result.variableChanges,...result.requestChanges].map((change,index)=><p className="font-mono" key={`${change.scope}-${change.key}-${index}`}><Badge className="mr-2" variant="outline">{change.operation}</Badge>{change.scope}.{change.key} · {change.state}</p>)}{!result.tests.length&&!result.variableChanges.length&&!result.requestChanges.length?<p className="py-3 text-muted-foreground">No tests or mutations recorded.</p>:null}</div></section></div></div>}

function OverviewTab({ run, step, insight }: { run: RunContract; step: StepRunContract; insight?: StepInsightContract }) {
  const preparation=numberValue(step.timing?.preparationMs)??0;const post=numberValue(step.timing?.postProcessingMs)??0
  return <div className="space-y-7"><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"><KeyValue label="API response time" value={insight?.apiResponseTimeMs ? formatDuration(insight.apiResponseTimeMs) : "Not recorded"} /><KeyValue label="Execution duration" value={formatDuration(step.durationMs)} /><KeyValue label="Preparation" value={formatDuration(preparation)} /><KeyValue label="Post-processing" value={formatDuration(post)} /><KeyValue label="Attempts" value={String(step.attemptCount)} /><KeyValue label="Slowest API phase" value={insight?.slowestPhase ? `${phaseLabel(insight.slowestPhase)} · ${formatDuration(insight.slowestPhaseMs ?? 0)}` : "Not recorded"} /></div><div><h3 className="text-sm font-semibold">API response baseline</h3><BaselineDetail baseline={insight?.baseline} duration={insight?.apiResponseTimeMs ?? 0} /></div><div><h3 className="text-sm font-semibold">Generated outputs</h3><SafeObject value={step.outputs} empty="No generated outputs were retained." /></div><div className="text-xs text-muted-foreground">Run {run.id.slice(0,8)} · Step definition {step.stepDefinitionId}</div></div>
}

function ChecksTab({ step }: { step: StepRunContract }) {
  return <div className="grid gap-7 xl:grid-cols-2"><CheckList title="Assertions" icon={Check} empty="No assertions configured." items={step.assertions.map((item)=>({label:item.type,detail:item.expression || "Response check",expected:item.expected,observed:printable(item.observed),passed:item.passed,error:item.error}))} /><CheckList title="Extractors" icon={FileSearch} empty="No extractors configured." items={step.extractors.map((item)=>({label:item.variable || item.source,detail:item.source,expected:"Value extracted",observed:item.sensitive ? "Masked sensitive value" : printable(item.value),passed:item.success,error:item.error}))} /></div>
}

function AttemptsTab({ step }: { step: StepRunContract }) {
  if (!step.attempts?.length) return <EmptyEvidence text="Attempt-level evidence was not recorded for this execution." />
  return <div className="space-y-4">{step.attempts.map((attempt)=><article className="rounded-xl border" key={attempt.id}><header className="flex flex-wrap items-center gap-3 border-b px-4 py-3"><StatusIcon status={attempt.status} /><h3 className="font-medium">Attempt {attempt.attemptNumber}</h3><span className="text-sm text-muted-foreground">{attempt.responseStatus ? `HTTP ${attempt.responseStatus}` : attempt.failureCategory?.replaceAll("_", " ") || "No response"}</span><span className="ml-auto font-mono text-xs">{formatDuration(attempt.durationMs)}</span></header>{attempt.errorMessage ? <p className="border-b bg-destructive/5 px-4 py-3 text-sm text-destructive">{attempt.errorMessage}</p> : null}<div className="p-4"><TimingBreakdown timing={attempt.timing} />{attempt.retryBackoffMs ? <p className="mt-3 text-xs text-muted-foreground">Retry backoff: {formatDuration(attempt.retryBackoffMs)}</p> : null}{attempt.redirects?.length ? <div className="mt-4"><h4 className="text-xs font-medium text-muted-foreground">Redirects</h4><SafeObject value={attempt.redirects as JsonValue} empty="No redirects" /></div> : null}</div></article>)}</div>
}

function NetworkTab({ step }: { step: StepRunContract }) {
  return <div className="space-y-7"><TimingBreakdown timing={step.timing} /><div className="grid gap-7 xl:grid-cols-2"><EvidenceView title="TLS and certificate" value={step.tls} icon={ShieldCheck} /><EvidenceView title="Proxy route" value={step.proxy} icon={Waypoints} /></div></div>
}

function EventsTab({ events }: { events: RunDiagnosticsContract["events"] }) {
  const [query,setQuery]=useState("")
  const filtered=useMemo(()=>events.filter((event)=>`${event.type} ${event.message} ${event.category ?? ""}`.toLowerCase().includes(query.toLowerCase())),[events,query])
  return <div><div className="relative max-w-md"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search execution events" className="pl-9" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search events" /></div><ol className="mt-5 space-y-0">{filtered.map((event)=><li className="grid grid-cols-[20px_1fr] gap-3" key={event.id}><div className="flex flex-col items-center"><span className="mt-1.5 size-2 rounded-full bg-primary" /><span className="min-h-8 w-px flex-1 bg-border" /></div><div className="pb-5"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{event.type.replaceAll("_", " ")}</p>{event.category ? <Badge variant="outline">{event.category.replaceAll("_", " ")}</Badge> : null}<time className="font-mono text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</time></div><p className="mt-1 text-sm text-muted-foreground">{event.message}</p>{event.details && Object.keys(event.details).length ? <SafeObject value={event.details} empty="" compact /> : null}</div></li>)}{!filtered.length ? <EmptyEvidence text="No execution events match this search." /> : null}</ol></div>
}

function TimingBreakdown({ timing }: { timing?: Record<string, JsonValue> }) {
  const phases=phaseOrder.map((key)=>({key,value:numberValue(timing?.[key])})).filter((item)=>item.value!==undefined)
  const total=Math.max(numberValue(timing?.totalMs) ?? phases.reduce((sum,item)=>sum+(item.value ?? 0),0),1)
  if (!phases.length) return <EmptyEvidence text="Detailed phase timing was not recorded for this execution." />
  const apiTime=numberValue(timing?.apiResponseTimeMs);const networkTotal=numberValue(timing?.networkTotalMs);const retryBackoff=numberValue(timing?.retryBackoffMs)??0
  return <div className="mt-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Timing phases</h3><p className="mt-0.5 text-xs text-muted-foreground">API response excludes preparation, post-processing, and retry backoff.</p></div><TimingHelp /></div>{apiTime!==undefined?<div className="mb-4 grid gap-3 rounded-lg bg-muted/35 p-3 sm:grid-cols-2 lg:grid-cols-4"><KeyValue label="API response" value={formatDuration(apiTime)} /><KeyValue label="All attempts" value={formatDuration(networkTotal??apiTime)} /><KeyValue label="Retry backoff" value={formatDuration(retryBackoff)} /><KeyValue label="Execution total" value={formatDuration(numberValue(timing?.totalMs)??total)} /></div>:null}<div className="flex h-3 overflow-hidden rounded-full bg-muted">{phases.map((phase,index)=><span aria-label={`${phaseLabel(phase.key)} ${phase.value} milliseconds`} className={phaseColor(index)} key={phase.key} style={{width:`${Math.max(1,(phase.value ?? 0)/total*100)}%`}} />)}</div><dl className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{phases.map((phase)=><div className="flex items-center justify-between gap-3 text-sm" key={phase.key}><dt className="text-muted-foreground">{phaseLabel(phase.key)}</dt><dd className="font-mono text-xs">{formatDuration(phase.value ?? 0)}</dd></div>)}</dl>{timing?.connectionReused === true ? <p className="mt-3 text-xs text-muted-foreground">Existing connection reused; DNS, TCP, or TLS setup may not apply.</p> : null}</div>
}

function TimingHelp() {
  return <Popover><PopoverTrigger render={<Button type="button" size="sm" variant="outline" aria-label="Explain timing phases" />}><Info data-icon="inline-start" /> What do these mean?</PopoverTrigger><PopoverContent align="end" className="max-h-[min(680px,75vh)] w-[min(440px,calc(100vw-2rem))] overflow-auto rounded-xl"><PopoverHeader><PopoverTitle>How execution timing is measured</PopoverTitle><PopoverDescription>Preparation is time on Rhythm's side, not time spent waiting for the target. It is intentionally included because the monitor cannot complete without it.</PopoverDescription></PopoverHeader><div className="divide-y">{phaseOrder.map((key)=><div className="py-3 first:pt-0 last:pb-0" key={key}><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{phaseLabel(key)}</p><Badge variant="outline">{phaseHelp[key].origin}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{phaseHelp[key].description}</p></div>)}</div><div className="rounded-lg bg-muted/55 p-3 text-xs leading-5"><p className="font-medium">How totals relate</p><p className="mt-1 text-muted-foreground">These phases contribute to step duration. Run duration can also include other workflow steps, monitor-level setup scripts, retries, retry backoff, and orchestration overhead. Queue delay is reported separately.</p></div></PopoverContent></Popover>
}

function EvidenceView({ title, value, icon: Icon }: { title: string; value?: Record<string, JsonValue>; icon: typeof Network }) {
  if (!value || !Object.keys(value).length) return <EmptyEvidence text={`${title} was not recorded for this execution.`} />
  const capture=value.bodyCapture as Record<string,JsonValue>|undefined
  return <div className="min-w-0"><h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4" />{title}</h3>{capture ? <CaptureState value={capture} /> : null}<dl className="mt-4 divide-y rounded-xl border">{Object.entries(value).filter(([key])=>key!=="bodyCapture"&&key!=="body").map(([key,item])=><div className="grid gap-1 px-4 py-3 sm:grid-cols-[170px_minmax(0,1fr)]" key={key}><dt className="text-xs font-medium text-muted-foreground">{labelize(key)}</dt><dd className="min-w-0 break-words font-mono text-xs">{printable(item)}</dd></div>)}</dl>{Object.hasOwn(value,"body") ? <div className="mt-4"><p className="text-xs font-medium text-muted-foreground">Captured body</p><pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-muted/55 p-4 font-mono text-xs leading-5">{pretty(value.body)}</pre></div> : null}</div>
}

function CaptureState({ value }: { value: Record<string,JsonValue> }) { const state=String(value.state ?? "NOT_CAPTURED");return <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><Badge variant="outline">{state.replaceAll("_"," ")}</Badge><span className="text-muted-foreground">{numberValue(value.byteLength) ?? 0} bytes{state==="TRUNCATED" ? " retained before the configured limit" : ""}</span></div> }
function SafeObject({ value, empty, compact=false }: { value: JsonValue | Record<string,JsonValue> | undefined; empty: string; compact?: boolean }) { if(value===undefined||value===null||(typeof value==="object"&&!Array.isArray(value)&&!Object.keys(value).length))return <p className="mt-3 text-sm text-muted-foreground">{empty}</p>;return <pre className={`${compact?"mt-2 max-h-32":"mt-3 max-h-80"} overflow-auto rounded-lg bg-muted/55 p-3 font-mono text-xs leading-5`}>{pretty(value)}</pre> }
function CheckList({ title,icon:Icon,empty,items }: { title:string;icon:typeof Check;empty:string;items:Array<{label:string;detail:string;expected:string;observed:string;passed:boolean;error?:string}> }) { return <section><h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4" />{title}</h3>{items.length?<ul className="mt-3 divide-y rounded-xl border">{items.map((item,index)=><li className="flex gap-3 p-4" key={`${item.label}-${index}`}><StatusIcon status={item.passed?"SUCCESS":"FAILED"} /><div className="min-w-0"><p className="font-medium">{item.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p><div className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><p><span className="text-muted-foreground">Expected:</span> <span className="font-mono">{item.expected}</span></p><p><span className="text-muted-foreground">Observed:</span> <span className="font-mono">{item.observed}</span></p></div>{item.error?<p className="mt-2 text-sm text-destructive">{item.error}</p>:null}</div></li>)}</ul>:<EmptyEvidence text={empty} />}</section> }

function BaselineDetail({ baseline, duration }: { baseline?: StepInsightContract["baseline"]; duration:number }) { if(!baseline||baseline.classification==="INSUFFICIENT_HISTORY")return <p className="mt-2 text-sm text-muted-foreground">Not enough comparable successful runs yet. At least five samples are required.</p>;return <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3 rounded-xl border p-4"><KeyValue label="Current" value={formatDuration(duration)} /><KeyValue label="Median (p50)" value={formatDuration(baseline.p50Ms ?? 0)} /><KeyValue label="p95" value={formatDuration(baseline.p95Ms ?? 0)} /><KeyValue label="Change" value={`${baseline.changePercent && baseline.changePercent>0?"+":""}${baseline.changePercent ?? 0}%`} /><div><p className="text-xs text-muted-foreground">Assessment</p><div className="mt-1"><BaselineBadge baseline={baseline} />{baseline.mixedRevisions?<span className="ml-2 text-xs text-muted-foreground">mixed revisions</span>:null}</div></div></div> }
function BaselineBadge({ baseline }: { baseline?: StepInsightContract["baseline"] }) { if(!baseline||baseline.classification==="INSUFFICIENT_HISTORY")return null;const tone=baseline.classification==="REGRESSED"?"text-warning-foreground border-warning/30":baseline.classification==="IMPROVED"?"text-success-foreground border-success/30":"";return <Badge className={tone} variant="outline">{baseline.classification.toLowerCase()}</Badge> }
function PendingSteps({ active }: { active:boolean }) { return <div className="rounded-xl border border-dashed py-16 text-center"><LoaderCircle className={`mx-auto size-6 text-muted-foreground ${active?"animate-spin":""}`} /><p className="mt-3 font-medium">{active?"Waiting for execution evidence":"No step evidence recorded"}</p><p className="mt-1 text-sm text-muted-foreground">{active?"The first step will appear here as soon as it starts.":"This legacy run completed without step-level evidence."}</p></div> }
function EmptyEvidence({ text }: { text:string }) { return <div className="mt-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"><FileJson className="mx-auto mb-2 size-5" />{text}</div> }
function StatusBadge({ status }: { status:RunContract["status"] }) { const success=status==="SUCCESS"||status==="SUCCESS_WITH_WARNINGS";const active=activeStatuses.has(status);return <Badge className={success?"bg-success-soft text-success-foreground":active?"":"bg-destructive/10 text-destructive"} variant="secondary">{success?<Check />:active?<LoaderCircle className="animate-spin" />:<CircleAlert />}{status.replaceAll("_"," ")}</Badge> }
function StatusIcon({ status }: { status:RunContract["status"] }) { const success=status==="SUCCESS"||status==="SUCCESS_WITH_WARNINGS";const active=activeStatuses.has(status);const skipped=status==="SKIPPED_CONDITION";return <span className={`grid size-7 shrink-0 place-items-center rounded-full ${success?"bg-success-soft text-success-foreground":active?"bg-primary/10 text-primary":skipped?"bg-muted text-muted-foreground":"bg-destructive/10 text-destructive"}`}>{success?<Check className="size-3.5" />:active?<LoaderCircle className="size-3.5 animate-spin" />:skipped?<X className="size-3.5" />:<CircleAlert className="size-3.5" />}</span> }
function Metric({ label,value,icon:Icon }: { label:string;value:string;icon:typeof Timer }) { return <div className="flex min-w-48 flex-1 items-center gap-3 px-4 py-3"><Icon className="size-4 text-muted-foreground" /><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 truncate text-sm font-medium">{value}</p></div></div> }
function Meta({ label,value,mono=false }: { label:string;value:string;mono?:boolean }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-0.5 max-w-56 truncate ${mono?"font-mono text-xs":"text-sm"}`}>{value}</dd></div> }
function KeyValue({ label,value }: { label:string;value:string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-medium">{value}</p></div> }
function numberValue(value:JsonValue|undefined){return typeof value==="number"?value:undefined}
function phaseLabel(value:string){return phaseLabels[value]??labelize(value)}
function phaseColor(index:number){return ["bg-primary/35","bg-primary/50","bg-primary/65","bg-primary/80","bg-primary","bg-warning/70","bg-success/65","bg-muted-foreground/55","bg-foreground/55"][index%9]}
function formatDuration(value:number){if(value<1)return "<1 ms";if(value<1000)return `${Math.round(value)} ms`;return `${(value/1000).toFixed(value<10000?2:1)} s`}
function labelize(value:string){return value.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ").replace(/^./,(letter)=>letter.toUpperCase())}
function printable(value:JsonValue|undefined):string{if(value===undefined||value===null)return "—";if(typeof value==="string")return value;return JSON.stringify(value)}
function pretty(value:unknown){if(typeof value==="string"){try{return JSON.stringify(JSON.parse(value),null,2)}catch{return value}}return JSON.stringify(value,null,2)}
function helpText(code:string){const values:Record<string,string>={CHECK_DNS_AND_AGENT_NETWORK:"verify the hostname, DNS resolver, and selected agent network.",CHECK_PROXY_PROFILE:"test the proxy profile, credentials, and no-proxy rules.",CHECK_CERTIFICATE_AND_TRUST:"review certificate validity, hostname coverage, client certificate, and CA bundle.",CHECK_TARGET_LATENCY_AND_TIMEOUT:"compare server-wait timing with the configured timeout and target health.",CHECK_SECRET_AND_AUTH_PROFILE:"test referenced secrets and authentication-profile configuration.",CHECK_EXPECTED_AND_OBSERVED:"compare the recorded value with the assertion definition and target contract.",CHECK_RESPONSE_AND_EXPRESSION:"inspect the captured response and extractor expression.",CHECK_PRE_REQUEST_SCRIPT:"open the Pre-request tab and inspect the exact line, console output, tests, and blocked capability.",RUN_CANCELLED:"confirm who cancelled the run and whether a replacement execution is required."};return values[code]??"inspect the failed phase, attempt evidence, and preceding successful step."}
