import { useEffect, useState, type ReactNode } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
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
  Activity,
  AppWindow,
  Bell,
  Boxes,
  Cable,
  ChevronDown,
  CircleAlert,
  Gauge,
  FileSearch,
  Search,
  Settings2,
  ShieldCheck,
  ScrollText,
} from "lucide-react"

import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import { RhythmLogo } from "@/components/brand/rhythm-logo"

const navigation = [
  { label: "Overview", to: "/", icon: Gauge },
  { label: "Monitors", to: "/monitors", icon: Activity },
  { label: "Applications", to: "/applications", icon: AppWindow },
  { label: "ELF log search", to: "/elf", icon: FileSearch },
  { label: "Alerts", to: "/alerts", icon: CircleAlert },
  { label: "Validation suites", to: "/suites", icon: Boxes },
  { label: "Execution agents", to: "/agents", icon: Cable },
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
          className="flex h-12 items-center rounded-lg px-2 outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
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
                    render={<Link to={item.to} />}
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
        <div className="flex items-center gap-3 rounded-lg px-2 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
            EJ
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium">Ebin Jacob</p>
            <p className="truncate text-xs text-muted-foreground">
              Administrator
            </p>
          </div>
          <ChevronDown
            aria-hidden="true"
            className="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden"
          />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
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
            <div className="relative hidden w-full max-w-sm sm:block">
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search Rhythm"
                className="h-9 bg-muted/55 pl-9"
                placeholder="Search monitors, runs, and alerts"
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge
                className="hidden bg-success-soft text-success-foreground lg:inline-flex"
                variant="secondary"
              >
                <ShieldCheck /> Agent fleet
              </Badge>
              <ThemeToggle />
              <Button
                aria-label="One active alert"
                className="relative"
                size="icon"
                variant="ghost"
              >
                <Bell />
                <span
                  className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive"
                  aria-hidden="true"
                />
              </Button>
            </div>
          </header>
          <div id="main-content" className="min-w-0">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

export function SystemNotice({
  alert,
}: {
  alert?: {
    sourceType?: "RHYTHM_MONITOR" | "OPENSEARCH_ALERTING"
    monitorName?: string
    title: string
    consecutiveFailures: number
  }
}) {
  if (!alert) return null
  return (
    <div className="flex items-start gap-3 border-b bg-warning-soft px-4 py-2.5 text-sm text-warning-foreground md:px-6">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        One alert needs attention.{" "}
        <span className="font-medium">
          {alert.sourceType === "OPENSEARCH_ALERTING"
            ? alert.title
            : alert.monitorName || alert.title}
        </span>{" "}
        {alert.sourceType === "OPENSEARCH_ALERTING"
          ? "was received from OpenSearch."
          : `has failed ${alert.consecutiveFailures} consecutive runs.`}
      </p>
    </div>
  )
}
