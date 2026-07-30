import { useMemo, useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"
import { Braces, Search, Variable } from "lucide-react"

import type { VariableCatalogEntry } from "@/features/monitors/variable-catalog"

function CatalogResults({
  entries,
  query,
  onInsert,
}: {
  entries: VariableCatalogEntry[]
  query: string
  onInsert?: (entry: VariableCatalogEntry, explicit: boolean) => void
}) {
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return entries
    return entries.filter((entry) =>
      [entry.name, entry.scope, entry.origin, entry.template]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    )
  }, [entries, query])
  if (!results.length)
    return (
      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        No variables match this search.
      </p>
    )
  return (
    <div className="max-h-80 overflow-y-auto py-1" role="listbox">
      {results.map((entry) => (
        <div
          key={entry.id}
          className="border-b px-3 py-2.5 last:border-b-0"
          aria-disabled={entry.availability === "later"}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="text-xs font-semibold text-foreground">
                  {entry.name}
                </code>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {entry.scope}
                </Badge>
                {entry.sensitive ? (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    MASKED
                  </Badge>
                ) : null}
                {entry.shadowed ? (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    shadowed
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {entry.origin}
                {entry.availability === "later"
                  ? ` · Available after ${entry.availableAfter ?? "this step"}`
                  : entry.previewState === "known" && entry.previewValue
                    ? ` · ${entry.previewValue}`
                    : entry.previewState === "masked"
                      ? " · Value protected"
                      : " · Resolved at runtime"}
              </p>
            </div>
            {onInsert ? (
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-9 px-2"
                  disabled={entry.availability === "later"}
                  onClick={() => onInsert(entry, false)}
                >
                  Insert
                </Button>
                {entry.explicitTemplate !== entry.template || entry.shadowed ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-9 px-2"
                    disabled={entry.availability === "later"}
                    onClick={() => onInsert(entry, true)}
                    aria-label={`Insert ${entry.name} with explicit ${entry.scope} scope`}
                  >
                    Scoped
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export function VariablePicker({
  entries,
  onInsert,
  open,
  onOpenChange,
  label = "Insert variable",
}: {
  entries: VariableCatalogEntry[]
  onInsert: (entry: VariableCatalogEntry, explicit: boolean) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  label?: string
}) {
  const [query, setQuery] = useState("")
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 shrink-0 md:min-h-8"
            aria-label={label || "Insert variable"}
          />
        }
      >
        <Braces />
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,32rem)] gap-2 p-0">
        <PopoverHeader className="px-3 pt-3">
          <PopoverTitle>Insert variable</PopoverTitle>
          <PopoverDescription>
            Values shown here are available at this workflow step.
          </PopoverDescription>
        </PopoverHeader>
        <div className="relative px-3">
          <Search className="pointer-events-none absolute top-2.5 left-5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
            placeholder="Search variables, scopes, and origins"
            aria-label="Search variables"
          />
        </div>
        <CatalogResults
          entries={entries}
          query={query}
          onInsert={(entry, explicit) => {
            onInsert(entry, explicit)
            onOpenChange?.(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function VariableCatalogSheet({
  entries,
}: {
  entries: VariableCatalogEntry[]
}) {
  const [query, setQuery] = useState("")
  const available = entries.filter(
    (entry) => entry.availability === "now"
  ).length
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 md:min-h-8"
          />
        }
      >
        <Variable />
        Variables
        <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
          {available}
        </Badge>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg"
        aria-describedby="variable-catalog-description"
      >
        <SheetHeader>
          <SheetTitle>Variable catalog</SheetTitle>
          <SheetDescription id="variable-catalog-description">
            Inspect value scope, origin, availability, and safe preview state.
            Secret values are never loaded into this panel.
          </SheetDescription>
        </SheetHeader>
        <div className="relative px-6 pb-3">
          <Search className="pointer-events-none absolute top-2.5 left-8 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
            placeholder="Search the catalog"
            aria-label="Search variable catalog"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t">
          <CatalogResults entries={entries} query={query} />
        </div>
        <div className="border-t px-6 py-4 text-xs text-muted-foreground">
          Need another value?{" "}
          <a
            className="font-medium text-primary underline"
            href="/configuration?kind=environments"
          >
            Manage environments
          </a>{" "}
          or{" "}
          <a
            className="font-medium text-primary underline"
            href="/configuration?kind=secrets"
          >
            manage secrets
          </a>
          .
        </div>
      </SheetContent>
    </Sheet>
  )
}
