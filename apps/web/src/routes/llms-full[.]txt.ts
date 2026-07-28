import { createFileRoute } from "@tanstack/react-router"

import { getLlmText } from "@/lib/docs/get-llm-text"
import { docsSource } from "@/lib/docs/source"

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => {
        const pages = await Promise.all(docsSource.getPages().map(getLlmText))
        return new Response(pages.join("\n\n---\n\n"), {
          headers: {
            "Cache-Control": "public, max-age=300",
            "Content-Type": "text/plain; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
        })
      },
    },
  },
})
