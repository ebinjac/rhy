import { useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { FilePenLine, Globe2, Plus, Trash2, X } from "lucide-react"

import {
  ConfigurationIntro,
  DeleteProfileDialog,
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
import { toast } from "@workspace/ui/components/sonner"

type VariableDraft = {
  id: string
  key: string
  source: "value" | "secret"
  value: string
}

const stages = [
  "PRODUCTION",
  "STAGING",
  "DEVELOPMENT",
  "TEST",
  "LOCAL",
  "CUSTOM",
]

export function EnvironmentsPanel({
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
  const [stage, setStage] = useState("PRODUCTION")
  const [baseUrl, setBaseUrl] = useState("")
  const [region, setRegion] = useState("")
  const [variables, setVariables] = useState<VariableDraft[]>([])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [deleteTarget, setDeleteTarget] =
    useState<ConfigurationProfileContract | null>(null)
  const [deleting, setDeleting] = useState(false)

  function reset() {
    setEditing(null)
    setName("")
    setDescription("")
    setStage("PRODUCTION")
    setBaseUrl("")
    setRegion("")
    setVariables([])
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
    setStage(profile.profileType)
    setBaseUrl(text(profile.config.baseUrl))
    setRegion(text(profile.config.region))
    const stored = record(profile.config.variables)
    setVariables(
      Object.entries(stored).map(([key, raw], index) => {
        const value = text(raw)
        const secret = value.startsWith("secret://")
        return {
          id: `${index}-${key}`,
          key,
          source: secret ? "secret" : "value",
          value: secret ? secretAliasFromRef(value) : value,
        }
      })
    )
    setMessage("")
    setOpen(true)
  }

  async function save() {
    const duplicateKeys = variables
      .map((item) => item.key.trim())
      .filter((key, index, all) => key && all.indexOf(key) !== index)
    if (!name.trim() || !baseUrl.trim()) {
      setMessage("Profile name and base URL are required.")
      return
    }
    if (duplicateKeys.length) {
      setMessage(`Variable names must be unique: ${duplicateKeys.join(", ")}.`)
      return
    }
    setPending(true)
    setMessage("")
    const variableMap = Object.fromEntries(
      variables
        .filter((item) => item.key.trim())
        .map((item) => [
          item.key.trim(),
          item.source === "secret" ? toSecretRef(item.value) : item.value,
        ])
    )
    const data = {
      kind: "environments" as const,
      name: name.trim(),
      description: description.trim(),
      profileType: stage,
      config: {
        baseUrl: baseUrl.trim(),
        region: region.trim(),
        variables: variableMap,
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

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteConfigurationProfile({
      data: { kind: "environments", profileId: deleteTarget.id },
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
    <>
      <div aria-live="polite" className="sr-only" role="status">
        {message}
      </div>
      <ConfigurationIntro
        icon={<Globe2 className="size-5" />}
        title="Environment profiles"
        description="Group a base endpoint, region, and run-time variables into one reusable target context. Sensitive variables must point to a saved secret."
        aside="Keep target details in one governed record instead of repeating them across definitions. Secret-backed values are represented only by aliases and are never returned to the browser."
        actionLabel="New environment"
        onAction={beginCreate}
      />
      {open ? (
        <GuidedForm
          title={editing ? "Edit environment" : "Create environment"}
          description="Define the target context monitor authors will recognize."
          message={message}
          pending={pending}
          submitLabel={editing ? "Save changes" : "Create environment"}
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
          <FormField label="Environment stage" required>
            <select aria-label="Environment stage"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={stage}
              onChange={(event) => setStage(event.target.value)}
            >
              {stages.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Base URL"
            required
            help="Used as the default target root. Credentials are not allowed in this URL."
          >
            <Input aria-label="Base URL"
              className="font-mono"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com"
            />
          </FormField>
          <FormField
            label="Region"
            help="Optional operational label; for example eu-west-1."
          >
            <Input aria-label="Region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="eu-west-1"
            />
          </FormField>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">Environment variables</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Reusable non-sensitive values and secret aliases available to
                  request templates.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setVariables((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID(),
                      key: "",
                      source: "value",
                      value: "",
                    },
                  ])
                }
              >
                <Plus data-icon="inline-start" /> Add variable
              </Button>
            </div>
            <div className="mt-3 space-y-3">
              {variables.map((variable) => (
                <div
                  key={variable.id}
                  className="grid gap-3 rounded-xl border p-3 md:grid-cols-[1fr_140px_1fr_auto] md:items-end"
                >
                  <FormField label="Name">
                    <Input aria-label="Name"
                      className="font-mono"
                      value={variable.key}
                      onChange={(event) =>
                        setVariables((current) =>
                          current.map((item) =>
                            item.id === variable.id
                              ? { ...item, key: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="API_VERSION"
                    />
                  </FormField>
                  <FormField label="Source">
                    <select aria-label="Source"
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={variable.source}
                      onChange={(event) =>
                        setVariables((current) =>
                          current.map((item) =>
                            item.id === variable.id
                              ? {
                                  ...item,
                                  source: event.target
                                    .value as VariableDraft["source"],
                                  value: "",
                                }
                              : item
                          )
                        )
                      }
                    >
                      <option value="value">Plain value</option>
                      <option value="secret">Saved secret</option>
                    </select>
                  </FormField>
                  <FormField
                    label={
                      variable.source === "secret" ? "Secret alias" : "Value"
                    }
                  >
                    {variable.source === "secret" ? (
                      <SecretPicker
                        secrets={secrets}
                        value={variable.value}
                        onValueChange={(value) =>
                          setVariables((current) =>
                            current.map((item) =>
                              item.id === variable.id
                                ? { ...item, value }
                                : item
                            )
                          )
                        }
                      />
                    ) : (
                      <Input
                        aria-label="Environment variable value"
                        value={variable.value}
                        onChange={(event) =>
                          setVariables((current) =>
                            current.map((item) =>
                              item.id === variable.id
                                ? { ...item, value: event.target.value }
                                : item
                            )
                          )
                        }
                      />
                    )}
                  </FormField>
                  <Button
                    aria-label={`Remove ${variable.key || "variable"}`}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                    onClick={() =>
                      setVariables((current) =>
                        current.filter((item) => item.id !== variable.id)
                      )
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))}
              {!variables.length ? (
                <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                  No variables added. The base URL can still be used by
                  monitors.
                </div>
              ) : null}
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
                    <Globe2 className="size-4" />
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
                  label="Base URL"
                  value={text(profile.config.baseUrl)}
                />
                <ReadonlyValue
                  label="Region"
                  value={text(profile.config.region)}
                />
                <ReadonlyValue
                  label="Variables"
                  value={`${number(profile.config.variableCount)} configured`}
                />
                <ReadonlyValue
                  label="Secret-backed"
                  value={`${number(profile.config.secretCount)} variables`}
                />
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => beginEdit(profile)}
                >
                  <FilePenLine data-icon="inline-start" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(profile)}
                >
                  <Trash2 /> Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : !open ? (
        <EmptyProfiles
          title="No environments yet"
          description="Create a target context so monitor authors can reuse endpoints and variables safely."
          onCreate={beginCreate}
        />
      ) : null}
      <DeleteProfileDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null)
        }}
        title={`Delete “${deleteTarget?.name ?? "environment"}”?`}
        description="Monitors using this environment may stop working. This cannot be undone."
        confirming={deleting}
        onConfirm={() => void confirmDelete()}
        confirmLabel="Delete environment"
      />
    </>
  )
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}
function number(value: unknown) {
  return typeof value === "number" ? value : 0
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
