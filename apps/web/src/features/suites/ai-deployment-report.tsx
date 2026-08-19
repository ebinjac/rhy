import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { FileDown, LoaderCircle, RefreshCw, Sparkles } from "lucide-react"

import { AssistantContent } from "@/features/ai/assistant-content"
import {
  AIRequestError,
  aiProviderReady,
  generateAIDeploymentReport,
  getAIDeploymentReport,
  getAISettings,
  type AIDeploymentReport,
} from "@/lib/api-client/ai"

function downloadBlob(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;"
    if (character === "<") return "&lt;"
    if (character === ">") return "&gt;"
    if (character === '"') return "&quot;"
    return "&#39;"
  })
}

function inlineMarkdown(value: string) {
  const escaped = escapeHtml(value)
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((\/[^)]+|https?:[^)]+)\)/g, '<a href="$2">$1</a>')
}

function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const html: string[] = []
  let inList = false
  let inTable = false
  const closeList = () => {
    if (inList) {
      html.push("</ul>")
      inList = false
    }
  }
  const closeTable = () => {
    if (inTable) {
      html.push("</tbody></table>")
      inTable = false
    }
  }
  for (const line of lines) {
    if (/^\s*\|/.test(line)) {
      closeList()
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
      if (!inTable) {
        html.push("<table><thead><tr>")
        html.push(cells.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join(""))
        html.push("</tr></thead><tbody>")
        inTable = true
      } else {
        html.push(
          `<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`
        )
      }
      continue
    }
    closeTable()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      if (!inList) {
        html.push("<ul>")
        inList = true
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`)
      continue
    }
    closeList()
    if (!line.trim()) continue
    html.push(`<p>${inlineMarkdown(line)}</p>`)
  }
  closeList()
  closeTable()
  return html.join("")
}

function printableHtml(title: string, markdown: string, generatedAt: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; color: #1a2744; background: #fff; }
  header { background: #016FD0; color: #fff; padding: 28px 32px; }
  header p { margin: 8px 0 0; opacity: .86; font-size: 13px; }
  h1 { margin: 0; font-size: 1.6rem; font-weight: 650; }
  article { max-width: 48rem; margin: 0 auto; padding: 32px 28px 64px; }
  h2, h3 { margin: 1.6em 0 0.4em; }
  p, li { margin: 0.6em 0; }
  a { color: #016FD0; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 13px; }
  th, td { border-bottom: 1px solid #d7e3f2; text-align: left; padding: 8px 10px; vertical-align: top; }
  th { color: #5a6b85; font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em; }
  @media print { header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <p>Rhythm deployment validation report · generated ${escapeHtml(generatedAt)}</p>
</header>
<article>${markdownToHtml(markdown)}</article>
</body>
</html>`
}

function safeFilename(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return slug || "deployment-validation"
}

export function AIDeploymentReportPanel({
  runId,
  suiteName,
  complete,
}: {
  runId: string
  suiteName: string
  complete: boolean
}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [report, setReport] = useState<AIDeploymentReport | null>(null)
  const [pending, setPending] = useState<"load" | "generate" | "">("load")
  const [message, setMessage] = useState("")

  useEffect(() => {
    let disposed = false
    setPending("load")
    setMessage("")
    Promise.all([
      getAISettings().catch(() => null),
      getAIDeploymentReport(runId).catch((error) => {
        if (error instanceof AIRequestError && error.status === 428) return null
        throw error
      }),
    ])
      .then(([settings, existing]) => {
        if (disposed) return
        setConfigured(settings ? aiProviderReady(settings) : false)
        setReport(existing)
      })
      .catch(() => {
        if (!disposed) {
          setConfigured(false)
          setMessage("Ask Rhythm status could not be loaded.")
        }
      })
      .finally(() => {
        if (!disposed) setPending("")
      })
    return () => {
      disposed = true
    }
  }, [runId])

  async function generate() {
    setPending("generate")
    setMessage("")
    try {
      const next = await generateAIDeploymentReport(runId)
      setReport(next)
      setConfigured(true)
    } catch (error) {
      if (error instanceof AIRequestError && error.code === "AI_NOT_CONFIGURED") {
        setConfigured(false)
        setMessage("")
      } else {
        setMessage(
          error instanceof Error
            ? error.message
            : "Ask Rhythm could not generate this report."
        )
      }
    } finally {
      setPending("")
    }
  }

  const filename = safeFilename(suiteName)
  const generatedLabel = report
    ? new Date(report.generatedAt).toLocaleString()
    : ""

  return (
    <section aria-labelledby="ai-report-heading">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2
            className="font-heading text-lg font-semibold"
            id="ai-report-heading"
          >
            AI validation report
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Grounded in this run’s statuses, timings, and failure messages.
            Rhythm does not send secrets or request bodies to the model.
          </p>
        </div>
        {configured && complete ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending === "generate"}
              onClick={() => void generate()}
            >
              {pending === "generate" ? (
                <LoaderCircle className="animate-spin" />
              ) : report ? (
                <RefreshCw />
              ) : (
                <Sparkles />
              )}
              {report ? "Regenerate" : "Generate report"}
            </Button>
            <Button
              disabled={!report}
              onClick={() =>
                report &&
                downloadBlob(
                  `${filename}.md`,
                  report.markdown,
                  "text/markdown;charset=utf-8"
                )
              }
              variant="outline"
            >
              <FileDown /> Markdown
            </Button>
            <Button
              disabled={!report}
              onClick={() =>
                report &&
                downloadBlob(
                  `${filename}.html`,
                  printableHtml(suiteName, report.markdown, generatedLabel),
                  "text/html;charset=utf-8"
                )
              }
              variant="outline"
            >
              <FileDown /> HTML
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}

      {pending === "load" ? (
        <div className="mt-4 space-y-3 border-y py-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : configured === false ? (
        <Empty className="mt-4 rounded-none border-x-0 border-dashed py-10">
          <EmptyHeader>
            <EmptyTitle>Configure Ask Rhythm to generate this report</EmptyTitle>
            <EmptyDescription>
              Add an OpenRouter or Compass360 provider, then generate a
              grounded summary of what failed, what passed, and the next
              checks.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              nativeButton={false}
              render={<Link search={{ kind: "ai" }} to="/configuration" />}
            >
              Configuration → Ask Rhythm
            </Button>
          </EmptyContent>
        </Empty>
      ) : !complete ? (
        <p className="mt-4 border-y py-5 text-sm text-muted-foreground">
          Generate the AI report after this validation completes or fails.
        </p>
      ) : pending === "generate" ? (
        <div className="mt-4 space-y-3 border-y py-5" aria-live="polite">
          <p className="inline-flex items-center gap-2 text-sm font-medium">
            <LoaderCircle className="size-4 animate-spin" />
            Writing the validation report from this run’s evidence…
          </p>
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : report ? (
        <div className="mt-4 border-y py-5">
          <p className="text-xs text-muted-foreground">
            {report.modelName ? `${report.modelName} · ` : ""}
            generated {generatedLabel}
          </p>
          <div className="mt-4">
            <AssistantContent content={report.markdown} />
          </div>
        </div>
      ) : (
        <Empty className="mt-4 rounded-none border-x-0 border-dashed py-10">
          <EmptyHeader>
            <EmptyTitle>No AI report yet</EmptyTitle>
            <EmptyDescription>
              Generate a Markdown ops report from the actual monitor, step,
              ELF, alert, and Dynatrace outcomes on this run.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => void generate()}>
              <Sparkles /> Generate report
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </section>
  )
}
