import type { ComponentProps } from "react"

import { cn } from "@workspace/ui/lib/utils"

const BRAND_LOGO_SRC = "/brand-logo.png"

type RhythmMarkProps = Omit<ComponentProps<"img">, "src" | "alt"> & {
  title?: string
  /** When true, mark is decorative (e.g. inside a labeled link). */
  decorative?: boolean
  /** Framed plaque for Amex-blue chrome. Never invert the mark. */
  onBrand?: boolean
}

/**
 * Rhythm mark — brand logo image (square crop of the Amex box).
 * Sized ~28–32px in the collapsed icon rail for a crisp mark.
 */
export function RhythmMark({
  className,
  title = "Rhythm",
  decorative = false,
  onBrand = false,
  ...props
}: RhythmMarkProps) {
  const img = (
    <img
      src={BRAND_LOGO_SRC}
      alt={decorative ? "" : title}
      aria-hidden={decorative || undefined}
      width={32}
      height={32}
      decoding="async"
      className={cn(
        "object-cover object-[78%_14%]",
        onBrand
          ? "size-full rounded-[5px]"
          : "size-8 shrink-0 rounded-lg",
        !onBrand && className
      )}
      {...props}
    />
  )

  if (!onBrand) {
    return img
  }

  return (
    <span
      className={cn(
        "size-8 shrink-0 rounded-md shadow-[0_2px_8px_oklch(0.18_0.08_253.7/0.55)]",
        className
      )}
    >
      <span className="grid size-full place-items-center overflow-hidden rounded-md bg-[var(--rhythm-mark-tile)] shadow-[inset_0_1px_0_oklch(1_0_0/0.32)] ring-1 ring-inset ring-[color-mix(in_srgb,white_38%,transparent)]">
        {img}
      </span>
    </span>
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
  /** Mark + type for Amex-blue surfaces. */
  onBrand?: boolean
}

export function RhythmLogo({
  className,
  markClassName,
  wordmarkClassName,
  showWordmark = true,
  showSubtitle = true,
  subtitle = "Synthetic monitoring",
  decorative = false,
  onBrand = false,
}: RhythmLogoProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        onBrand ? "gap-3.5" : "gap-3",
        !showWordmark && "justify-center",
        className
      )}
    >
      <RhythmMark
        className={markClassName}
        decorative={decorative}
        onBrand={onBrand}
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
            <p className="mt-1 truncate text-[11px] leading-none tracking-[0.01em] text-sidebar-foreground/75">
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
