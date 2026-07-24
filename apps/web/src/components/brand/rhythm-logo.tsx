import { useId, type ComponentProps } from "react"

import { cn } from "@workspace/ui/lib/utils"

type RhythmMarkProps = ComponentProps<"svg"> & {
  title?: string
  /** When true, mark is decorative (e.g. inside a labeled link). */
  decorative?: boolean
}

/**
 * Rhythm mark — "Cadence Lock"
 *
 * Deep indigo tile + custom R. The open bowl reads as a signal aperture;
 * the leg resolves into an amber probe node (a synthetic check landing).
 * Stroke geometry stays crisp at ~28–32px in the collapsed icon rail.
 */
export function RhythmMark({
  className,
  title = "Rhythm",
  decorative = false,
  ...props
}: RhythmMarkProps) {
  const titleId = useId()

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-8 shrink-0", className)}
      {...(decorative
        ? { "aria-hidden": true as const }
        : { role: "img" as const, "aria-labelledby": titleId })}
      {...props}
    >
      {decorative ? null : <title id={titleId}>{title}</title>}
      <rect width="32" height="32" rx="8" fill="var(--rhythm-mark-tile)" />
      {/* Stem */}
      <path
        d="M11.25 8.5v15"
        stroke="var(--rhythm-mark-on)"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
      {/* Bowl — open aperture */}
      <path
        d="M11.25 9.35c3.7 0 7 .5 7 4.15s-3.3 4.15-7 4.15"
        stroke="var(--rhythm-mark-on)"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
      {/* Leg — stops short of the probe so the accent stays distinct */}
      <path
        d="M15.1 17.4 19.15 21.7"
        stroke="var(--rhythm-mark-on)"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
      {/* Probe node — synthetic check landing */}
      <circle
        cx="23.2"
        cy="24.35"
        r="2.8"
        fill="var(--rhythm-mark-accent)"
      />
    </svg>
  )
}

type RhythmLogoProps = {
  className?: string
  markClassName?: string
  wordmarkClassName?: string
  showWordmark?: boolean
  showSubtitle?: boolean
  subtitle?: string
  /** Decorative mark when the parent already labels the control. */
  decorative?: boolean
}

export function RhythmLogo({
  className,
  markClassName,
  wordmarkClassName,
  showWordmark = true,
  showSubtitle = true,
  subtitle = "Synthetic monitoring",
  decorative = false,
}: RhythmLogoProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        !showWordmark && "justify-center",
        className
      )}
    >
      <RhythmMark
        className={markClassName}
        decorative={decorative}
        title="Rhythm"
      />
      {showWordmark ? (
        <div
          className={cn("min-w-0", wordmarkClassName)}
          aria-hidden={decorative || undefined}
        >
          <p className="font-heading text-[15px] leading-none font-semibold tracking-[-0.02em] text-sidebar-foreground">
            Rhythm
          </p>
          {showSubtitle ? (
            <p className="mt-1 truncate text-[11px] leading-none tracking-[0.01em] text-sidebar-foreground/55">
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
