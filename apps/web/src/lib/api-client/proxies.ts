import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type {
  ApiErrorResponse,
  ApiSuccess,
  JsonValue,
} from "@/lib/api-client/contracts"

export type ProxyTestResult = {
  success: boolean
  message: string
  targetUrl: string
  statusCode: number
  durationMs: number
  failureCategory?: string
  timing: Record<string, JsonValue>
  proxyScheme: string
  proxyHost: string
  proxyPort: string
  bypassed: boolean
  checkedAt: string
}

export const testProxyProfile = createServerFn({ method: "POST" })
  .validator(
    z.object({
      profileId: z.string().min(1),
      targetUrl: z.url(),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; result: ProxyTestResult } | { ok: false; message: string }
    > => {
      const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
      try {
        const response = await fetch(
          `${baseURL}/api/v1/config/proxies/${encodeURIComponent(data.profileId)}/test`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ targetUrl: data.targetUrl }),
            signal: AbortSignal.timeout(20000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return { ok: false, message: failure.error.message }
        }
        return {
          ok: true,
          result: ((await response.json()) as ApiSuccess<ProxyTestResult>).data,
        }
      } catch {
        return {
          ok: false,
          message: "The proxy test could not reach the Rhythm API.",
        }
      }
    }
  )
