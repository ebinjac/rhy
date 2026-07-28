import { Badge } from "@workspace/ui/components/badge"
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Clock3,
  PauseCircle,
  TriangleAlert,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type {
  AlertContract,
  ELFRunContract,
  MonitorContract,
} from "@/lib/api-client/contracts"
import type { MonitorStatus } from "@/features/monitors/seed-data"

export type OperationalStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "FAILING"
  | "PAUSED"
  | "NO_SIGNAL"
  | "ATTENTION"
  | "CRITICAL"
  | "UNMONITORED"
  | "PROBE_COMPLETE"
  | "PASS"
  | "FAIL"
  | "PENDING"
  | "CANCELLED"
  | "INSUFFICIENT_HISTORY"

type StatusDefinition = {
  label: string
  explanation: string
  icon: LucideIcon
  className: string
}

export const operationalStatuses: Record<OperationalStatus, StatusDefinition> =
  {
    HEALTHY: {
      label: "Healthy",
      explanation:
        "The latest signals are successful and no active alert needs attention.",
      icon: CheckCircle2,
      className: "bg-success-soft text-success-foreground",
    },
    DEGRADED: {
      label: "Degraded",
      explanation:
        "The resource is operating, but reliability or latency needs attention.",
      icon: TriangleAlert,
      className: "bg-warning-soft text-warning-foreground",
    },
    FAILING: {
      label: "Failing",
      explanation:
        "A current execution or active alert indicates an actionable failure.",
      icon: CircleAlert,
      className: "bg-destructive/10 text-destructive",
    },
    PAUSED: {
      label: "Paused",
      explanation:
        "Scheduled execution is disabled. Existing history is unchanged.",
      icon: PauseCircle,
      className: "bg-muted text-muted-foreground",
    },
    NO_SIGNAL: {
      label: "No signal",
      explanation: "No recent measured execution is available yet.",
      icon: CircleHelp,
      className: "bg-muted text-muted-foreground",
    },
    ATTENTION: {
      label: "Attention",
      explanation: "At least one linked signal needs review.",
      icon: TriangleAlert,
      className: "bg-warning-soft text-warning-foreground",
    },
    CRITICAL: {
      label: "Critical",
      explanation:
        "A blocking failure or critical alert needs immediate attention.",
      icon: CircleAlert,
      className: "bg-destructive/10 text-destructive",
    },
    UNMONITORED: {
      label: "Unmonitored",
      explanation:
        "No enabled monitor or evaluated log check currently covers this application.",
      icon: CircleHelp,
      className: "bg-muted text-muted-foreground",
    },
    PROBE_COMPLETE: {
      label: "Probe complete",
      explanation:
        "OpenSearch returned results, but no deployment-check decision was evaluated.",
      icon: CheckCircle2,
      className: "bg-primary/10 text-primary",
    },
    PASS: {
      label: "Passed",
      explanation: "The evaluated condition passed.",
      icon: CheckCircle2,
      className: "bg-success-soft text-success-foreground",
    },
    FAIL: {
      label: "Failed",
      explanation: "The evaluated condition failed.",
      icon: CircleAlert,
      className: "bg-destructive/10 text-destructive",
    },
    PENDING: {
      label: "Pending",
      explanation: "The execution has not produced a final decision yet.",
      icon: Clock3,
      className: "bg-muted text-muted-foreground",
    },
    CANCELLED: {
      label: "Cancelled",
      explanation: "Execution stopped before a final result was produced.",
      icon: Ban,
      className: "bg-muted text-muted-foreground",
    },
    INSUFFICIENT_HISTORY: {
      label: "Insufficient history",
      explanation:
        "There are not enough comparable samples to make a reliable judgment.",
      icon: CircleHelp,
      className: "bg-warning-soft text-warning-foreground",
    },
  }

export function OperationalStatusBadge({
  status,
  className = "",
}: {
  status: OperationalStatus
  className?: string
}) {
  const definition = operationalStatuses[status]
  const Icon = definition.icon
  return (
    <Badge
      className={`${definition.className} ${className}`}
      title={definition.explanation}
      variant="secondary"
    >
      <Icon aria-hidden="true" />
      {definition.label}
    </Badge>
  )
}

export function deriveMonitorOperationalStatus(
  monitor: Pick<
    MonitorContract,
    "enabled" | "health" | "lastRunAt" | "successRate24h"
  >,
  activeAlerts: Array<Pick<AlertContract, "severity">> = []
): OperationalStatus {
  if (!monitor.enabled) return "PAUSED"
  if (
    activeAlerts.some(
      (alert) => alert.severity === "CRITICAL" || alert.severity === "HIGH"
    ) ||
    monitor.health === "FAILING"
  )
    return "FAILING"
  if (
    activeAlerts.length > 0 ||
    monitor.health === "WARNING" ||
    (monitor.successRate24h !== undefined && monitor.successRate24h < 99)
  )
    return "DEGRADED"
  if (!monitor.lastRunAt || monitor.health === "UNKNOWN") return "NO_SIGNAL"
  return "HEALTHY"
}

export function deriveELFOperationalStatus(
  run?: Pick<ELFRunContract, "status" | "decision">
): OperationalStatus {
  if (!run) return "NO_SIGNAL"
  if (run.status === "FAILED") return "FAIL"
  if (run.decision === "PENDING") return "PROBE_COMPLETE"
  return run.decision
}

export function fromMonitorSummaryStatus(
  status: MonitorStatus
): OperationalStatus {
  switch (status) {
    case "healthy":
      return "HEALTHY"
    case "warning":
      return "DEGRADED"
    case "failing":
      return "FAILING"
    case "paused":
      return "PAUSED"
    default:
      return "NO_SIGNAL"
  }
}
