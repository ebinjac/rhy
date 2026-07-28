import { useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { FilePenLine, KeyRound, ShieldCheck, Trash2 } from "lucide-react"

import {
  ConfigurationIntro,
  EmptyProfiles,
  FormField,
  GuidedForm,
  IdentityFields,
  ReadonlyValue,
} from "./guided-profile-shared"
import {
  SecretPicker,
  secretAliasFromRef,
  toSecretRef,
} from "./secret-credential-field"
import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"
import {
  createConfigurationProfile,
  deleteConfigurationProfile,
  saveConfigurationProfile,
} from "@/lib/api-client/monitors"

const types = [
  ["BEARER", "Bearer token"],
  ["BASIC", "Basic authentication"],
  ["API_KEY", "API key"],
  ["OAUTH2", "OAuth 2.0 client credentials"],
  ["JWT", "Signed JWT"],
  ["HMAC", "HMAC signature"],
] as const

export function AuthPanel({
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
  const [type, setType] = useState("BEARER")
  const [fields, setFields] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")

  function reset() {
    setEditing(null)
    setName("")
    setDescription("")
    setType("BEARER")
    setFields({})
    setMessage("")
  }
  function beginCreate() {
    reset()
    setOpen(true)
  }
  function beginEdit(profile: ConfigurationProfileContract) {
    setEditing(profile)
    setName(profile.name)
    setDescription(profile.description ?? "")
    setType(profile.profileType)
    setFields(
      Object.fromEntries(
        Object.entries(profile.config).map(([key, value]) => [
          key,
          secretAliasFromRef(text(value)),
        ])
      )
    )
    setMessage("")
    setOpen(true)
  }
  function field(key: string) {
    return fields[key] ?? ""
  }
  function setField(key: string, value: string) {
    setFields((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    if (!name.trim()) {
      setMessage("Enter a recognizable profile name.")
      return
    }
    setPending(true)
    setMessage("")
    const config = authConfig(fields)
    const data = {
      kind: "auth" as const,
      name: name.trim(),
      description: description.trim(),
      profileType: type,
      config,
    }
    const result = editing
      ? await saveConfigurationProfile({
          data: { ...data, profileId: editing.id, active: true },
        })
      : await createConfigurationProfile({ data })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setOpen(false)
    reset()
    await onChanged()
  }

  async function remove(profile: ConfigurationProfileContract) {
    if (
      !window.confirm(
        `Delete ${profile.name}? Requests using this authentication profile may fail.`
      )
    )
      return
    const result = await deleteConfigurationProfile({
      data: { kind: "auth", profileId: profile.id },
    })
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    await onChanged()
  }

  return (
    <>
      <ConfigurationIntro
        icon={<KeyRound className="size-5" />}
        title="Authentication profiles"
        description="Create reusable authentication policies without placing credentials in monitor definitions. Each sensitive field must reference a secret."
        aside="Profiles keep the authentication method and its safe metadata together. Sensitive values remain in the Secrets library; this page stores only their aliases."
        actionLabel="New authentication profile"
        onAction={beginCreate}
      />
      {open ? (
        <GuidedForm
          title={
            editing
              ? "Edit authentication profile"
              : "Create authentication profile"
          }
          description="Choose a method and complete only the fields that method requires."
          message={message}
          pending={pending}
          submitLabel={editing ? "Save changes" : "Create profile"}
          onSubmit={() => void save()}
          onCancel={() => {
            setOpen(false)
            reset()
          }}
        >
          <IdentityFields
            name={name}
            description={description}
            setName={setName}
            setDescription={setDescription}
          />
          <div className="md:col-span-2">
            <p className="text-sm font-medium">
              Authentication method <span className="text-destructive">*</span>
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {types.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={type === value}
                  className={`min-h-14 rounded-xl border px-3 text-left text-sm transition-colors ${type === value ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50"}`}
                  onClick={() => {
                    setType(value)
                    setFields({})
                  }}
                >
                  <span className="block font-medium">{label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {value}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <AuthFields
            type={type}
            field={field}
            setField={setField}
            secrets={secrets}
          />
          <div className="rounded-xl border bg-muted/30 p-4 md:col-span-2">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="text-sm text-muted-foreground">
                Only secret aliases and non-sensitive method metadata are stored
                here. Credential values remain in the Secrets library and are
                masked from execution evidence.
              </p>
            </div>
          </div>
        </GuidedForm>
      ) : null}
      {profiles.length ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {profiles.map((profile) => (
            <article
              key={profile.id}
              className="rounded-2xl border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
                    <KeyRound className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{profile.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {profile.description || "No description"}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">{profile.profileType}</Badge>
              </div>
              <dl className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2">
                <ReadonlyValue
                  label="Method"
                  value={authLabel(profile.profileType)}
                />
                <ReadonlyValue
                  label="Credential handling"
                  value={`${number(profile.config.secretCount)} secret reference${number(profile.config.secretCount) === 1 ? "" : "s"}`}
                />
                <ReadonlyValue
                  label="Header / endpoint"
                  value={
                    text(profile.config.outputHeader) ||
                    text(profile.config.name) ||
                    text(profile.config.tokenUrl)
                  }
                />
                <ReadonlyValue
                  label="Status"
                  value={profile.active ? "Available" : "Inactive"}
                />
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => beginEdit(profile)}
                >
                  <FilePenLine /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(profile)}
                >
                  <Trash2 /> Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : !open ? (
        <EmptyProfiles
          title="No authentication profiles yet"
          description="Create one to reuse governed credentials across HTTP requests."
          onCreate={beginCreate}
        />
      ) : null}
    </>
  )
}

function AuthFields({
  type,
  field,
  setField,
  secrets,
}: {
  type: string
  field: (key: string) => string
  setField: (key: string, value: string) => void
  secrets: ConfigurationProfileContract[]
}) {
  const secret = (label: string, key: string, help?: string) => (
    <FormField label={label} required help={help}>
      <SecretPicker
        secrets={secrets}
        value={field(key)}
        onValueChange={(value) => setField(key, value)}
        ariaLabel={label}
      />
    </FormField>
  )
  if (type === "BASIC")
    return (
      <>
        {secret("Username secret", "usernameSecretRef")}
        {secret("Password secret", "passwordSecretRef")}
      </>
    )
  if (type === "BEARER")
    return (
      <>
        {secret(
          "Token secret",
          "tokenSecretRef",
          "The saved secret should contain only the bearer token."
        )}
      </>
    )
  if (type === "API_KEY")
    return (
      <>
        <FormField label="Key name" required>
          <Input
            value={field("name")}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="X-API-Key"
          />
        </FormField>
        <FormField label="Send in" required>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={field("location") || "header"}
            onChange={(e) => setField("location", e.target.value)}
          >
            <option value="header">Request header</option>
            <option value="query">Query parameter</option>
          </select>
        </FormField>
        {secret("API key secret", "valueSecretRef")}
      </>
    )
  if (type === "OAUTH2")
    return (
      <>
        <FormField label="Token URL" required>
          <Input
            className="font-mono"
            value={field("tokenUrl")}
            onChange={(e) => setField("tokenUrl", e.target.value)}
            placeholder="https://identity.example.com/oauth/token"
          />
        </FormField>
        <FormField label="Client ID" required>
          <Input
            value={field("clientId")}
            onChange={(e) => setField("clientId", e.target.value)}
          />
        </FormField>
        {secret("Client secret", "clientSecretRef")}
        <FormField label="Scope">
          <Input
            value={field("scope")}
            onChange={(e) => setField("scope", e.target.value)}
            placeholder="api.read"
          />
        </FormField>
      </>
    )
  if (type === "JWT")
    return (
      <>
        <FormField label="Issuer" required>
          <Input
            value={field("issuer")}
            onChange={(e) => setField("issuer", e.target.value)}
          />
        </FormField>
        <FormField label="Audience" required>
          <Input
            value={field("audience")}
            onChange={(e) => setField("audience", e.target.value)}
          />
        </FormField>
        {secret("Signing key secret", "keySecretRef")}
        <FormField label="Algorithm" required>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={field("algorithm") || "RS256"}
            onChange={(e) => setField("algorithm", e.target.value)}
          >
            <option>RS256</option>
            <option>HS256</option>
          </select>
        </FormField>
      </>
    )
  return (
    <>
      {secret("HMAC secret", "secretRef")}
      <FormField label="Algorithm" required>
        <select
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={field("algorithm") || "SHA-256"}
          onChange={(e) => setField("algorithm", e.target.value)}
        >
          <option>SHA-256</option>
          <option>SHA-512</option>
        </select>
      </FormField>
      <FormField label="Signature header" required>
        <Input
          value={field("outputHeader")}
          onChange={(e) => setField("outputHeader", e.target.value)}
          placeholder="X-Signature"
        />
      </FormField>
      <FormField
        label="Canonical string template"
        wide
        help="Optional template used to build the signed message."
      >
        <Textarea
          className="min-h-24 font-mono"
          value={field("canonicalTemplate")}
          onChange={(e) => setField("canonicalTemplate", e.target.value)}
          placeholder={"{{method}}\\n{{path}}\\n{{body}}"}
        />
      </FormField>
    </>
  )
}

function authConfig(fields: Record<string, string>) {
  const secretKeys = new Set([
    "usernameSecretRef",
    "passwordSecretRef",
    "tokenSecretRef",
    "valueSecretRef",
    "clientSecretRef",
    "keySecretRef",
    "secretRef",
  ])
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      secretKeys.has(key) ? toSecretRef(value) : value.trim(),
    ])
  )
}
function text(value: unknown) {
  return typeof value === "string" ? value : ""
}
function number(value: unknown) {
  return typeof value === "number" ? value : 0
}
function authLabel(type: string) {
  return types.find(([value]) => value === type)?.[1] ?? type
}
