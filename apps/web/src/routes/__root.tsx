import {
  HeadContent,
  ScriptOnce,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router"

import instrumentSansLatinUrl from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url"
import "@workspace/ui/globals.css"
import { lazy, Suspense } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { AppErrorBoundary } from "@/components/error-boundary"
import {
  NotFoundState,
  RouteErrorState,
  RoutePendingState,
} from "@/components/page-state"
import { PerformanceReporter } from "@/components/performance-reporter"
import { ThemeProvider } from "@/components/theme-provider"

const siteDescription =
  "Rhythm synthetic monitoring and validation for application journeys, ELF probes, and OpenSearch alerting."
const DeferredToaster = lazy(() => import("@/components/deferred-toaster"))

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
        rel: "preload",
        href: instrumentSansLatinUrl,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
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
        <ScriptOnce children={themeScript} />
        <ScriptOnce children={chunkRecoveryScript} />
        <style dangerouslySetInnerHTML={{ __html: criticalPaintCss }} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="rhythm-theme"
        >
          <AppErrorBoundary>
            <PerformanceReporter />
            {isDocumentation || isPublicMarketing ? (
              children
            ) : (
              <AppShell>{children}</AppShell>
            )}
            <Suspense fallback={null}>
              <DeferredToaster />
            </Suspense>
          </AppErrorBoundary>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

const themeScript = `(function(){try{var stored=localStorage.getItem("rhythm-theme");var theme=stored==="dark"||stored==="light"?stored:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.classList.toggle("dark",theme==="dark");document.documentElement.style.colorScheme=theme;var density=localStorage.getItem("rhythm-table-density");document.documentElement.dataset.density=density==="compact"?"compact":"comfortable";}catch(_){}})();`

const chunkRecoveryScript = `(function(){var key="rhythm:chunk-recovery",reloading=false;function text(value){try{return String(value&&value.message||value||"")}catch(_){return""}}function isChunkFailure(value){return /chunkloaderror|loading chunk|dynamically imported module|importing a module script|module script failed|preload.*failed/i.test(text(value))}function recover(event){if(reloading)return;try{var now=Date.now(),stored=JSON.parse(sessionStorage.getItem(key)||"null"),count=stored&&now-stored.at<60000?Number(stored.count||0):0;if(count>=2)return;sessionStorage.setItem(key,JSON.stringify({count:count+1,at:now}));reloading=true;if(event&&event.preventDefault)event.preventDefault();location.reload()}catch(_){}}addEventListener("vite:preloadError",recover);addEventListener("unhandledrejection",function(event){if(isChunkFailure(event.reason))recover(event)});addEventListener("error",function(event){var target=event.target,source=target&&(target.src||target.href)||"";if((source.indexOf("/assets/")!==-1&&(target.tagName==="SCRIPT"||target.tagName==="LINK"))||isChunkFailure(event.error||event.message))recover(event)},true);setTimeout(function(){if(!reloading)try{sessionStorage.removeItem(key)}catch(_){}},15000)})();`

const criticalPaintCss =
  "html{background:oklch(1 0.002 254);color-scheme:light}html.dark{background:oklch(0.12 0.005 254);color-scheme:dark}body{margin:0;background:inherit}"
