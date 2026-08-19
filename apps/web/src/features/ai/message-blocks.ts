export type ChartType = "line" | "area" | "bar" | "pie"

export type ChartSeries = {
  key: string
  label: string
}

export type ChartSpec = {
  type: ChartType
  title: string
  description?: string
  unit?: string
  xKey: string
  series: ChartSeries[]
  data: Record<string, string | number>[]
}

export type StatItem = {
  label: string
  value: string
  hint?: string
  tone?: "default" | "success" | "warning" | "destructive"
}

export type StatsSpec = { items: StatItem[] }

export type CalloutSpec = {
  tone: "info" | "warning" | "missing"
  title: string
  body: string
}

export type MessageSegment =
  | { type: "markdown"; content: string }
  | { type: "chart"; spec: ChartSpec }
  | { type: "stats"; spec: StatsSpec }
  | { type: "callout"; spec: CalloutSpec }

const FENCE =
  /```(chart|stats|callout|kpi)[^\n]*\n([\s\S]*?)```/gi
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/
const CHART_TYPES = new Set<ChartType>(["line", "area", "bar", "pie"])
const STAT_TONES = new Set(["default", "success", "warning", "destructive"])
const CALLOUT_TONES = new Set(["info", "warning", "missing"])

export function parseAssistantContent(content: string): MessageSegment[] {
  const source = content.trim()
  if (!source) return []
  const segments: MessageSegment[] = []
  let cursor = 0
  FENCE.lastIndex = 0
  for (const match of source.matchAll(FENCE)) {
    const index = match.index ?? 0
    if (index > cursor) {
      pushMarkdown(segments, source.slice(cursor, index))
    }
    const kind = match[1].toLowerCase()
    const parsed = parseFence(kind, match[2])
    if (parsed) segments.push(parsed)
    else pushMarkdown(segments, match[0])
    cursor = index + match[0].length
  }
  if (cursor < source.length) pushMarkdown(segments, source.slice(cursor))
  return segments.length ? segments : [{ type: "markdown", content: source }]
}

function pushMarkdown(segments: MessageSegment[], value: string) {
  const content = value.trim()
  if (!content) return
  segments.push({ type: "markdown", content })
}

function parseFence(kind: string, raw: string): MessageSegment | null {
  const value = parseJsonObject(raw)
  if (!value) return null
  if (kind === "chart") {
    const spec = sanitizeChart(value)
    return spec ? { type: "chart", spec } : null
  }
  if (kind === "stats" || kind === "kpi") {
    const spec = sanitizeStats(value)
    return spec ? { type: "stats", spec } : null
  }
  const spec = sanitizeCallout(value)
  return spec ? { type: "callout", spec } : null
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

function sanitizeChart(value: Record<string, unknown>): ChartSpec | null {
  const type = String(value.type ?? "").toLowerCase() as ChartType
  if (!CHART_TYPES.has(type)) return null
  const title = clip(String(value.title ?? "Chart"), 160)
  const description = optionalClip(value.description, 280)
  const unit = optionalClip(value.unit, 24)
  const rows = Array.isArray(value.data) ? value.data.slice(0, 180) : []
  if (rows.length < 2) return null

  let series = Array.isArray(value.series)
    ? value.series
        .slice(0, 8)
        .map(readSeries)
        .filter((item): item is ChartSeries => item !== null)
    : []
  let xKey = typeof value.xKey === "string" && KEY.test(value.xKey) ? value.xKey : ""

  if (type === "pie" && series.length === 0) {
    xKey = xKey || "name"
    series = [{ key: "value", label: "Value" }]
  }
  if (!xKey) xKey = inferXKey(rows[0])
  if (!xKey) return null
  if (series.length === 0) {
    series = inferSeries(rows[0], xKey)
  }
  if (series.length === 0) return null

  const data: Record<string, string | number>[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue
    const record = row as Record<string, unknown>
    const label = readAxis(record[xKey])
    if (label === null) continue
    const next: Record<string, string | number> = { [xKey]: label }
    let hasValue = false
    for (const item of series) {
      const numeric = readNumber(record[item.key])
      if (numeric === null) continue
      next[item.key] = numeric
      hasValue = true
    }
    if (hasValue) data.push(next)
  }
  if (data.length < 2) return null
  return {
    type,
    title,
    ...(description ? { description } : {}),
    ...(unit ? { unit } : {}),
    xKey,
    series,
    data,
  }
}

function sanitizeStats(value: Record<string, unknown>): StatsSpec | null {
  const source = Array.isArray(value.items) ? value.items : []
  const items: StatItem[] = []
  for (const entry of source.slice(0, 6)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const label = clip(String(record.label ?? ""), 48)
    const rawValue = clip(String(record.value ?? ""), 32)
    if (!label || !rawValue) continue
    const tone = String(record.tone ?? "default")
    items.push({
      label,
      value: rawValue,
      ...(optionalClip(record.hint, 80)
        ? { hint: optionalClip(record.hint, 80) }
        : {}),
      ...(STAT_TONES.has(tone) && tone !== "default"
        ? { tone: tone as StatItem["tone"] }
        : {}),
    })
  }
  return items.length ? { items } : null
}

function sanitizeCallout(value: Record<string, unknown>): CalloutSpec | null {
  const tone = String(value.tone ?? "info")
  const title = clip(String(value.title ?? ""), 80)
  const body = clip(String(value.body ?? value.content ?? ""), 500)
  if (!title || !body || !CALLOUT_TONES.has(tone)) return null
  return { tone: tone as CalloutSpec["tone"], title, body }
}

function readSeries(value: unknown): ChartSeries | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const key = String(record.key ?? "")
  if (!KEY.test(key)) return null
  return { key, label: clip(String(record.label ?? key), 48) }
}

function inferXKey(row: unknown): string {
  if (!row || typeof row !== "object" || Array.isArray(row)) return ""
  for (const candidate of ["at", "label", "name", "x"]) {
    if (candidate in row) return candidate
  }
  const first = Object.keys(row as object)[0]
  return first && KEY.test(first) ? first : ""
}

function inferSeries(row: unknown, xKey: string): ChartSeries[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) return []
  return Object.entries(row as Record<string, unknown>)
    .filter(([key, value]) => key !== xKey && KEY.test(key) && readNumber(value) !== null)
    .slice(0, 8)
    .map(([key]) => ({ key, label: key }))
}

function readAxis(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const clipped = clip(value, 80)
    return clipped || null
  }
  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function clip(value: string, max: number) {
  const trimmed = value.trim().replace(/\s+/g, " ")
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

function optionalClip(value: unknown, max: number) {
  if (typeof value !== "string") return undefined
  const clipped = clip(value, max)
  return clipped || undefined
}
