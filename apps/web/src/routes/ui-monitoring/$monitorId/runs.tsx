import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/ui-monitoring/$monitorId/runs")({
  component: Outlet,
})
