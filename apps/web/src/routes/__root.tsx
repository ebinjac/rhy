import {
  HeadContent,
  ScriptOnce,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"

import appCss from "@workspace/ui/globals.css?url"
import { Toaster } from "sonner"
import { AppShell } from "@/components/app-shell/app-shell"
import { AppErrorBoundary } from "@/components/error-boundary"
import {
  NotFoundState,
  RouteErrorState,
  RoutePendingState,
} from "@/components/page-state"
import { ThemeProvider } from "@/components/theme-provider"

const siteDescription =
  "Rhythm synthetic monitoring and validation for application journeys, ELF probes, and OpenSearch alerting."

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        title: "Rhythm — Synthetic Monitoring & Validation",
      },
      {
        name: "description",
        content: siteDescription,
      },
      {
        name: "robots",
        content: "noindex, nofollow",
      },
      {
        property: "og:title",
        content: "Rhythm — Synthetic Monitoring & Validation",
      },
      {
        property: "og:description",
        content: siteDescription,
      },
      {
        property: "og:image",
        content: "/brand-logo.png",
      },
      {
        name: "twitter:card",
        content: "summary",
      },
      {
        name: "twitter:image",
        content: "/brand-logo.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        href: "/favicon.ico",
      },
      {
        rel: "apple-touch-icon",
        href: "/brand-logo.png",
      },
    ],
  }),
  pendingComponent: RoutePendingState,
  errorComponent: RouteErrorState,
  notFoundComponent: NotFoundState,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isDocumentation = pathname === "/docs" || pathname.startsWith("/docs/")
  const isPublicMarketing = pathname === "/rhythm"

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ScriptOnce children={themeScript} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="rhythm-theme"
        >
          <AppErrorBoundary>
            <RootProvider
              search={{
                options: {
                  api: "/api/docs-search",
                },
              }}
              theme={{ enabled: false }}
            >
              {isDocumentation || isPublicMarketing ? (
                children
              ) : (
                <AppShell>{children}</AppShell>
              )}
            </RootProvider>
            <Toaster richColors closeButton />
          </AppErrorBoundary>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

const themeScript = `(function(){try{var stored=localStorage.getItem("rhythm-theme");var theme=stored==="dark"||stored==="light"?stored:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.classList.toggle("dark",theme==="dark");document.documentElement.style.colorScheme=theme;var density=localStorage.getItem("rhythm-table-density");document.documentElement.dataset.density=density==="compact"?"compact":"comfortable";}catch(_){}})();`
