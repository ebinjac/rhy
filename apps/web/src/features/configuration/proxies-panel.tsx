import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Gauge,
  Globe2,
  KeyRound,
  LoaderCircle,
  Network,
  Plus,
  Route,
  ShieldCheck,
  TestTube2,
  Trash2,
  X,
} from "lucide-react"

import {
  SecretPicker,
  secretAliasFromRef,
  toSecretRef,
} from "@/features/configuration/secret-credential-field"
import { DeleteProfileDialog } from "@/features/configuration/guided-profile-shared"
import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"
import {
  createConfigurationProfile,
  deleteConfigurationProfile,
  saveConfigurationProfile,
} from "@/lib/api-client/monitors"
import { testProxyProfile } from "@/lib/api-client/proxies"
import type { ProxyTestResult } from "@/lib/api-client/proxies"
import { toast } from "@workspace/ui/components/sonner"

type ProxyScheme = "HTTP" | "HTTPS" | "SOCKS5"

const protocols: Array<{
  value: ProxyScheme
  title: string
  description: string
  defaultPort: string
}> = [
  {
    value: "HTTP",
    title: "HTTP",
    description: "Standard forward proxy for HTTP and HTTPS targets.",
    defaultPort: "8080",
  },
  {
    value: "HTTPS",
    title: "HTTPS",
    description: "TLS-encrypted connection from Rhythm to the proxy.",
    defaultPort: "443",
  },
  {
    value: "SOCKS5",
    title: "SOCKS5",
    description: "Socket-level routing for HTTP and HTTPS requests.",
    defaultPort: "1080",
  },
]

export function ProxiesPanel({
  profiles,
  secrets,
  onChanged,
}: {
  profiles: ConfigurationProfileContract[]
  secrets: ConfigurationProfileContract[]
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ConfigurationProfileContract | null>(
    null
  )
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [scheme, setScheme] = useState<ProxyScheme>("HTTP")
  const [proxyUrl, setProxyUrl] = useState("")
  const [noProxy, setNoProxy] = useState("")
  const [usernameAlias, setUsernameAlias] = useState("")
  const [passwordAlias, setPasswordAlias] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [testingProfile, setTestingProfile] =
    useState<ConfigurationProfileContract | null>(null)
  const [testTarget, setTestTarget] = useState("https://example.com")
  const [testPending, setTestPending] = useState(false)
  const [testMessage, setTestMessage] = useState("")
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null)
  const [deleteTarget, setDeleteTarget] =
    useState<ConfigurationProfileContract | null>(null)
  const [deleting, setDeleting] = useState(false)

  function resetForm() {
    setEditing(null)
    setName("")
    setDescription("")
    setScheme("HTTP")
    setProxyUrl("")
    setNoProxy("")
    setUsernameAlias("")
    setPasswordAlias("")
    setMessage("")
  }

  function beginCreate() {
    resetForm()
    setOpen(true)
  }

  function beginEdit(profile: ConfigurationProfileContract) {
    setEditing(profile)
    setName(profile.name)
    setDescription(profile.description ?? "")
    setScheme(asScheme(textValue(profile.config.scheme) || profile.profileType))
    setProxyUrl(textValue(profile.config.url))
    setNoProxy(textValue(profile.config.noProxy))
    setUsernameAlias(
      secretAliasFromRef(textValue(profile.config.usernameSecretRef))
    )
    setPasswordAlias(
      secretAliasFromRef(textValue(profile.config.passwordSecretRef))
    )
    setMessage("")
    setOpen(true)
  }

  function chooseScheme(next: ProxyScheme) {
    setScheme(next)
    const current = proxyUrl.trim()
    if (!current || /^(https?|socks5h?):\/\/$/i.test(current)) {
      setProxyUrl(`${next.toLowerCase()}://`)
      return
    }
    setProxyUrl(
      current.replace(/^(https?|socks5h?):\/\//i, `${next.toLowerCase()}://`)
    )
  }

  async function save() {
    if (!name.trim()) {
      setMessage("Enter a recognizable profile name.")
      return
    }
    if (!proxyUrl.trim()) {
      setMessage("Enter the proxy endpoint URL.")
      return
    }
    setPending(true)
    setMessage("")
    const data = {
      kind: "proxies" as const,
      name: name.trim(),
      description: description.trim(),
      profileType: scheme,
      config: {
        url: proxyUrl.trim(),
        noProxy,
        usernameSecretRef: toSecretRef(usernameAlias),
        passwordSecretRef: toSecretRef(passwordAlias),
      },
    }
    const result = editing
      ? await saveConfigurationProfile({
          data: {
            ...data,
            profileId: editing.id,
            active: true,
          },
        })
      : await createConfigurationProfile({ data })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setOpen(false)
    resetForm()
    await onChanged()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteConfigurationProfile({
      data: { kind: "proxies", profileId: deleteTarget.id },
    })
    setDeleting(false)
    if (!result.ok) {
      toast.error(result.message)
      setMessage(result.message)
      return
    }
    toast.success(`Deleted “${deleteTarget.name}”.`)
    if (testingProfile?.id === deleteTarget.id) setTestingProfile(null)
    setDeleteTarget(null)
    await onChanged()
  }

  function beginTest(profile: ConfigurationProfileContract) {
    setTestingProfile(profile)
    setTestMessage("")
    setTestResult(null)
  }

  async function runTest() {
    if (!testingProfile) return
    let parsed: URL
    try {
      parsed = new URL(testTarget)
    } catch {
      setTestMessage("Enter a valid HTTP or HTTPS target URL.")
      return
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setTestMessage("The test target must use HTTP or HTTPS.")
      return
    }
    setTestPending(true)
    setTestMessage("")
    setTestResult(null)
    const response = await testProxyProfile({
      data: { profileId: testingProfile.id, targetUrl: parsed.toString() },
    })
    setTestPending(false)
    if (!response.ok) {
      setTestMessage(response.message)
      return
    }
    setTestResult(response.result)
  }

  const bypassRules = parseBypassRules(noProxy)

  return (
    <div className="mt-6 space-y-6">
      <section className="overflow-hidden rounded-xl border">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2">
              <Route className="size-4 text-primary" />
              <h2 className="font-medium">Outbound proxy profiles</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Route monitor and ELF traffic through a governed HTTP, HTTPS, or
              SOCKS5 proxy. Credentials stay in the secret library, while bypass
              rules make trusted internal destinations connect directly.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" /> No credentials in
                URLs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" /> Connectivity testing
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" /> Explicit bypass
                policy
              </span>
            </div>
          </div>
          <Button onClick={open ? () => setOpen(false) : beginCreate}>
            {open ? <X /> : <Plus />}
            {open ? "Close" : "New proxy profile"}
          </Button>
        </div>
        <div className="border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
          A proxy profile changes the network route only. TLS verification,
          client certificates, request authentication, and capture policy remain
          configured independently.
        </div>
      </section>

      {open ? (
        <section className="rounded-xl border" aria-labelledby="proxy-form">
          <div className="border-b px-5 py-4">
            <h3 id="proxy-form" className="font-medium">
              {editing ? `Edit ${editing.name}` : "Create proxy profile"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the egress endpoint, optional secret-backed credentials, and
              destinations that should bypass it.
            </p>
          </div>
          <div className="space-y-6 p-5">
            <fieldset>
              <legend className="text-sm font-medium">Proxy protocol</legend>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {protocols.map((protocol) => {
                  const selected = scheme === protocol.value
                  return (
                    <button
                      key={protocol.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => chooseScheme(protocol.value)}
                      className={`min-h-24 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "hover:border-foreground/25 hover:bg-muted/30"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Network
                          className={`size-4 ${selected ? "text-primary" : ""}`}
                        />
                        {protocol.title}
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                        {protocol.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Profile name" required>
                <Input
                  aria-label="Profile name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Corporate production egress"
                />
              </Field>
              <Field label="Description">
                <Input
                  aria-label="Description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Routes payments monitors through the corporate proxy"
                />
              </Field>
              <Field
                label="Proxy endpoint"
                help={`Include the scheme and host. The common ${scheme} port is ${
                  protocols.find((item) => item.value === scheme)?.defaultPort
                }.`}
                wide
                required
              >
                <Input
                  aria-label="Proxy endpoint"
                  className="font-mono"
                  value={proxyUrl}
                  onChange={(event) => setProxyUrl(event.target.value)}
                  placeholder={`${scheme.toLowerCase()}://proxy.internal:${
                    protocols.find((item) => item.value === scheme)?.defaultPort
                  }`}
                  spellCheck={false}
                />
              </Field>
            </div>

            <div className="rounded-lg border bg-muted/15 p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                <h4 className="text-sm font-medium">Proxy authentication</h4>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional. Select secret aliases instead of placing credentials
                in the proxy URL.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Username secret">
                  <SecretPicker
                    ariaLabel="Proxy username secret"
                    secrets={secrets}
                    value={usernameAlias}
                    onValueChange={setUsernameAlias}
                    placeholder="No username"
                  />
                </Field>
                <Field label="Password secret">
                  <SecretPicker
                    ariaLabel="Proxy password secret"
                    secrets={secrets}
                    value={passwordAlias}
                    onValueChange={setPasswordAlias}
                    placeholder="No password"
                  />
                </Field>
              </div>
              {!secrets.length ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  No reusable secrets exist.{" "}
                  <Link
                    to="/configuration"
                    search={{ kind: "secrets" }}
                    className="font-medium text-primary hover:underline"
                  >
                    Create a secret
                  </Link>{" "}
                  before configuring authenticated proxy access.
                </p>
              ) : null}
            </div>

            <Field
              label="Bypass proxy for"
              help="Comma- or line-separated exact hosts, IP addresses, wildcard domains such as *.internal, or * to bypass every target."
            >
              <Textarea aria-label="Bypass proxy for"
                className="min-h-24 font-mono"
                value={noProxy}
                onChange={(event) => setNoProxy(event.target.value)}
                placeholder={"localhost, 127.0.0.1\n*.corp.internal"}
                spellCheck={false}
              />
            </Field>
            {bypassRules.length ? (
              <div className="flex flex-wrap gap-2" aria-label="Bypass rules">
                {bypassRules.map((rule) => (
                  <Badge key={rule} variant="outline" className="font-mono">
                    {rule}
                  </Badge>
                ))}
              </div>
            ) : null}

            {message ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {message}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t bg-muted/15 px-5 py-4 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={() => void save()}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Route />}
              {pending
                ? "Validating…"
                : editing
                  ? "Save profile"
                  : "Create profile"}
            </Button>
          </div>
        </section>
      ) : null}

      {testingProfile ? (
        <section className="rounded-xl border" aria-labelledby="proxy-test">
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <h3 id="proxy-test" className="font-medium">
                Test {testingProfile.name}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Rhythm will make a bounded GET request using the same proxy,
                credential resolution, DNS policy, and timeout path as a
                monitor.
              </p>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close proxy test"
              onClick={() => setTestingProfile(null)}
            >
              <X />
            </Button>
          </div>
          <div className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Field label="Test target">
                <Input aria-label="Test target"
                  className="min-w-0 font-mono sm:w-[420px]"
                  value={testTarget}
                  onChange={(event) => setTestTarget(event.target.value)}
                  placeholder="https://example.com/health"
                />
              </Field>
              <Button
                className="self-end"
                disabled={testPending}
                onClick={() => void runTest()}
              >
                {testPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <TestTube2 />
                )}
                {testPending ? "Testing route…" : "Run test"}
              </Button>
            </div>
            {testMessage ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {testMessage}
              </p>
            ) : null}
            {testResult ? <ProxyTestEvidence result={testResult} /> : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="stored-proxies">
        <div>
          <h2 id="stored-proxies" className="font-medium">
            Stored profiles
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {profiles.length} {profiles.length === 1 ? "profile" : "profiles"}{" "}
            available to monitors and integrations.
          </p>
        </div>
        <div className="mt-4 divide-y overflow-hidden rounded-xl border">
          {profiles.map((profile) => (
            <ProxyRow
              key={profile.id}
              profile={profile}
              onEdit={() => beginEdit(profile)}
              onTest={() => beginTest(profile)}
              onDelete={() => setDeleteTarget(profile)}
            />
          ))}
          {!profiles.length ? (
            <div className="px-5 py-14 text-center">
              <Route className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">No proxy profiles yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Create a governed egress route, test it, then select the profile
                from a monitor’s Proxy settings.
              </p>
              <Button className="mt-5" onClick={beginCreate}>
                <Plus /> New proxy profile
              </Button>
            </div>
          ) : null}
        </div>
      </section>
      <DeleteProfileDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null)
        }}
        title={`Delete “${deleteTarget?.name ?? "proxy"}”?`}
        description="Monitors and ELF connections using this profile may stop working. This cannot be undone."
        confirming={deleting}
        onConfirm={() => void confirmDelete()}
        confirmLabel="Delete proxy"
      />
    </div>
  )
}

function ProxyRow({
  profile,
  onEdit,
  onTest,
  onDelete,
}: {
  profile: ConfigurationProfileContract
  onEdit: () => void
  onTest: () => void
  onDelete: () => void
}) {
  const config = profile.config
  const host = textValue(config.host)
  const port = textValue(config.port)
  const endpoint = host
    ? `${textValue(config.scheme).toLowerCase()}://${host}:${port}`
    : textValue(config.url)
  const authenticated =
    booleanValue(config.authConfigured) ||
    Boolean(
      textValue(config.usernameSecretRef) || textValue(config.passwordSecretRef)
    )
  const bypassCount =
    numberValue(config.noProxyCount) ||
    parseBypassRules(textValue(config.noProxy)).length
  return (
    <article className="p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary">
            <Network className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{profile.name}</h3>
              <Badge variant="secondary">
                {textValue(config.scheme) || profile.profileType}
              </Badge>
              {authenticated ? (
                <Badge variant="outline">
                  <KeyRound /> Authenticated
                </Badge>
              ) : (
                <Badge variant="outline">No authentication</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile.description || "No description"}
            </p>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
              <Detail
                icon={Globe2}
                label="Endpoint"
                value={endpoint || "Legacy profile"}
                mono
              />
              <Detail
                icon={ShieldCheck}
                label="Credentials"
                value={authenticated ? "Secret-backed" : "Not configured"}
              />
              <Detail
                icon={Route}
                label="Bypass rules"
                value={`${bypassCount} configured`}
              />
            </dl>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onTest}>
            <TestTube2 /> Test route
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
    </article>
  )
}

function ProxyTestEvidence({ result }: { result: ProxyTestResult }) {
  return (
    <div
      className={`mt-5 rounded-lg border p-4 ${
        result.success
          ? "border-success/30 bg-success/5"
          : "border-destructive/30 bg-destructive/5"
      }`}
      role="status"
    >
      <div className="flex items-start gap-3">
        {result.success ? (
          <Check className="mt-0.5 size-5 shrink-0 text-success" />
        ) : (
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {result.success ? "Proxy route is working" : "Proxy test failed"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{result.message}</p>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <Detail
              icon={Network}
              label="Route"
              value={
                result.bypassed
                  ? "Direct (bypass matched)"
                  : `${result.proxyScheme} proxy`
              }
            />
            <Detail
              icon={Gauge}
              label="HTTP status"
              value={
                result.statusCode ? String(result.statusCode) : "No response"
              }
            />
            <Detail
              icon={Clock3}
              label="Duration"
              value={`${result.durationMs} ms`}
            />
            <Detail
              icon={ArrowRight}
              label="Proxy endpoint"
              value={`${result.proxyHost}:${result.proxyPort}`}
              mono
            />
          </dl>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  help,
  required,
  wide,
  children,
}: {
  label: string
  help?: string
  required?: boolean
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`text-sm font-medium ${wide ? "md:col-span-2" : ""}`}>
      {label}
      {required ? <span className="ml-1 text-destructive">*</span> : null}
      <span className="mt-2 block">{children}</span>
      {help ? (
        <span className="mt-1.5 block text-xs font-normal text-muted-foreground">
          {help}
        </span>
      ) : null}
    </label>
  )
}

function Detail({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Network
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </dt>
      <dd className={`mt-1 truncate ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  )
}

function parseBypassRules(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n\r]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function asScheme(value: string): ProxyScheme {
  if (value === "HTTPS" || value === "SOCKS5" || value === "SOCKS5H") {
    return value === "SOCKS5H" ? "SOCKS5" : value
  }
  return "HTTP"
}
