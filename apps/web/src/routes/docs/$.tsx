import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import browserCollections from "collections/browser"
import { deserializePageTree } from "fumadocs-core/source/client"
import type { ReactNode } from "react"
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
  PageLastUpdate,
} from "fumadocs-ui/layouts/docs/page"

import { RhythmDocsLayout } from "@/components/docs/docs-layout"
import { getMdxComponents } from "@/components/docs/mdx-components"
import { docsSource } from "@/lib/docs/source"
import docsStylesheetUrl from "@/styles/docs.css?url"

export const Route = createFileRoute("/docs/$")({
  loader: async ({ params }) => {
    const data = await loadDocumentationPage({
      data: params._splat?.split("/").filter(Boolean) ?? [],
    })
    await docsClientLoader.preload(data.path)
    return data
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Documentation"} — Rhythm Docs` },
      { name: "description", content: loaderData?.description ?? "" },
      { property: "og:type", content: "article" },
      {
        property: "og:title",
        content: `${loaderData?.title ?? "Documentation"} — Rhythm Docs`,
      },
      {
        property: "og:description",
        content: loaderData?.description ?? "",
      },
    ],
    links: [{ rel: "stylesheet", href: docsStylesheetUrl }],
  }),
  component: DocumentationPage,
  notFoundComponent: DocumentationNotFound,
})

const loadDocumentationPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = docsSource.getPage(slugs)
    if (!page) throw notFound()
    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      status: page.data.status,
      since: page.data.since,
      lastReviewed: page.data.lastReviewed,
      toc: page.data.toc.map((item) => ({
        ...item,
        title: nodeText(item.title),
      })),
      url: page.url,
      tree: await docsSource.serializePageTree(docsSource.pageTree),
    }
  })

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join("")
  if (node && typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode }
    return nodeText(props.children)
  }
  return ""
}

const docsClientLoader = browserCollections.docs.createClientLoader({
  component({ default: Mdx }) {
    return <Mdx components={getMdxComponents()} />
  },
})

function DocumentationPage() {
  const page = Route.useLoaderData()
  const sourceUrl = `https://github.com/ebinjac/rhy/blob/main/apps/web/content/docs/${page.path}`

  return (
    <RhythmDocsLayout tree={deserializePageTree(page.tree)}>
      <DocsPage role="main" toc={page.toc}>
        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border px-2 py-1 capitalize">
            {page.status}
          </span>
          <span>Since {page.since}</span>
        </div>
        <DocsTitle>{page.title}</DocsTitle>
        <DocsDescription>{page.description}</DocsDescription>
        <div className="mt-5 flex flex-wrap gap-3 border-b pb-5 text-sm">
          <a
            className="font-medium text-primary underline-offset-4 hover:underline"
            href={page.url.replace("/docs", "/docs-markdown")}
          >
            Copy-safe Markdown
          </a>
          <EditOnGitHub href={sourceUrl}>Edit this page</EditOnGitHub>
        </div>
        <DocsBody>
          {docsClientLoader.useContent(page.path)}
        </DocsBody>
        <div className="mt-10 border-t pt-6">
          <PageLastUpdate date={new Date(page.lastReviewed)} />
        </div>
      </DocsPage>
    </RhythmDocsLayout>
  )
}

function DocumentationNotFound() {
  return (
    <div className="rhythm-docs min-h-screen bg-background text-foreground">
      <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-20">
        <p className="text-sm font-semibold text-primary">Documentation</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">
          This page is not available.
        </h1>
        <p className="mt-4 max-w-prose text-muted-foreground">
          The page may have moved, may belong to a different documentation
          version, or may not exist yet.
        </p>
        <a
          className="mt-7 w-fit rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          href="/docs"
        >
          Return to documentation
        </a>
      </main>
    </div>
  )
}
