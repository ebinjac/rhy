import type { ComponentPropsWithoutRef, ElementType } from "react"

import { cn } from "@workspace/ui/lib/utils"

/** Shared content width for authenticated app pages (`max-w-7xl` = 1280px). */
export const APP_PAGE_MAX_WIDTH_CLASS = "max-w-7xl"

/** Horizontal centering + padding rhythm for main app content. */
export const appPageContainerClassName = cn(
  "mx-auto w-full",
  APP_PAGE_MAX_WIDTH_CLASS,
  "px-4 md:px-6"
)

const paddingClasses = {
  /** Standard page body vertical rhythm. */
  default: "py-6 md:py-8",
  /** Slightly denser body (e.g. builder / run detail). */
  compact: "py-5 md:py-6",
  /** Sticky toolbars / action headers. */
  header: "py-3",
  /** Tab / section headers with top inset only. */
  tabs: "pt-4",
  /** Width + horizontal padding only; compose vertical spacing via className. */
  none: "",
} as const

export type PageContainerPadding = keyof typeof paddingClasses

type PageContainerProps<T extends ElementType = "div"> = {
  as?: T
  padding?: PageContainerPadding
  className?: string
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className">

/**
 * Shared width + horizontal padding for authenticated app pages and nested tabs.
 * Marketing (`/rhythm`) and docs keep their own layouts.
 */
export function PageContainer<T extends ElementType = "div">({
  as,
  padding = "default",
  className,
  ...props
}: PageContainerProps<T>) {
  const Comp = as ?? "div"
  return (
    <Comp
      className={cn(
        appPageContainerClassName,
        paddingClasses[padding],
        className
      )}
      {...props}
    />
  )
}
