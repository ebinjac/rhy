import { LoaderCircle } from "lucide-react"

export function EditorLoading({
  label = "Loading editor…",
}: {
  label?: string
}) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="flex min-h-48 items-center justify-center gap-2 rounded-lg border bg-muted/20 text-sm text-muted-foreground"
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
