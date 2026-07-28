export type MonitorStatus = "healthy" | "failing" | "paused" | "unknown" | "warning"

export type MonitorSummary = {
  id: string
  name: string
  slug: string
  description: string
  status: MonitorStatus
  enabled: boolean
  applicationId: string | null
  application: string
  cadence: string
  owner: string
  successRate: number | null
  latencyMs: number | null
  lastRun: string
  stepCount: number
  state: "DRAFT" | "PUBLISHED" | "ENABLED" | "DISABLED" | "ARCHIVED"
}
