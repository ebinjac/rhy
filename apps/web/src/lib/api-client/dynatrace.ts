import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type {
  ApiErrorResponse,
  ApiSuccess,
  DynatraceConfigurationContract,
  DynatraceEntityContract,
  DynatraceEnvironmentBindingContract,
  DynatraceResourcePreviewContract,
  DynatraceRunContract,
  DynatraceRuleContract,
} from "@/lib/api-client/contracts"

const baseURL = () => process.env.RHYTHM_API_URL ?? "http://localhost:8080"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseURL()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(35_000),
  })
  if (!response.ok) {
    const failure = (await response.json()) as ApiErrorResponse
    throw new Error(
      failure.error.message || `Rhythm API returned ${response.status}`
    )
  }
  return ((await response.json()) as ApiSuccess<T>).data
}

const applicationSchema = z.object({ applicationId: z.string().min(1) })
const contextSchema = z.object({
  applicationId: z.string().min(1),
  environmentBindingId: z.string().min(1),
})

export const listApplicationEnvironments = createServerFn({
  method: "GET",
})
  .validator(applicationSchema)
  .handler(async ({ data }) =>
    request<DynatraceEnvironmentBindingContract[]>(
      `/api/v1/applications/${encodeURIComponent(data.applicationId)}/environments`
    )
  )

export const linkApplicationEnvironment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      applicationId: z.string().min(1),
      environmentProfileId: z.string().min(1),
    })
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        binding: await request<DynatraceEnvironmentBindingContract>(
          `/api/v1/applications/${encodeURIComponent(data.applicationId)}/environments`,
          {
            method: "POST",
            body: JSON.stringify({
              environmentProfileId: data.environmentProfileId,
              enabled: true,
            }),
          }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to link the environment.",
      }
    }
  })

export const ensureApplicationDynatraceContext = createServerFn({
  method: "POST",
})
  .validator(applicationSchema)
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        binding: await request<DynatraceEnvironmentBindingContract>(
          `/api/v1/applications/${encodeURIComponent(data.applicationId)}/dynatrace/context`,
          { method: "POST", body: JSON.stringify({}) }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to prepare Dynatrace.",
      }
    }
  })

export const getDynatraceConfiguration = createServerFn({ method: "GET" })
  .validator(contextSchema)
  .handler(async ({ data }): Promise<DynatraceConfigurationContract | null> => {
    const response = await fetch(
      `${baseURL()}/api/v1/applications/${encodeURIComponent(data.applicationId)}/environments/${encodeURIComponent(data.environmentBindingId)}/dynatrace`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }
    )
    if (response.status === 404) return null
    if (!response.ok) {
      const failure = (await response.json()) as ApiErrorResponse
      throw new Error(failure.error.message)
    }
    return (
      (await response.json()) as ApiSuccess<DynatraceConfigurationContract>
    ).data
  })

const resourceMappingSchema = z.object({
  id: z.string().optional(),
  serviceId: z.string().optional(),
  platform: z.enum(["HYDRA", "TIMS"]),
  entityType: z.string(),
  mappingType: z.enum([
    "ENTITY_ID",
    "TAG",
    "HOST_GROUP",
    "NAMESPACE",
    "WORKLOAD",
    "CONTAINER_GROUP",
    "CLUSTER",
    "HOST",
  ]),
  value: z.string().min(1),
  label: z.string().optional(),
  enabled: z.boolean(),
})

const ruleSchema = z.object({
  id: z.string().optional(),
  serviceId: z.string().optional(),
  name: z.string().min(1),
  metric: z.enum(["CPU", "MEMORY"]),
  statistic: z.enum(["AVERAGE", "MAXIMUM", "LATEST", "P50", "P95"]),
  operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]),
  threshold: z.number(),
  comparison: z.enum([
    "ABSOLUTE",
    "BASELINE_ABSOLUTE",
    "BASELINE_PERCENT",
  ]),
  scope: z.enum(["APPLICATION", "SERVICE", "RESOURCE"]),
  gateMode: z.enum(["ADVISORY", "BLOCKING"]),
  minimumCoveragePercent: z.number().min(0).max(100).optional(),
  consecutivePoints: z.number().int().min(1),
  enabled: z.boolean(),
})

const configurationSchema = contextSchema.extend({
  connectionProfileId: z.string().min(1),
  credentialSecretRef: z.string(),
  platforms: z.array(z.enum(["HYDRA", "TIMS"])).min(1),
  managementZones: z.array(z.string()),
  metricMappings: z.object({
    cpu: z.string(),
    memory: z.string(),
    hydraCpu: z.string(),
    hydraMemory: z.string(),
    timsCpu: z.string(),
    timsMemory: z.string(),
  }),
  baselineWindowSeconds: z.number().int(),
  stabilizationSeconds: z.number().int(),
  postWindowSeconds: z.number().int(),
  enabled: z.boolean(),
  resourceMappings: z.array(resourceMappingSchema),
  rules: z.array(ruleSchema),
})

export const saveDynatraceConfiguration = createServerFn({ method: "POST" })
  .validator(configurationSchema)
  .handler(async ({ data }) => {
    const { applicationId, environmentBindingId, ...body } = data
    try {
      return {
        ok: true as const,
        configuration: await request<DynatraceConfigurationContract>(
          `/api/v1/applications/${encodeURIComponent(applicationId)}/environments/${encodeURIComponent(environmentBindingId)}/dynatrace`,
          { method: "PUT", body: JSON.stringify(body) }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to save Dynatrace configuration.",
      }
    }
  })

export const testDynatraceConnection = createServerFn({ method: "POST" })
  .validator(contextSchema)
  .handler(async ({ data }) => {
    try {
      const result = await request<{
        status: "SUCCESS" | "FAILED"
        baseUrl: string
        latencyMs: number
        entityCount: number
        requiredScopes: string[]
        checkedAt: string
        safeError?: string
      }>(
        `/api/v1/applications/${encodeURIComponent(data.applicationId)}/environments/${encodeURIComponent(data.environmentBindingId)}/dynatrace/test`,
        { method: "POST" }
      )
      return {
        ok: result.status === "SUCCESS",
        result,
        message: result.safeError,
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to test Dynatrace.",
      }
    }
  })

export const listDynatraceManagementZones = createServerFn({ method: "GET" })
  .validator(contextSchema)
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        zones: await request<string[]>(
          `/api/v1/applications/${encodeURIComponent(data.applicationId)}/environments/${encodeURIComponent(data.environmentBindingId)}/dynatrace/management-zones`
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to load management zones.",
      }
    }
  })

export const previewDynatraceResources = createServerFn({ method: "POST" })
  .validator(contextSchema.extend({ serviceId: z.string() }))
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        preview: await request<DynatraceResourcePreviewContract>(
          `/api/v1/applications/${encodeURIComponent(data.applicationId)}/environments/${encodeURIComponent(data.environmentBindingId)}/dynatrace/resources/preview`,
          {
            method: "POST",
            body: JSON.stringify({ serviceId: data.serviceId }),
          }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to preview Dynatrace resources.",
      }
    }
  })

export const discoverDynatraceResources = createServerFn({ method: "POST" })
  .validator(
    contextSchema.extend({
      platform: z.enum(["HYDRA", "TIMS"]),
      managementZones: z.array(z.string()),
    })
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        resources: await request<DynatraceEntityContract[]>(
          `/api/v1/applications/${encodeURIComponent(data.applicationId)}/environments/${encodeURIComponent(data.environmentBindingId)}/dynatrace/resources/discover`,
          {
            method: "POST",
            body: JSON.stringify({
              platform: data.platform,
              managementZones: data.managementZones,
            }),
          }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to discover Dynatrace resources.",
      }
    }
  })

export const saveDynatraceRules = createServerFn({ method: "POST" })
  .validator(contextSchema.extend({ rules: z.array(ruleSchema) }))
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        rules: await request<DynatraceRuleContract[]>(
          `/api/v1/applications/${encodeURIComponent(data.applicationId)}/environments/${encodeURIComponent(data.environmentBindingId)}/dynatrace/rules`,
          { method: "PUT", body: JSON.stringify(data.rules) }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error ? error.message : "Unable to save rules.",
      }
    }
  })

export const runDynatraceQuery = createServerFn({ method: "POST" })
  .validator(
    contextSchema.extend({
      serviceId: z.string(),
      platform: z.string(),
      timeFrom: z.string(),
      timeTo: z.string(),
      resolution: z.string(),
    })
  )
  .handler(async ({ data }) => {
    const { applicationId, environmentBindingId, ...body } = data
    try {
      return {
        ok: true as const,
        run: await request<DynatraceRunContract>(
          `/api/v1/applications/${encodeURIComponent(applicationId)}/environments/${encodeURIComponent(environmentBindingId)}/dynatrace/query`,
          { method: "POST", body: JSON.stringify(body) }
        ),
      }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Unable to query Dynatrace.",
      }
    }
  })

export const listDynatraceRuns = createServerFn({ method: "GET" })
  .validator(
    z.object({
      applicationId: z.string(),
      environmentBindingId: z.string(),
    })
  )
  .handler(async ({ data }) => {
    const query = new URLSearchParams()
    if (data.applicationId) query.set("applicationId", data.applicationId)
    if (data.environmentBindingId)
      query.set("environmentBindingId", data.environmentBindingId)
    return request<DynatraceRunContract[]>(
      `/api/v1/dynatrace/runs?${query.toString()}`
    )
  })
