export const ENVIRONMENT_OPTIONS = [
  "production",
  "staging",
  "development",
  "qa",
] as const

export function environmentChoices(
  ...extra: Array<string | undefined | null>
): string[] {
  return Array.from(
    new Set([
      ...ENVIRONMENT_OPTIONS,
      ...extra.map((value) => value?.trim() ?? "").filter(Boolean),
    ])
  )
}
