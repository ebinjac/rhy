import { lazy, Suspense, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Activity,
  AppWindow,
  BookOpen,
  Boxes,
  CircleAlert,
  Info,
  TriangleAlert,
  Gauge,
  FileSearch,
  MonitorCheck,
  Settings2,
  ScrollText,
  Check,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"

import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import { RhythmLogo } from "@/components/brand/rhythm-logo"

const DeferredGlobalSearch = lazy(() =>
  import("@/components/app-shell/global-search").then((module) => ({
    default: module.GlobalSearch,
  }))
)
const DeferredHelpDrawer = lazy(() =>
  import("@/components/app-shell/help-drawer").then((module) => ({
    default: module.HelpDrawer,
  }))
)
const DeferredAlertsInbox = lazy(() =>
  import("@/components/app-shell/alerts-inbox").then((module) => ({
    default: module.AlertsInbox,
  }))
)

const navigation = [
  { label: "Overview", to: "/", icon: Gauge },
  { label: "Monitors", to: "/monitors", icon: Activity },
  { label: "UI monitoring", to: "/ui-monitoring", icon: MonitorCheck },
  { label: "Applications", to: "/applications", icon: AppWindow },
  { label: "ELF log search", to: "/elf", icon: FileSearch },
  { label: "Alerts", to: "/alerts", icon: CircleAlert },
  { label: "Validation suites", to: "/suites", icon: Boxes },
  { label: "Audit log", to: "/audit", icon: ScrollText },
  { label: "Configuration", to: "/configuration", icon: Settings2 },
] as const

function readSidebarOpenCookie() {
  if (typeof document === "undefined") return true
  const value = document.cookie
    .split("; ")
    .find((row) => row.startsWith("sidebar_state="))
    ?.split("=")[1]
  return value !== "false"
}

function isNavActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/"
  return pathname === to || pathname.startsWith(`${to}/`)
}

function AppSidebar() {
  const { setOpenMobile } = useSidebar()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <Sidebar collapsible="icon" aria-label="Primary navigation">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link
          to="/"
          aria-label="Rhythm home"
          className="flex h-12 items-center rounded-lg px-2 transition-colors outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          onClick={() => setOpenMobile(false)}
        >
          <RhythmLogo
            decorative
            className="w-full group-data-[collapsible=icon]:w-auto"
            wordmarkClassName="group-data-[collapsible=icon]:hidden"
          />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    render={<Link aria-label={item.label} to={item.to} />}
                    isActive={isNavActive(pathname, item.to)}
                    tooltip={item.label}
                    className="h-9 rounded-lg text-muted-foreground data-active:text-sidebar-accent-foreground"
                    onClick={() => setOpenMobile(false)}
                  >
                    <item.icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link aria-label="Rhythm" to="/rhythm" />}
              tooltip="Rhythm"
              className="h-9 rounded-lg text-muted-foreground"
              onClick={() => setOpenMobile(false)}
            >
              <Sparkles aria-hidden="true" />
              <span>Rhythm</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link
                  aria-label="Documentation"
                  to="/docs/$"
                  params={{ _splat: "" }}
                />
              }
              tooltip="Documentation"
              className="h-9 rounded-lg text-muted-foreground"
              onClick={() => setOpenMobile(false)}
            >
              <BookOpen aria-hidden="true" />
              <span>Documentation</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <WorkspacePreferences />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

type Density = "comfortable" | "compact"
const densityStorageKey = "rhythm-table-density"

function WorkspacePreferences() {
  const [density, setDensity] = useState<Density>("comfortable")

  useEffect(() => {
    const stored = window.localStorage.getItem(densityStorageKey)
    const initial: Density = stored === "compact" ? "compact" : "comfortable"
    document.documentElement.dataset.density = initial
    setDensity(initial)
  }, [])

  function updateDensity(next: Density) {
    window.localStorage.setItem(densityStorageKey, next)
    document.documentElement.dataset.density = next
    setDensity(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            aria-label="Open user preferences"
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            type="button"
          />
        }
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
          EJ
        </div>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-sm font-medium">Ebin Jacob</p>
          <p className="truncate text-xs text-muted-foreground">
            Administrator
          </p>
        </div>
        <SlidersHorizontal className="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Display preferences</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => updateDensity("comfortable")}>
            {density === "comfortable" ? (
              <Check />
            ) : (
              <span className="size-4" />
            )}
            Comfortable tables
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => updateDensity("compact")}>
            {density === "compact" ? <Check /> : <span className="size-4" />}
            Compact tables
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Preferences are stored for this browser profile.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    setOpen(readSidebarOpenCookie())
  }, [])

  return (
    <TooltipProvider>
      <SidebarProvider open={open} onOpenChange={setOpen}>
        <a
          href="#main-content"
          className="fixed top-3 left-3 z-50 -translate-y-20 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
            <SidebarTrigger />
            <DeferredShellSearch />
            <div className="ml-auto flex items-center gap-2">
              <DeferredShellActions />
              <ThemeToggle />
            </div>
          </header>
          <div id="main-content" className="min-w-0 outline-none" tabIndex={-1}>
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

function DeferredShellSearch() {
  const ready = useIdleReady()
  if (!ready) {
    return (
      <div
        aria-hidden="true"
        className="hidden h-9 w-full max-w-sm rounded-lg bg-muted/45 sm:block"
      />
    )
  }
  return (
    <Suspense
      fallback={
        <div
          aria-hidden="true"
          className="hidden h-9 w-full max-w-sm rounded-lg bg-muted/45 sm:block"
        />
      }
    >
      <DeferredGlobalSearch />
    </Suspense>
  )
}

function DeferredShellActions() {
  const ready = useIdleReady()
  if (!ready) {
    return (
      <div aria-hidden="true" className="flex gap-2">
        <span className="size-9 rounded-lg bg-muted/45" />
        <span className="size-9 rounded-lg bg-muted/45" />
      </div>
    )
  }
  return (
    <Suspense
      fallback={
        <div aria-hidden="true" className="flex gap-2">
          <span className="size-9 rounded-lg bg-muted/45" />
          <span className="size-9 rounded-lg bg-muted/45" />
        </div>
      }
    >
      <DeferredHelpDrawer />
      <DeferredAlertsInbox />
    </Suspense>
  )
}

function useIdleReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const windowWithIdle = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number }
      ) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (windowWithIdle.requestIdleCallback) {
      const handle = windowWithIdle.requestIdleCallback(
        () => setReady(true),
        { timeout: 1200 }
      )
      return () => windowWithIdle.cancelIdleCallback?.(handle)
    }
    const handle = window.setTimeout(() => setReady(true), 250)
    return () => window.clearTimeout(handle)
  }, [])
  return ready
}

export function SystemNotice({
  alert,
  alertCount = alert ? 1 : 0,
}: {
  alertCount?: number
  alert?: {
    id?: string
    severity?: "INFO" | "LOW" | "WARNING" | "HIGH" | "CRITICAL"
    sourceType?:
      "RHYTHM_MONITOR" | "RHYTHM_BROWSER_MONITOR" | "OPENSEARCH_ALERTING"
    monitorName?: string
    title: string
    consecutiveFailures: number
  }
}) {
  if (!alert) return null
  const critical = alert.severity === "CRITICAL" || alert.severity === "HIGH"
  const surface = critical
    ? "border-b bg-destructive/8 text-destructive"
    : alert.severity === "WARNING"
      ? "border-b bg-warning-soft text-warning-foreground"
      : "border-b bg-primary/8 text-foreground"
  const NoticeIcon = critical
    ? CircleAlert
    : alert.severity === "WARNING"
      ? TriangleAlert
      : Info
  const label =
    alert.sourceType === "OPENSEARCH_ALERTING"
      ? alert.title
      : alert.monitorName || alert.title
  const detail =
    alert.sourceType === "OPENSEARCH_ALERTING"
      ? "was received from OpenSearch."
      : alert.sourceType === "RHYTHM_BROWSER_MONITOR"
        ? `has failed ${alert.consecutiveFailures} consecutive browser journeys.`
        : `has failed ${alert.consecutiveFailures} consecutive runs.`
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 px-4 py-2.5 text-sm md:px-6 ${surface}`}
    >
      <NoticeIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        {alertCount === 1
          ? "One alert needs attention."
          : `${alertCount} alerts need attention.`}{" "}
        <span className="font-medium">{label}</span> {detail}{" "}
        <Link
          to="/alerts"
          hash={alert.id ? `alert-${alert.id}` : undefined}
          className="font-medium underline underline-offset-2 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {alertCount === 1 ? "Review alert" : "Review alerts"}
        </Link>
      </p>
    </div>
  )
}
