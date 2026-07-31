import {
  createFileRoute,
  Link,
  Outlet,
  useMatchRoute,
} from "@tanstack/react-router"
import {
  Activity,
  ChartNoAxesCombined,
  Eye,
  FilePenLine,
  History,
  Settings2,
} from "lucide-react"

import { PageContainer } from "@/components/page-container"
import { BrowserHealthBadge } from "@/features/ui-monitoring/browser-monitor-status"
import { getBrowserMonitor } from "@/lib/api-client/browser-monitoring"
import { cn } from "@workspace/ui/lib/utils"

export const Route = createFileRoute("/ui-monitoring/$monitorId")({
  loader: ({ params }) =>
    getBrowserMonitor({ data: { monitorId: params.monitorId } }),
  component: BrowserMonitorWorkspace,
})

const tabs = [
  {
    label: "Overview",
    to: "/ui-monitoring/$monitorId",
    icon: Activity,
    exact: true,
  },
  {
    label: "Journey",
    to: "/ui-monitoring/$monitorId/journey",
    icon: FilePenLine,
    exact: false,
  },
  {
    label: "Runs",
    to: "/ui-monitoring/$monitorId/runs",
    icon: History,
    exact: false,
  },
  {
    label: "Metrics",
    to: "/ui-monitoring/$monitorId/metrics",
    icon: ChartNoAxesCombined,
    exact: false,
  },
  {
    label: "Baselines",
    to: "/ui-monitoring/$monitorId/baselines",
    icon: Eye,
    exact: false,
  },
  {
    label: "Settings",
    to: "/ui-monitoring/$monitorId/settings",
    icon: Settings2,
    exact: false,
  },
] as const

function BrowserMonitorWorkspace() {
  const monitor = Route.useLoaderData()
  const matchRoute = useMatchRoute()
  return (
    <div>
      <div className="border-b bg-muted/15">
        <PageContainer padding="tabs">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Link className="hover:text-foreground" to="/ui-monitoring">
              UI monitoring
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="truncate text-foreground">
              {monitor.name}
            </span>
          </nav>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-lg font-semibold">{monitor.name}</p>
                <BrowserHealthBadge monitor={monitor} />
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {monitor.applicationName || "No application"}
                {monitor.serviceName ? ` · ${monitor.serviceName}` : ""}
                {monitor.environmentName ? ` · ${monitor.environmentName}` : ""}
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
                })
              )
              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    isActive
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
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
