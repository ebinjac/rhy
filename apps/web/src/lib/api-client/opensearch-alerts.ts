import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type {
  AlertContract,
  AlertEventContract,
  ApiErrorResponse,
  ApiSuccess,
  OpenSearchAlertDeliveryContract,
  OpenSearchAlertReceiverContract,
  OpenSearchAlertSetupContract,
  JsonValue,
} from "@/lib/api-client/contracts"

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
    throw new Error(failure.error.message || "Rhythm API request failed.")
  }
  if (response.status === 204) return undefined as T
  return ((await response.json()) as ApiSuccess<T>).data
}

const receiverInput = z.object({
  receiverId: z.string().optional(),
  applicationId: z.string().min(1),
  name: z.string().min(1),
  serviceId: z.string(),
  enabled: z.boolean(),
  dashboardUrl: z.string(),
  expectedMonitorTypes: z.array(
    z.enum(["QUERY_LEVEL", "BUCKET_LEVEL", "DOCUMENT_LEVEL"])
  ),
  reconciliationIntervalSeconds: z.number().int().min(30).max(3600),
})

export const listOpenSearchAlertReceivers = createServerFn({ method: "GET" })
  .validator(z.object({ applicationId: z.string().default("") }))
  .handler(async ({ data }): Promise<OpenSearchAlertReceiverContract[]> =>
    json(
      data.applicationId
        ? `/api/v1/applications/${encodeURIComponent(data.applicationId)}/opensearch-alert-receivers`
        : "/api/v1/opensearch-alert-receivers"
    )
  )

export const saveOpenSearchAlertReceiver = createServerFn({ method: "POST" })
  .validator(receiverInput)
  .handler(async ({ data }) => {
    try {
      const path = data.receiverId
        ? `/api/v1/opensearch-alert-receivers/${encodeURIComponent(data.receiverId)}`
        : `/api/v1/applications/${encodeURIComponent(data.applicationId)}/opensearch-alert-receivers`
      const receiver = await json<OpenSearchAlertReceiverContract>(path, {
        method: data.receiverId ? "PATCH" : "POST",
        body: JSON.stringify({
          name: data.name,
          serviceId: data.serviceId,
          enabled: data.enabled,
          dashboardUrl: data.dashboardUrl,
          expectedMonitorTypes: data.expectedMonitorTypes,
          reconciliationIntervalSeconds: data.reconciliationIntervalSeconds,
        }),
      })
      return { ok: true as const, receiver }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error ? error.message : "Unable to save receiver.",
      }
    }
  })

export const receiverAction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      receiverId: z.string().min(1),
      action: z.enum(["delete", "rotate-token", "test", "reconcile"]),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      | {
          ok: true
          data:
            | OpenSearchAlertReceiverContract
            | AlertContract
            | Record<string, JsonValue>
            | null
        }
      | { ok: false; message: string }
    > => {
      try {
        if (data.action === "delete") {
          await json<void>(
            `/api/v1/opensearch-alert-receivers/${encodeURIComponent(data.receiverId)}`,
            { method: "DELETE" }
          )
          return { ok: true as const, data: null }
        }
        const result = await json<
          | OpenSearchAlertReceiverContract
          | AlertContract
          | Record<string, JsonValue>
        >(
          `/api/v1/opensearch-alert-receivers/${encodeURIComponent(data.receiverId)}/${data.action}`,
          { method: "POST" }
        )
        return { ok: true as const, data: result }
      } catch (error) {
        return {
          ok: false as const,
          message:
            error instanceof Error ? error.message : "Receiver action failed.",
        }
      }
    }
  )

export const getOpenSearchAlertSetup = createServerFn({ method: "GET" })
  .validator(z.object({ receiverId: z.string().min(1) }))
  .handler(async ({ data }): Promise<OpenSearchAlertSetupContract> =>
    json(
      `/api/v1/opensearch-alert-receivers/${encodeURIComponent(data.receiverId)}/setup-template`
    )
  )

export const listOpenSearchAlertDeliveries = createServerFn({ method: "GET" })
  .validator(z.object({ receiverId: z.string().min(1) }))
  .handler(async ({ data }): Promise<OpenSearchAlertDeliveryContract[]> =>
    json(
      `/api/v1/opensearch-alert-receivers/${encodeURIComponent(data.receiverId)}/deliveries`
    )
  )

export const listUnifiedAlerts = createServerFn({ method: "GET" })
  .validator(
    z.object({
      state: z.string().default(""),
      sourceType: z.string().default(""),
      applicationId: z.string().default(""),
      serviceId: z.string().default(""),
      severity: z.string().default(""),
    })
  )
  .handler(async ({ data }): Promise<AlertContract[]> => {
    const params = new URLSearchParams()
    Object.entries(data).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })
    return json(`/api/v1/alerts?${params}`)
  })

export const listAlertEvents = createServerFn({ method: "GET" })
  .validator(z.object({ alertId: z.string().min(1) }))
  .handler(async ({ data }): Promise<AlertEventContract[]> =>
    json(`/api/v1/alerts/${encodeURIComponent(data.alertId)}/events`)
  )
