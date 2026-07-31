import { useMemo, useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  CircleAlert,
  HardDrive,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"

import { PageContainer } from "@/components/page-container"
import {
  deleteBrowserMonitor,
  getBrowserMonitor,
  listBrowserAuthSessions,
  listBrowserMonitorRevisions,
  saveBrowserMonitorDraft,
  updateBrowserMonitor,
} from "@/lib/api-client/browser-monitoring"
import type { BrowserMonitorDefinition } from "@/lib/api-client/browser-monitoring"
import { listELFApplications } from "@/lib/api-client/elf"
import { listConfigurationProfiles } from "@/lib/api-client/monitors"

export const Route = createFileRoute("/ui-monitoring/$monitorId/settings")({
  loader: async ({ params }) => {
    const [monitor, revisions, applications, environments, authSessions] =
      await Promise.all([
        getBrowserMonitor({ data: { monitorId: params.monitorId } }),
        listBrowserMonitorRevisions({
          data: { monitorId: params.monitorId },
        }),
        listELFApplications(),
        listConfigurationProfiles({ data: { kind: "environments" } }),
        listBrowserAuthSessions(),
      ])
    const draft =
      revisions.find(
        (revision) => revision.id === monitor.currentDraftRevisionId
      ) ?? revisions[0]
    if (!draft) throw new Error("Browser monitor definition was not found.")
    return {
      monitor,
      draft,
      applications,
      environments,
      authSessions,
    }
  },
  component: BrowserMonitorSettings,
})

function BrowserMonitorSettings() {
  const { monitor, draft, applications, environments, authSessions } =
    Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState(monitor.name)
  const [description, setDescription] = useState(monitor.description ?? "")
  const [applicationID, setApplicationID] = useState(
    monitor.applicationId ?? ""
  )
  const [serviceID, setServiceID] = useState(monitor.serviceId ?? "")
  const [environmentID, setEnvironmentID] = useState(
    monitor.environmentProfileId ?? ""
  )
  const [frequencySeconds, setFrequencySeconds] = useState(
    monitor.frequencySeconds
  )
  const [enabled, setEnabled] = useState(monitor.enabled)
  const [definition, setDefinition] = useState<BrowserMonitorDefinition>(
    draft.definition
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState("")
  const services =
    applications.find((application) => application.id === applicationID)
      ?.services ?? []
  const changed = useMemo(
    () =>
      name !== monitor.name ||
      description !== (monitor.description ?? "") ||
      applicationID !== (monitor.applicationId ?? "") ||
      serviceID !== (monitor.serviceId ?? "") ||
      environmentID !== (monitor.environmentProfileId ?? "") ||
      frequencySeconds !== monitor.frequencySeconds ||
      enabled !== monitor.enabled ||
      JSON.stringify(definition) !== JSON.stringify(draft.definition),
    [
      applicationID,
      definition,
      description,
      draft.definition,
      enabled,
      environmentID,
      frequencySeconds,
      monitor,
      name,
      serviceID,
    ]
  )

  async function save() {
    setSaving(true)
    setError("")
    try {
      await updateBrowserMonitor({
        data: {
          monitorId: monitor.id,
          input: {
            name,
            description,
            applicationId: applicationID,
            serviceId: serviceID,
            environmentProfileId: environmentID,
            frequencySeconds,
            enabled,
          },
        },
      })
      if (JSON.stringify(definition) !== JSON.stringify(draft.definition)) {
        await saveBrowserMonitorDraft({
          data: { monitorId: monitor.id, definition },
        })
      }
      toast.success("UI monitor settings saved")
      await router.invalidate()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Settings could not be saved."
      )
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Permanently delete ${monitor.name}, including all browser runs, screenshots, and baselines?`
      )
    )
      return
    setDeleting(true)
    try {
      await deleteBrowserMonitor({ data: { monitorId: monitor.id } })
      toast.success("UI monitor permanently deleted")
      await router.navigate({ to: "/ui-monitoring" })
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Monitor was not deleted."
      )
      setDeleting(false)
    }
  }

  return (
    <PageContainer as="main">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold">UI monitor settings</h1>
          <p className="mt-1 max-w-2xl text-sm/6 text-muted-foreground">
            Ownership, schedule, browser profile, navigation boundary,
            authentication, and evidence-retention controls.
          </p>
        </div>
        <Button disabled={!changed || saving} onClick={() => void save()}>
          {saving ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Save />
          )}
          Save changes
        </Button>
      </div>

      {error ? (
        <div
          className="mt-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <section className="mt-7" aria-labelledby="ownership-settings">
        <h2 className="text-lg font-semibold" id="ownership-settings">
          Ownership and schedule
        </h2>
        <div className="mt-4 grid gap-5 rounded-xl border p-4 md:grid-cols-2 md:p-5">
          <Field label="Monitor name" id="settings-name">
            <Input
              id="settings-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          <Field label="Run frequency" id="settings-frequency">
            <Select
              onValueChange={(value) => setFrequencySeconds(Number(value))}
              value={String(frequencySeconds)}
            >
              <SelectTrigger id="settings-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="300">Every 5 minutes</SelectItem>
                <SelectItem value="900">Every 15 minutes</SelectItem>
                <SelectItem value="1800">Every 30 minutes</SelectItem>
                <SelectItem value="3600">Every hour</SelectItem>
                <SelectItem value="21600">Every 6 hours</SelectItem>
                <SelectItem value="86400">Every day</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Application" id="settings-application">
            <Select
              onValueChange={(value) => {
                setApplicationID(value === "NONE" ? "" : (value ?? ""))
                setServiceID("")
              }}
              value={applicationID || "NONE"}
            >
              <SelectTrigger id="settings-application">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Not linked</SelectItem>
                {applications.map((application) => (
                  <SelectItem key={application.id} value={application.id}>
                    {application.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Service" id="settings-service">
            <Select
              disabled={!services.length}
              onValueChange={(value) =>
                setServiceID(value === "NONE" ? "" : (value ?? ""))
              }
              value={serviceID || "NONE"}
            >
              <SelectTrigger id="settings-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">All application services</SelectItem>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Environment" id="settings-environment">
            <Select
              onValueChange={(value) =>
                setEnvironmentID(value === "NONE" ? "" : (value ?? ""))
              }
              value={environmentID || "NONE"}
            >
              <SelectTrigger id="settings-environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No environment</SelectItem>
                {environments
                  .filter((profile) => profile.active)
                  .map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/30 px-4 py-3">
            <div>
              <Label htmlFor="settings-enabled">Scheduled execution</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Pause without deleting history, baselines, or the published
                journey.
              </p>
            </div>
            <Switch
              checked={enabled}
              id="settings-enabled"
              onCheckedChange={setEnabled}
            />
          </div>
          <div className="md:col-span-2">
            <Field label="Description" id="settings-description">
              <Textarea
                id="settings-description"
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="browser-profile-settings">
        <h2 className="text-lg font-semibold" id="browser-profile-settings">
          Browser and navigation
        </h2>
        <div className="mt-4 grid gap-5 rounded-xl border p-4 md:grid-cols-2 md:p-5">
          <Field label="Start URL" id="settings-start-url">
            <Input
              id="settings-start-url"
              onChange={(event) =>
                setDefinition((current) => ({
                  ...current,
                  startUrl: event.target.value,
                }))
              }
              value={definition.startUrl}
            />
          </Field>
          <Field label="Reusable authentication session" id="settings-auth">
            <Select
              onValueChange={(value) =>
                setDefinition((current) => ({
                  ...current,
                  authSessionId:
                    value === "NONE" ? undefined : (value ?? undefined),
                }))
              }
              value={definition.authSessionId || "NONE"}
            >
              <SelectTrigger id="settings-auth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No reusable session</SelectItem>
                {authSessions.map((session) => (
                  <SelectItem
                    disabled={session.status !== "ACTIVE"}
                    key={session.id}
                    value={session.id}
                  >
                    {session.name} · {session.status.toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Allowed navigation origins"
            id="settings-origins"
            hint="One exact origin per line. Browser navigation outside this boundary is blocked."
          >
            <Textarea
              id="settings-origins"
              onChange={(event) =>
                setDefinition((current) => ({
                  ...current,
                  allowedOrigins: event.target.value
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                }))
              }
              value={definition.allowedOrigins.join("\n")}
            />
          </Field>
          <Field
            label="Screenshot mask selectors"
            id="settings-masks"
            hint="Sensitive inputs are always masked. Add selectors for user data and dynamic content."
          >
            <Textarea
              id="settings-masks"
              onChange={(event) =>
                setDefinition((current) => ({
                  ...current,
                  maskSelectors: event.target.value
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                }))
              }
              value={definition.maskSelectors.join("\n")}
            />
          </Field>
          <Field label="Page color scheme" id="settings-color-scheme">
            <Select
              onValueChange={(value) =>
                setDefinition((current) => ({
                  ...current,
                  profile: {
                    ...current.profile,
                    colorScheme:
                      value as BrowserMonitorDefinition["profile"]["colorScheme"],
                  },
                }))
              }
              value={definition.profile.colorScheme}
            >
              <SelectTrigger id="settings-color-scheme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="no-preference">System neutral</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Network profile" id="settings-network-profile">
            <Select
              onValueChange={(value) =>
                setDefinition((current) => ({
                  ...current,
                  profile: {
                    ...current.profile,
                    networkProfile: value ?? "NATIVE",
                  },
                }))
              }
              value={definition.profile.networkProfile}
            >
              <SelectTrigger id="settings-network-profile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NATIVE">Native agent network</SelectItem>
                <SelectItem value="FAST_4G">Fast 4G emulation</SelectItem>
                <SelectItem value="SLOW_4G">Slow 4G emulation</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="evidence-settings">
        <div className="flex items-start gap-3">
          <HardDrive className="mt-0.5 size-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold" id="evidence-settings">
              Evidence and retention
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Successful runs stay lightweight; failed runs retain richer
              sanitized evidence for investigation.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-5 rounded-xl border p-4 md:grid-cols-2 md:p-5">
          <Field
            label="Successful screenshot retention"
            id="settings-success-retention"
          >
            <Select
              onValueChange={(value) =>
                setDefinition((current) => ({
                  ...current,
                  artifactPolicy: {
                    ...current.artifactPolicy,
                    successScreenshotHours: Number(value),
                  },
                }))
              }
              value={String(definition.artifactPolicy.successScreenshotHours)}
            >
              <SelectTrigger id="settings-success-retention">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Do not retain</SelectItem>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="72">3 days</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Failure evidence retention"
            id="settings-failure-retention"
          >
            <Select
              onValueChange={(value) =>
                setDefinition((current) => ({
                  ...current,
                  artifactPolicy: {
                    ...current.artifactPolicy,
                    failureEvidenceDays: Number(value),
                  },
                }))
              }
              value={String(definition.artifactPolicy.failureEvidenceDays)}
            >
              <SelectTrigger id="settings-failure-retention">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 day</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/30 px-4 py-3 md:col-span-2">
            <div>
              <Label htmlFor="settings-trace">Sanitized trace on failure</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Raw traces remain in agent tmpfs. Upload happens only after
                request bodies, authorization, cookies, and sensitive inputs are
                removed.
              </p>
            </div>
            <Switch
              checked={definition.artifactPolicy.captureTraceOnFailure}
              id="settings-trace"
              onCheckedChange={(checked) =>
                setDefinition((current) => ({
                  ...current,
                  artifactPolicy: {
                    ...current.artifactPolicy,
                    captureTraceOnFailure: checked,
                  },
                }))
              }
            />
          </div>
        </div>
      </section>

      <section
        className="mt-8 rounded-xl border border-destructive/30 p-4 md:p-5"
        aria-labelledby="danger-zone"
      >
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="font-semibold text-destructive" id="danger-zone">
              Delete UI monitor
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Permanently removes the monitor, revisions, run history,
              screenshots, visual baselines, and deployment references.
            </p>
          </div>
          <Button
            disabled={deleting}
            onClick={() => void remove()}
            variant="destructive"
          >
            {deleting ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Trash2 />
            )}
            Delete permanently
          </Button>
        </div>
      </section>
    </PageContainer>
  )
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string
  id: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      {hint ? (
        <p className="mt-1 text-xs/5 text-muted-foreground">{hint}</p>
      ) : null}
      <div className="mt-2">{children}</div>
    </div>
  )
}
