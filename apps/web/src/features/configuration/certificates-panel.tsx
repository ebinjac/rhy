import { useId, useRef, useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { CopyButton } from "@workspace/ui/components/copy-button"
import { Input } from "@workspace/ui/components/input"
import {
  CalendarClock,
  Check,
  ChevronDown,
  FileArchive,
  FileKey2,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react"

import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"
import { uploadCertificateProfile } from "@/lib/api-client/certificates"
import { deleteConfigurationProfile } from "@/lib/api-client/monitors"
import { DeleteProfileDialog } from "@/features/configuration/guided-profile-shared"
import { toast } from "@workspace/ui/components/sonner"

type Purpose = "CLIENT_IDENTITY" | "TRUST_BUNDLE" | "COMBINED"
type EncodedFile = { name: string; type: string; contentBase64: string }

const purposeOptions: Array<{
  value: Purpose
  label: string
  description: string
  icon: typeof KeyRound
}> = [
  {
    value: "CLIENT_IDENTITY",
    label: "Client identity",
    description: "Certificate and private key for mutual TLS (mTLS).",
    icon: KeyRound,
  },
  {
    value: "TRUST_BUNDLE",
    label: "Trust bundle",
    description: "CA certificates used to verify a server.",
    icon: ShieldCheck,
  },
  {
    value: "COMBINED",
    label: "Combined",
    description: "Client identity plus a custom CA chain.",
    icon: FileKey2,
  },
]

const acceptedExtensions =
  ".pem,.crt,.cer,.der,.key,.p7b,.p7c,.p12,.pfx,.jks,.keystore,application/x-pkcs12,application/pkcs12"

export function CertificatesPanel({
  profiles,
  onChanged,
}: {
  profiles: ConfigurationProfileContract[]
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ConfigurationProfileContract | null>(
    null
  )
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [purpose, setPurpose] = useState<Purpose>("CLIENT_IDENTITY")
  const [source, setSource] = useState<File>()
  const [privateKey, setPrivateKey] = useState<File>()
  const [caBundle, setCABundle] = useState<File>()
  const [password, setPassword] = useState("")
  const [keyPassword, setKeyPassword] = useState("")
  const [alias, setAlias] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [deleteTarget, setDeleteTarget] =
    useState<ConfigurationProfileContract | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isContainer =
    source != null && /\.(p12|pfx|jks|keystore)$/i.test(source.name)
  const needsPrivateKey =
    purpose !== "TRUST_BUNDLE" &&
    source != null &&
    !isContainer &&
    !privateKey &&
    !editing

  function reset() {
    setEditing(null)
    setName("")
    setDescription("")
    setPurpose("CLIENT_IDENTITY")
    setSource(undefined)
    setPrivateKey(undefined)
    setCABundle(undefined)
    setPassword("")
    setKeyPassword("")
    setAlias("")
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
    setPurpose(asPurpose(textValue(profile.config.purpose)))
    setSource(undefined)
    setPrivateKey(undefined)
    setCABundle(undefined)
    setPassword("")
    setKeyPassword("")
    setAlias(textValue(profile.config.alias))
    setMessage("")
    setOpen(true)
  }

  async function save() {
    if (!name.trim()) {
      setMessage("Enter a recognizable profile name.")
      return
    }
    if (!editing && !source) {
      setMessage("Select a certificate, trust bundle, or keystore file.")
      return
    }
    if (needsPrivateKey) {
      setMessage(
        "Add the matching private-key file, or choose a P12, PFX, or JKS container."
      )
      return
    }
    for (const file of [source, privateKey, caBundle]) {
      if (file && file.size > 10 * 1024 * 1024) {
        setMessage(`${file.name} exceeds the 10 MB per-file limit.`)
        return
      }
    }
    setPending(true)
    setMessage("")
    const [encodedSource, encodedPrivateKey, encodedCABundle] =
      await Promise.all([
        source ? encodeFile(source) : undefined,
        privateKey ? encodeFile(privateKey) : undefined,
        caBundle ? encodeFile(caBundle) : undefined,
      ])
    const result = await uploadCertificateProfile({
      data: {
        ...(editing ? { profileId: editing.id } : {}),
        name: name.trim(),
        description: description.trim(),
        purpose,
        password,
        keyPassword,
        alias: alias.trim(),
        ...(encodedSource ? { source: encodedSource } : {}),
        ...(encodedPrivateKey ? { privateKey: encodedPrivateKey } : {}),
        ...(encodedCABundle ? { caBundle: encodedCABundle } : {}),
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setOpen(false)
    reset()
    await onChanged()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteConfigurationProfile({
      data: { kind: "certificates", profileId: deleteTarget.id },
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
      <section className="overflow-hidden rounded-xl border">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-primary" />
              <h2 className="font-medium">TLS certificate profiles</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Upload certificates as PEM, CRT, CER, DER, or PKCS#7; import
              client identities from P12/PFX or Java JKS keystores. Rhythm
              validates the chain and key pairing, normalizes it for monitor
              execution, then encrypts private material at rest.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" /> Passwords are never
                stored
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" /> Private keys never
                return to the browser
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" /> 10 MB per file
              </span>
            </div>
          </div>
          <Button onClick={open ? () => setOpen(false) : beginCreate}>
            {open ? <X data-icon="inline-start" /> : <Plus />}
            {open ? "Close" : "Import certificate"}
          </Button>
        </div>
        <div className="border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
          Supported: PEM bundles, X.509 CRT/CER, binary DER, PKCS#7 (.p7b/.p7c),
          PKCS#12 (.p12/.pfx), JKS/.keystore, separate PKCS#1/PKCS#8/EC private
          keys, and CA chains.
        </div>
      </section>

      {open ? (
        <section
          className="rounded-xl border"
          aria-labelledby="certificate-form"
        >
          <div className="border-b px-5 py-4">
            <h3 id="certificate-form" className="font-medium">
              {editing ? `Edit ${editing.name}` : "Import a TLS certificate"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {editing
                ? "Change metadata below, or select new files to replace the stored material."
                : "Choose how the profile will be used. The form adapts to the file you select."}
            </p>
          </div>
          <div className="space-y-6 p-5">
            <fieldset>
              <legend className="text-sm font-medium">
                How will this be used?
              </legend>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {purposeOptions.map((option) => {
                  const Icon = option.icon
                  const selected = purpose === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setPurpose(option.value)}
                      className={`min-h-24 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "hover:border-foreground/25 hover:bg-muted/30"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon className={selected ? "text-primary" : ""} />
                        {option.label}
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                        {option.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Profile name" required>
                <Input aria-label="Profile name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Payments production mTLS"
                />
              </Field>
              <Field label="Description">
                <Input aria-label="Description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Identity used by checkout API monitors"
                />
              </Field>
            </div>

            <div>
              <p className="text-sm font-medium">
                {purpose === "TRUST_BUNDLE"
                  ? "Certificate or CA bundle"
                  : "Certificate or keystore"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {editing
                  ? "Leave files empty to retain the encrypted material already stored."
                  : "Choose one file. Combined PEM files and password-protected containers are supported."}
              </p>
              <div className="mt-3">
                <FileDrop
                  file={source}
                  onFile={setSource}
                  label={
                    purpose === "TRUST_BUNDLE"
                      ? "Choose certificate bundle"
                      : "Choose certificate or keystore"
                  }
                />
              </div>
            </div>

            {isContainer ? (
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <FileArchive className="size-4 text-primary" />
                  <h4 className="text-sm font-medium">Keystore access</h4>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Used only while importing the file. Rhythm does not retain
                  either password.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="Keystore password">
                    <Input aria-label="Keystore password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                  <Field
                    label="Private-key password"
                    help="Optional. Defaults to the keystore password."
                  >
                    <Input aria-label="Private-key password"
                      type="password"
                      autoComplete="new-password"
                      value={keyPassword}
                      onChange={(event) => setKeyPassword(event.target.value)}
                    />
                  </Field>
                  {/\.(jks|keystore)$/i.test(source?.name ?? "") ? (
                    <Field
                      label="JKS alias"
                      help="Optional. Rhythm chooses the first private-key entry when empty."
                    >
                      <Input aria-label="JKS alias"
                        value={alias}
                        onChange={(event) => setAlias(event.target.value)}
                        placeholder="client-cert"
                      />
                    </Field>
                  ) : null}
                </div>
              </div>
            ) : source ? (
              <details className="rounded-lg border" open={needsPrivateKey}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
                  <ChevronDown className="size-4" />
                  Add separate key or CA chain
                  {needsPrivateKey ? (
                    <Badge variant="secondary" className="ml-auto">
                      Private key required
                    </Badge>
                  ) : null}
                </summary>
                <div className="grid gap-4 border-t p-4 md:grid-cols-2">
                  {purpose !== "TRUST_BUNDLE" ? (
                    <div>
                      <p className="mb-2 text-xs font-medium">
                        Private key (PEM/KEY)
                      </p>
                      <FileDrop
                        compact
                        file={privateKey}
                        onFile={setPrivateKey}
                        label="Choose private key"
                        accept=".pem,.key"
                      />
                    </div>
                  ) : null}
                  <div>
                    <p className="mb-2 text-xs font-medium">
                      CA chain (optional)
                    </p>
                    <FileDrop
                      compact
                      file={caBundle}
                      onFile={setCABundle}
                      label="Choose CA bundle"
                      accept=".pem,.crt,.cer,.der,.p7b,.p7c"
                    />
                  </div>
                </div>
              </details>
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
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : editing ? (
                <RefreshCw data-icon="inline-start" />
              ) : (
                <Upload />
              )}
              {pending
                ? "Validating and encrypting…"
                : editing
                  ? "Save profile"
                  : "Validate and import"}
            </Button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="stored-certificates">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="stored-certificates" className="font-medium">
              Stored profiles
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {profiles.length} {profiles.length === 1 ? "profile" : "profiles"}{" "}
              available to monitors.
            </p>
          </div>
        </div>
        <div className="mt-4 divide-y overflow-hidden rounded-xl border">
          {profiles.map((profile) => (
            <CertificateRow
              key={profile.id}
              profile={profile}
              onEdit={() => beginEdit(profile)}
              onDelete={() => setDeleteTarget(profile)}
            />
          ))}
          {!profiles.length ? (
            <div className="px-5 py-14 text-center">
              <FileKey2 className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">No certificate profiles yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Import a client identity or trust bundle, then select it from a
                monitor’s TLS settings.
              </p>
              <Button className="mt-5" onClick={beginCreate}>
                <Upload data-icon="inline-start" /> Import certificate
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
        title={`Delete “${deleteTarget?.name ?? "certificate"}”?`}
        description="Monitors using this TLS profile may fail. This cannot be undone."
        confirming={deleting}
        onConfirm={() => void confirmDelete()}
        confirmLabel="Delete certificate"
      />
    </div>
  )
}

function CertificateRow({
  profile,
  onEdit,
  onDelete,
}: {
  profile: ConfigurationProfileContract
  onEdit: () => void
  onDelete: () => void
}) {
  const config = profile.config
  const purpose = asPurpose(textValue(config.purpose))
  const expiresAt = textValue(config.notAfter)
  const days = numberValue(config.daysUntilExpiry)
  const fingerprint = textValue(config.fingerprintSHA256)
  const expiryTone =
    days == null ? "secondary" : days < 0 ? "destructive" : "secondary"
  return (
    <article className="p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary">
            {purpose === "TRUST_BUNDLE" ? (
              <ShieldCheck className="size-5" />
            ) : (
              <FileKey2 className="size-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{profile.name}</h3>
              <Badge variant="secondary">{purposeLabel(purpose)}</Badge>
              {textValue(config.sourceFormat) ? (
                <Badge variant="outline">
                  {textValue(config.sourceFormat)}
                </Badge>
              ) : (
                <Badge variant="outline">Legacy reference</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile.description ||
                textValue(config.subject) ||
                "No description"}
            </p>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <Detail
                icon={CalendarClock}
                label="Expires"
                value={
                  expiresAt
                    ? `${formatDate(expiresAt)}${days == null ? "" : ` · ${days}d`}`
                    : "Managed by secret reference"
                }
              />
              <Detail
                icon={ShieldCheck}
                label="Issuer"
                value={textValue(config.issuer) || "Not recorded"}
              />
              <Detail
                icon={KeyRound}
                label="Key"
                value={textValue(config.keyAlgorithm) || "Not recorded"}
              />
              <Detail
                icon={Fingerprint}
                label="SHA-256 fingerprint"
                value={
                  fingerprint ? compactFingerprint(fingerprint) : "Not recorded"
                }
                copyValue={fingerprint}
              />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {booleanValue(config.hasClientIdentity) ? (
                <Badge variant="outline">
                  <KeyRound /> Client identity
                </Badge>
              ) : null}
              {booleanValue(config.hasTrustBundle) ? (
                <Badge variant="outline">
                  <ShieldCheck /> Trust chain
                </Badge>
              ) : null}
              {days != null && days <= 30 ? (
                <Badge variant={expiryTone}>
                  {days < 0 ? "Expired" : `Expires in ${days} days`}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <RefreshCw data-icon="inline-start" /> Edit or replace
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 data-icon="inline-start" /> Delete
          </Button>
        </div>
      </div>
    </article>
  )
}

function FileDrop({
  file,
  onFile,
  label,
  compact = false,
  accept = acceptedExtensions,
}: {
  file?: File
  onFile: (file?: File) => void
  label: string
  compact?: boolean
  accept?: string
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={`rounded-lg border border-dashed transition-colors ${
        dragging ? "border-primary bg-primary/5" : "bg-muted/10"
      } ${compact ? "p-3" : "p-5"}`}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        onFile(event.dataTransfer.files[0])
      }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        accept={accept}
        onChange={(event) => onFile(event.target.files?.[0])}
      />
      {file ? (
        <div className="flex min-h-11 items-center gap-3">
          <FileKey2 className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(file.size)} · {formatFromName(file.name)}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onFile(undefined)
              if (inputRef.current) inputRef.current.value = ""
            }}
          >
            <X data-icon="inline-start" /> Remove
          </Button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={`flex cursor-pointer flex-col items-center justify-center text-center ${
            compact ? "min-h-16" : "min-h-24"
          }`}
        >
          <Upload className="size-5 text-muted-foreground" />
          <span className="mt-2 text-sm font-medium">{label}</span>
          <span className="mt-1 text-xs text-muted-foreground">
            or drop a file here
          </span>
        </label>
      )}
    </div>
  )
}

function Field({
  label,
  help,
  required,
  children,
}: {
  label: string
  help?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="text-sm font-medium">
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
  copyValue,
}: {
  icon: typeof CalendarClock
  label: string
  value: string
  copyValue?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </dt>
      <dd className="mt-1 flex items-center gap-1.5">
        <span className="truncate">{value}</span>
        {copyValue ? (
          <CopyButton
            className="text-muted-foreground"
            iconClassName="size-3"
            label={`Copy ${label}`}
            size="icon-xs"
            value={copyValue}
            variant="ghost"
          />
        ) : null}
      </dd>
    </div>
  )
}

async function encodeFile(file: File): Promise<EncodedFile> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    contentBase64: btoa(binary),
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function asPurpose(value: string): Purpose {
  if (value === "TRUST_BUNDLE" || value === "COMBINED") return value
  return "CLIENT_IDENTITY"
}

function purposeLabel(purpose: Purpose) {
  if (purpose === "TRUST_BUNDLE") return "Trust bundle"
  if (purpose === "COMBINED") return "Combined"
  return "Client identity"
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatFromName(name: string) {
  const extension = name.split(".").pop()?.toUpperCase()
  return extension ? `${extension} file` : "Certificate file"
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not recorded"
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)
}

function compactFingerprint(value: string) {
  const normalized = value.replaceAll(":", "")
  return `${normalized.slice(0, 12)}…${normalized.slice(-8)}`
}
