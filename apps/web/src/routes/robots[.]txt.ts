import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin
        return new Response(
          [
            "User-agent: *",
            "Allow: /docs/",
            "Disallow: /docs/current/",
            "Disallow: /api/docs-search",
            "Disallow: /llms-full.txt",
            `Sitemap: ${origin}/sitemap.xml`,
            "",
          ].join("\n"),
          {
            headers: {
              "Cache-Control": "public, max-age=3600",
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        )
      },
    },
  },
})
