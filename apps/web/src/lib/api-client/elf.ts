import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type {
  ApiErrorResponse,
  ApiSuccess,
  ELFApplicationContract,
  ELFQueryContract,
  ELFRunContract,
  ELFServiceContract,
  ELFSettingsContract,
  ELFValidationContract,
  JsonValue,
} from "@/lib/api-client/contracts"

type NullableField = Omit<ELFRunContract["fields"][number], "samples"> & {
  samples?: ELFRunContract["fields"][number]["samples"] | null
}
type NullableRun = Omit<
  ELFRunContract,
  | "samples"
  | "fields"
  | "shardSummary"
  | "aggregations"
  | "rawResponse"
  | "truncation"
  | "debug"
> & {
  samples?: ELFRunContract["samples"] | null
  fields?: NullableField[] | null
  shardSummary?: ELFRunContract["shardSummary"] | null
  aggregations?: ELFRunContract["aggregations"] | null
  rawResponse?: ELFRunContract["rawResponse"] | null
  truncation?: ELFRunContract["truncation"] | null
  debug?: ELFRunContract["debug"] | null
}
type NullableService = Omit<ELFServiceContract, "semanticMapping"> & {
  semanticMapping?: ELFServiceContract["semanticMapping"] | null
}
type NullableApplication = Omit<
  ELFApplicationContract,
  "services" | "monitorIds" | "maskingRules" | "semanticMapping"
> & {
  services?: NullableService[] | null
  monitorIds?: string[] | null
  maskingRules?: string[] | null
  semanticMapping?: Record<string, string> | null
}
type NullableQuery = Omit<
  ELFQueryContract,
  "discoveredSchema" | "criteria" | "semanticMapping" | "lastRun"
> & {
  discoveredSchema?: NullableField[] | null
  criteria?: ELFQueryContract["criteria"] | null
  semanticMapping?: ELFQueryContract["semanticMapping"] | null
  lastRun?: NullableRun | null
}

const baseURL = () => process.env.RHYTHM_API_URL ?? "http://localhost:8080"
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseURL()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(35000),
  })
  if (!response.ok) {
    const failure = (await response.json()) as ApiErrorResponse
    throw new Error(
      failure.error.message || `Rhythm API returned ${response.status}`
    )
  }
  return ((await response.json()) as ApiSuccess<T>).data
}

function normalizeRun(run: NullableRun): ELFRunContract {
  return {
    ...run,
    samples: Array.isArray(run.samples) ? run.samples : [],
    fields: Array.isArray(run.fields)
      ? run.fields.map((field) => ({
          ...field,
          samples: Array.isArray(field.samples) ? field.samples : [],
        }))
      : [],
    shardSummary: run.shardSummary ?? {},
    aggregations: run.aggregations ?? {},
    rawResponse: run.rawResponse ?? {},
    truncation: run.truncation ?? {},
    debug: run.debug ?? {},
  }
}

function normalizeApplication(
  application: NullableApplication
): ELFApplicationContract {
  return {
    ...application,
    services: Array.isArray(application.services)
      ? application.services.map((service) => ({
          ...service,
          semanticMapping: service.semanticMapping ?? {},
        }))
      : [],
    monitorIds: Array.isArray(application.monitorIds)
      ? application.monitorIds
      : [],
    maskingRules: Array.isArray(application.maskingRules)
      ? application.maskingRules
      : [],
    semanticMapping: application.semanticMapping ?? {},
  }
}

function normalizeQuery(query: NullableQuery): ELFQueryContract {
  return {
    ...query,
    discoveredSchema: Array.isArray(query.discoveredSchema)
      ? query.discoveredSchema.map((field) => ({
          ...field,
          samples: Array.isArray(field.samples) ? field.samples : [],
        }))
      : [],
    criteria: query.criteria ?? {},
    semanticMapping: query.semanticMapping ?? {},
    lastRun: query.lastRun ? normalizeRun(query.lastRun) : undefined,
  }
}

const settingsSchema = z.object({
  baseUrl: z.string().url(),
  dashboardUrl: z.string(),
  defaultIndexPattern: z.string().min(1),
  timeoutSeconds: z.number().int().min(1).max(30),
  allowedIndexPatterns: z.array(z.string()).min(1),
  tlsProfileId: z.string(),
  proxyProfileId: z.string(),
  authMode: z.enum(["NONE", "BASIC", "BEARER"]),
  username: z.string(),
  credentialSecretRef: z.string(),
})
const applicationSchema = z.object({
  id: z.string().optional(),
  carId: z.string().max(64),
  name: z.string().min(1),
  owner: z.string(),
  environment: z.string(),
  defaultIndexPattern: z.string(),
  defaultTimeField: z.string().min(1),
  maskingRules: z.array(z.string()),
  semanticMapping: z.record(z.string(), z.string()),
})
const serviceSchema = z.object({
  applicationId: z.string().min(1),
  name: z.string().min(1),
  indexPattern: z.string(),
  timeField: z.string(),
})
const querySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string(),
  applicationId: z.string().min(1),
  serviceId: z.string(),
  indexOverride: z.string(),
  active: z.boolean(),
  searchBody: z.record(z.string(), z.unknown()),
  defaultWindowSeconds: z.number().int().min(60).max(2592000),
  checkKind: z.literal("HIT_COUNT"),
  criteria: z.record(z.string(), z.unknown()),
  gateMode: z.enum(["BLOCKING", "ADVISORY"]),
  semanticMapping: z.record(z.string(), z.string()),
})

export const listELFApplications = createServerFn({ method: "GET" }).handler(
  async () => {
    const applications = await json<ELFApplicationContract[]>(
      "/api/v1/applications"
    )
    return Array.isArray(applications)
      ? applications.map(normalizeApplication)
      : []
  }
)
export const saveELFApplication = createServerFn({ method: "POST" })
  .validator(applicationSchema)
  .handler(async ({ data }) => {
    try {
      const { id, ...body } = data
      return {
        ok: true as const,
        application: await json<ELFApplicationContract>(
          id
            ? `/api/v1/applications/${encodeURIComponent(id)}`
            : "/api/v1/applications",
          { method: id ? "PATCH" : "POST", body: JSON.stringify(body) }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to save application.",
      }
    }
  })
export const deleteELFApplication = createServerFn({ method: "POST" })
  .validator(z.object({ applicationId: z.string().min(1) }))
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        const response = await fetch(
          `${baseURL()}/api/v1/applications/${encodeURIComponent(data.applicationId)}`,
          {
            method: "DELETE",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
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
          message: "Unable to delete the application.",
        }
      }
    }
  )
export const createELFService = createServerFn({ method: "POST" })
  .validator(serviceSchema)
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        service: await json<ELFServiceContract>(
          `/api/v1/applications/${encodeURIComponent(data.applicationId)}/services`,
          {
            method: "POST",
            body: JSON.stringify({
              name: data.name,
              indexPattern: data.indexPattern,
              timeField: data.timeField,
              semanticMapping: {},
            }),
          }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error ? error.message : "Unable to save service.",
      }
    }
  })

export const setApplicationMonitorLink = createServerFn({ method: "POST" })
  .validator(
    z.object({
      applicationId: z.string().min(1),
      monitorId: z.string().min(1),
      linked: z.boolean(),
    })
  )
  .handler(async ({ data }) => {
    try {
      await json<{ linked: boolean }>(
        `/api/v1/applications/${encodeURIComponent(data.applicationId)}/monitors/${encodeURIComponent(data.monitorId)}`,
        { method: data.linked ? "PUT" : "DELETE" }
      )
      return { ok: true as const }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to update monitor tag.",
      }
    }
  })

export const assignELFQueryToApplication = createServerFn({ method: "POST" })
  .validator(
    z.object({
      applicationId: z.string().min(1),
      queryId: z.string().min(1),
    })
  )
  .handler(async ({ data }) => {
    try {
      const query = await json<ELFQueryContract>(
        `/api/v1/elf/queries/${encodeURIComponent(data.queryId)}`
      )
      const updated = await json<ELFQueryContract>(
        `/api/v1/elf/queries/${encodeURIComponent(data.queryId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: query.name,
            description: query.description ?? "",
            applicationId: data.applicationId,
            serviceId: "",
            indexOverride: query.indexOverride ?? "",
            active: query.active,
            searchBody: query.searchBody,
            defaultWindowSeconds: query.defaultWindowSeconds,
            checkKind: query.checkKind,
            criteria: query.criteria,
            gateMode: query.gateMode,
            semanticMapping: query.semanticMapping,
          }),
        }
      )
      return { ok: true as const, query: updated }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to assign ELF query.",
      }
    }
  })

export const getELFSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<ELFSettingsContract | null> => {
    try {
      return await json<ELFSettingsContract>("/api/v1/elf/settings")
    } catch {
      return null
    }
  }
)
export const saveELFSettings = createServerFn({ method: "POST" })
  .validator(settingsSchema)
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        settings: await json<ELFSettingsContract>("/api/v1/elf/settings", {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to save ELF settings.",
      }
    }
  })
export const testELFSettings = createServerFn({ method: "POST" })
  .validator(settingsSchema)
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        result: await json<Record<string, JsonValue>>(
          "/api/v1/elf/settings/test",
          { method: "POST", body: JSON.stringify(data) }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to test ELF connection.",
      }
    }
  })

export const listELFQueries = createServerFn({ method: "GET" }).handler(() =>
  json<ELFQueryContract[]>("/api/v1/elf/queries").then((queries) =>
    Array.isArray(queries) ? queries.map(normalizeQuery) : []
  )
)
export const getELFQuery = createServerFn({ method: "GET" })
  .validator(z.object({ queryId: z.string().min(1) }))
  .handler(async ({ data }) =>
    normalizeQuery(
      await json<ELFQueryContract>(
        `/api/v1/elf/queries/${encodeURIComponent(data.queryId)}`
      )
    )
  )
export const saveELFQuery = createServerFn({ method: "POST" })
  .validator(querySchema)
  .handler(async ({ data }) => {
    try {
      const { id, ...body } = data
      return {
        ok: true as const,
        query: await json<ELFQueryContract>(
          id
            ? `/api/v1/elf/queries/${encodeURIComponent(id)}`
            : "/api/v1/elf/queries",
          { method: id ? "PATCH" : "POST", body: JSON.stringify(body) }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error ? error.message : "Unable to save ELF query.",
      }
    }
  })
export const permanentlyDeleteELFQueries = createServerFn({ method: "POST" })
  .validator(z.object({ queryIds: z.array(z.string().min(1)).min(1).max(100) }))
  .handler(async ({ data }) => {
    try {
      const result = await json<{ deletedCount: number }>(
        "/api/v1/elf/queries/bulk-delete",
        { method: "POST", body: JSON.stringify(data) }
      )
      return { ok: true as const, deletedCount: result.deletedCount }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to permanently delete the selected ELF queries.",
      }
    }
  })
export const validateELFQuery = createServerFn({ method: "POST" })
  .validator(z.object({ queryId: z.string().min(1) }))
  .handler(({ data }) =>
    json<ELFValidationContract>(
      `/api/v1/elf/queries/${encodeURIComponent(data.queryId)}/validate`,
      { method: "POST" }
    )
  )
export const runELFQuery = createServerFn({ method: "POST" })
  .validator(
    z.object({
      queryId: z.string().min(1),
      mode: z.enum(["probe", "test"]),
      windowSeconds: z.number().int().min(60),
      size: z.number().int().min(0).max(100),
    })
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        run: normalizeRun(
          await json<ELFRunContract>(
            `/api/v1/elf/queries/${encodeURIComponent(data.queryId)}/${data.mode}`,
            {
              method: "POST",
              body: JSON.stringify({
                windowSeconds: data.windowSeconds,
                size: data.size,
              }),
            }
          )
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to execute ELF query.",
      }
    }
  })
export const listELFRuns = createServerFn({ method: "GET" }).handler(
  async () => {
    const runs = await json<ELFRunContract[]>("/api/v1/elf/runs")
    return Array.isArray(runs) ? runs.map(normalizeRun) : []
  }
)
