import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ArrowLeft, Braces, Database, ShieldCheck } from "lucide-react"

import {
  deriveELFOperationalStatus,
  OperationalStatusBadge,
} from "@/components/operational-status"
import { getELFRun } from "@/lib/api-client/elf"
import { formatDateTime } from "@/lib/format-date"
import { PageContainer } from "@/components/page-container"

export const Route = createFileRoute("/elf/run/$runId")({
  loader: ({ params }) => getELFRun({ data: { runId: params.runId } }),
  component: ELFRunDetail,
})

function ELFRunDetail() {
  const run = Route.useLoaderData()
  return (
    <PageContainer as="main">
      <Button
        nativeButton={false}
        render={<Link to="/elf/runs" />}
        variant="ghost"
      >
        <ArrowLeft />
        ELF runs
      </Button>
      <header className="mt-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <OperationalStatusBadge
              status={deriveELFOperationalStatus(run)}
            />
            <Badge variant="outline">{run.gateMode}</Badge>
            <Badge variant="secondary">{run.sampleState}</Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold">ELF execution evidence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.applicationName || "Deleted application"} ·{" "}
            {run.serviceName || "All services"} · {formatDateTime(run.createdAt)}
          </p>
        </div>
        {run.queryId ? (
          <Button
            nativeButton={false}
            render={
              <Link params={{ queryId: run.queryId }} to="/elf/$queryId" />
            }
          >
            <Braces />
            Open query
          </Button>
        ) : null}
      </header>

      <section
        aria-label="Execution summary"
        className="mt-7 grid divide-y rounded-lg border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4"
      >
        <Metric label="hits.total.value" value={run.hitCount.toLocaleString()} />
        <Metric
          label="OpenSearch took"
          value={`${run.openSearchTookMs.toLocaleString()} ms`}
        />
        <Metric
          label="Rhythm round trip"
          value={`${run.roundTripMs.toLocaleString()} ms`}
        />
        <Metric
          label="Time window"
          value={`${formatDateTime(run.timeFrom)} – ${formatDateTime(run.timeTo)}`}
        />
      </section>

      {run.failureReason ? (
        <section className="mt-6 border-y py-4">
          <p className="text-sm font-medium text-destructive">
            {run.failureCategory || "Execution failed"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.failureReason}
          </p>
        </section>
      ) : null}

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr_.8fr]">
        <section>
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 size-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">
                Sanitized OpenSearch response
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This preserves the actual upstream response structure. Rhythm
                replaces sensitive values before persistence or display.
              </p>
            </div>
          </div>
          <JSONEvidence
            empty="The upstream response was not recorded for this execution."
            value={run.rawResponse}
          />
        </section>
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold">Compiled request and debug</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Server-controlled time bounds and policy changes are visible here
              without credentials.
            </p>
            <JSONEvidence
              empty="Debug evidence was not recorded for this execution."
              value={run.debug}
            />
          </section>
          <section>
            <h2 className="text-lg font-semibold">Evidence retention</h2>
            <div className="mt-3 flex items-start gap-3 border-y py-4">
              <ShieldCheck className="mt-0.5 size-5 text-primary" />
              <p className="text-sm leading-6 text-muted-foreground">
                Sample documents are masked and retained for seven days.
                Summary values and the gate decision follow normal run-history
                retention. Current sample state:{" "}
                <span className="font-medium text-foreground">
                  {run.sampleState.toLowerCase().replaceAll("_", " ")}
                </span>
                .
              </p>
            </div>
          </section>
        </div>
      </div>
    </PageContainer>
  )
}

function JSONEvidence({
  value,
  empty,
}: {
  value: Record<string, unknown>
  empty: string
}) {
  if (!Object.keys(value).length) {
    return (
      <p className="mt-4 border-y py-8 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    )
  }
  return (
    <pre className="mt-4 max-h-[560px] overflow-auto rounded-lg border bg-muted/25 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-base font-semibold">{value}</p>
    </div>
  )
}
