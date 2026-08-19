import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { CircleAlert, Info } from "lucide-react"
import Markdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { AssistantChart, AssistantStats } from "./chart-block"
import { parseAssistantContent } from "./message-blocks"

const markdownComponents: Components = {
  h1: ({ children }) => <h2>{children}</h2>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  table: ({ children }) => (
    <div className="not-typeset my-4 overflow-hidden rounded-xl border">
      <Table>{children}</Table>
    </div>
  ),
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableHead>{children}</TableHead>,
  td: ({ children }) => (
    <TableCell className="whitespace-normal">{children}</TableCell>
  ),
}

export function AssistantContent({ content }: { content: string }) {
  const segments = parseAssistantContent(content)
  return (
    <div className="typeset typeset-chat max-w-[42em]">
      {!segments.length ? <p>No response was recorded.</p> : null}
      {segments.map((segment, index) => {
        if (segment.type === "chart") {
          return (
            <AssistantChart key={`chart-${index}`} spec={segment.spec} />
          )
        }
        if (segment.type === "stats") {
          return (
            <AssistantStats items={segment.spec.items} key={`stats-${index}`} />
          )
        }
        if (segment.type === "callout") {
          return (
            <CalloutBlock key={`callout-${index}`} spec={segment.spec} />
          )
        }
        return (
          <Markdown
            components={markdownComponents}
            key={`md-${index}`}
            remarkPlugins={[remarkGfm]}
            urlTransform={safeUrl}
          >
            {segment.content}
          </Markdown>
        )
      })}
    </div>
  )
}

function CalloutBlock({
  spec,
}: {
  spec: { tone: "info" | "warning" | "missing"; title: string; body: string }
}) {
  const warning = spec.tone !== "info"
  return (
    <Alert className="not-typeset my-4" variant={warning ? "destructive" : "default"}>
      {warning ? <CircleAlert /> : <Info />}
      <AlertTitle>{spec.title}</AlertTitle>
      <AlertDescription>{spec.body}</AlertDescription>
    </Alert>
  )
}

function MarkdownLink({
  href,
  children,
}: {
  href?: string
  children: ReactNode
}) {
  if (!href) return <span>{children}</span>
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link to={href as "/"}>{children}</Link>
    )
  }
  return (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  )
}

function safeUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
    return value
  }
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "mailto:"
    ) {
      return value
    }
  } catch {
    return ""
  }
  return ""
}
