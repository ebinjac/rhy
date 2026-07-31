import { useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Activity,
  AppWindow,
  Boxes,
  Braces,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MonitorCheck,
  Search,
  Settings2,
  X,
} from "lucide-react"

import type {
  SearchAlertHit,
  SearchMonitorHit,
  SearchResultsContract,
  SearchResourceHit,
  SearchRunHit,
} from "@/lib/api-client/contracts"
import { searchWorkspace } from "@/lib/api-client/search"

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 250
const RECENT_STORAGE_KEY = "rhythm-global-search-recent"
const MAX_RECENT = 6

type RecentItem =
  | {
      id: string
      label: string
      kind: "monitor"
      monitorId: string
    }
  | {
      id: string
      label: string
      kind: "run"
      monitorId: string
      runId: string
    }
  | {
      id: string
      label: string
      kind: "alert"
      alertId: string
    }
  | {
      id: string
      label: string
      kind: "resource"
      resource: SearchResourceHit
    }

const emptyResults: SearchResultsContract = {
  query: "",
  monitors: [],
  runs: [],
  alerts: [],
  resources: [],
}

function readRecent(): RecentItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentItem[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.label === "string")
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function writeRecent(items: RecentItem[]) {
  window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT)))
}

function resultCount(results: SearchResultsContract) {
  return (
    results.monitors.length +
    results.runs.length +
    results.alerts.length +
    results.resources.length
  )
}

function isMacPlatform() {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [results, setResults] = useState<SearchResultsContract>(emptyResults)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [isMac, setIsMac] = useState(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    setRecent(readRecent())
    setIsMac(isMacPlatform())
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [query])

  const runSearch = useEffectEvent(async (value: string) => {
    const requestId = ++requestIdRef.current
    if (value.length < MIN_QUERY_LENGTH) {
      setLoading(false)
      setError("")
      setResults(emptyResults)
      return
    }
    setLoading(true)
    setError("")
    try {
      const next = await searchWorkspace({ data: { q: value, limit: 8 } })
      if (requestId !== requestIdRef.current) return
      setResults(next)
    } catch {
      if (requestId !== requestIdRef.current) return
      setResults(emptyResults)
      setError("Search is unavailable right now.")
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  })

  useEffect(() => {
    void runSearch(debouncedQuery)
  }, [debouncedQuery])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      requestIdRef.current += 1
      setQuery("")
      setDebouncedQuery("")
      setResults(emptyResults)
      setError("")
      setLoading(false)
    }
  }

  function remember(item: RecentItem) {
    const next = [item, ...recent.filter((entry) => entry.id !== item.id)].slice(
      0,
      MAX_RECENT
    )
    setRecent(next)
    writeRecent(next)
  }

  function clearRecent() {
    setRecent([])
    window.localStorage.removeItem(RECENT_STORAGE_KEY)
  }

  async function goTo(item: RecentItem) {
    remember(item)
    handleOpenChange(false)
    if (item.kind === "monitor") {
      await navigate({
        to: "/monitors/$monitorId/edit",
        params: { monitorId: item.monitorId },
      })
      return
    }
    if (item.kind === "run") {
      await navigate({
        to: "/monitors/$monitorId/runs/$runId",
        params: { monitorId: item.monitorId, runId: item.runId },
      })
      return
    }
    if (item.kind === "alert") {
      await navigate({
        to: "/alerts",
        hash: `alert-${item.alertId}`,
      })
      return
    }
    const resource = item.resource
    if (resource.kind === "BROWSER_MONITOR") {
      await navigate({
        to: "/ui-monitoring/$monitorId",
        params: { monitorId: resource.id },
      })
    } else if (resource.kind === "APPLICATION" || resource.kind === "SERVICE") {
      await navigate({
        to: "/applications/$applicationId",
        params: { applicationId: resource.applicationId || resource.id },
        search: {
          section: resource.kind === "SERVICE" ? "services" : "overview",
        },
      })
    } else if (resource.kind === "ELF_QUERY") {
      await navigate({
        to: "/elf/$queryId",
        params: { queryId: resource.queryId || resource.id },
      })
    } else if (resource.kind === "ELF_RUN") {
      await navigate({
        to: "/elf/run/$runId",
        params: { runId: resource.id },
      })
    } else if (resource.kind === "DEPLOYMENT_RUN") {
      await navigate({
        to: "/deployment-runs/$deploymentRunId",
        params: { deploymentRunId: resource.id },
      })
    } else if (resource.kind === "CONFIGURATION") {
      const kinds = {
        CERTIFICATE: "certificates",
        PROXY: "proxies",
        AUTH: "auth",
        NOTIFICATION: "notifications",
        TELEMETRY: "telemetry",
      } as const
      await navigate({
        to: "/configuration",
        search: {
          kind:
            kinds[resource.context as keyof typeof kinds] ?? "secrets",
        },
      })
    } else {
      await navigate({ to: "/suites" })
    }
  }

  const showMinHint =
    query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && !loading
  const showEmpty =
    !loading &&
    !error &&
    debouncedQuery.length >= MIN_QUERY_LENGTH &&
    resultCount(results) === 0
  const shortcutLabel = isMac ? "⌘K" : "Ctrl K"

  return (
    <>
      <button
        type="button"
        aria-label="Search Rhythm workspace"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={inputId}
        onClick={() => setOpen(true)}
        className="relative hidden h-9 w-full max-w-sm items-center rounded-lg border border-transparent bg-muted/55 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:flex"
      >
        <Search aria-hidden="true" className="mr-2 size-4 shrink-0" />
        <span className="flex-1 truncate">Search Rhythm workspace</span>
        <Kbd className="ml-2 hidden md:inline-flex">{shortcutLabel}</Kbd>
      </button>
      <button
        type="button"
        aria-label="Open search"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:hidden"
      >
        <Search aria-hidden="true" className="size-4" />
      </button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Search Rhythm"
        description="Search monitors, applications, logs, suites, runs, and alerts"
        className="sm:max-w-xl"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            id={inputId}
            value={query}
            onValueChange={setQuery}
            placeholder="Search monitors, applications, logs, suites…"
            aria-label="Search Rhythm workspace"
          />
          <CommandList aria-label="Search results">
            {loading ? (
              <div
                className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Searching…
              </div>
            ) : null}

            {!loading && error ? (
              <div className="px-3 py-8 text-center text-sm text-destructive" role="alert">
                {error}
              </div>
            ) : null}

            {!loading && !error && showMinHint ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                Type at least {MIN_QUERY_LENGTH} characters to search.
              </div>
            ) : null}

            {!loading && !error && !query.trim() && recent.length > 0 ? (
              <CommandGroup heading="Recent">
                {recent.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`recent-${item.id}`}
                    onSelect={() => void goTo(item)}
                  >
                    <Clock3 aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {item.kind}
                    </span>
                  </CommandItem>
                ))}
                <CommandItem value="clear-recent" onSelect={clearRecent}>
                  <X aria-hidden="true" />
                  Clear recent searches
                </CommandItem>
              </CommandGroup>
            ) : null}

            {!loading && !error && !query.trim() && recent.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                Search by name, slug, tags, status, or alert title.
              </div>
            ) : null}

            {showEmpty ? (
              <CommandEmpty>No matches for “{debouncedQuery}”.</CommandEmpty>
            ) : null}

            {!loading && !error && results.monitors.length > 0 ? (
              <CommandGroup heading="Monitors">
                {results.monitors.map((monitor) => (
                  <MonitorResult
                    key={monitor.id}
                    monitor={monitor}
                    onSelect={(item) => void goTo(item)}
                  />
                ))}
              </CommandGroup>
            ) : null}

            {!loading && !error && results.runs.length > 0 ? (
              <>
                {results.monitors.length > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading="Runs">
                  {results.runs.map((run) => (
                    <RunResult
                      key={run.id}
                      run={run}
                      onSelect={(item) => void goTo(item)}
                    />
                  ))}
                </CommandGroup>
              </>
            ) : null}

            {!loading && !error && results.alerts.length > 0 ? (
              <>
                {results.monitors.length > 0 || results.runs.length > 0 ? (
                  <CommandSeparator />
                ) : null}
                <CommandGroup heading="Alerts">
                  {results.alerts.map((alert) => (
                    <AlertResult
                      key={alert.id}
                      alert={alert}
                      onSelect={(item) => void goTo(item)}
                    />
                  ))}
                </CommandGroup>
              </>
            ) : null}

            {!loading && !error && results.resources.length > 0 ? (
              <>
                {results.monitors.length > 0 ||
                results.runs.length > 0 ||
                results.alerts.length > 0 ? (
                  <CommandSeparator />
                ) : null}
                <CommandGroup heading="Workspace">
                  {results.resources.map((resource) => (
                    <ResourceResult
                      key={`${resource.kind}-${resource.id}`}
                      resource={resource}
                      onSelect={(item) => void goTo(item)}
                    />
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

function ResourceResult({
  resource,
  onSelect,
}: {
  resource: SearchResourceHit
  onSelect: (item: RecentItem) => void
}) {
  const Icon =
    resource.kind === "BROWSER_MONITOR"
      ? MonitorCheck
      : resource.kind === "APPLICATION" || resource.kind === "SERVICE"
      ? AppWindow
      : resource.kind === "ELF_QUERY" || resource.kind === "ELF_RUN"
        ? Braces
        : resource.kind === "CONFIGURATION"
          ? Settings2
          : Boxes
  return (
    <CommandItem
      value={`resource-${resource.kind}-${resource.id}-${resource.name}`}
      onSelect={() =>
        onSelect({
          id: `resource:${resource.kind}:${resource.id}`,
          label: resource.name,
          kind: "resource",
          resource,
        })
      }
    >
      <Icon aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{resource.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {resource.kind.toLowerCase().replaceAll("_", " ")}
          {resource.context ? ` · ${resource.context}` : ""}
          {resource.status ? ` · ${resource.status.toLowerCase()}` : ""}
        </span>
      </span>
    </CommandItem>
  )
}

function MonitorResult({
  monitor,
  onSelect,
}: {
  monitor: SearchMonitorHit
  onSelect: (item: RecentItem) => void
}) {
  return (
    <CommandItem
      value={`monitor-${monitor.id}-${monitor.name}`}
      onSelect={() =>
        onSelect({
          id: `monitor:${monitor.id}`,
          label: monitor.name,
          kind: "monitor",
          monitorId: monitor.id,
        })
      }
    >
      <Activity aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{monitor.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {monitor.slug}
          {monitor.tags.length ? ` · ${monitor.tags.slice(0, 3).join(", ")}` : ""}
          {` · ${monitor.health.toLowerCase()}`}
        </span>
      </span>
    </CommandItem>
  )
}

function RunResult({
  run,
  onSelect,
}: {
  run: SearchRunHit
  onSelect: (item: RecentItem) => void
}) {
  const label = run.monitorName ? `${run.monitorName} · ${run.status}` : run.status
  return (
    <CommandItem
      value={`run-${run.id}-${run.status}`}
      onSelect={() =>
        onSelect({
          id: `run:${run.id}`,
          label,
          kind: "run",
          monitorId: run.monitorId,
          runId: run.id,
        })
      }
    >
      <Clock3 aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {run.monitorName || "Monitor run"}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {run.status}
          {run.failureCategory ? ` · ${run.failureCategory}` : ""}
          {` · ${run.id.slice(0, 8)}`}
        </span>
      </span>
    </CommandItem>
  )
}

function AlertResult({
  alert,
  onSelect,
}: {
  alert: SearchAlertHit
  onSelect: (item: RecentItem) => void
}) {
  return (
    <CommandItem
      value={`alert-${alert.id}-${alert.title}`}
      onSelect={() =>
        onSelect({
          id: `alert:${alert.id}`,
          label: alert.title,
          kind: "alert",
          alertId: alert.id,
        })
      }
    >
      <CircleAlert aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{alert.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {alert.severity.toLowerCase()} · {alert.state.toLowerCase()}
          {alert.monitorName || alert.applicationName
            ? ` · ${alert.monitorName || alert.applicationName}`
            : ""}
        </span>
      </span>
    </CommandItem>
  )
}
