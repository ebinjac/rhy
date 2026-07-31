import { createServerFn } from "@tanstack/react-start"

import type { MonitorSummary } from "@/features/monitors/seed-data"
import type {
  AlertContract,
  ApiSuccess,
  DeploymentValidationRunSummaryContract,
  ELFApplicationContract,
  MonitorContract,
  RunContract,
} from "@/lib/api-client/contracts"
import { toMonitorSummary } from "@/lib/api-client/monitors"

export type OverviewContract = {
  monitors: MonitorSummary[]
  alerts: AlertContract[]
  runs: RunContract[]
  deployments: DeploymentValidationRunSummaryContract[]
  applications: ELFApplicationContract[]
  elfConfigured: boolean
  counts: {
    monitors: number
    enabledMonitors: number
    healthyMonitors: number
    attentionMonitors: number
    activeAlerts: number
    criticalAlerts: number
    deployments: number
    suites: number
    applications: number
    elfQueries: number
  }
}

type OverviewAPIContract = Omit<OverviewContract, "monitors"> & {
  monitors: MonitorContract[]
}

export const getOperationalOverview = createServerFn({
  method: "GET",
}).handler(async (): Promise<OverviewContract> => {
  const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
  const response = await fetch(`${baseURL}/api/v1/overview`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) {
    throw new Error(`Rhythm overview returned ${response.status}`)
  }
  const data = (
    (await response.json()) as ApiSuccess<OverviewAPIContract>
  ).data
  const applicationByMonitor = new Map<string, ELFApplicationContract>()
  for (const application of data.applications ?? []) {
    for (const monitorId of application.monitorIds ?? []) {
      applicationByMonitor.set(monitorId, application)
    }
  }
  return {
    ...data,
    monitors: (data.monitors ?? []).map((monitor) => {
      const application = applicationByMonitor.get(monitor.id)
      return toMonitorSummary(
        monitor,
        application
          ? { id: application.id, name: application.name }
          : undefined
      )
    }),
  }
})
