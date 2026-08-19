export type AISettings = {
  id?: string
  name: string
  providerType: "COMPASS360" | "OPENROUTER" | "OPENROUTER_DEMO"
  environment: string
  baseUrl: string
  completionPath: string
  defaultModel: string
  approvedModels: string[]
  requiredCapabilities: Record<string, boolean>
  proxyUrl?: string
  timeoutSeconds: number
  maxConcurrency: number
  maxToolRounds: number
  maxInputTokens: number
  maxOutputTokens: number
  dailyRequestLimit: number
  active: boolean
  hasCredential: boolean
  lastTestStatus: string
  lastTestMessage?: string
  lastTestLatencyMs?: number
  lastTestedAt?: string
  updatedAt?: string
}

export type AIConversation = {
  id: string
  title: string
  contextType?: string
  contextId?: string
  createdAt: string
  updatedAt: string
}

export type AICitation = {
  label: string
  resourceType: string
  resourceId: string
  href: string
}

export type AIMessage = {
  id: string
  conversationId: string
  role: "USER" | "ASSISTANT" | "TOOL"
  content: string
  citations: AICitation[]
  providerName?: string
  modelName?: string
  finishReason?: string
  promptTokens?: number
  completionTokens?: number
  status: "STREAMING" | "COMPLETE" | "FAILED" | "CANCELLED"
  createdAt: string
}

export type AIConversationDetail = {
  conversation: AIConversation
  messages: AIMessage[]
  tools?: { name: string; status: "RUNNING" | "COMPLETE" }[]
}

type Envelope<T> = { data: T }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  })
  const body = (await response.json().catch(() => null)) as
    Envelope<T> | { error?: { message?: string } } | null
  if (!response.ok) {
    throw new Error(
      body && "error" in body
        ? body.error?.message || "Rhythm could not complete the request."
        : "Rhythm could not complete the request."
    )
  }
  return (body as Envelope<T>).data
}

export const getAISettings = () => api<AISettings>("/api/v1/ai/settings")

export const saveAISettings = (
  input: Omit<AISettings, "hasCredential" | "lastTestStatus"> & {
    apiKey: string
  }
) =>
  api<AISettings>("/api/v1/ai/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  })

export type AITestResult = {
  status: string
  message: string
  provider: string
  model: string
  latencyMs: number
  capabilities: Record<string, unknown>
}

export const testAISettings = () =>
  api<AITestResult>("/api/v1/ai/settings/test", {
    method: "POST",
    body: "{}",
  })

export const listAIConversations = () =>
  api<AIConversation[]>("/api/v1/ai/conversations")

export const createAIConversation = (input?: {
  title?: string
  contextType?: string
  contextId?: string
}) =>
  api<AIConversation>("/api/v1/ai/conversations", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  })

export const getAIConversation = (conversationId: string) =>
  api<AIConversationDetail>(
    `/api/v1/ai/conversations/${encodeURIComponent(conversationId)}`
  )

export const updateAIConversation = (
  conversationId: string,
  input: { contextType?: string; contextId?: string }
) =>
  api<AIConversation>(
    `/api/v1/ai/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  )

export const deleteAIConversation = (conversationId: string) =>
  fetch(`/api/v1/ai/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
    credentials: "same-origin",
  }).then((response) => {
    if (!response.ok && response.status !== 404) {
      throw new Error("Conversation could not be deleted.")
    }
  })

export const sendAIMessage = (
  conversationId: string,
  content: string,
  signal?: AbortSignal
) =>
  api<AIConversationDetail>(
    `/api/v1/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
      signal,
    }
  )

export type AIDeploymentReport = {
  runId: string
  markdown: string
  providerName: string
  modelName: string
  generatedBy?: string
  promptTokens?: number
  completionTokens?: number
  generatedAt: string
}

export class AIRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message)
    this.name = "AIRequestError"
  }
}

function isAIConfigured(settings: AISettings) {
  return settings.active && settings.hasCredential
}

export const aiProviderReady = isAIConfigured

async function readEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | Envelope<T>
    | { error?: { code?: string; message?: string } }
    | null
  if (!response.ok) {
    const code =
      body && "error" in body ? body.error?.code || "AI_REQUEST_FAILED" : "AI_REQUEST_FAILED"
    const message =
      body && "error" in body
        ? body.error?.message || "Rhythm could not complete the request."
        : "Rhythm could not complete the request."
    throw new AIRequestError(message, code, response.status)
  }
  return (body as Envelope<T>).data
}

export async function getAIDeploymentReport(runId: string) {
  const response = await fetch(
    `/api/v1/ai/deployment-runs/${encodeURIComponent(runId)}/report`,
    {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }
  )
  if (response.status === 404) return null
  return readEnvelope<AIDeploymentReport>(response)
}

export async function generateAIDeploymentReport(
  runId: string,
  signal?: AbortSignal
) {
  const response = await fetch(
    `/api/v1/ai/deployment-runs/${encodeURIComponent(runId)}/report`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
      signal,
    }
  )
  return readEnvelope<AIDeploymentReport>(response)
}
