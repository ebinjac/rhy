import { normalizeScriptDefinition } from "@/features/monitors/script-definition"
import type { ScriptDefinition } from "@/features/monitors/script-definition"

export type KeyValueRow = {
  id: string
  enabled: boolean
  key: string
  value: string
  description: string
  sensitive?: boolean
}

export type RequestDefinition = {
  schemaVersion: number
  scripts: { preRequest: ScriptDefinition }
  steps: Array<{
    id: string
    name: string
    type: "HTTP_REQUEST" | "ACTION" | "METRIC_VALIDATION"
    enabled: boolean
    timeoutMs: number
    actions: Array<{
      id: string
      enabled: boolean
      type: string
      output: string
      expression: string
      sensitive: boolean
      fields?: Record<string, string>
    }>
    metric: {
      provider: string
      profileId: string
      metricSelector: string
      entitySelector: string
      aggregation: string
      window: string
      resolution: string
      baselineWindow: string
      operator: string
      threshold: number
      missingDataPolicy: string
    }
    request: {
      method: string
      url: string
      params: KeyValueRow[]
      headers: KeyValueRow[]
      cookies: Array<KeyValueRow & { domain: string; path: string }>
      persistCookies: boolean
      auth: { type: string; fields: Record<string, string> }
      body: { type: string; content: string }
      preRequest: Array<{
        id: string
        enabled: boolean
        type: string
        output: string
        expression: string
        sensitive: boolean
        fields?: Record<string, string>
      }>
      preRequestScript: ScriptDefinition
      testScript: ScriptDefinition
      extractors: Array<{
        id: string
        enabled: boolean
        source: string
        variable: string
        expression: string
        sensitive: boolean
      }>
      assertions: Array<{
        id: string
        enabled: boolean
        type: string
        expression: string
        expected: string
        operator?: string
      }>
      tls: {
        certificateProfileId: string
        caProfileId: string
        minimumVersion: string
        verifyHostname: boolean
      }
      proxy: {
        mode: string
        profileId: string
        url: string
        noProxy: string
        usernameSecretRef: string
        passwordSecretRef: string
      }
      settings: {
        followRedirects: boolean
        maxRedirects: number
        compression: boolean
        timeoutMs: number
        retries: number
        retryBackoff: string
        captureBody: boolean
        maxBodyBytes: number
      }
    }
  }>
}

export const createKeyValueRow = (id: string): KeyValueRow => ({
  id,
  enabled: true,
  key: "",
  value: "",
  description: "",
})

export const initialRequestDefinition: RequestDefinition = {
  schemaVersion: 2,
  scripts: {
    preRequest: {
      enabled: false,
      language: "javascript",
      code: "",
      runtimeVersion: "rhythm-js-2",
    },
  },
  steps: [
    {
      id: "step-request-1",
      name: "Request 1",
      type: "HTTP_REQUEST",
      enabled: true,
      timeoutMs: 15000,
      actions: [],
      metric: {
        provider: "DYNATRACE",
        profileId: "",
        metricSelector: "builtin:host.cpu.usage",
        entitySelector: "",
        aggregation: "AVG",
        window: "10m",
        resolution: "1m",
        baselineWindow: "",
        operator: "LESS_THAN",
        threshold: 80,
        missingDataPolicy: "FAIL",
      },
      request: {
        method: "GET",
        url: "",
        params: [createKeyValueRow("param-1")],
        headers: [
          {
            ...createKeyValueRow("header-1"),
            key: "Accept",
            value: "application/json",
          },
        ],
        cookies: [],
        persistCookies: true,
        auth: { type: "none", fields: {} },
        body: { type: "none", content: "" },
        preRequest: [],
        preRequestScript: {
          enabled: false,
          language: "javascript",
          code: "",
          runtimeVersion: "rhythm-js-2",
        },
        testScript: {
          enabled: false,
          language: "javascript",
          code: "",
          runtimeVersion: "rhythm-js-2",
        },
        extractors: [],
        assertions: [
          {
            id: "assertion-1",
            enabled: true,
            type: "status",
            expression: "status",
            expected: "200",
          },
        ],
        tls: {
          certificateProfileId: "",
          caProfileId: "",
          minimumVersion: "TLS 1.2",
          verifyHostname: true,
        },
        proxy: {
          mode: "environment",
          profileId: "",
          url: "",
          noProxy: "",
          usernameSecretRef: "",
          passwordSecretRef: "",
        },
        settings: {
          followRedirects: true,
          maxRedirects: 5,
          compression: true,
          timeoutMs: 15000,
          retries: 0,
          retryBackoff: "exponential",
          captureBody: true,
          maxBodyBytes: 1048576,
        },
      },
    },
  ],
}

/** Align enabled with script content before persisting or executing a preview. */
export function normalizeDefinitionScripts(
  value: RequestDefinition
): RequestDefinition {
  const emptyScript: ScriptDefinition = {
    enabled: false,
    language: "javascript",
    code: "",
    runtimeVersion: "rhythm-js-2",
  }
  return {
    ...value,
    scripts: {
      ...value.scripts,
      preRequest: normalizeScriptDefinition(
        value.scripts?.preRequest ?? emptyScript
      ),
    },
    steps: value.steps.map((step) => ({
      ...step,
      request: {
        ...step.request,
        preRequestScript: normalizeScriptDefinition(
          step.request?.preRequestScript ?? emptyScript
        ),
        testScript: normalizeScriptDefinition(
          step.request?.testScript ?? emptyScript
        ),
      },
    })),
  }
}

export type RequestWorkbenchSection =
  | "params"
  | "auth"
  | "headers"
  | "body"
  | "cookies"
  | "pre-request"
  | "extractors"
  | "assertions"
  | "tls"
  | "proxy"
  | "settings"

export type RequestWorkbenchFocusTarget = {
  requestKey: number
  stepId: string
  section: RequestWorkbenchSection
  field: "url" | "body" | "name" | "section"
}
