import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Boxes,
  Copy,
  FilePenLine,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react"

import { CertificatesPanel } from "@/features/configuration/certificates-panel"
import { AuthPanel } from "@/features/configuration/auth-panel"
import { DeleteProfileDialog } from "@/features/configuration/guided-profile-shared"
import { NotificationsPanel } from "@/features/configuration/notifications-panel"
import { ProxiesPanel } from "@/features/configuration/proxies-panel"
import { SecretsPanel } from "@/features/configuration/secrets-panel"
import { TelemetryPanel } from "@/features/configuration/telemetry-panel"
import {
  createConfigurationProfile,
  deleteConfigurationProfile,
  listConfigurationProfiles,
  saveConfigurationProfile,
} from "@/lib/api-client/monitors"
import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"
import { PageContainer } from "@/components/page-container"

const kinds = [
  "secrets",
  "certificates",
  "proxies",
  "auth",
  "notifications",
  "telemetry",
] as const
type Kind = (typeof kinds)[number]

const profileFields: Partial<
  Record<Kind, Array<{ key: string; label: string; placeholder: string }>>
> = {
  auth: [
    { key: "mode", label: "Authentication mode", placeholder: "BEARER" },
    {
      key: "credentialSecretRef",
      label: "Credential secret reference",
      placeholder: "production-api-token",
    },
  ],
  telemetry: [
    {
      key: "baseUrl",
      label: "Provider base URL",
      placeholder: "https://tenant.live.dynatrace.com",
    },
    {
      key: "tokenSecretRef",
      label: "Token secret reference",
      placeholder: "dynatrace-api-token",
    },
  ],
}

export const Route = createFileRoute("/configuration")({
  validateSearch: (search: Record<string, unknown>) => ({
    kind: kinds.includes(search.kind as Kind)
      ? (search.kind as Kind)
      : ("secrets" as Kind),
  }),
  loaderDeps: ({ search }) => ({ kind: search.kind }),
  loader: async ({ deps }) => {
    const profiles = await listConfigurationProfiles({
      data: { kind: deps.kind },
    })
    if (
      deps.kind !== "notifications" &&
      deps.kind !== "proxies" &&
      deps.kind !== "auth" &&
      deps.kind !== "telemetry"
    ) {
      return {
        profiles,
        secrets: [] as Awaited<ReturnType<typeof listConfigurationProfiles>>,
        certificates: [] as Awaited<
          ReturnType<typeof listConfigurationProfiles>
        >,
        proxies: [] as Awaited<ReturnType<typeof listConfigurationProfiles>>,
      }
    }
    const [secrets, certificates, proxies] = await Promise.all([
      listConfigurationProfiles({ data: { kind: "secrets" } }),
      deps.kind === "telemetry"
        ? listConfigurationProfiles({ data: { kind: "certificates" } })
        : Promise.resolve([]),
      deps.kind === "telemetry"
        ? listConfigurationProfiles({ data: { kind: "proxies" } })
        : Promise.resolve([]),
    ])
    return { profiles, secrets, certificates, proxies }
  },
  component: ConfigurationPage,
})

function ConfigurationPage() {
  const { profiles, secrets, certificates, proxies } = Route.useLoaderData()
  const { kind } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [profileType, setProfileType] = useState("")
  const [description, setDescription] = useState("")
  const [config, setConfig] = useState("{}")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [editingId, setEditingId] = useState("")
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] =
    useState<ConfigurationProfileContract | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function create() {
    let parsed: Record<string, unknown>
    try {
      parsed = { ...JSON.parse(config), ...fieldValues }
    } catch {
      setMessage("Configuration must be valid JSON.")
      return
    }
    setPending(true)
    const result = editingId
      ? await saveConfigurationProfile({
          data: {
            kind,
            profileId: editingId,
            name,
            description,
            profileType,
            config: parsed,
            active: true,
          },
        })
      : await createConfigurationProfile({
          data: { kind, name, description, profileType, config: parsed },
        })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setOpen(false)
    setEditingId("")
    setName("")
    setProfileType("")
    setMessage("")
    setConfig("{}")
    setFieldValues({})
    await router.invalidate()
  }

  function edit(profile: ConfigurationProfileContract) {
    const knownKeys = new Set(
      (profileFields[kind] ?? []).map((field) => field.key)
    )
    setEditingId(profile.id)
    setName(profile.name)
    setProfileType(profile.profileType)
    setDescription(profile.description ?? "")
    setFieldValues(
      Object.fromEntries(
        Object.entries(profile.config)
          .filter(([key]) => knownKeys.has(key))
          .map(([key, value]) => [key, String(value ?? "")])
      )
    )
    setConfig(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(profile.config).filter(([key]) => !knownKeys.has(key))
        ),
        null,
        2
      )
    )
    setMessage("")
    setOpen(true)
  }

  function clone(profile: ConfigurationProfileContract) {
    edit(profile)
    setEditingId("")
    setName(`${profile.name} copy`)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteConfigurationProfile({
      data: { kind, profileId: deleteTarget.id },
    })
    setDeleting(false)
    if (!result.ok) {
      toast.error(result.message)
      setMessage(result.message)
      return
    }
    toast.success(`Deleted “${deleteTarget.name}”.`)
    setDeleteTarget(null)
    await router.invalidate()
  }

  function selectKind(next: Kind) {
    void navigate({ search: { kind: next } })
    setOpen(false)
    setEditingId("")
    setMessage("")
    setFieldValues({})
    setConfig(
      next === "telemetry"
        ? '{"baseUrl":"https://tenant.live.dynatrace.com","tokenSecretRef":"dynatrace-api-token"}'
        : "{}"
    )
  }

  return (
    <>
      <div aria-live="polite" className="sr-only" role="status">{message}</div>
    <PageContainer>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Governed reuse
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold">
            Configuration library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {kind === "secrets"
              ? "Named credential aliases for monitors, scripts, and integrations — encrypted at rest when stored in Rhythm."
              : kind === "certificates"
                ? "Validated TLS identities and trust bundles for secure monitor connections."
                : kind === "proxies"
                  ? "Governed outbound routes for monitor and ELF network traffic."
                  : kind === "auth"
                    ? "Secret-backed authentication policies for HTTP requests."
                    : kind === "telemetry"
                      ? "Governed provider connections and defaults for metric checks."
                      : kind === "notifications"
                        ? "SMTP, Slack, and webhook channels for alert delivery. Application destinations are configured per app."
                        : "Certificate, proxy, authentication, notification, and telemetry profiles."}
          </p>
        </div>
        {kind !== "secrets" &&
        kind !== "certificates" &&
        kind !== "proxies" &&
        kind !== "notifications" &&
        kind !== "auth" &&
        kind !== "telemetry" ? (
          <Button onClick={() => setOpen(!open)}>
            <Plus /> New profile
          </Button>
        ) : null}
      </div>
      <div className="mt-7 flex gap-2 overflow-x-auto border-b pb-3">
        {kinds.map((item) => (
          <Button
            key={item}
            variant={kind === item ? "secondary" : "ghost"}
            onClick={() => selectKind(item)}
            className="capitalize"
          >
            {item}
          </Button>
        ))}
      </div>

      {kind === "secrets" ? (
        <SecretsPanel
          profiles={profiles}
          onChanged={async () => {
            await router.invalidate()
          }}
        />
      ) : kind === "certificates" ? (
        <CertificatesPanel
          profiles={profiles}
          onChanged={async () => {
            await router.invalidate()
          }}
        />
      ) : kind === "proxies" ? (
        <ProxiesPanel
          profiles={profiles}
          secrets={secrets}
          onChanged={async () => {
            await router.invalidate()
          }}
        />
      ) : kind === "notifications" ? (
        <NotificationsPanel
          profiles={profiles}
          secrets={secrets}
          onChanged={async () => {
            await router.invalidate()
          }}
        />
      ) : kind === "auth" ? (
        <AuthPanel
          profiles={profiles}
          secrets={secrets}
          onChanged={async () => {
            await router.invalidate()
          }}
        />
      ) : kind === "telemetry" ? (
        <TelemetryPanel
          profiles={profiles}
          secrets={secrets}
          certificates={certificates}
          proxies={proxies}
          onChanged={async () => {
            await router.invalidate()
          }}
        />
      ) : (
        <>
          {open ? (
            <section className="mt-5 rounded-xl border bg-muted/20 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Name">
                  <Input aria-label="Name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field label="Profile type">
                  <Input aria-label="Profile type"
                    value={profileType}
                    onChange={(event) => setProfileType(event.target.value)}
                    placeholder={kind === "telemetry" ? "DYNATRACE" : "default"}
                  />
                </Field>
                <Field label="Description" wide>
                  <Input aria-label="Description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                {(profileFields[kind as Kind] ?? []).map((field) => (
                  <Field label={field.label} key={field.key}>
                    <Input
                      aria-label={field.label}
                      value={fieldValues[field.key] ?? ""}
                      onChange={(event) =>
                        setFieldValues((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.placeholder}
                    />
                  </Field>
                ))}
                <details className="rounded-lg border md:col-span-2">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                    Advanced JSON
                  </summary>
                  <div className="border-t p-4">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Add provider-specific fields that are not available in the
                      guided form. Guided values override matching JSON keys.
                    </p>
                    <Textarea
                      aria-label="Advanced configuration JSON"
                      className="min-h-28 font-mono"
                      value={config}
                      onChange={(event) => setConfig(event.target.value)}
                    />
                  </div>
                </details>
              </div>
              {message ? (
                <p className="mt-3 text-xs text-destructive">{message}</p>
              ) : null}
              <div className="mt-4 flex justify-end">
                <Button disabled={pending} onClick={() => void create()}>
                  {pending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Plus />
                  )}{" "}
                  {editingId ? "Save changes" : "Create profile"}
                </Button>
              </div>
            </section>
          ) : null}
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {profiles.map((profile) => (
              <article className="rounded-xl border p-5" key={profile.id}>
                <div className="flex items-start gap-3">
                  <div className="grid size-9 place-items-center rounded-lg bg-muted">
                    <Boxes className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-medium">{profile.name}</h2>
                      <Badge variant="secondary">{profile.profileType}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {profile.description || "No description"}
                    </p>
                    <p className="mt-3 font-mono text-xs text-muted-foreground">
                      {profile.id}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        onClick={() => edit(profile)}
                        size="sm"
                        variant="outline"
                      >
                        <FilePenLine />
                        Edit
                      </Button>
                      <Button
                        onClick={() => clone(profile)}
                        size="sm"
                        variant="ghost"
                      >
                        <Copy />
                        Clone
                      </Button>
                      <Button
                        onClick={() => setDeleteTarget(profile)}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash2 />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {!profiles.length ? (
              <div className="col-span-full rounded-xl border border-dashed py-14 text-center">
                <Boxes className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-3 font-medium">No {kind} profiles</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a governed reusable profile for monitor authors.
                </p>
              </div>
            ) : null}
          </div>
          <DeleteProfileDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(next) => {
              if (!next) setDeleteTarget(null)
            }}
            title={`Delete “${deleteTarget?.name ?? "profile"}”?`}
            description="Monitors that reference this profile may stop working. This cannot be undone."
            confirming={deleting}
            onConfirm={() => void confirmDelete()}
            confirmLabel="Delete profile"
          />
        </>
      )}
    </PageContainer>
    </>
  )
}

function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`text-xs font-medium ${wide ? "md:col-span-2" : ""}`}>
      {label}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}
