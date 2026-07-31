import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: () =>
        new Response('{"status":"ok","service":"rhythm-web"}', {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
          },
        }),
    },
  },
})
