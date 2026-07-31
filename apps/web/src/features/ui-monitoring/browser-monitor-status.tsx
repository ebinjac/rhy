import { Badge } from "@workspace/ui/components/badge"
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Clock3,
  LoaderCircle,
  PauseCircle,
  TriangleAlert,
} from "lucide-react"

import type {
  BrowserMonitor,
  BrowserMonitorStatus,
} from "@/lib/api-client/browser-monitoring"

export function BrowserHealthBadge({
  monitor,
}: {
  monitor: Pick<BrowserMonitor, "enabled" | "health">
}) {
  if (!monitor.enabled)
    return (
      <Badge className="bg-muted text-muted-foreground" variant="secondary">
        <PauseCircle />
        Paused
      </Badge>
    )
  switch (monitor.health) {
    case "HEALTHY":
      return (
        <Badge
          className="bg-success-soft text-success-foreground"
          variant="secondary"
        >
          <CheckCircle2 />
          Healthy
        </Badge>
      )
    case "DEGRADED":
      return (
        <Badge
          className="bg-warning-soft text-warning-foreground"
          variant="secondary"
        >
          <TriangleAlert />
          Degraded
        </Badge>
      )
    case "FAILING":
      return (
        <Badge
          className="bg-destructive/10 text-destructive"
          variant="secondary"
        >
          <CircleAlert />
          Failing
        </Badge>
      )
    default:
      return (
        <Badge className="bg-muted text-muted-foreground" variant="secondary">
          <CircleHelp />
          No signal
        </Badge>
      )
  }
}

export function BrowserRunBadge({ status }: { status: BrowserMonitorStatus }) {
  const label = status.toLowerCase().replaceAll("_", " ")
  if (status === "SUCCESS")
    return (
      <Badge
        className="bg-success-soft text-success-foreground"
        variant="secondary"
      >
        <CheckCircle2 />
        {label}
      </Badge>
    )
  if (status === "SUCCESS_WITH_WARNINGS")
    return (
      <Badge
        className="bg-warning-soft text-warning-foreground"
        variant="secondary"
      >
        <TriangleAlert />
        {label}
      </Badge>
    )
  if (["FAILED", "TIMED_OUT", "ABORTED"].includes(status))
    return (
      <Badge variant="destructive">
        <CircleAlert />
        {label}
      </Badge>
    )
  if (status === "CANCELLED")
    return (
      <Badge variant="outline">
        <Ban />
        {label}
      </Badge>
    )
  return (
    <Badge className="bg-primary/10 text-primary" variant="secondary">
      {["QUEUED", "STARTING", "RUNNING", "ANALYZING"].includes(status) ? (
        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
      ) : (
        <Clock3 />
      )}
      {label}
    </Badge>
  )
}

export function formatDuration(value?: number | null) {
  if (value === undefined || value === null) return "Not recorded"
  if (value < 1) return "<1 ms"
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`
}

export function formatFrequency(seconds: number) {
  if (seconds % 86400 === 0) return `Every ${seconds / 86400}d`
  if (seconds % 3600 === 0) return `Every ${seconds / 3600}h`
  if (seconds % 60 === 0) return `Every ${seconds / 60}m`
  return `Every ${seconds}s`
}
