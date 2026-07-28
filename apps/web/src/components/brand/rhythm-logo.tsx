import type { ComponentProps } from "react"

import { cn } from "@workspace/ui/lib/utils"

const BRAND_LOGO_SRC = "/brand-logo.png"

type RhythmMarkProps = Omit<ComponentProps<"img">, "src" | "alt"> & {
  title?: string
  /** When true, mark is decorative (e.g. inside a labeled link). */
  decorative?: boolean
}

/**
 * Rhythm mark — brand logo image (square crop).
 * Sized ~28–32px in the collapsed icon rail for a crisp mark.
 */
export function RhythmMark({
  className,
  title = "Rhythm",
  decorative = false,
  ...props
}: RhythmMarkProps) {
  return (
    <img
      src={BRAND_LOGO_SRC}
      alt={decorative ? "" : title}
      aria-hidden={decorative || undefined}
      width={32}
      height={32}
      decoding="async"
      className={cn(
        "size-8 shrink-0 rounded-lg object-cover object-right-top",
        className
      )}
      {...props}
    />
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
            <p className="mt-1 truncate text-[11px] leading-none tracking-[0.01em] text-sidebar-foreground/70">
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
