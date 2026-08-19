export const DEFAULT_ELF_TIME_FIELD = "@timestamp"

const AT_TIMESTAMP_TOKEN = /(?:^|[^A-Za-z0-9_])@timestamp(?:[^A-Za-z0-9_]|$)/
const TIMESTAMP_FIELD_TOKEN =
  /["']timestamp["']|(?:^|[^A-Za-z0-9_@])timestamp\s*:|\.timestamp(?:[^A-Za-z0-9_]|$)|(?:^|[^A-Za-z0-9_@])timestamp\s*(?:>=|<=|>|<|==|=)/

export function inspectTimeField(
  queryText: string
): "@timestamp" | "timestamp" | "" {
  AT_TIMESTAMP_TOKEN.lastIndex = 0
  TIMESTAMP_FIELD_TOKEN.lastIndex = 0
  if (AT_TIMESTAMP_TOKEN.test(queryText)) {
    return "@timestamp"
  }
  if (TIMESTAMP_FIELD_TOKEN.test(queryText)) {
    return "timestamp"
  }
  return ""
}

export function detectTimeField(
  queryText: string,
  fallback = DEFAULT_ELF_TIME_FIELD
): string {
  return (
    inspectTimeField(queryText) || fallback.trim() || DEFAULT_ELF_TIME_FIELD
  )
}
