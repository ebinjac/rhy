import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ArrowLeft, CircleAlert, RefreshCw } from "lucide-react"

import { PageContainer } from "@/components/page-container"

export function RoutePendingState() {
  return (
    <PageContainer
      as="main"
      aria-busy="true"
      aria-label="Loading page"
    >
      <Skeleton className="h-7 w-52" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-6 h-64" />
    </PageContainer>
  )
}

export function RouteErrorState({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 md:px-6">
      <CircleAlert aria-hidden="true" className="size-7 text-destructive" />
      <h1 className="mt-4 text-2xl font-semibold">This page could not load</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {safeErrorMessage(error)}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={reset}>
          <RefreshCw data-icon="inline-start" />
          Retry
        </Button>
        <Button
          nativeButton={false}
          render={<Link aria-label="Back to overview" to="/" />}
          variant="outline"
        >
          <ArrowLeft data-icon="inline-start" />
          Back to overview
        </Button>
      </div>
    </main>
  )
}

export function NotFoundState() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 md:px-6">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page may have moved, or the resource may have been deleted.
      </p>
      <Button
        className="mt-6"
        nativeButton={false}
        render={<Link aria-label="Back to overview" to="/" />}
      >
        <ArrowLeft data-icon="inline-start" />
        Back to overview
      </Button>
    </main>
  )
}

function safeErrorMessage(error: Error) {
  if (/permission|forbidden|unauthor/i.test(error.message)) {
    return "You do not have permission to view this resource. Ask an administrator for access."
  }
  if (/not found|404/i.test(error.message)) {
    return "The requested resource was not found. It may have been removed."
  }
  return "Rhythm kept your previous data unchanged. Check the service connection and try again."
}
