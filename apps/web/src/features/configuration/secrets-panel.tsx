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
import { toast } from "@workspace/ui/components/sonner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react"

import { DeleteProfileDialog } from "@/features/configuration/guided-profile-shared"
import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"
import {
  createConfigurationProfile,
  deleteConfigurationProfile,
} from "@/lib/api-client/monitors"

type SecretProvider = "LOCAL" | "ENV" | "VAULT"

const providerLabels: Record<SecretProvider, string> = {
  LOCAL: "Stored (encrypted)",
  ENV: "Environment variable",
  VAULT: "HashiCorp Vault",
}

export function SecretsPanel({
  profiles,
  onChanged,
}: {
  profiles: ConfigurationProfileContract[]
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [provider, setProvider] = useState<SecretProvider>("LOCAL")
  const [value, setValue] = useState("")
  const [externalPath, setExternalPath] = useState("")
  const [field, setField] = useState("value")
  const [namespace, setNamespace] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [deleteTarget, setDeleteTarget] =
    useState<ConfigurationProfileContract | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function create() {
    const alias = name.trim()
    if (!alias) {
      setMessage("Choose a stable alias (used as secret://alias).")
      return
    }
    const config =
      provider === "LOCAL"
        ? { provider: "LOCAL", value }
        : provider === "ENV"
          ? { provider: "ENV", externalPath: externalPath.trim() }
          : {
              provider: "VAULT",
              externalPath: externalPath.trim(),
              ...(field.trim() ? { field: field.trim() } : {}),
              ...(namespace.trim() ? { namespace: namespace.trim() } : {}),
            }
    if (provider === "LOCAL" && !value) {
      setMessage("Enter the secret value to encrypt and store.")
      return
    }
    if (provider !== "LOCAL" && !externalPath.trim()) {
      setMessage(
        provider === "ENV"
          ? "Enter the environment variable name on the API process."
          : "Enter the Vault KV path."
      )
      return
    }
    setPending(true)
    const result = await createConfigurationProfile({
      data: {
        kind: "secrets",
        name: alias,
        description: description.trim(),
        config,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setOpen(false)
    setName("")
    setDescription("")
    setValue("")
    setExternalPath("")
    setField("value")
    setNamespace("")
    setMessage("")
    await onChanged()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteConfigurationProfile({
      data: { kind: "secrets", profileId: deleteTarget.id },
    })
    setDeleting(false)
    if (!result.ok) {
      toast.error(result.message)
      setMessage(result.message)
      return
    }
    toast.success(`Deleted “${deleteTarget.name}”.`)
    setDeleteTarget(null)
    await onChanged()
  }

  return (
    <div className="mt-6 space-y-6">
      <div aria-live="polite" className="sr-only" role="status">
        {message}
      </div>
      <section className="rounded-xl border bg-muted/15 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <h2 className="font-medium">What secrets are</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Secrets are named aliases for credentials. Rhythm never returns
              decrypted values in the configuration UI or list APIs. Stored
              secrets are encrypted with AES-GCM before they reach the database;
              environment and Vault secrets keep only a path reference.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>
                Monitors &amp; auth fields:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  secret://api-token
                </code>
              </li>
              <li>
                Pre-request scripts:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  await pm.vault.get(&quot;api-token&quot;)
                </code>
              </li>
              <li>
                Notification / telemetry profiles: point at the same{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  secret://
                </code>{" "}
                alias
              </li>
            </ul>
          </div>
          <Button onClick={() => setOpen((current) => !current)}>
            <Plus /> {open ? "Close form" : "New secret"}
          </Button>
        </div>
      </section>

      {open ? (
        <section className="rounded-xl border p-5">
          <h3 className="font-medium">Create secret</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a provider, then fill only the fields for that provider. The
            alias becomes the name you reference from monitors and scripts.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field
              label="Alias"
              help="Stable name used as secret://alias and pm.vault.get(alias)."
            >
              <Input aria-label="Alias"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="api-token"
                className="font-mono"
              />
            </Field>
            <Field label="Provider">
              <Select
                value={provider}
                onValueChange={(next) => {
                  if (next == null) return
                  setProvider(next)
                }}
                items={providerLabels}
              >
                <SelectTrigger aria-label="Provider" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOCAL">
                    Stored (encrypted in Rhythm)
                  </SelectItem>
                  <SelectItem value="ENV">Environment variable</SelectItem>
                  <SelectItem value="VAULT">HashiCorp Vault</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Description" wide>
              <Input aria-label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Used by payments monitors for HMAC signing"
              />
            </Field>
            {provider === "LOCAL" ? (
              <Field
                label="Secret value"
                help="Encrypted with AES-GCM before storage. Never shown again after create."
                wide
              >
                <Textarea aria-label="Secret value"
                  className="min-h-24 font-mono"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="Paste the credential once"
                  autoComplete="new-password"
                />
              </Field>
            ) : null}
            {provider === "ENV" ? (
              <Field
                label="Environment variable"
                help="Must be set on the API process (or Docker compose environment)."
                wide
              >
                <Input aria-label="Environment variable"
                  className="font-mono"
                  value={externalPath}
                  onChange={(event) => setExternalPath(event.target.value)}
                  placeholder="PAYMENTS_API_TOKEN"
                />
              </Field>
            ) : null}
            {provider === "VAULT" ? (
              <>
                <Field
                  label="Vault path"
                  help="KV v1 or v2 path relative to the Vault mount."
                  wide
                >
                  <Input aria-label="Vault path"
                    className="font-mono"
                    value={externalPath}
                    onChange={(event) => setExternalPath(event.target.value)}
                    placeholder="secret/data/rhythm/service"
                  />
                </Field>
                <Field label="Field">
                  <Input aria-label="Field"
                    className="font-mono"
                    value={field}
                    onChange={(event) => setField(event.target.value)}
                    placeholder="value"
                  />
                </Field>
                <Field label="Namespace (optional)">
                  <Input aria-label="Namespace (optional)"
                    className="font-mono"
                    value={namespace}
                    onChange={(event) => setNamespace(event.target.value)}
                    placeholder="payments"
                  />
                </Field>
              </>
            ) : null}
          </div>
          {message ? (
            <p className="mt-3 text-xs text-destructive" role="alert">
              {message}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button disabled={pending} onClick={() => void create()}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}{" "}
              Create secret
            </Button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {profiles.map((profile) => {
          const providerValue = String(
            profile.config.provider ?? profile.profileType ?? "LOCAL"
          ).toUpperCase()
          const label =
            providerLabels[providerValue as SecretProvider] ?? providerValue
          return (
            <article className="rounded-xl border p-5" key={profile.id}>
              <div className="flex items-start gap-3">
                <div className="grid size-9 place-items-center rounded-lg bg-muted">
                  <KeyRound className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-medium">{profile.name}</h2>
                    <Badge variant="secondary">{label}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {profile.description || "No description"}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                    <Terminal className="size-3.5" />
                    <span>secret://{profile.name}</span>
                    {providerValue === "ENV" && profile.config.externalPath ? (
                      <span className="text-muted-foreground/80">
                        · env {String(profile.config.externalPath)}
                      </span>
                    ) : null}
                    {providerValue === "VAULT" &&
                    profile.config.externalPath ? (
                      <span className="text-muted-foreground/80">
                        · {String(profile.config.externalPath)}
                      </span>
                    ) : null}
                    {providerValue === "LOCAL" ? (
                      <span className="text-muted-foreground/80">
                        · encrypted at rest
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(profile)}
                    >
                      <Trash2 /> Delete
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          )
        })}
        {!profiles.length ? (
          <div className="col-span-full rounded-xl border border-dashed px-6 py-14 text-center">
            <KeyRound className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 font-medium">No secrets yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Create an alias for an API token or signing key, then reference it
              from monitor auth, notification channels, or{" "}
              <code className="font-mono text-xs">pm.vault.get</code> in
              pre-request scripts.
            </p>
            <Button className="mt-5" onClick={() => setOpen(true)}>
              <Plus /> Create your first secret
            </Button>
          </div>
        ) : null}
      </div>
      <DeleteProfileDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null)
        }}
        title={`Delete “${deleteTarget?.name ?? "secret"}”?`}
        description={
          <>
            References to{" "}
            <code className="font-mono">secret://{deleteTarget?.name}</code> in
            monitors, scripts, and integrations will stop resolving. This cannot
            be undone.
          </>
        }
        confirming={deleting}
        onConfirm={() => void confirmDelete()}
        confirmLabel="Delete secret"
      />
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
