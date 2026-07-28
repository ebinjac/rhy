import {
  HeadContent,
  ScriptOnce,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"

import appCss from "@workspace/ui/globals.css?url"
import { Toaster } from "@workspace/ui/components/sonner"
import { AppShell } from "@/components/app-shell/app-shell"
import {
  NotFoundState,
  RouteErrorState,
  RoutePendingState,
} from "@/components/page-state"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Rhythm — Synthetic Monitoring & Validation",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
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

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ScriptOnce children={themeScript} />
        <RootProvider
          search={{
            options: {
              api: "/api/docs-search",
            },
          }}
          theme={{ enabled: false }}
        >
          {isDocumentation ? children : <AppShell>{children}</AppShell>}
        </RootProvider>
        <Toaster richColors closeButton />
        <Scripts />
      </body>
    </html>
  )
}

const themeScript = `(function(){try{var stored=localStorage.getItem("rhythm-theme");var theme=stored==="dark"||stored==="light"?stored:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.classList.toggle("dark",theme==="dark");document.documentElement.style.colorScheme=theme;var density=localStorage.getItem("rhythm-table-density");document.documentElement.dataset.density=density==="compact"?"compact":"comfortable";}catch(_){}})();`
