import { LoaderCircle } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

export function EditorLoading({
  label = "Loading editor…",
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={cn(
        "flex min-h-48 items-center justify-center gap-2 rounded-lg border bg-muted/20 text-sm text-muted-foreground",
        className
      )}
      role="status"
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      {label}
    </div>
  )
}
