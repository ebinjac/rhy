import { createFileRoute } from "@tanstack/react-router"
import { llms } from "fumadocs-core/source"

import { docsSource } from "@/lib/docs/source"

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(llms(docsSource).index(), {
          headers: {
            "Cache-Control": "public, max-age=300",
            "Content-Type": "text/plain; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
        }),
    },
  },
})
