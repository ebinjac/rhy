import { createServerFn } from "@tanstack/react-start"

import type {
  MonitorStatus,
  MonitorSummary,
} from "@/features/monitors/seed-data"
import { createMonitorSchema } from "@/features/monitors/schema"
import type { CreateMonitorInput } from "@/features/monitors/schema"
import type {
  AlertContract,
  ApiErrorResponse,
  ApiSuccess,
  AuditEventContract,
  ConfigurationProfileContract,
  DraftMonitorPreviewContract,
  ELFApplicationContract,
  MonitorContract,
  RevisionContract,
  RunContract,
  RunDiagnosticsContract,
  RunHistoryMetricsContract,
  ScheduleContract,
  ScriptProblemContract,
  ScriptResultContract,
} from "@/lib/api-client/contracts"
import { z } from "zod"

type MonitorListApplication = {
  id: string
  name: string
}

type MonitorListResult = {
  monitors: MonitorSummary[]
  applications: MonitorListApplication[]
  source: "api"
}

export const listMonitors = createServerFn({ method: "GET" }).handler(
  async (): Promise<MonitorListResult> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const [monitorsResponse, applicationsResponse] = await Promise.all([
      fetch(`${baseURL}/api/v1/monitors`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${baseURL}/api/v1/applications`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }),
    ])
    if (!monitorsResponse.ok) {
      throw new Error(`Rhythm API returned ${monitorsResponse.status}`)
    }
    const envelope = (await monitorsResponse.json()) as ApiSuccess<
      MonitorContract[]
    >
    if (!Array.isArray(envelope.data)) {
      throw new Error("Rhythm API returned an invalid monitor list")
    }

    const applicationByMonitorId = new Map<
      string,
      { id: string; name: string }
    >()
    const applications: MonitorListApplication[] = []
    if (applicationsResponse.ok) {
      const applicationsEnvelope = (await applicationsResponse.json()) as ApiSuccess<
        ELFApplicationContract[]
      >
      if (Array.isArray(applicationsEnvelope.data)) {
        for (const application of applicationsEnvelope.data) {
          applications.push({ id: application.id, name: application.name })
          const monitorIds = Array.isArray(application.monitorIds)
            ? application.monitorIds
            : []
          for (const monitorId of monitorIds) {
            applicationByMonitorId.set(monitorId, {
              id: application.id,
              name: application.name,
            })
          }
        }
      }
    }

    return {
      monitors: envelope.data.map((monitor) =>
        toMonitorSummary(monitor, applicationByMonitorId.get(monitor.id))
      ),
      applications: applications.sort((left, right) =>
        left.name.localeCompare(right.name)
      ),
      source: "api",
    }
  }
)

export const previewMonitorDraft = createServerFn({ method: "POST" })
  .validator(z.object({ definition: z.record(z.string(), z.unknown()) }))
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; preview: DraftMonitorPreviewContract }
      | { ok: false; message: string }
    > => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      try {
        const response = await fetch(`${baseURL}/api/v1/monitors/preview`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data.definition),
          signal: AbortSignal.timeout(65000),
        })
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return {
            ok: false,
            message: failure.error.message || "Draft preview failed.",
          }
        }
        return {
          ok: true,
          preview: (
            (await response.json()) as ApiSuccess<DraftMonitorPreviewContract>
          ).data,
        }
      } catch {
        return {
          ok: false,
          message: "Draft preview could not reach the Rhythm API.",
        }
      }
    }
  )

type CreateMonitorResult =
  | { ok: true; monitor: MonitorContract; schedule: ScheduleContract }
  | { ok: false; message: string; fieldErrors?: Record<string, string>; monitorId?: string }

export const createMonitor = createServerFn({ method: "POST" })
  .validator(createMonitorSchema)
  .handler(async ({ data }): Promise<CreateMonitorResult> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    try {
      const { enabled, schedule, ...monitorInput } = data
      const response = await fetch(`${baseURL}/api/v1/monitors`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(monitorInput satisfies Omit<CreateMonitorInput, "enabled" | "schedule">),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        const failure = (await response.json()) as ApiErrorResponse
        const fieldErrors = Object.fromEntries(
          (failure.error.details?.fields ?? []).map((field) => [
            field.path,
            field.message,
          ])
        )
        return {
          ok: false,
          message: failure.error.message || "Unable to create the monitor.",
          fieldErrors,
        }
      }
      const envelope = (await response.json()) as ApiSuccess<MonitorContract>
      let monitor = envelope.data

      if (enabled) {
        const publishResponse = await fetch(
          `${baseURL}/api/v1/monitors/${encodeURIComponent(monitor.id)}/publish`,
          {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ changeSummary: "Published during monitor creation" }),
            signal: AbortSignal.timeout(8000),
          }
        )
        if (!publishResponse.ok) {
          const failure = (await publishResponse.json()) as ApiErrorResponse
          return { ok: false, monitorId: monitor.id, message: failure.error.message || "The monitor was saved as a draft, but could not be published." }
        }
        const enableResponse = await fetch(
          `${baseURL}/api/v1/monitors/${encodeURIComponent(monitor.id)}/enable`,
          { method: "POST", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
        )
        if (!enableResponse.ok) {
          const failure = (await enableResponse.json()) as ApiErrorResponse
          return { ok: false, monitorId: monitor.id, message: failure.error.message || "The monitor was published, but could not be enabled." }
        }
        const enabledEnvelope = (await enableResponse.json()) as ApiSuccess<MonitorContract>
        monitor = enabledEnvelope.data
      }

      const scheduleResponse = await fetch(
        `${baseURL}/api/v1/monitors/${encodeURIComponent(monitor.id)}/schedule`,
        {
          method: "PUT",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(schedule),
          signal: AbortSignal.timeout(8000),
        }
      )
      if (!scheduleResponse.ok) {
        const failure = (await scheduleResponse.json()) as ApiErrorResponse
        return { ok: false, monitorId: monitor.id, message: failure.error.message || "The monitor was created, but its schedule could not be saved." }
      }
      const scheduleEnvelope = (await scheduleResponse.json()) as ApiSuccess<ScheduleContract>
      return { ok: true, monitor, schedule: scheduleEnvelope.data }
    } catch {
      return {
        ok: false,
        message:
          "Rhythm API is unavailable. Check the API connection and try again.",
      }
    }
  })

export const permanentlyDeleteMonitors = createServerFn({ method: "POST" })
  .validator(z.object({ monitorIds: z.array(z.string().min(1)).min(1).max(100) }))
  .handler(async ({ data }): Promise<{ ok: true; deletedCount: number } | { ok: false; message: string }> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    try {
      const response = await fetch(`${baseURL}/api/v1/monitors/bulk-delete`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) {
        const failure = (await response.json()) as ApiErrorResponse
        return { ok: false, message: failure.error.message || "Unable to permanently delete the selected monitors." }
      }
      const envelope = (await response.json()) as ApiSuccess<{ deletedCount: number }>
      return { ok: true, deletedCount: envelope.data.deletedCount }
    } catch {
      return { ok: false, message: "The delete operation could not reach the Rhythm API." }
    }
  })

type RunMonitorResult =
  { ok: true; run: RunContract } | { ok: false; message: string }

export const runMonitor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      revision: z.enum(["draft", "published"]).default("draft"),
    })
  )
  .handler(async ({ data }): Promise<RunMonitorResult> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    try {
      const response = await fetch(
        `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/runs?revision=${data.revision}`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(35000),
        }
      )
      if (!response.ok) {
        const failure = (await response.json()) as ApiErrorResponse
        return {
          ok: false,
          message: failure.error.message || "Unable to run the monitor.",
        }
      }
      const envelope = (await response.json()) as ApiSuccess<{ run: RunContract }>
      return { ok: true, run: envelope.data.run }
    } catch {
      return { ok: false, message: "The run could not reach the Rhythm API." }
    }
  })

const monitorActionSchema = z.object({
  monitorId: z.string().min(1),
  action: z.enum([
    "publish",
    "enable",
    "disable",
    "archive",
    "restore",
    "clone",
  ]),
  name: z.string().optional(),
  slug: z.string().optional(),
})

export const mutateMonitor = createServerFn({ method: "POST" })
  .validator(monitorActionSchema)
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; monitor: MonitorContract } | { ok: false; message: string }
    > => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      const payload =
        data.action === "clone"
          ? { name: data.name, slug: data.slug }
          : data.action === "publish"
            ? { changeSummary: "Published from the monitor workspace" }
            : undefined
      try {
        const response = await fetch(
          `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/${data.action}`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              ...(payload ? { "Content-Type": "application/json" } : {}),
            },
            body: payload ? JSON.stringify(payload) : undefined,
            signal: AbortSignal.timeout(8000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return {
            ok: false,
            message:
              failure.error.message || `Unable to ${data.action} monitor.`,
          }
        }
        const envelope = (await response.json()) as ApiSuccess<
          MonitorContract | { monitor: MonitorContract }
        >
        const monitor =
          "monitor" in envelope.data ? envelope.data.monitor : envelope.data
        return { ok: true, monitor }
      } catch {
        return {
          ok: false,
          message: "The monitor action could not reach the Rhythm API.",
        }
      }
    }
  )

export const listMonitorRuns = createServerFn({ method: "GET" })
  .validator(z.object({ monitorId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RunContract[]> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(
      `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/runs`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!response.ok)
      throw new Error(`Unable to load run history (${response.status})`)
    const envelope = (await response.json()) as ApiSuccess<RunContract[]>
    return envelope.data
  })

export const getMonitorMetrics = createServerFn({ method: "GET" })
  .validator(z.object({ monitorId: z.string().min(1), window: z.enum(["24h", "7d", "30d", "90d"]).default("30d") }))
  .handler(async ({ data }): Promise<RunHistoryMetricsContract> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(
      `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/metrics?window=${data.window}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
    )
    if (!response.ok) throw new Error(`Unable to load run metrics (${response.status})`)
    return ((await response.json()) as ApiSuccess<RunHistoryMetricsContract>).data
  })

export const getRun = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RunContract> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(
      `${baseURL}/api/v1/runs/${encodeURIComponent(data.runId)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!response.ok)
      throw new Error(`Unable to load run diagnostics (${response.status})`)
    const envelope = (await response.json()) as ApiSuccess<RunContract>
    return envelope.data
  })

export const getRunDiagnostics = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RunDiagnosticsContract> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(`${baseURL}/api/v1/runs/${encodeURIComponent(data.runId)}/diagnostics`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`Unable to load run diagnostics (${response.status})`)
    return ((await response.json()) as ApiSuccess<RunDiagnosticsContract>).data
  })

export const validatePreRequestScript = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string().max(65536) }))
  .handler(async ({ data }): Promise<{ valid:boolean; problems:ScriptProblemContract[] }> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(`${baseURL}/api/v1/scripts/validate`, { method:"POST", headers:{ Accept:"application/json", "Content-Type":"application/json" }, body:JSON.stringify({code:data.code}), signal:AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`Unable to validate script (${response.status})`)
    return ((await response.json()) as ApiSuccess<{ valid:boolean; problems:ScriptProblemContract[] }>).data
  })

const scriptPreviewSchema = z.object({ monitorId:z.string().min(1), revisionId:z.string().min(1), scope:z.enum(["monitor","request"]), stepId:z.string().optional(), code:z.string().max(65536), variables:z.record(z.string(),z.string()).default({}), request:z.record(z.string(),z.unknown()).nullable().optional() })
export const previewPreRequestScript = createServerFn({ method:"POST" })
  .validator(scriptPreviewSchema)
  .handler(async ({data}):Promise<ScriptResultContract>=>{
    const baseURL=process.env.RHYTHM_API_URL??"http://localhost:8080"
    const response=await fetch(`${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/revisions/${encodeURIComponent(data.revisionId)}/scripts/preview`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({scope:data.scope,stepId:data.stepId,code:data.code,variables:data.variables,request:data.request}),signal:AbortSignal.timeout(5000)})
    if(!response.ok){const failure=(await response.json()) as ApiErrorResponse;throw new Error(failure.error.message||"Unable to preview script.")}
    return ((await response.json()) as ApiSuccess<ScriptResultContract>).data
  })

export const cancelRun = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(`${baseURL}/api/v1/runs/${encodeURIComponent(data.runId)}/cancel`, { method: "POST", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) })
    if (response.ok) return { ok: true }
    const failure = (await response.json()) as ApiErrorResponse
    return { ok: false, message: failure.error.message || "Unable to cancel the run." }
  })

export const listRecentRuns = createServerFn({ method: "GET" }).handler(
  async (): Promise<RunContract[]> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(`${baseURL}/api/v1/runs`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error("Unable to load recent runs")
    return ((await response.json()) as ApiSuccess<RunContract[]>).data
  }
)

export const getMonitorDraft = createServerFn({ method: "GET" })
  .validator(z.object({ monitorId: z.string().min(1) }))
  .handler(
    async ({
      data,
    }): Promise<{ monitor: MonitorContract; revision: RevisionContract }> => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      const monitorResponse = await fetch(
        `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        }
      )
      if (!monitorResponse.ok) throw new Error("Unable to load monitor")
      const monitorEnvelope =
        (await monitorResponse.json()) as ApiSuccess<MonitorContract>
      if (!monitorEnvelope.data.currentDraftRevisionId)
        throw new Error("Monitor has no draft revision")
      const revisionResponse = await fetch(
        `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/revisions/${encodeURIComponent(monitorEnvelope.data.currentDraftRevisionId)}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        }
      )
      if (!revisionResponse.ok) throw new Error("Unable to load monitor draft")
      const revisionEnvelope =
        (await revisionResponse.json()) as ApiSuccess<RevisionContract>
      return { monitor: monitorEnvelope.data, revision: revisionEnvelope.data }
    }
  )

export const saveMonitorDraft = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      definition: z.record(z.string(), z.unknown()),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; revision: RevisionContract } | { ok: false; message: string }
    > => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      try {
        const response = await fetch(
          `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/draft`,
          {
            method: "PUT",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ definition: data.definition }),
            signal: AbortSignal.timeout(8000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return {
            ok: false,
            message: failure.error.message || "Unable to save draft.",
          }
        }
        const envelope = (await response.json()) as ApiSuccess<{
          revision: RevisionContract
        }>
        return { ok: true, revision: envelope.data.revision }
      } catch {
        return {
          ok: false,
          message: "The draft could not reach the Rhythm API.",
        }
      }
    }
  )

export const getMonitorSchedule = createServerFn({ method: "GET" })
  .validator(z.object({ monitorId: z.string().min(1) }))
  .handler(async ({ data }): Promise<ScheduleContract | null> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(
      `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/schedule`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error("Unable to load monitor schedule")
    return ((await response.json()) as ApiSuccess<ScheduleContract>).data
  })

export const saveMonitorSchedule = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monitorId: z.string().min(1),
      schedule: z.object({
        type: z.enum(["MANUAL", "INTERVAL", "CRON"]),
        expression: z.string().optional(),
        intervalSeconds: z.number().optional(),
        timezone: z.string(),
        jitterSeconds: z.number(),
        concurrencyPolicy: z.enum(["SKIP_IF_RUNNING", "QUEUE", "ALLOW"]),
        missedRunPolicy: z.enum(["SKIP", "RUN_ONCE"]),
      }),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; schedule: ScheduleContract } | { ok: false; message: string }
    > => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      try {
        const response = await fetch(
          `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/schedule`,
          {
            method: "PUT",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data.schedule),
            signal: AbortSignal.timeout(8000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return {
            ok: false,
            message: failure.error.message || "Unable to save schedule.",
          }
        }
        return {
          ok: true,
          schedule: ((await response.json()) as ApiSuccess<ScheduleContract>)
            .data,
        }
      } catch {
        return {
          ok: false,
          message: "The schedule could not reach the Rhythm API.",
        }
      }
    }
  )

export const listAlerts = createServerFn({ method: "GET" })
  .validator(
    z.object({
      state: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", ""]).default(""),
    })
  )
  .handler(async ({ data }): Promise<AlertContract[]> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(
      `${baseURL}/api/v1/alerts?state=${data.state}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!response.ok) throw new Error("Unable to load alerts")
    return ((await response.json()) as ApiSuccess<AlertContract[]>).data
  })

export const mutateAlert = createServerFn({ method: "POST" })
  .validator(
    z.object({
      alertId: z.string().min(1),
      action: z.enum(["acknowledge", "resolve"]),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; alert: AlertContract } | { ok: false; message: string }
    > => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      try {
        const response = await fetch(
          `${baseURL}/api/v1/alerts/${encodeURIComponent(data.alertId)}/${data.action}`,
          {
            method: "POST",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(5000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return { ok: false, message: failure.error.message }
        }
        return {
          ok: true,
          alert: ((await response.json()) as ApiSuccess<AlertContract>).data,
        }
      } catch {
        return {
          ok: false,
          message: "The alert action could not reach the Rhythm API.",
        }
      }
    }
  )

export const listAuditEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuditEventContract[]> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(`${baseURL}/api/v1/audit-events`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error("Unable to load audit history")
    return ((await response.json()) as ApiSuccess<AuditEventContract[]>).data
  }
)

export const listMonitorRevisions = createServerFn({ method: "GET" })
  .validator(z.object({ monitorId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RevisionContract[]> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(
      `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/revisions`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!response.ok) throw new Error("Unable to load revisions")
    return ((await response.json()) as ApiSuccess<RevisionContract[]>).data
  })

export const restoreMonitorRevision = createServerFn({ method: "POST" })
  .validator(
    z.object({ monitorId: z.string().min(1), revisionId: z.string().min(1) })
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(
      `${baseURL}/api/v1/monitors/${encodeURIComponent(data.monitorId)}/revisions/${encodeURIComponent(data.revisionId)}/restore`,
      {
        method: "POST",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!response.ok) {
      const failure = (await response.json()) as ApiErrorResponse
      return { ok: false, message: failure.error.message }
    }
    return { ok: true, message: "Revision restored into the current draft." }
  })

const profileKind = z.enum([
  "environments",
  "secrets",
  "certificates",
  "proxies",
  "auth",
  "notifications",
  "telemetry",
])
export const listConfigurationProfiles = createServerFn({ method: "GET" })
  .validator(z.object({ kind: profileKind }))
  .handler(async ({ data }): Promise<ConfigurationProfileContract[]> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const response = await fetch(`${baseURL}/api/v1/config/${data.kind}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error("Unable to load configuration profiles")
    return (
      (await response.json()) as ApiSuccess<ConfigurationProfileContract[]>
    ).data
  })
export const createConfigurationProfile = createServerFn({ method: "POST" })
  .validator(
    z.object({
      kind: profileKind,
      name: z.string().min(1),
      description: z.string(),
      profileType: z.string().optional(),
      config: z.record(z.string(), z.unknown()),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; profile: ConfigurationProfileContract }
      | { ok: false; message: string }
    > => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      try {
        const payload = {
          name: data.name,
          description: data.description,
          config: data.config,
          ...(data.kind === "secrets"
            ? {}
            : { profileType: data.profileType ?? "" }),
        }
        const response = await fetch(`${baseURL}/api/v1/config/${data.kind}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return { ok: false, message: failure.error.message }
        }
        return {
          ok: true,
          profile: (
            (await response.json()) as ApiSuccess<ConfigurationProfileContract>
          ).data,
        }
      } catch {
        return {
          ok: false,
          message: "The configuration profile could not reach the Rhythm API.",
        }
      }
    }
  )

export const saveConfigurationProfile = createServerFn({ method: "POST" })
  .validator(
    z.object({
      kind: profileKind,
      profileId: z.string().min(1),
      name: z.string().min(1),
      description: z.string(),
      profileType: z.string(),
      config: z.record(z.string(), z.unknown()),
      active: z.boolean().default(true),
    })
  )
  .handler(async ({ data }) => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    try {
      const response = await fetch(
        `${baseURL}/api/v1/config/${data.kind}/${encodeURIComponent(data.profileId)}`,
        {
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: data.name,
            description: data.description,
            profileType: data.profileType,
            config: data.config,
            active: data.active,
          }),
          signal: AbortSignal.timeout(8000),
        }
      )
      if (!response.ok) {
        const failure = (await response.json()) as ApiErrorResponse
        return { ok: false as const, message: failure.error.message }
      }
      return {
        ok: true as const,
        profile: (
          (await response.json()) as ApiSuccess<ConfigurationProfileContract>
        ).data,
      }
    } catch {
      return {
        ok: false as const,
        message: "The configuration profile could not be saved.",
      }
    }
  })

export const deleteConfigurationProfile = createServerFn({ method: "POST" })
  .validator(
    z.object({ kind: profileKind, profileId: z.string().min(1) })
  )
  .handler(async ({ data }) => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    try {
      const response = await fetch(
        `${baseURL}/api/v1/config/${data.kind}/${encodeURIComponent(data.profileId)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        }
      )
      if (!response.ok && response.status !== 204) {
        const failure = (await response.json()) as ApiErrorResponse
        return { ok: false as const, message: failure.error.message }
      }
      return { ok: true as const }
    } catch {
      return {
        ok: false as const,
        message: "The configuration profile could not be deleted.",
      }
    }
  })

export const sendNotificationTestEmail = createServerFn({ method: "POST" })
  .validator(
    z.object({
      profileId: z.string().min(1),
      to: z.string().email(),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; message: string }> => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      try {
        const response = await fetch(
          `${baseURL}/api/v1/config/notifications/${encodeURIComponent(data.profileId)}/test-email`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ to: data.to }),
            signal: AbortSignal.timeout(15000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return { ok: false, message: failure.error.message }
        }
        return { ok: true }
      } catch {
        return {
          ok: false,
          message: "Unable to reach the Rhythm API for the SMTP test.",
        }
      }
    }
  )

function toMonitorSummary(
  monitor: MonitorContract,
  application?: { id: string; name: string }
): MonitorSummary {
  return {
    id: monitor.id,
    name: monitor.name,
    slug: monitor.slug,
    description: monitor.description ?? "No description provided",
    status: healthToStatus(monitor.health),
    enabled: monitor.enabled,
    applicationId: application?.id ?? null,
    application: application?.name || "Not assigned",
    cadence: monitor.scheduleSummary ?? "Manual only",
    owner: monitor.ownerId ?? "Unassigned",
    successRate: monitor.successRate24h ?? null,
    latencyMs: monitor.lastLatencyMs ?? null,
    lastRun: monitor.lastRunAt ? relativeTime(monitor.lastRunAt) : "Not run",
    stepCount: monitor.stepCount,
    state: monitor.state,
  }
}

function healthToStatus(health: MonitorContract["health"]): MonitorStatus {
  if (health === "HEALTHY") return "healthy"
  if (health === "FAILING") return "failing"
  if (health === "WARNING") return "warning"
  if (health === "PAUSED") return "paused"
  return "unknown"
}

function relativeTime(value: string) {
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000)
  )
  if (elapsedSeconds < 60) return `${elapsedSeconds} sec ago`
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} min ago`
  if (elapsedSeconds < 86400)
    return `${Math.floor(elapsedSeconds / 3600)} hr ago`
  return `${Math.floor(elapsedSeconds / 86400)} days ago`
}
