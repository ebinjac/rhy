import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type {
  ApiErrorResponse,
  ApiSuccess,
  InvestigationItemContract,
  InvestigationReportContract,
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
    signal: AbortSignal.timeout(35_000),
  })
  if (!response.ok) {
    const failure = (await response.json()) as ApiErrorResponse
    throw new Error(failure.error.message || "Rhythm API request failed.")
  }
  return ((await response.json()) as ApiSuccess<T>).data
}

export const getAlertInvestigation = createServerFn({ method: "GET" })
  .validator(z.object({ alertId: z.string().min(1) }))
  .handler(async ({ data }): Promise<InvestigationReportContract> => {
    try {
      return await json(
        `/api/v1/alerts/${encodeURIComponent(data.alertId)}/investigation`
      )
    } catch {
      return { alertId: data.alertId, items: [] }
    }
  })

export const getRunInvestigation = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string().min(1) }))
  .handler(async ({ data }): Promise<InvestigationReportContract> => {
    try {
      return await json(
        `/api/v1/runs/${encodeURIComponent(data.runId)}/investigation`
      )
    } catch {
      return { alertId: "", runId: data.runId, items: [] }
    }
  })

export const rerunAlertInvestigation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      alertId: z.string().min(1),
      checkId: z.string().min(1),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; item: InvestigationItemContract }
      | { ok: false; message: string }
    > => {
      try {
        return {
          ok: true,
          item: await json(
            `/api/v1/alerts/${encodeURIComponent(data.alertId)}/investigation/${encodeURIComponent(data.checkId)}/run`,
            { method: "POST", body: "{}" }
          ),
        }
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Unable to re-run this check.",
        }
      }
    }
  )
