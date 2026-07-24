import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { CheckCircle2, CircleAlert, Clock3, Database } from "lucide-react"

import { listELFRuns } from "@/lib/api-client/elf"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/elf/runs")({
  loader: () => listELFRuns(),
  component: RunsPage,
})
function RunsPage() {
  const runs = Route.useLoaderData()
  return (
    <main className="mx-auto max-w-[1380px] px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="font-heading text-2xl font-semibold">ELF runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sanitized probe and gate evidence. Sample documents expire after seven
          days.
        </p>
      </header>
      <div className="mt-7 overflow-x-auto border-y">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-muted/35 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">Outcome</th>
              <th className="px-3 py-2.5 font-medium">Application / service</th>
              <th className="px-3 py-2.5 font-medium">Index</th>
              <th className="px-3 py-2.5 font-medium">Window</th>
              <th className="px-3 py-2.5 text-right font-medium">Hits</th>
              <th className="px-3 py-2.5 text-right font-medium">OpenSearch</th>
              <th className="px-3 py-2.5 text-right font-medium">Round trip</th>
              <th className="px-3 py-2.5 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-muted/20">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    {run.status === "SUCCESS" && run.decision === "PASS" ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <CircleAlert className="size-4 text-destructive" />
                    )}
                    <div>
                      <p className="font-medium">{run.decision}</p>
                      <p className="text-xs text-muted-foreground">
                        {run.gateMode}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <p>{run.applicationName || "Deleted application"}</p>
                  <p className="text-xs text-muted-foreground">
                    {run.serviceName || "All services"}
                  </p>
                </td>
                <td className="max-w-[220px] truncate px-3 py-3 font-mono text-xs">
                  {run.resolvedIndex}
                </td>
                <td className="px-3 py-3">
                  <p className="text-xs">{formatDateTime(run.createdAt)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {Math.round(
                      (new Date(run.timeTo).getTime() -
                        new Date(run.timeFrom).getTime()) /
                        60000
                    )}{" "}
                    min
                  </p>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {run.hitCount.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {run.openSearchTookMs} ms
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {run.roundTripMs} ms
                </td>
                <td className="px-3 py-3">
                  <Badge variant="outline">{run.sampleState}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!runs.length ? (
          <div className="py-16 text-center">
            <Database className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-3 font-medium">No ELF executions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Probe a saved query to create normalized evidence.
            </p>
            <Link
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              to="/elf"
            >
              <Clock3 className="size-4" />
              Open query library
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  )
}
