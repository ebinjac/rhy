export type ScriptDefinition = {
  enabled: boolean
  language: "javascript"
  code: string
  runtimeVersion: "rhythm-js-1" | "rhythm-js-2"
  packages?: Array<{ name: string; code: string }>
}

/** Keep the persisted enabled flag aligned with Postman-style script content. */
export function normalizeScriptDefinition(
  value: ScriptDefinition
): ScriptDefinition {
  const code = value?.code ?? ""
  return {
    enabled: code.trim().length > 0,
    language: "javascript",
    code,
    runtimeVersion: "rhythm-js-2",
    packages: value?.packages ?? [],
  }
}
