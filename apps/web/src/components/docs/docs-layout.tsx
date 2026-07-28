import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import type { Root } from "fumadocs-core/page-tree"
import { BookOpen, Code2, ExternalLink } from "lucide-react"

import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import { RhythmLogo } from "@/components/brand/rhythm-logo"

export function RhythmDocsLayout({
  children,
  tree,
}: {
  children: ReactNode
  tree: Root
}) {
  return (
    <div className="rhythm-docs min-h-screen bg-background text-foreground">
      <DocsLayout
        tree={tree}
        nav={{
          title: (
            <span className="flex items-center gap-3">
              <RhythmLogo
                decorative
                showSubtitle={false}
                wordmarkClassName="[&_p]:text-foreground"
              />
              <span className="hidden rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground sm:inline">
                Docs
              </span>
            </span>
          ),
          url: "/docs",
        }}
        links={[
          {
            type: "main",
            text: "Guides",
            url: "/docs/getting-started/overview",
            icon: <BookOpen aria-hidden="true" className="size-4" />,
          },
          {
            type: "button",
            text: "Open Rhythm",
            url: "/",
            icon: <ExternalLink aria-hidden="true" className="size-4" />,
          },
          {
            type: "button",
            text: "GitHub",
            url: "https://github.com/ebinjac/rhy",
            icon: <Code2 aria-hidden="true" className="size-4" />,
            external: true,
          },
          {
            type: "custom",
            secondary: true,
            children: (
              <div className="flex items-center">
                <ThemeToggle />
              </div>
            ),
          },
        ]}
        themeSwitch={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </div>
  )
}

export function DocsLink({
  children,
  to,
}: {
  children: ReactNode
  to: string
}) {
  return (
    <Link className="text-primary underline-offset-4 hover:underline" to={to}>
      {children}
    </Link>
  )
}
