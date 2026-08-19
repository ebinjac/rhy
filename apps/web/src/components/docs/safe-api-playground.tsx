import { useMemo, useState } from "react"
import { Play, ShieldCheck } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

const safeEndpoints = [
  { label: "Health", path: "/healthz" },
  { label: "Monitors", path: "/api/v1/monitors?limit=20" },
  { label: "Applications", path: "/api/v1/applications?limit=20" },
  { label: "ELF queries", path: "/api/v1/elf/queries?limit=20" },
] as const

const SAME_INSTALLATION = "__same_installation__"

const originPresets = [
  { label: "Local Docker", value: "http://localhost:18080" },
  { label: "Same installation", value: "" },
] as const

export function SafeApiPlayground() {
  const [origin, setOrigin] = useState<string>(originPresets[0].value)
  const [path, setPath] = useState<string>(safeEndpoints[0].path)
  const [token, setToken] = useState("")
  const [response, setResponse] = useState("")
  const [status, setStatus] = useState<"idle" | "running" | "complete">("idle")

  const requestUrl = useMemo(() => `${origin}${path}`, [origin, path])

  async function runRequest() {
    setStatus("running")
    setResponse("")
    try {
      const headers = new Headers({ Accept: "application/json" })
      if (token) headers.set("Authorization", `Bearer ${token}`)
      const result = await fetch(requestUrl, {
        method: "GET",
        headers,
        credentials: "omit",
      })
      const body = await result.text()
      const pretty = prettyJson(body)
      setResponse(`HTTP ${result.status} ${result.statusText}\n\n${pretty}`)
    } catch (error) {
      setResponse(
        `Request failed. Verify the approved origin, CORS policy, and API availability.\n\n${error instanceof Error ? error.message : "Unknown network error"}`
      )
    } finally {
      setStatus("complete")
    }
  }

  return (
    <section className="my-8 rounded-xl border bg-card p-5 text-card-foreground">
      <div className="flex items-start gap-3">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">Safe local playground</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            GET requests only. Tokens stay in component memory and are cleared
            on refresh. Cookies and arbitrary destinations are never sent.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="api-origin">
          API origin
          <Select
            value={origin || SAME_INSTALLATION}
            onValueChange={(value) => {
              if (value == null) return
              setOrigin(value === SAME_INSTALLATION ? "" : value)
            }}
            items={originPresets.map((preset) => ({
              value: preset.value || SAME_INSTALLATION,
              label: preset.label,
            }))}
          >
            <SelectTrigger id="api-origin" className="h-11 w-full font-normal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {originPresets.map((preset) => (
                <SelectItem
                  key={preset.label}
                  value={preset.value || SAME_INSTALLATION}
                >
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="safe-operation">
          Safe operation
          <Select
            value={path}
            onValueChange={(value) => {
              if (value == null) return
              setPath(value)
            }}
            items={safeEndpoints.map((endpoint) => ({
              value: endpoint.path,
              label: endpoint.label,
            }))}
          >
            <SelectTrigger id="safe-operation" className="h-11 w-full font-normal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {safeEndpoints.map((endpoint) => (
                <SelectItem key={endpoint.path} value={endpoint.path}>
                  {endpoint.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <label className="mt-4 grid gap-1.5 text-sm font-medium">
        Bearer token
        <input
          autoComplete="current-password"
          className="h-11 rounded-lg border bg-background px-3 font-mono text-sm font-normal"
          onChange={(event) => setToken(event.target.value)}
          placeholder="Held in memory only"
          type="password"
          value={token}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
          GET {requestUrl}
        </code>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          disabled={status === "running"}
          onClick={() => void runRequest()}
          type="button"
        >
          <Play aria-hidden="true" className="size-4" />
          {status === "running" ? "Running…" : "Send request"}
        </button>
      </div>

      {response ? (
        <pre
          aria-live="polite"
          className="mt-5 max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs leading-5 whitespace-pre-wrap"
        >
          {response}
        </pre>
      ) : null}
    </section>
  )
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
