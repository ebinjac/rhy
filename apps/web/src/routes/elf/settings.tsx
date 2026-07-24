import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
  Save,
  ShieldCheck,
} from "lucide-react"

import {
  getELFSettings,
  saveELFSettings,
  testELFSettings,
} from "@/lib/api-client/elf"

export const Route = createFileRoute("/elf/settings")({
  loader: () => getELFSettings(),
  component: SettingsPage,
})
function SettingsPage() {
  const loaded = Route.useLoaderData()
  const router = useRouter()
  const [baseUrl, setBaseUrl] = useState(loaded?.baseUrl ?? "")
  const [dashboardUrl, setDashboardUrl] = useState(loaded?.dashboardUrl ?? "")
  const [index, setIndex] = useState(loaded?.defaultIndexPattern ?? "")
  const [allowed, setAllowed] = useState(
    (loaded?.allowedIndexPatterns ?? []).join(", ")
  )
  const [timeout, setTimeout] = useState(loaded?.timeoutSeconds ?? 10)
  const [authMode, setAuthMode] = useState<"NONE" | "BASIC" | "BEARER">(
    loaded?.authMode ?? "NONE"
  )
  const [username, setUsername] = useState(loaded?.username ?? "")
  const [secretRef, setSecretRef] = useState(loaded?.credentialSecretRef ?? "")
  const [pending, setPending] = useState<"save" | "test" | "">("")
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState("")
  const data = () => ({
    baseUrl,
    dashboardUrl,
    defaultIndexPattern: index,
    timeoutSeconds: timeout,
    allowedIndexPatterns: allowed
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    tlsProfileId: loaded?.tlsProfileId ?? "",
    proxyProfileId: loaded?.proxyProfileId ?? "",
    authMode,
    username,
    credentialSecretRef: secretRef,
  })
  async function save() {
    setPending("save")
    const response = await saveELFSettings({ data: data() })
    setPending("")
    if (!response.ok) {
      setMessage(response.message)
      return
    }
    setMessage("ELF settings saved.")
    await router.invalidate()
  }
  async function test() {
    setPending("test")
    setResult(null)
    const response = await testELFSettings({ data: data() })
    setPending("")
    if (!response.ok) {
      setMessage(response.message)
      return
    }
    setResult(response.result)
    setMessage("")
  }
  return (
    <main className="mx-auto max-w-[980px] px-4 py-6 md:px-6 md:py-8">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold">
            ELF connection
          </h1>
          {loaded ? (
            <Badge
              className="bg-success-soft text-success-foreground"
              variant="secondary"
            >
              Configured
            </Badge>
          ) : (
            <Badge variant="secondary">Setup required</Badge>
          )}
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Connect Rhythm to the governed ELF Proxy. Local development may point
          directly at the bundled OpenSearch cluster.
        </p>
      </header>
      <div className="mt-7 grid gap-5 md:grid-cols-2">
        <Field
          label="ELF base URL"
          help="Production must use the corporate ELF Proxy."
        >
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://elf-proxy.internal"
          />
        </Field>
        <Field
          label="OpenSearch Dashboards URL"
          help="Shown as an optional investigation link."
        >
          <Input
            value={dashboardUrl}
            onChange={(e) => setDashboardUrl(e.target.value)}
            placeholder="https://dashboards.internal"
          />
        </Field>
        <Field
          label="Default index pattern"
          help="Used only when application, service, and query do not override it."
        >
          <Input
            className="font-mono"
            value={index}
            onChange={(e) => setIndex(e.target.value)}
            placeholder="logs-*"
          />
        </Field>
        <Field
          label="Allowed index patterns"
          help="Comma-separated allowlist; resolved indices must match."
        >
          <Input
            className="font-mono"
            value={allowed}
            onChange={(e) => setAllowed(e.target.value)}
          />
        </Field>
        <Field
          label="Search timeout (seconds)"
          help="Rhythm enforces a maximum of 30 seconds."
        >
          <Input
            type="number"
            min={1}
            max={30}
            value={timeout}
            onChange={(e) => setTimeout(Number(e.target.value))}
          />
        </Field>
        <Field
          label="Authentication"
          help="Credential values are never accepted here."
        >
          <Select
            value={authMode}
            onValueChange={(value) => {
              if (value == null) return
              setAuthMode(value as typeof authMode)
            }}
            items={{
              NONE: "None",
              BEARER: "Bearer token",
              BASIC: "Basic authentication",
            }}
          >
            <SelectTrigger className="mt-0 h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">None</SelectItem>
              <SelectItem value="BEARER">Bearer token</SelectItem>
              <SelectItem value="BASIC">Basic authentication</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {authMode === "BASIC" ? (
          <Field label="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
        ) : null}
        {authMode !== "NONE" ? (
          <Field
            label="Credential secret reference"
            help="Use a secret:// alias from Configuration."
          >
            <Input
              className="font-mono"
              value={secretRef}
              onChange={(e) => setSecretRef(e.target.value)}
              placeholder="secret://elf-token"
            />
          </Field>
        ) : null}
      </div>
      <div className="mt-5 flex items-start gap-2 border-y bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <p>
          Connection tests issue a bounded <code>size: 0</code> search. Debug
          output is masked, redirects are blocked, DNS is revalidated, and raw
          upstream responses are not stored.
        </p>
      </div>
      {message ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="size-4" />
          {message}
        </p>
      ) : null}
      {result ? (
        <div
          className={`mt-4 flex items-start gap-3 rounded-lg p-4 text-sm ${result.reachable ? "bg-success-soft text-success-foreground" : "bg-destructive/5 text-destructive"}`}
        >
          {result.reachable ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <CircleAlert className="size-5" />
          )}
          <div>
            <p className="font-medium">
              {result.reachable ? "Connection succeeded" : "Connection failed"}
            </p>
            <p className="mt-1 text-xs">
              {String(result.message ?? result.clusterResponse ?? "")} ·{" "}
              {String(result.durationMs)} ms
            </p>
          </div>
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        {dashboardUrl ? (
          <a
            className={buttonVariants({ variant: "outline" })}
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink />
            Open Dashboards
          </a>
        ) : null}
        <Button
          variant="outline"
          disabled={!!pending || !baseUrl || !index}
          onClick={test}
        >
          {pending === "test" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <FlaskConical />
          )}
          Test connection
        </Button>
        <Button disabled={!!pending || !baseUrl || !index} onClick={save}>
          {pending === "save" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Save />
          )}
          Save settings
        </Button>
      </div>
    </main>
  )
}
function Field({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <label className="text-xs font-medium">
      {label}
      <span className="mt-1.5 block">{children}</span>
      {help ? (
        <span className="mt-1.5 block font-normal text-muted-foreground">
          {help}
        </span>
      ) : null}
    </label>
  )
}
