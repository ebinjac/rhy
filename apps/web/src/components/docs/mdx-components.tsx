import type { ReactNode } from "react"
import defaultMdxComponents from "fumadocs-ui/mdx"
import { CheckCircle2, CircleAlert, LockKeyhole, TimerReset } from "lucide-react"
import type { MDXComponents } from "mdx/types"

import { SafeApiPlayground } from "./safe-api-playground"
import { cn } from "@workspace/ui/lib/utils"

function DocumentationPanel({
  children,
  className,
  icon,
  title,
}: {
  children: ReactNode
  className?: string
  icon: ReactNode
  title: string
}) {
  return (
    <section
      className={cn(
        "my-6 rounded-xl border bg-card px-5 py-4 text-card-foreground",
        className
      )}
    >
      <div className="mb-2 flex items-center gap-2 font-semibold">
        {icon}
        <span>{title}</span>
      </div>
      <div className="text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  )
}

export function ExpectedResult({ children }: { children: ReactNode }) {
  return (
    <DocumentationPanel
      className="border-success/30 bg-success-soft/55"
      icon={<CheckCircle2 aria-hidden="true" className="size-4 text-success" />}
      title="Expected result"
    >
      {children}
    </DocumentationPanel>
  )
}

export function SecurityNote({ children }: { children: ReactNode }) {
  return (
    <DocumentationPanel
      icon={<LockKeyhole aria-hidden="true" className="size-4 text-primary" />}
      title="Security note"
    >
      {children}
    </DocumentationPanel>
  )
}

export function FailureExample({ children }: { children: ReactNode }) {
  return (
    <DocumentationPanel
      className="border-warning/35 bg-warning-soft/55"
      icon={
        <CircleAlert
          aria-hidden="true"
          className="size-4 text-warning-foreground"
        />
      }
      title="If this fails"
    >
      {children}
    </DocumentationPanel>
  )
}

export function DiagnosticPhase({
  children,
  name,
}: {
  children: ReactNode
  name: string
}) {
  return (
    <DocumentationPanel
      icon={<TimerReset aria-hidden="true" className="size-4 text-primary" />}
      title={name}
    >
      {children}
    </DocumentationPanel>
  )
}

export function Procedure({ children }: { children: ReactNode }) {
  return <div className="rhythm-procedure my-6">{children}</div>
}

export function CaptureState({
  children,
  state,
}: {
  children: ReactNode
  state: string
}) {
  return (
    <div className="my-3 flex gap-3 rounded-lg bg-muted/55 px-4 py-3">
      <code className="h-fit rounded bg-background px-1.5 py-0.5 text-xs font-semibold">
        {state}
      </code>
      <div className="text-sm leading-6 text-muted-foreground">{children}</div>
    </div>
  )
}

export function ApiTimingBreakdown({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="my-6 overflow-x-auto rounded-xl border">
      <div className="min-w-[36rem] p-5">{children}</div>
    </div>
  )
}

export function ConfigurationMatrix({
  children,
}: {
  children: ReactNode
}) {
  return <div className="my-6 overflow-x-auto">{children}</div>
}

export function getMdxComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Procedure,
    ExpectedResult,
    SecurityNote,
    FailureExample,
    DiagnosticPhase,
    CaptureState,
    ApiTimingBreakdown,
    ConfigurationMatrix,
    SafeApiPlayground,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMdxComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMdxComponents>
}
