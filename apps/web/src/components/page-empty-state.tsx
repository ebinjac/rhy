import type { ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export function PageEmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mt-5 rounded-2xl border border-dashed px-5 py-12 text-center",
        className
      )}
    >
      {icon ? (
        <div className="mx-auto mb-3 flex size-10 items-center justify-center text-muted-foreground [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function PageEmptyStateAction({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button className="min-h-11 sm:min-h-9" onClick={onClick}>
      {children}
    </Button>
  )
}
