import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/docs/current/$")({
  beforeLoad: ({ params }) => {
    const suffix = params._splat ? `/${params._splat}` : ""
    throw redirect({
      href: `/docs${suffix}`,
      statusCode: 302,
    })
  },
})
