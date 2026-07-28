import { useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  BellRing,
  LoaderCircle,
  Mail,
  Plus,
  Send,
  ShieldCheck,
  Webhook,
} from "lucide-react"

import {
  SecretCredentialField,
  SecretPicker,
  secretAliasFromRef,
  toSecretRef
  
} from "@/features/configuration/secret-credential-field"
import type {SecretInputMode} from "@/features/configuration/secret-credential-field";
import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"
import {
  createConfigurationProfile,
  sendNotificationTestEmail,
} from "@/lib/api-client/monitors"

type ChannelType = "EMAIL" | "SLACK" | "WEBHOOK"
type AuthMode = "none" | "credentials" | "secrets"

const channelLabels: Record<ChannelType, string> = {
  EMAIL: "Email (SMTP)",
  SLACK: "Slack webhook",
  WEBHOOK: "Generic webhook",
}

const authModeLabels: Record<AuthMode, string> = {
  none: "No authentication",
  credentials: "Enter username & password",
  secrets: "Use existing secret",
}

export function NotificationsPanel({
  profiles,
  secrets,
  onCreated,
}: {
  profiles: ConfigurationProfileContract[]
  secrets: ConfigurationProfileContract[]
  onCreated: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [channelType, setChannelType] = useState<ChannelType>("EMAIL")
  const [smtpHost, setSmtpHost] = useState("mailpit")
  const [smtpPort, setSmtpPort] = useState("1025")
  const [from, setFrom] = useState("rhythm-alerts@localhost")
  const [fallbackTo, setFallbackTo] = useState("")
  const [authMode, setAuthMode] = useState<AuthMode>("none")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [usernameSecretAlias, setUsernameSecretAlias] = useState("")
  const [passwordSecretAlias, setPasswordSecretAlias] = useState("")
  const [urlMode, setUrlMode] = useState<SecretInputMode>("secret")
  const [urlValue, setUrlValue] = useState("")
  const [urlSecretAlias, setUrlSecretAlias] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [testTo, setTestTo] = useState("")
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testMessage, setTestMessage] = useState("")

  const emailProfiles = profiles.filter(
    (profile) => profile.profileType.toUpperCase() === "EMAIL"
  )

  function resetForm() {
    setName("")
    setDescription("")
    setAuthMode("none")
    setUsername("")
    setPassword("")
    setUsernameSecretAlias("")
    setPasswordSecretAlias("")
    setUrlMode("secret")
    setUrlValue("")
    setUrlSecretAlias("")
    setMessage("")
  }

  async function create() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setMessage("Give this channel a name.")
      return
    }
    let config: Record<string, unknown>
    if (channelType === "EMAIL") {
      const port = Number(smtpPort)
      if (!smtpHost.trim() || !from.trim()) {
        setMessage("SMTP host and from address are required.")
        return
      }
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        setMessage("SMTP port must be a valid number.")
        return
      }
      const to = fallbackTo
        .split(/[,;\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      config = {
        smtpHost: smtpHost.trim(),
        smtpPort: port,
        from: from.trim(),
        ...(to.length ? { to } : {}),
      }
      if (authMode === "credentials") {
        const user = username.trim()
        if (!user && !password) {
          setMessage(
            "Enter a username/password, switch to an existing secret, or choose no authentication."
          )
          return
        }
        if (user) config.username = user
        if (password) config.password = password
      } else if (authMode === "secrets") {
        if (!usernameSecretAlias && !passwordSecretAlias) {
          setMessage("Pick at least one secret, or choose no authentication.")
          return
        }
        if (usernameSecretAlias) {
          config.usernameSecretRef = toSecretRef(usernameSecretAlias)
        }
        if (passwordSecretAlias) {
          config.passwordSecretRef = toSecretRef(passwordSecretAlias)
        }
      }
    } else if (urlMode === "value") {
      const url = urlValue.trim()
      if (!url) {
        setMessage("Enter a webhook URL, or pick an existing secret.")
        return
      }
      config = { url }
    } else {
      if (!urlSecretAlias.trim()) {
        setMessage("Pick a secret that stores the webhook URL.")
        return
      }
      config = { urlSecretRef: toSecretRef(urlSecretAlias) }
    }
    setPending(true)
    const result = await createConfigurationProfile({
      data: {
        kind: "notifications",
        name: trimmedName,
        description: description.trim(),
        profileType: channelType,
        config,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setOpen(false)
    resetForm()
    await onCreated()
  }

  async function sendTest(profileId: string) {
    const destination = testTo.trim()
    if (!destination.includes("@")) {
      setTestMessage("Enter a destination email for the test message.")
      return
    }
    setTestingId(profileId)
    setTestMessage("")
    const result = await sendNotificationTestEmail({
      data: { profileId, to: destination },
    })
    setTestingId(null)
    setTestMessage(
      result.ok
        ? `Test email sent to ${destination}. Open the local Mailpit inbox to inspect it.`
        : result.message
    )
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border bg-muted/15 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <BellRing className="size-4 text-muted-foreground" />
              <h2 className="font-medium">Alert delivery channels</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Configure how Rhythm sends alert email and chat notifications.
              SMTP settings are global; each application chooses its own
              destination addresses under Applications.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>
                Local Compose uses the in-stack{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  mailpit:1025
                </code>{" "}
                SMTP catcher with no authentication. View captured messages at{" "}
                <a
                  className="font-medium text-primary underline underline-offset-4"
                  href="http://localhost:18025"
                  rel="noreferrer"
                  target="_blank"
                >
                  localhost:18025
                </a>
                .
              </li>
              <li>
                Prefer application recipients for routing; optional fallback{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  to
                </code>{" "}
                addresses on the channel catch alerts without an app mapping.
              </li>
              <li>
                SMTP credentials and webhook URLs can be typed here (encrypted at
                rest) or linked from Secrets — values are never shown again
                after save.
              </li>
            </ul>
          </div>
          <Button onClick={() => setOpen((current) => !current)}>
            <Plus /> {open ? "Close form" : "New channel"}
          </Button>
        </div>
      </section>

      {open ? (
        <section className="rounded-xl border p-5">
          <h3 className="font-medium">Create notification channel</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with Email for SMTP alert delivery, or add Slack/webhook
            endpoints that resolve through Secrets.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Local SMTP"
              />
            </Field>
            <Field label="Channel type">
              <Select
                value={channelType}
                onValueChange={(next) => {
                  if (next == null) return
                  setChannelType(next)
                }}
                items={channelLabels}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMAIL">Email (SMTP)</SelectItem>
                  <SelectItem value="SLACK">Slack webhook</SelectItem>
                  <SelectItem value="WEBHOOK">Generic webhook</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Description" wide>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Primary alert email path for local development"
              />
            </Field>
            {channelType === "EMAIL" ? (
              <>
                <Field
                  label="SMTP host"
                  help="Use mailpit for local Docker. Use your provider hostname in production."
                >
                  <Input
                    className="font-mono"
                    value={smtpHost}
                    onChange={(event) => setSmtpHost(event.target.value)}
                    placeholder="mailpit"
                  />
                </Field>
                <Field label="SMTP port">
                  <Input
                    className="font-mono"
                    value={smtpPort}
                    onChange={(event) => setSmtpPort(event.target.value)}
                    placeholder="1025"
                  />
                </Field>
                <Field label="From address">
                  <Input
                    className="font-mono"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    placeholder="rhythm-alerts@localhost"
                  />
                </Field>
                <Field
                  label="Fallback recipients (optional)"
                  help="Comma-separated. Used when an alert has no application destination emails."
                >
                  <Input
                    value={fallbackTo}
                    onChange={(event) => setFallbackTo(event.target.value)}
                    placeholder="oncall@example.com"
                  />
                </Field>
                <Field
                  label="SMTP authentication"
                  help="Mailpit needs no authentication. Production providers usually require credentials."
                  wide
                >
                  <Select
                    value={authMode}
                    onValueChange={(next) => {
                      if (next == null) return
                      setAuthMode(next)
                    }}
                    items={authModeLabels}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No authentication</SelectItem>
                      <SelectItem value="credentials">
                        Enter username &amp; password
                      </SelectItem>
                      <SelectItem value="secrets">
                        Use existing secret
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {authMode === "credentials" ? (
                  <>
                    <Field
                      label="Username"
                      help="Stored encrypted on this channel. Leave empty if the provider only needs a password."
                    >
                      <Input
                        className="font-mono"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="smtp-user"
                        autoComplete="off"
                      />
                    </Field>
                    <Field
                      label="Password"
                      help="Encrypted at rest. Never returned after save."
                    >
                      <Input
                        className="font-mono"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="SMTP password"
                        autoComplete="new-password"
                      />
                    </Field>
                  </>
                ) : null}
                {authMode === "secrets" ? (
                  <>
                    <Field
                      label="Username secret"
                      help="Pick an alias from Configuration → Secrets."
                    >
                      <SecretPicker
                        secrets={secrets}
                        value={usernameSecretAlias}
                        onValueChange={setUsernameSecretAlias}
                      />
                    </Field>
                    <Field
                      label="Password secret"
                      help="The secret value itself is never shown here."
                    >
                      <SecretPicker
                        secrets={secrets}
                        value={passwordSecretAlias}
                        onValueChange={setPasswordSecretAlias}
                      />
                    </Field>
                  </>
                ) : null}
              </>
            ) : (
              <SecretCredentialField
                label="Webhook URL"
                help="Paste the full webhook URL (encrypted on save) or pick a Secrets alias."
                secrets={secrets}
                mode={urlMode}
                onModeChange={setUrlMode}
                value={urlValue}
                onValueChange={setUrlValue}
                secretAlias={urlSecretAlias}
                onSecretAliasChange={setUrlSecretAlias}
                password={false}
                valuePlaceholder="https://hooks.slack.com/services/…"
                modeLabelsOverride={{
                  value: "Enter webhook URL",
                  secret: "Use existing secret",
                }}
                wide
              />
            )}
          </div>
          {channelType === "EMAIL" ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Auth is optional. Typed
              passwords are encrypted with the same key as Secrets; existing
              secret aliases are linked without typing{" "}
              <code className="font-mono">secret://</code>.
            </p>
          ) : null}
          {message ? (
            <p className="mt-3 text-xs text-destructive">{message}</p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button disabled={pending} onClick={() => void create()}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}{" "}
              Create channel
            </Button>
          </div>
        </section>
      ) : null}

      {emailProfiles.length ? (
        <section className="rounded-xl border p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="font-medium">Send test email</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Verifies SMTP connectivity for an EMAIL channel without opening
                a real alert. Local messages appear in{" "}
                <a
                  className="font-medium text-primary underline underline-offset-4"
                  href="http://localhost:18025"
                  rel="noreferrer"
                  target="_blank"
                >
                  Mailpit
                </a>
                .
              </p>
            </div>
            <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
              <Input
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
                placeholder="you@example.com"
                className="font-mono"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {emailProfiles.map((profile) => (
              <Button
                key={profile.id}
                variant="secondary"
                disabled={testingId === profile.id}
                onClick={() => void sendTest(profile.id)}
              >
                {testingId === profile.id ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Send />
                )}
                Test {profile.name}
              </Button>
            ))}
          </div>
          {testMessage ? (
            <p
              className={`mt-3 text-xs ${testMessage.includes("sent") ? "text-muted-foreground" : "text-destructive"}`}
            >
              {testMessage}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {profiles.map((profile) => {
          const type = profile.profileType.toUpperCase() as ChannelType
          const isEmail = type === "EMAIL"
          const host = String(profile.config.smtpHost ?? "")
          const port = profile.config.smtpPort
          const fromAddress = String(profile.config.from ?? "")
          const fallback = Array.isArray(profile.config.to)
            ? profile.config.to.map(String).join(", ")
            : ""
          const hasPassword =
            profile.config.hasPassword === true ||
            Boolean(profile.config.passwordSecretRef)
          const hasUsername =
            profile.config.hasUsername === true ||
            Boolean(profile.config.usernameSecretRef)
          const passwordViaSecret = secretAliasFromRef(
            profile.config.passwordSecretRef
              ? String(profile.config.passwordSecretRef)
              : ""
          )
          const urlViaSecret = secretAliasFromRef(
            profile.config.urlSecretRef
              ? String(profile.config.urlSecretRef)
              : ""
          )
          const hasUrl =
            profile.config.hasUrl === true || Boolean(profile.config.urlSecretRef)
          return (
            <article className="rounded-xl border p-5" key={profile.id}>
              <div className="flex items-start gap-3">
                <div className="grid size-9 place-items-center rounded-lg bg-muted">
                  {isEmail ? (
                    <Mail className="size-4" />
                  ) : (
                    <Webhook className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-medium">{profile.name}</h2>
                    <Badge variant="secondary">
                      {channelLabels[type] ?? profile.profileType}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {profile.description || "No description"}
                  </p>
                  {isEmail ? (
                    <div className="mt-3 space-y-1 font-mono text-xs text-muted-foreground">
                      <p>
                        {host || "host?"}
                        {port != null ? `:${String(port)}` : ""}
                      </p>
                      <p>from {fromAddress || "—"}</p>
                      <p>
                        fallback{" "}
                        {fallback || "none — use application recipients"}
                      </p>
                      {hasPassword || hasUsername ? (
                        <p className="flex items-center gap-1">
                          <ShieldCheck className="size-3.5" />
                          {passwordViaSecret
                            ? `auth via secret ${passwordViaSecret}`
                            : "•••• (saved)"}
                        </p>
                      ) : (
                        <p>auth none</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 flex items-center gap-1 font-mono text-xs text-muted-foreground">
                      <ShieldCheck className="size-3.5" />
                      {urlViaSecret
                        ? `url via secret ${urlViaSecret}`
                        : hasUrl
                          ? "•••• (saved)"
                          : "url not configured"}
                    </p>
                  )}
                </div>
              </div>
            </article>
          )
        })}
        {!profiles.length ? (
          <div className="col-span-full rounded-xl border border-dashed px-6 py-14 text-center">
            <Mail className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 font-medium">No SMTP configured</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Create an Email channel to deliver monitor and OpenSearch alerts.
              Local Compose automatically seeds{" "}
              <code className="font-mono text-xs">mailpit:1025</code> from
              environment defaults on API startup.
            </p>
            <Button className="mt-5" onClick={() => setOpen(true)}>
              <Plus /> Configure SMTP
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Field({
  label,
  help,
  wide,
  children,
}: {
  label: string
  help?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`text-xs font-medium ${wide ? "md:col-span-2" : ""}`}>
      {label}
      <span className="mt-2 block">{children}</span>
      {help ? (
        <span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">
          {help}
        </span>
      ) : null}
    </label>
  )
}
