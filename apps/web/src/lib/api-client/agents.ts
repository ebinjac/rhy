import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type { AgentContract, ApiErrorResponse, ApiSuccess } from "@/lib/api-client/contracts"

const baseURL = () => process.env.RHYTHM_API_URL ?? "http://localhost:8080"

export const listAgents = createServerFn({ method: "GET" }).handler(async (): Promise<AgentContract[]> => {
  const response = await fetch(`${baseURL()}/api/v1/agents`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error("Unable to load execution agents")
  return ((await response.json()) as ApiSuccess<AgentContract[]>).data
})

export const registerAgent = createServerFn({ method: "POST" }).validator(z.object({ name: z.string().min(1), groupId: z.string(), version: z.string(), tags: z.array(z.string()), capabilities: z.record(z.string(), z.unknown()), maxConcurrency: z.number().int().min(1).max(1000) })).handler(async ({ data }): Promise<{ ok: true; agent: AgentContract } | { ok: false; message: string }> => {
  try {
    const response = await fetch(`${baseURL()}/api/v1/agents/register`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(data), signal: AbortSignal.timeout(5000) })
    if (!response.ok) { const failure = (await response.json()) as ApiErrorResponse; return { ok: false, message: failure.error.message } }
    return { ok: true, agent: ((await response.json()) as ApiSuccess<AgentContract>).data }
  } catch { return { ok: false, message: "The agent could not be registered with the Rhythm API." } }
})

export const changeAgentStatus = createServerFn({ method: "POST" }).validator(z.object({ agentId: z.string().min(1), action: z.enum(["drain", "activate", "revoke"]) })).handler(async ({ data }): Promise<{ ok: true; agent: AgentContract } | { ok: false; message: string }> => {
  try {
    const response = await fetch(`${baseURL()}/api/v1/agents/${encodeURIComponent(data.agentId)}/${data.action}`, { method: "POST", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) { const failure = (await response.json()) as ApiErrorResponse; return { ok: false, message: failure.error.message } }
    return { ok: true, agent: ((await response.json()) as ApiSuccess<AgentContract>).data }
  } catch { return { ok: false, message: "The agent state change could not reach the Rhythm API." } }
})
