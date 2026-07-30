import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { Braces, ScrollText, Settings2 } from "lucide-react"

import { PageContainer } from "@/components/page-container"

export const Route = createFileRoute("/elf")({ component: ELFLayout })

const tabs: Array<{
  to: "/elf" | "/elf/runs" | "/elf/settings"
  label: string
  icon: typeof Braces
  exact?: boolean
}> = [
  { to: "/elf", label: "Queries", icon: Braces, exact: true },
  { to: "/elf/runs", label: "Runs", icon: ScrollText },
  { to: "/elf/settings", label: "Settings", icon: Settings2 },
]

function ELFLayout() {
  return (
    <div>
      <div className="border-b bg-muted/20">
        <PageContainer
          padding="none"
          className="flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.exact ?? false }}
              activeProps={{ className: "border-primary text-foreground" }}
              className="flex h-12 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <tab.icon className="size-4" />
              {tab.label}
            </Link>
          ))}
        </PageContainer>
      </div>
      <Outlet />
    </div>
  )
}
