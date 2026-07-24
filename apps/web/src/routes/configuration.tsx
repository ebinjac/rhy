import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Boxes, LoaderCircle, Plus, ShieldCheck } from "lucide-react"

import {
  createConfigurationProfile,
  listConfigurationProfiles,
} from "@/lib/api-client/monitors"

const kinds = [
  "environments",
  "secrets",
  "certificates",
  "proxies",
  "auth",
  "notifications",
  "telemetry",
] as const
type Kind = (typeof kinds)[number]

export const Route = createFileRoute("/configuration")({
  validateSearch: (search: Record<string, unknown>) => ({
    kind: kinds.includes(search.kind as Kind)
      ? (search.kind as Kind)
      : ("environments" as Kind),
  }),
  loaderDeps: ({ search }) => ({ kind: search.kind }),
  loader: ({ deps }) =>
    listConfigurationProfiles({ data: { kind: deps.kind } }),
  component: ConfigurationPage,
})

function ConfigurationPage() {
  const profiles = Route.useLoaderData()
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
  async function create() {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(config)
    } catch {
      setMessage("Configuration must be valid JSON.")
      return
    }
    setPending(true)
    const result = await createConfigurationProfile({
      data: { kind, name, description, profileType, config: parsed },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setOpen(false)
    setName("")
    setProfileType("")
    setMessage("")
    await router.invalidate()
  }
  function selectKind(next: Kind) {
    void navigate({ search: { kind: next } })
    setConfig(
      next === "secrets"
        ? '{"provider":"vault","externalPath":"secret/data/rhythm/service","field":"value"}'
        : next === "notifications"
          ? '{"urlSecretRef":"secret://slack-webhook"}'
          : next === "telemetry"
            ? '{"baseUrl":"https://tenant.live.dynatrace.com","tokenSecretRef":"secret://dynatrace-api-token"}'
            : "{}"
    )
  }
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Governed reuse
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold">
            Configuration library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Environment, secret-reference, certificate, proxy, authentication,
            and notification profiles.
          </p>
        </div>
        <Button onClick={() => setOpen(!open)}>
          <Plus /> New profile
        </Button>
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
      {open ? (
        <section className="mt-5 rounded-xl border bg-muted/20 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Profile type">
              <Input
                value={profileType}
                onChange={(event) => setProfileType(event.target.value)}
                placeholder={
                  kind === "secrets"
                    ? "env"
                    : kind === "notifications"
                      ? "SLACK, WEBHOOK, or EMAIL"
                  : kind === "telemetry"
                    ? "DYNATRACE"
                    : "default"
                }
              />
            </Field>
            <Field label="Description" wide>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Configuration JSON" wide>
              <Textarea
                className="min-h-28 font-mono"
                value={config}
                onChange={(event) => setConfig(event.target.value)}
              />
            </Field>
          </div>
          {kind === "secrets" || kind === "notifications" ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Store endpoint and credential
              values in secret references; this profile accepts only their
              aliases.
            </p>
          ) : null}
          {message ? (
            <p className="mt-3 text-xs text-destructive">{message}</p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button disabled={pending} onClick={create}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}{" "}
              Create profile
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
    </div>
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
