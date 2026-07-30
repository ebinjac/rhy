/** Pick the sole/default Dynatrace environment binding without user-facing env UI. */
export function defaultEnvironmentBindingId(
  bindings: Array<{ id: string }> | undefined | null
): string {
  return bindings?.[0]?.id ?? ""
}
