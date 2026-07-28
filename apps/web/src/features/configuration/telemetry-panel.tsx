import { useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Activity, FilePenLine, Gauge, KeyRound, Trash2 } from "lucide-react"

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

export function TelemetryPanel({
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
  const [baseUrl, setBaseUrl] = useState("")
  const [tokenAlias, setTokenAlias] = useState("")
  const [selector, setSelector] = useState("")
  const [windowValue, setWindowValue] = useState("10m")
  const [resolution, setResolution] = useState("1m")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")

  function reset() {
    setEditing(null)
    setName("")
    setDescription("")
    setBaseUrl("")
    setTokenAlias("")
    setSelector("")
    setWindowValue("10m")
    setResolution("1m")
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
    setBaseUrl(text(profile.config.baseUrl))
    setTokenAlias(secretAliasFromRef(text(profile.config.tokenSecretRef)))
    setSelector(text(profile.config.defaultMetricSelector))
    setWindowValue(text(profile.config.defaultWindow) || "10m")
    setResolution(text(profile.config.defaultResolution) || "1m")
    setMessage("")
    setOpen(true)
  }
  async function save() {
    if (!name.trim() || !baseUrl.trim() || !tokenAlias) {
      setMessage(
        "Profile name, Dynatrace base URL, and token secret are required."
      )
      return
    }
    setPending(true)
    setMessage("")
    const data = {
      kind: "telemetry" as const,
      name: name.trim(),
      description: description.trim(),
      profileType: "DYNATRACE",
      config: {
        baseUrl: baseUrl.trim(),
        tokenSecretRef: toSecretRef(tokenAlias),
        defaultMetricSelector: selector.trim(),
        defaultWindow: windowValue.trim(),
        defaultResolution: resolution.trim(),
      },
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
        `Delete ${profile.name}? Metric checks using this profile may stop working.`
      )
    )
      return
    const result = await deleteConfigurationProfile({
      data: { kind: "telemetry", profileId: profile.id },
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
        icon={<Activity className="size-5" />}
        title="Telemetry connections"
        description="Connect Rhythm metric checks to Dynatrace using a governed endpoint and token secret. Defaults reduce repetitive setup while remaining editable per check."
        aside="Rhythm sends metric-selector queries to the configured Dynatrace API. The token is resolved at execution time, and only masked summaries are retained in diagnostics."
        actionLabel="New telemetry connection"
        onAction={beginCreate}
      />
      {open ? (
        <GuidedForm
          title={editing ? "Edit telemetry connection" : "Connect Dynatrace"}
          description="Configure the provider first, then choose sensible defaults for new metric checks."
          message={message}
          pending={pending}
          submitLabel={editing ? "Save changes" : "Create connection"}
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
          <FormField label="Provider">
            <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm">
              <Badge variant="secondary">Dynatrace</Badge>
              <span className="text-muted-foreground">Metrics API v2</span>
            </div>
          </FormField>
          <FormField
            label="Environment URL"
            required
            help="Your Dynatrace environment root, without the metrics API path."
          >
            <Input
              className="font-mono"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://abc12345.live.dynatrace.com"
            />
          </FormField>
          <FormField
            label="API token secret"
            required
            help="Select a secret containing a token with metrics.read permission."
          >
            <SecretPicker
              secrets={secrets}
              value={tokenAlias}
              onValueChange={setTokenAlias}
              ariaLabel="Dynatrace API token secret"
            />
          </FormField>
          <FormField
            label="Default metric selector"
            wide
            help="Optional. New metric checks can start with this selector and override it."
          >
            <Input
              className="font-mono"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="builtin:service.response.time:avg"
            />
          </FormField>
          <FormField label="Default lookback window">
            <Input
              className="font-mono"
              value={windowValue}
              onChange={(e) => setWindowValue(e.target.value)}
              placeholder="10m"
            />
          </FormField>
          <FormField label="Default resolution">
            <Input
              className="font-mono"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="1m"
            />
          </FormField>
          <div className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-3 md:col-span-2">
            <div className="flex gap-2">
              <KeyRound className="mt-0.5 size-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                Token stays in Secrets
              </span>
            </div>
            <div className="flex gap-2">
              <Gauge className="mt-0.5 size-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                Used by metric checks
              </span>
            </div>
            <div className="flex gap-2">
              <Activity className="mt-0.5 size-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                Evidence is masked
              </span>
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
                    <Activity className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{profile.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {profile.description || "No description"}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">DYNATRACE</Badge>
              </div>
              <dl className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2">
                <ReadonlyValue
                  label="Environment"
                  value={
                    text(profile.config.host) || text(profile.config.baseUrl)
                  }
                />
                <ReadonlyValue label="Credential" value="Secret-backed token" />
                <ReadonlyValue
                  label="Default window"
                  value={text(profile.config.defaultWindow)}
                />
                <ReadonlyValue
                  label="Resolution"
                  value={text(profile.config.defaultResolution)}
                />
              </dl>
              {text(profile.config.defaultMetricSelector) ? (
                <div className="mt-4 rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    Default selector
                  </p>
                  <p className="mt-1 truncate font-mono text-xs">
                    {text(profile.config.defaultMetricSelector)}
                  </p>
                </div>
              ) : null}
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
          title="No telemetry connections yet"
          description="Connect Dynatrace before adding provider-backed metric checks to a monitor."
          onCreate={beginCreate}
        />
      ) : null}
    </>
  )
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}
