const TEMPLATE = /\{\{[\s\S]*?\}\}/g
const VALUE_PLACEHOLDER = '"__rhythm_template__"'
const STRING_PLACEHOLDER = "rhythmTemplate"

type RewriteSpan = {
  originalStart: number
  originalEnd: number
  rewrittenStart: number
  rewrittenEnd: number
}

export type TemplatedJsonError = {
  message: string
  offset: number
  line: number
  column: number
}

function isInsideJsonString(source: string, index: number) {
  let inString = false
  let escaped = false
  for (let cursor = 0; cursor < index; cursor += 1) {
    const character = source[cursor]
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
    } else if (character === '"') {
      inString = true
    }
  }
  return inString
}

function rewriteJsonTemplates(source: string): {
  rewritten: string
  spans: RewriteSpan[]
} {
  const spans: RewriteSpan[] = []
  let rewritten = ""
  let last = 0
  for (const match of source.matchAll(TEMPLATE)) {
    const originalStart = match.index ?? 0
    const originalEnd = originalStart + match[0].length
    rewritten += source.slice(last, originalStart)
    const rewrittenStart = rewritten.length
    rewritten += isInsideJsonString(source, originalStart)
      ? STRING_PLACEHOLDER
      : VALUE_PLACEHOLDER
    spans.push({
      originalStart,
      originalEnd,
      rewrittenStart,
      rewrittenEnd: rewritten.length,
    })
    last = originalEnd
  }
  rewritten += source.slice(last)
  return { rewritten, spans }
}

function rewrittenOffsetToOriginal(
  offset: number,
  spans: RewriteSpan[]
): number {
  let shift = 0
  for (const span of spans) {
    if (offset <= span.rewrittenStart) return offset + shift
    if (offset < span.rewrittenEnd) return span.originalStart
    shift +=
      span.originalEnd -
      span.originalStart -
      (span.rewrittenEnd - span.rewrittenStart)
  }
  return offset + shift
}

export function offsetToLineColumn(source: string, offset: number) {
  const clamped = Math.max(0, Math.min(offset, source.length))
  let line = 1
  let column = 1
  for (let index = 0; index < clamped; index += 1) {
    if (source[index] === "\n") {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

function parseOffset(message: string): number | null {
  const match = message.match(/position\s+(\d+)/i)
  if (!match) return null
  return Number(match[1])
}

export function findTemplatedJsonError(
  source: string
): TemplatedJsonError | null {
  if (!source.trim()) return null
  const { rewritten, spans } = rewriteJsonTemplates(source)
  try {
    JSON.parse(rewritten)
    return null
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "This JSON is not valid."
    const rewrittenOffset = parseOffset(message) ?? 0
    const offset = rewrittenOffsetToOriginal(rewrittenOffset, spans)
    const { line, column } = offsetToLineColumn(source, offset)
    return {
      message: message.replace(/^Unexpected end of JSON input$/i, "JSON is incomplete."),
      offset,
      line,
      column,
    }
  }
}
