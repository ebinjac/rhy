import { createFileRoute } from "@tanstack/react-router"

import { docsSource } from "@/lib/docs/source"

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin
        const urls = docsSource
          .getPages()
          .filter((page) => page.data.status === "stable")
          .map(
            (page) =>
              `<url><loc>${escapeXml(`${origin}${page.url}`)}</loc><lastmod>${page.data.lastReviewed}</lastmod></url>`
          )
          .join("")

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
          {
            headers: {
              "Cache-Control": "public, max-age=3600",
              "Content-Type": "application/xml; charset=utf-8",
            },
          }
        )
      },
    },
  },
})

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}
