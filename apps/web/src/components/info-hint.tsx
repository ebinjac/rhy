import type { ReactNode } from "react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { cn } from "@workspace/ui/lib/utils"
import { Info } from "lucide-react"

type InfoHintProps = {
  title: string
  children: ReactNode
  /** Accessible name for the trigger. Defaults to `About ${title}`. */
  label?: string
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  className?: string
}

export function InfoHint({
  title,
  children,
  label,
  side = "top",
  align = "start",
  className,
}: InfoHintProps) {
  return (
    <HoverCard>
      <HoverCardTrigger
        aria-label={label ?? `About ${title}`}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted data-popup-open:text-foreground",
          className
        )}
        type="button"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </HoverCardTrigger>
      <HoverCardContent
        align={align}
        className="w-72 rounded-xl p-3"
        side={side}
      >
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1 text-sm leading-5 text-muted-foreground">
          {children}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/** Inline label plus info trigger, for table headers and compact metrics. */
export function HintedLabel({
  children,
  title,
  body,
  className,
}: {
  children: ReactNode
  title: string
  body: string
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {children}
      <InfoHint className="size-5" title={title}>
        {body}
      </InfoHint>
    </span>
  )
}
