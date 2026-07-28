import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type { ApiSuccess, SearchResultsContract } from "@/lib/api-client/contracts"

export const searchWorkspace = createServerFn({ method: "GET" })
  .validator(
    z.object({
      q: z.string().trim().min(1).max(120),
      limit: z.number().int().min(1).max(20).default(8),
    })
  )
  .handler(async ({ data }): Promise<SearchResultsContract> => {
    const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
    const params = new URLSearchParams({
      q: data.q,
      limit: String(data.limit),
    })
    const response = await fetch(`${baseURL}/api/v1/search?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      throw new Error(`Rhythm search failed with status ${response.status}`)
    }
    const envelope = (await response.json()) as ApiSuccess<SearchResultsContract>
    return {
      query: envelope.data.query,
      monitors: envelope.data.monitors ?? [],
      runs: envelope.data.runs ?? [],
      alerts: envelope.data.alerts ?? [],
      resources: envelope.data.resources ?? [],
    }
  })
