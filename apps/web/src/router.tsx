import { createRouter as createTanStackRouter } from "@tanstack/react-router"

import {
  RouteErrorState,
  RoutePendingState,
} from "@/components/page-state"

import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    defaultPendingMs: 200,
    defaultPendingComponent: RoutePendingState,
    defaultErrorComponent: RouteErrorState,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
