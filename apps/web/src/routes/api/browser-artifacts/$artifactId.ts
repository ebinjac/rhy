import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/browser-artifacts/$artifactId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.artifactId)) {
          return new Response("Artifact not found", { status: 404 })
        }
        const baseURL = process.env.RHYTHM_API_URL ?? "http://localhost:8080"
        const upstream = await fetch(
          `${baseURL}/api/v1/browser-artifacts/${encodeURIComponent(params.artifactId)}`,
          {
            headers: { Accept: "image/png,application/octet-stream" },
            signal: AbortSignal.timeout(15000),
          }
        )
        if (!upstream.ok) {
          return new Response("Artifact is unavailable or has expired.", {
            status: upstream.status,
            headers: { "Cache-Control": "private, no-store" },
          })
        }
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type":
              upstream.headers.get("Content-Type") ??
              "application/octet-stream",
            "Content-Disposition": "inline",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        })
      },
    },
  },
})
