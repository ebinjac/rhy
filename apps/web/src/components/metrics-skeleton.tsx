import { Skeleton } from "@workspace/ui/components/skeleton"

export function MetricsSkeleton({
  chartsOnly = false,
  statCount = 4,
}: {
  chartsOnly?: boolean
  statCount?: number
}) {
  return (
    <div aria-hidden="true" className="mt-6 space-y-6">
      {!chartsOnly ? (
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: statCount }).map((_, index) => (
            <div className="bg-background p-4" key={index}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-8 w-28" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="rounded-xl border p-5">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        <Skeleton className="mt-5 h-[300px] w-full" />
      </div>
      {!chartsOnly ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.75fr)]">
          <Skeleton className="h-[360px] w-full rounded-xl" />
          <Skeleton className="h-[360px] w-full rounded-xl" />
        </div>
      ) : null}
    </div>
  )
}
