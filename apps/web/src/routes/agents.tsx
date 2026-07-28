import { createFileRoute, redirect } from "@tanstack/react-router"

/** Execution agents UI is hidden for now; keep the path from 404ing. */
export const Route = createFileRoute("/agents")({
  beforeLoad: () => {
    throw redirect({ to: "/" })
  },
})
