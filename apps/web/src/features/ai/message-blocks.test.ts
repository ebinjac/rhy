import assert from "node:assert/strict"
import test from "node:test"

import { parseAssistantContent } from "./message-blocks.ts"

test("keeps ordinary markdown when no structured fences exist", () => {
  const segments = parseAssistantContent("## Attention\n\nCheckout API is failing.")
  assert.equal(segments.length, 1)
  assert.equal(segments[0]?.type, "markdown")
})

test("extracts an interactive chart fence from an operational answer", () => {
  const segments = parseAssistantContent(`p95 rose after 14:00.

\`\`\`chart
{"type":"line","title":"API response time","unit":"ms","xKey":"at","series":[{"key":"apiResponseTimeMs","label":"API response"}],"data":[{"at":"14:00","apiResponseTimeMs":210},{"at":"14:05","apiResponseTimeMs":340}]}
\`\`\`

Open the monitor for the failed run.`)
  assert.equal(segments.length, 3)
  assert.equal(segments[0]?.type, "markdown")
  assert.equal(segments[1]?.type, "chart")
  if (segments[1]?.type !== "chart") throw new Error("expected chart")
  assert.equal(segments[1].spec.type, "line")
  assert.equal(segments[1].spec.data.length, 2)
  assert.equal(segments[2]?.type, "markdown")
})

test("rejects charts with a single point and leaves the fence as markdown", () => {
  const segments = parseAssistantContent(`\`\`\`chart
{"type":"bar","title":"Runs","data":[{"name":"failed","value":3}]}
\`\`\``)
  assert.equal(segments.length, 1)
  assert.equal(segments[0]?.type, "markdown")
})

test("parses stats and missing-evidence callouts", () => {
  const segments = parseAssistantContent(`\`\`\`stats
{"items":[{"label":"Success rate","value":"98.2%","hint":"24h window"}]}
\`\`\`

\`\`\`callout
{"tone":"warning","title":"Not recorded","body":"No run metrics exist for this window."}
\`\`\``)
  assert.equal(segments.length, 2)
  assert.equal(segments[0]?.type, "stats")
  assert.equal(segments[1]?.type, "callout")
})
