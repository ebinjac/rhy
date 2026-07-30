import { parse } from "acorn"

import type { RequestDefinition } from "@/features/monitors/request-definition"
import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"

export type VariableScope =
  | "variables"
  | "environment"
  | "collection"
  | "globals"
  | "step"
  | "secret"
  | "dynamic"

export type VariableCatalogEntry = {
  id: string
  name: string
  scope: VariableScope
  template: string
  explicitTemplate: string
  javascript: string
  origin: string
  availability: "now" | "later"
  availableAfter?: string
  sensitive: boolean
  previewState: "known" | "masked" | "runtime" | "after-execution"
  previewValue?: string
  observed?: boolean
  shadowed?: boolean
}

type ScriptVariable = {
  name: string
  scope: Extract<
    VariableScope,
    "variables" | "environment" | "collection" | "globals"
  >
  operation: "set" | "unset" | "clear"
}

const dynamicVariables = [
  ["$guid", "Random GUID"],
  ["$uuid", "Random UUID"],
  ["$timestamp", "Unix timestamp"],
  ["$isoTimestamp", "ISO-8601 timestamp"],
  ["$randomInt", "Random integer from 0 to 1000"],
] as const

const scopeAccessor = {
  variables: "pm.variables",
  environment: "pm.environment",
  collection: "pm.collectionVariables",
  globals: "pm.globals",
} as const

function walk(node: unknown, visit: (value: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
    return
  }
  const value = node as Record<string, unknown>
  visit(value)
  for (const child of Object.values(value)) walk(child, visit)
}

export function discoverScriptVariables(code: string): ScriptVariable[] {
  if (!code.trim()) return []
  try {
    const ast = parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowAwaitOutsideFunction: true,
    })
    const found: ScriptVariable[] = []
    walk(ast, (node) => {
      if (node.type !== "CallExpression") return
      const callee = node.callee as Record<string, unknown> | undefined
      if (callee?.type !== "MemberExpression") return
      const object = callee.object as Record<string, unknown> | undefined
      const property = callee.property as Record<string, unknown> | undefined
      if (
        object?.type !== "MemberExpression" ||
        property?.type !== "Identifier"
      )
        return
      const pm = object.object as Record<string, unknown> | undefined
      const store = object.property as Record<string, unknown> | undefined
      if (
        pm?.type !== "Identifier" ||
        pm.name !== "pm" ||
        store?.type !== "Identifier"
      )
        return
      const scope =
        store.name === "collectionVariables"
          ? "collection"
          : store.name === "variables" ||
              store.name === "environment" ||
              store.name === "globals"
            ? store.name
            : null
      if (!scope) return
      const operation =
        property.name === "set"
          ? "set"
          : property.name === "unset"
            ? "unset"
            : property.name === "clear"
              ? "clear"
              : null
      if (!operation) return
      const first = (
        node.arguments as Array<Record<string, unknown>> | undefined
      )?.[0]
      if (operation === "clear") {
        found.push({ name: "*", scope, operation })
      } else if (first?.type === "Literal" && typeof first.value === "string") {
        found.push({ name: first.value, scope, operation })
      }
    })
    return found
  } catch {
    return []
  }
}

function scopedEntry(
  scope: Extract<
    VariableScope,
    "variables" | "environment" | "collection" | "globals"
  >,
  name: string,
  origin: string,
  availability: "now" | "later",
  extra: Partial<VariableCatalogEntry> = {}
): VariableCatalogEntry {
  return {
    id: `${scope}:${name}:${origin}`,
    name,
    scope,
    template: `{{${name}}}`,
    explicitTemplate: `{{${scope}.${name}}}`,
    javascript: `${scopeAccessor[scope]}.get(${JSON.stringify(name)})`,
    origin,
    availability,
    sensitive: false,
    previewState: availability === "now" ? "runtime" : "after-execution",
    ...extra,
  }
}

export function buildVariableCatalog({
  definition,
  selectedStepIndex,
  environments = [],
  secrets = [],
  environmentId,
  observed = [],
}: {
  definition: RequestDefinition
  selectedStepIndex: number
  environments?: ConfigurationProfileContract[]
  secrets?: ConfigurationProfileContract[]
  environmentId?: string
  observed?: Array<{ name: string; scope: VariableScope; masked?: boolean }>
}): VariableCatalogEntry[] {
  const entries: VariableCatalogEntry[] = []
  const environment = environments.find(
    (profile) => profile.id === environmentId
  )
  if (environment) {
    const variables =
      environment.config.variables &&
      typeof environment.config.variables === "object"
        ? (environment.config.variables as Record<string, unknown>)
        : {}
    const builtIns: Record<string, unknown> = {
      baseUrl: environment.config.baseUrl,
      region: environment.config.region,
      ...variables,
    }
    for (const [name, rawValue] of Object.entries(builtIns)) {
      if (rawValue == null || rawValue === "") continue
      const secret = String(rawValue).startsWith("secret://")
      entries.push(
        scopedEntry("environment", name, environment.name, "now", {
          sensitive: secret,
          previewState: secret ? "masked" : "known",
          previewValue: secret ? undefined : String(rawValue),
        })
      )
    }
  }
  for (const secret of secrets) {
    entries.push({
      id: `secret:${secret.id}`,
      name: secret.name,
      scope: "secret",
      template: `{{secrets.${secret.name}}}`,
      explicitTemplate: `{{secrets.${secret.name}}}`,
      javascript: `await pm.vault.get(${JSON.stringify(secret.name)})`,
      origin: "Secrets",
      availability: "now",
      sensitive: true,
      previewState: "masked",
    })
  }

  const monitorVariables = discoverScriptVariables(
    definition.scripts.preRequest.code
  )
  for (const variable of monitorVariables) {
    if (variable.operation !== "set") continue
    entries.push(
      scopedEntry(
        variable.scope,
        variable.name,
        "Monitor pre-request script",
        "now"
      )
    )
  }

  definition.steps.forEach((step, stepIndex) => {
    const earlier = stepIndex < selectedStepIndex
    const current = stepIndex === selectedStepIndex
    const afterStepAvailability = earlier ? "now" : "later"
    const controlledActions = [
      ...(step.actions ?? []),
      ...(step.request?.preRequest ?? []),
    ]
    for (const action of controlledActions) {
      if (!action.enabled || !action.output.trim()) continue
      const available =
        earlier || (current && step.request.preRequest.includes(action))
      entries.push(
        scopedEntry(
          "variables",
          action.output,
          `${step.name} · controlled action`,
          available ? "now" : "later",
          { availableAfter: available ? undefined : step.name }
        )
      )
    }
    for (const variable of discoverScriptVariables(
      step.request?.preRequestScript?.code ?? ""
    )) {
      if (variable.operation !== "set") continue
      entries.push(
        scopedEntry(
          variable.scope,
          variable.name,
          `${step.name} · pre-request script`,
          earlier || current ? "now" : "later",
          { availableAfter: earlier || current ? undefined : step.name }
        )
      )
    }
    const postResponse = [
      ...(step.request?.extractors ?? []).map((extractor) => ({
        name: extractor.variable,
        sensitive: extractor.sensitive,
        origin: "extractor",
      })),
      ...discoverScriptVariables(step.request?.testScript?.code ?? "")
        .filter((variable) => variable.operation === "set")
        .map((variable) => ({
          name: variable.name,
          sensitive: false,
          origin: "Tests script",
          scope: variable.scope,
        })),
    ]
    for (const output of postResponse) {
      if (!output.name?.trim()) continue
      const scope: ScriptVariable["scope"] =
        "scope" in output
          ? (output.scope as ScriptVariable["scope"])
          : "variables"
      entries.push(
        scopedEntry(
          scope,
          output.name,
          `${step.name} · ${output.origin}`,
          afterStepAvailability,
          {
            availableAfter: earlier ? undefined : step.name,
            sensitive: output.sensitive,
            previewState: output.sensitive
              ? "masked"
              : earlier
                ? "runtime"
                : "after-execution",
          }
        )
      )
      entries.push({
        id: `step:${step.id}:${output.name}`,
        name: output.name,
        scope: "step",
        template: `{{steps.${step.id}.outputs.${output.name}}}`,
        explicitTemplate: `{{steps.${step.id}.outputs.${output.name}}}`,
        javascript: `pm.variables.get(${JSON.stringify(output.name)})`,
        origin: `${step.name} · ${output.origin}`,
        availability: afterStepAvailability,
        availableAfter: earlier ? undefined : step.name,
        sensitive: output.sensitive,
        previewState: output.sensitive
          ? "masked"
          : earlier
            ? "runtime"
            : "after-execution",
      })
    }
  })

  for (const [name, origin] of dynamicVariables) {
    entries.push({
      id: `dynamic:${name}`,
      name,
      scope: "dynamic",
      template: `{{${name}}}`,
      explicitTemplate: `{{${name}}}`,
      javascript: `pm.variables.replaceIn("{{${name}}}")`,
      origin,
      availability: "now",
      sensitive: false,
      previewState: "runtime",
    })
  }
  for (const item of observed) {
    entries.push(
      scopedEntry(
        item.scope as "variables",
        item.name,
        "Observed in preview",
        "now",
        {
          observed: true,
          sensitive: Boolean(item.masked),
          previewState: item.masked ? "masked" : "runtime",
        }
      )
    )
  }

  const winners = new Map<string, VariableCatalogEntry>()
  const precedence: VariableScope[] = [
    "variables",
    "environment",
    "collection",
    "globals",
  ]
  for (const entry of entries) {
    if (!precedence.includes(entry.scope) || entry.availability !== "now")
      continue
    const winner = winners.get(entry.name)
    if (
      !winner ||
      precedence.indexOf(entry.scope) < precedence.indexOf(winner.scope)
    )
      winners.set(entry.name, entry)
  }
  return entries
    .map((entry) => ({
      ...entry,
      shadowed:
        precedence.includes(entry.scope) &&
        Boolean(winners.get(entry.name)) &&
        winners.get(entry.name)?.id !== entry.id,
    }))
    .filter(
      (entry, index, list) =>
        list.findIndex(
          (candidate) =>
            candidate.scope === entry.scope &&
            candidate.name === entry.name &&
            candidate.origin === entry.origin
        ) === index
    )
    .sort((left, right) => {
      if (left.availability !== right.availability)
        return left.availability === "now" ? -1 : 1
      return left.name.localeCompare(right.name)
    })
}
