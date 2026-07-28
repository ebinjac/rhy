import { useMemo, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"
import { CircleHelp, Search } from "lucide-react"

const topics = [
  {
    title: "API response time",
    body: "The target-facing time: DNS, proxy connection, TCP, TLS, request write, server wait, and download. Queueing, preparation, scripts, extraction, and assertions are shown separately.",
  },
  {
    title: "Full execution time",
    body: "The complete wall-clock duration of a run, including Rhythm orchestration, scripts, retries, checks, and post-processing.",
  },
  {
    title: "ELF",
    body: "Rhythm’s governed OpenSearch log investigation and deployment-check area. Probe explores logs; Test check evaluates the saved pass condition.",
  },
  {
    title: "CAR ID",
    body: "Your organization’s internal application identifier. Rhythm uses the application relationship—not payload text—as the trusted ownership context.",
  },
  {
    title: "Blocking and advisory",
    body: "A blocking failure prevents a deployment from being allowed. An advisory failure produces a warning while preserving the release decision.",
  },
  {
    title: "Draft, published, and enabled",
    body: "Draft changes are editable. Publishing creates the immutable revision used by execution. Enabled controls whether the published monitor runs on schedule.",
  },
  {
    title: "Capture states",
    body: "Evidence can be captured, empty, masked, truncated, not captured, or blocked by policy. A missing value is never treated as zero.",
  },
  {
    title: "Proxy and TLS",
    body: "Proxy controls the outbound network route. TLS profiles control certificate trust and client identity. Both apply after pre-request processing.",
  },
]

export function HelpDrawer() {
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return topics
    return topics.filter((topic) =>
      `${topic.title} ${topic.body}`.toLowerCase().includes(needle)
    )
  }, [query])

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            aria-label="Open help and glossary"
            size="icon"
            variant="ghost"
          />
        }
      >
        <CircleHelp />
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Help and glossary</SheetTitle>
          <SheetDescription>
            Concise explanations for monitoring, logs, and deployment
            validation.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="relative block">
            <span className="sr-only">Search help</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search help"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search concepts"
              value={query}
            />
          </div>
          <div className="mt-5 divide-y">
            {filtered.map((topic) => (
              <section className="py-4 first:pt-0" key={topic.title}>
                <h3 className="font-medium">{topic.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {topic.body}
                </p>
              </section>
            ))}
            {!filtered.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No matching help topic.
              </p>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
