import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router"
import {
  Activity,
  ChartNoAxesCombined,
  FileClock,
  FilePenLine,
  History,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { PageContainer } from "@/components/page-container"
import { listMonitors } from "@/lib/api-client/monitors"

export const Route = createFileRoute("/monitors/$monitorId")({
  loader: async ({ params }) => {
    const { monitors } = await listMonitors()
    const monitor = monitors.find((item) => item.id === params.monitorId)
    if (!monitor) throw new Error("Monitor not found")
    return { monitor }
  },
  component: MonitorWorkspace,
})

const tabs = [
  { label: "Overview", to: "/monitors/$monitorId", icon: Activity, exact: true },
  {
    label: "Builder",
    to: "/monitors/$monitorId/edit",
    icon: FilePenLine,
    exact: false,
  },
  {
    label: "Runs",
    to: "/monitors/$monitorId/runs",
    icon: History,
    exact: false,
  },
  {
    label: "Metrics",
    to: "/monitors/$monitorId/metrics",
    icon: ChartNoAxesCombined,
    exact: false,
  },
  {
    label: "Revisions",
    to: "/monitors/$monitorId/revisions",
    icon: FileClock,
    exact: false,
  },
] as const

function MonitorWorkspace() {
  const { monitor } = Route.useLoaderData()
  const matchRoute = useMatchRoute()

  return (
    <div>
      <div className="border-b bg-muted/15">
        <PageContainer padding="tabs">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Link className="hover:text-foreground" to="/monitors">
              Monitors
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="truncate text-foreground">
              {monitor.name}
            </span>
          </nav>
          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{monitor.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {monitor.application} · {monitor.cadence}
              </p>
            </div>
          </div>
          <nav
            aria-label={`${monitor.name} sections`}
            className="mt-3 flex min-w-0 gap-1 overflow-x-auto"
          >
            {tabs.map((tab) => {
              const isActive = Boolean(
                matchRoute({
                  to: tab.to,
                  params: { monitorId: monitor.id },
                  fuzzy: !tab.exact,
                }),
              )

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    isActive
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  key={tab.label}
                  params={{ monitorId: monitor.id }}
                  to={tab.to}
                >
                  <tab.icon aria-hidden="true" className="size-4" />
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </PageContainer>
      </div>
      <Outlet />
    </div>
  )
}
