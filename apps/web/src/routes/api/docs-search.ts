import { createFileRoute } from "@tanstack/react-router"
import { createFromSource } from "fumadocs-core/search/server"

import { docsSource } from "@/lib/docs/source"

const search = createFromSource(docsSource)

export const Route = createFileRoute("/api/docs-search")({
  server: {
    handlers: {
      GET: ({ request }) => search.GET(request),
    },
  },
})
