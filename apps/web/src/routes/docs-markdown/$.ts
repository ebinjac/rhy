import { createFileRoute } from "@tanstack/react-router"

import { getLlmText } from "@/lib/docs/get-llm-text"
import { docsSource } from "@/lib/docs/source"

export const Route = createFileRoute("/docs-markdown/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = params._splat?.split("/").filter(Boolean) ?? []
        const page = docsSource.getPage(slugs)
        if (!page) {
          return new Response("Documentation page not found.", { status: 404 })
        }
        return new Response(await getLlmText(page), {
          headers: {
            "Cache-Control": "public, max-age=300",
            "Content-Type": "text/markdown; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
        })
      },
    },
  },
})
