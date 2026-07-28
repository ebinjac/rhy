import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import type {
  ApiErrorResponse,
  ApiSuccess,
  DeploymentBaselinePreviewContract,
  ValidationSuiteContract,
  ValidationSuiteRunContract,
  DeploymentValidationRunContract,
} from "@/lib/api-client/contracts"

const checkSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["MONITOR", "ELF_QUERY", "OPENSEARCH_ALERT"]),
    monitorId: z.string(),
    queryId: z.string(),
    receiverId: z.string().default(""),
    externalMonitorId: z.string().default(""),
    externalTriggerId: z.string().default(""),
    externalMonitorName: z.string().default(""),
    externalTriggerName: z.string().default(""),
    name: z.string(),
    required: z.boolean(),
  })
  .refine(
    (value) => {
      if (value.kind === "MONITOR") return !!value.monitorId
      if (value.kind === "ELF_QUERY") return !!value.queryId
      return (
        !!value.receiverId &&
        (!!value.externalMonitorId ||
          !!value.externalMonitorName ||
          !!value.externalTriggerId ||
          !!value.externalTriggerName)
      )
    },
    { message: "Check target is required" }
  )
const stageSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  order: z.number().int().positive(),
  checks: z.array(checkSchema).min(1),
})
export const suiteInputSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  environment: z.string(),
  stages: z.array(stageSchema).min(1),
  parallelism: z.number().int().min(1).max(20),
  failFast: z.boolean(),
  timeoutSeconds: z.number().int().min(1).max(86400),
  baselinePolicy: z.string(),
  notificationPolicy: z.string(),
})

const baseURL = () => process.env.RHYTHM_API_URL ?? "http://localhost:8080"

export const previewDeploymentBaseline = createServerFn({ method: "POST" })
  .validator(
    z.object({
      suiteId: z.string().min(1),
      deploymentStart: z.string().datetime(),
      baselineWindow: z.enum(["24h", "7d", "30d"]),
      sampleCount: z.number().int().min(3).max(50),
      sampleIntervalSeconds: z.number().int().min(1).max(300),
    })
  )
  .handler(async ({ data }): Promise<DeploymentBaselinePreviewContract> => {
    const response = await fetch(
      `${baseURL()}/api/v1/suites/${encodeURIComponent(data.suiteId)}/deployment-baseline-preview`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          deploymentStart: data.deploymentStart,
          baselineWindow: data.baselineWindow,
          sampleCount: data.sampleCount,
          sampleIntervalSeconds: data.sampleIntervalSeconds,
        }),
        signal: AbortSignal.timeout(10000),
      }
    )
    if (!response.ok) {
      const failure = (await response.json()) as ApiErrorResponse
      throw new Error(failure.error.message || "Unable to preview the baseline.")
    }
    return (
      (await response.json()) as ApiSuccess<DeploymentBaselinePreviewContract>
    ).data
  })

export const listSuites = createServerFn({ method: "GET" }).handler(
  async (): Promise<ValidationSuiteContract[]> => {
    const response = await fetch(`${baseURL()}/api/v1/suites`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error("Unable to load validation suites")
    return ((await response.json()) as ApiSuccess<ValidationSuiteContract[]>)
      .data
  }
)

export const createSuite = createServerFn({ method: "POST" })
  .validator(suiteInputSchema)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; suite: ValidationSuiteContract }
      | { ok: false; message: string }
    > => {
      try {
        const response = await fetch(`${baseURL()}/api/v1/suites`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return { ok: false, message: failure.error.message }
        }
        return {
          ok: true,
          suite: (
            (await response.json()) as ApiSuccess<ValidationSuiteContract>
          ).data,
        }
      } catch {
        return {
          ok: false,
          message: "The validation suite could not reach the Rhythm API.",
        }
      }
    }
  )

export const updateSuite = createServerFn({ method: "POST" })
  .validator(suiteInputSchema.extend({ suiteId: z.string().min(1) }))
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; suite: ValidationSuiteContract }
      | { ok: false; message: string }
    > => {
      try {
        const { suiteId, ...input } = data
        const response = await fetch(
          `${baseURL()}/api/v1/suites/${encodeURIComponent(suiteId)}`,
          {
            method: "PATCH",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(8000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return { ok: false, message: failure.error.message }
        }
        return {
          ok: true,
          suite: (
            (await response.json()) as ApiSuccess<ValidationSuiteContract>
          ).data,
        }
      } catch {
        return {
          ok: false,
          message: "The validation suite could not reach the Rhythm API.",
        }
      }
    }
  )

export const deleteSuite = createServerFn({ method: "POST" })
  .validator(z.object({ suiteId: z.string().min(1) }))
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        const response = await fetch(
          `${baseURL()}/api/v1/suites/${encodeURIComponent(data.suiteId)}`,
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
          message: "Unable to delete the validation suite.",
        }
      }
    }
  )

export const runSuite = createServerFn({ method: "POST" })
  .validator(
    z.object({
      suiteId: z.string().min(1),
      deploymentId: z.string().optional(),
      version: z.string().optional(),
      commit: z.string().optional(),
      deploymentStart: z.string().optional(),
    })
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; run: ValidationSuiteRunContract }
      | { ok: false; message: string }
    > => {
      try {
        const response = await fetch(
          `${baseURL()}/api/v1/suites/${encodeURIComponent(data.suiteId)}/runs`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              triggerType: "MANUAL",
              deployment: {
                deploymentId: data.deploymentId,
                version: data.version,
                commit: data.commit,
                deploymentStart: data.deploymentStart,
              },
            }),
            signal: AbortSignal.timeout(90000),
          }
        )
        if (!response.ok) {
          const failure = (await response.json()) as ApiErrorResponse
          return { ok: false, message: failure.error.message }
        }
        return {
          ok: true,
          run: (
            (await response.json()) as ApiSuccess<ValidationSuiteRunContract>
          ).data,
        }
      } catch {
        return {
          ok: false,
          message:
            "The suite run timed out or the Rhythm API became unavailable.",
        }
      }
    }
  )

const deploymentInputSchema = z.object({
  suiteId: z.string().min(1),
  deploymentId: z.string(),
  version: z.string(),
  commit: z.string(),
  applicationId: z.string(),
  environment: z.string(),
  notes: z.string(),
  deploymentStart: z.string().min(1),
  baselineWindow: z.enum(["24h", "7d", "30d"]),
  sampleCount: z.number().int().min(3).max(50),
  sampleIntervalSeconds: z.number().int().min(1).max(300),
})

export const startDeploymentValidation = createServerFn({ method: "POST" })
  .validator(deploymentInputSchema)
  .handler(async ({ data }) => {
    try {
      const response = await fetch(
        `${baseURL()}/api/v1/suites/${encodeURIComponent(data.suiteId)}/deployment-runs`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            baselineWindow: data.baselineWindow,
            sampleCount: data.sampleCount,
            sampleIntervalSeconds: data.sampleIntervalSeconds,
            deployment: {
              deploymentId: data.deploymentId,
              version: data.version,
              commit: data.commit,
              applicationId: data.applicationId,
              environment: data.environment,
              notes: data.notes,
              deploymentStart: data.deploymentStart,
            },
          }),
          signal: AbortSignal.timeout(10000),
        }
      )
      if (!response.ok) {
        const failure = (await response.json()) as ApiErrorResponse
        return { ok: false as const, message: failure.error.message }
      }
      return {
        ok: true as const,
        run: (
          (await response.json()) as ApiSuccess<DeploymentValidationRunContract>
        ).data,
      }
    } catch {
      return {
        ok: false as const,
        message: "Unable to start deployment validation.",
      }
    }
  })

export const listDeploymentValidations = createServerFn({
  method: "GET",
}).handler(async (): Promise<DeploymentValidationRunContract[]> => {
  const response = await fetch(`${baseURL()}/api/v1/deployment-runs`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error("Unable to load deployment validations")
  return (
    (await response.json()) as ApiSuccess<DeploymentValidationRunContract[]>
  ).data
})

export const getDeploymentValidation = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string().min(1) }))
  .handler(async ({ data }): Promise<DeploymentValidationRunContract> => {
    const response = await fetch(
      `${baseURL()}/api/v1/deployment-runs/${encodeURIComponent(data.runId)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!response.ok) throw new Error("Deployment validation was not found")
    return (
      (await response.json()) as ApiSuccess<DeploymentValidationRunContract>
    ).data
  })

export const cancelDeploymentValidation = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const response = await fetch(
      `${baseURL()}/api/v1/deployment-runs/${encodeURIComponent(data.runId)}/cancel`,
      {
        method: "POST",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!response.ok) return { ok: false as const }
    return { ok: true as const }
  })

export const downloadDeploymentReport = createServerFn({ method: "GET" })
  .validator(
    z.object({ runId: z.string().min(1), format: z.enum(["pdf", "json"]) })
  )
  .handler(async ({ data }) => {
    const response = await fetch(
      `${baseURL()}/api/v1/deployment-runs/${encodeURIComponent(data.runId)}/report.${data.format}`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!response.ok) throw new Error("Unable to generate report")
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return {
      content: btoa(binary),
      contentType:
        data.format === "pdf" ? "application/pdf" : "application/json",
      filename: `deployment-validation.${data.format}`,
    }
  })
