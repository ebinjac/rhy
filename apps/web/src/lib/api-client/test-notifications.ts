import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type { ApiErrorResponse, ApiSuccess } from "@/lib/api-client/contracts"

const baseURL = () => process.env.RHYTHM_API_URL ?? "http://localhost:8080"

export type TestNotificationStatus = {
  email: {
    configured: boolean
    from: string
    fromName: string
    smtpHost: string
    smtpPort: number
  }
  sahara: {
    configured: boolean
    host?: string
    scheme?: string
  }
}

export type TestNotificationResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

const emailInput = z.object({
  from: z.string(),
  fromName: z.string(),
  to: z.string().min(1),
  cc: z.string(),
  bcc: z.string(),
  subject: z.string(),
  body: z.string(),
})

const saharaInput = z.object({
  assignmentGroup: z.string(),
  reporterGroup: z.string(),
  environmentAffected: z.string(),
  severity: z.string(),
  summary: z.string(),
  description: z.string(),
  eventGenerator: z.string(),
})

export const getTestNotificationStatus = createServerFn({
  method: "GET",
}).handler(async (): Promise<TestNotificationStatus> => {
  const response = await fetch(`${baseURL()}/api/v1/internal/test-notifications`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    throw new Error("Unable to load test notification status.")
  }
  return ((await response.json()) as ApiSuccess<TestNotificationStatus>).data
})

export const sendTestNotificationEmail = createServerFn({ method: "POST" })
  .validator(emailInput)
  .handler(async ({ data }): Promise<TestNotificationResult> => {
    return postTestNotification("/api/v1/internal/test-notifications/email", data, {
      success: (payload) =>
        `Email sent through ${String(payload.host || "SMTP")}.`,
      fallback: "Unable to reach the Rhythm API for the SMTP test.",
    })
  })

export const sendTestNotificationSahara = createServerFn({ method: "POST" })
  .validator(saharaInput)
  .handler(async ({ data }): Promise<TestNotificationResult> => {
    return postTestNotification("/api/v1/internal/test-notifications/sahara", data, {
      success: (payload) => {
        const host = payload.host ? ` (${String(payload.host)})` : ""
        const uniqueId = payload.eventUniqueId
          ? ` Event id ${String(payload.eventUniqueId)}.`
          : ""
        return `Sahara ingest accepted the test event${host}.${uniqueId}`
      },
      fallback: "Unable to reach the Rhythm API for the Sahara test.",
    })
  })

async function postTestNotification(
  path: string,
  body: unknown,
  copy: {
    success: (payload: Record<string, unknown>) => string
    fallback: string
  }
): Promise<TestNotificationResult> {
  try {
    const response = await fetch(`${baseURL()}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) {
      const failure = (await response.json()) as ApiErrorResponse
      return { ok: false, message: failure.error.message }
    }
    const payload = ((await response.json()) as ApiSuccess<Record<string, unknown>>)
      .data
    return { ok: true, message: copy.success(payload ?? {}) }
  } catch {
    return { ok: false, message: copy.fallback }
  }
}
