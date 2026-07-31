import { useMemo, useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
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
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  LoaderCircle,
  MonitorCheck,
  Play,
  ShieldCheck,
} from "lucide-react"

import { PageContainer } from "@/components/page-container"
import {
  createDefaultJourney,
  JourneyBuilder,
} from "@/features/ui-monitoring/journey-builder"
import {
  createBrowserMonitor,
  listBrowserAuthSessions,
  previewUnsavedBrowserMonitor,
} from "@/lib/api-client/browser-monitoring"
import type {
  BrowserMonitorDefinition,
  BrowserPreview,
  BrowserStep,
} from "@/lib/api-client/browser-monitoring"
import { listELFApplications } from "@/lib/api-client/elf"
import { listConfigurationProfiles } from "@/lib/api-client/monitors"
import { formatDuration } from "@/features/ui-monitoring/browser-monitor-status"

export const Route = createFileRoute("/ui-monitoring/new")({
  loader: async () => {
    const [applications, environments, authSessions] = await Promise.all([
      listELFApplications(),
      listConfigurationProfiles({ data: { kind: "environments" } }),
      listBrowserAuthSessions().catch(() => []),
    ])
    return { applications, environments, authSessions }
  },
  component: NewBrowserMonitorPage,
})

function NewBrowserMonitorPage() {
  const { applications, environments, authSessions } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [applicationID, setApplicationID] = useState("")
  const [serviceID, setServiceID] = useState("")
  const [environmentID, setEnvironmentID] = useState("")
  const [startURL, setStartURL] = useState("")
  const [allowedOrigins, setAllowedOrigins] = useState("")
  const [authSessionID, setAuthSessionID] = useState("")
  const [viewport, setViewport] = useState("desktop")
  const [colorScheme, setColorScheme] =
    useState<BrowserMonitorDefinition["profile"]["colorScheme"]>("light")
  const [frequencySeconds, setFrequencySeconds] = useState(900)
  const [enabled, setEnabled] = useState(false)
  const [steps, setSteps] = useState<BrowserStep[]>(() =>
    createDefaultJourney()
  )
  const [selectedStepID, setSelectedStepID] = useState(steps[0].id)
  const [submitting, setSubmitting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<BrowserPreview | null>(null)
  const [error, setError] = useState("")
  const selectedApplication = applications.find(
    (application) => application.id === applicationID
  )
  const services = selectedApplication?.services ?? []

  const definition = useMemo<BrowserMonitorDefinition>(() => {
    const mobile = viewport === "mobile"
    const origins = allowedOrigins
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)
    try {
      if (startURL) {
        const origin = new URL(startURL).origin
        if (!origins.includes(origin)) origins.unshift(origin)
      }
    } catch {
      // The inline readiness state reports the invalid URL.
    }
    return {
      schemaVersion: 1,
      startUrl: startURL,
      allowedOrigins: origins,
      profile: {
        browser: "chromium",
        viewportWidth: mobile ? 390 : 1440,
        viewportHeight: mobile ? 844 : 900,
        deviceScaleFactor: mobile ? 2 : 1,
        isMobile: mobile,
        locale: "en-US",
        timezone: "UTC",
        colorScheme,
        networkProfile: "NATIVE",
      },
      authSessionId: authSessionID || undefined,
      agent: { requiredTags: [] },
      steps: steps.map((step) =>
        step.type === "NAVIGATE" && step.id === "step-open-start-page"
          ? { ...step, url: startURL }
          : step
      ),
      artifactPolicy: {
        successScreenshotHours: 24,
        failureEvidenceDays: 7,
        captureTraceOnFailure: true,
      },
      maskSelectors: [
        "input[type=password]",
        "[autocomplete=current-password]",
        "[data-rhythm-mask]",
      ],
    }
  }, [allowedOrigins, authSessionID, colorScheme, startURL, steps, viewport])

  const readiness = useMemo(() => {
    let validURL = false
    try {
      validURL = ["http:", "https:"].includes(new URL(startURL).protocol)
    } catch {
      validURL = false
    }
    const hasBlockingCheck = definition.steps.some(
      (step) =>
        step.enabled &&
        (step.checks?.some(
          (check) => check.enabled && check.gateMode === "BLOCKING"
        ) ||
          step.graph?.gateMode === "BLOCKING" ||
          step.type === "SCREENSHOT")
    )
    return {
      validURL,
      named: name.trim().length >= 3,
      hasSteps: definition.steps.some((step) => step.enabled),
      hasBlockingCheck,
    }
  }, [definition.steps, name, startURL])
  const canCreate =
    readiness.validURL && readiness.named && readiness.hasSteps && !submitting

  async function runPreview() {
    if (!readiness.validURL || !readiness.hasSteps) {
      setError(
        "Enter a valid start URL and configure at least one enabled step."
      )
      return
    }
    setError("")
    setPreviewing(true)
    try {
      const result = await previewUnsavedBrowserMonitor({
        data: {
          environmentProfileId: environmentID,
          definition,
        },
      })
      setPreview(result)
    } catch (reason) {
      setPreview(null)
      setError(
        reason instanceof Error
          ? reason.message
          : "The browser preview could not be completed."
      )
    } finally {
      setPreviewing(false)
    }
  }

  async function createMonitor() {
    if (!canCreate) return
    setError("")
    setSubmitting(true)
    try {
      const monitor = await createBrowserMonitor({
        data: {
          name: name.trim(),
          slug: slugify(name),
          description: description.trim(),
          applicationId: applicationID,
          serviceId: serviceID,
          environmentProfileId: environmentID,
          frequencySeconds,
          enabled,
          definition,
        },
      })
      await router.navigate({
        to: "/ui-monitoring/$monitorId",
        params: { monitorId: monitor.id },
      })
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The UI monitor could not be created."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main>
      <div className="border-b bg-muted/15">
        <PageContainer padding="header">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                aria-label="Back to UI monitoring"
                nativeButton={false}
                render={<Link to="/ui-monitoring" />}
                size="icon"
                variant="ghost"
              >
                <ArrowLeft />
              </Button>
              <div className="min-w-0">
                <p className="truncate font-semibold">Create UI monitor</p>
                <p className="text-xs text-muted-foreground">
                  Build a maintainable browser journey, then preview it safely.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={previewing || !readiness.validURL}
                onClick={() => void runPreview()}
                variant="outline"
              >
                {previewing ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Play />
                )}
                {previewing ? "Running preview…" : "Run preview"}
              </Button>
              <Button
                disabled={!canCreate}
                onClick={() => void createMonitor()}
              >
                {submitting ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <MonitorCheck />
                )}
                {enabled ? "Create and enable" : "Create draft"}
              </Button>
            </div>
          </div>
        </PageContainer>
      </div>

      <PageContainer padding="compact">
        {error ? (
          <div
            className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <section aria-labelledby="monitor-context">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MonitorCheck className="size-4" />
            </span>
            <div>
              <h1 className="text-lg font-semibold" id="monitor-context">
                Monitor context
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Define ownership, execution data, and the browser profile used
                for comparable history.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 rounded-xl border p-4 md:grid-cols-2 md:p-5 xl:grid-cols-3">
            <Field label="Monitor name" id="browser-name">
              <Input
                id="browser-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Customer dashboard readiness"
                value={name}
              />
            </Field>
            <Field label="Application" id="browser-application">
              <Select
                onValueChange={(value) => {
                  setApplicationID(value === "NONE" ? "" : (value ?? ""))
                  setServiceID("")
                }}
                value={applicationID || "NONE"}
              >
                <SelectTrigger id="browser-application">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Not linked yet</SelectItem>
                  {applications.map((application) => (
                    <SelectItem key={application.id} value={application.id}>
                      {application.name}
                      {application.carId ? ` · ${application.carId}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Service" id="browser-service">
              <Select
                disabled={!services.length}
                onValueChange={(value) =>
                  setServiceID(value === "NONE" ? "" : (value ?? ""))
                }
                value={serviceID || "NONE"}
              >
                <SelectTrigger id="browser-service">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">
                    {services.length
                      ? "All application services"
                      : "No services"}
                  </SelectItem>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Start URL"
              id="browser-start-url"
              hint="Variables such as {{baseUrl}} are resolved from the selected environment."
            >
              <Input
                aria-invalid={Boolean(startURL && !readiness.validURL)}
                id="browser-start-url"
                inputMode="url"
                onChange={(event) => setStartURL(event.target.value)}
                placeholder="https://portal.example.internal"
                value={startURL}
              />
            </Field>
            <Field label="Environment" id="browser-environment">
              <Select
                onValueChange={(value) =>
                  setEnvironmentID(value === "NONE" ? "" : (value ?? ""))
                }
                value={environmentID || "NONE"}
              >
                <SelectTrigger id="browser-environment">
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
            <Field
              label="Authentication session"
              id="browser-auth"
              hint="Reusable sessions are encrypted and remain origin-scoped."
            >
              <Select
                onValueChange={(value) =>
                  setAuthSessionID(value === "NONE" ? "" : (value ?? ""))
                }
                value={authSessionID || "NONE"}
              >
                <SelectTrigger id="browser-auth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No reusable session</SelectItem>
                  {authSessions.map((session) => (
                    <SelectItem
                      disabled={session.status === "EXPIRED"}
                      key={session.id}
                      value={session.id}
                    >
                      {session.name} · {session.status.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Viewport" id="browser-viewport">
              <Select
                onValueChange={(value) => value && setViewport(value)}
                value={viewport}
              >
                <SelectTrigger id="browser-viewport">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desktop">Desktop · 1440 × 900</SelectItem>
                  <SelectItem value="mobile">Mobile · 390 × 844</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Page color scheme" id="browser-color-scheme">
              <Select
                onValueChange={(value) =>
                  setColorScheme(
                    value as BrowserMonitorDefinition["profile"]["colorScheme"]
                  )
                }
                value={colorScheme}
              >
                <SelectTrigger id="browser-color-scheme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="no-preference">System neutral</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Additional allowed origins"
              id="browser-origins"
              hint="One origin per line. Cross-origin navigation outside this boundary is blocked."
            >
              <Textarea
                id="browser-origins"
                onChange={(event) => setAllowedOrigins(event.target.value)}
                placeholder="https://login.example.internal"
                value={allowedOrigins}
              />
            </Field>
            <div className="md:col-span-2 xl:col-span-3">
              <Field label="Description" id="browser-description">
                <Textarea
                  id="browser-description"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What user journey this monitor protects and why it matters."
                  value={description}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="journey-title">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold" id="journey-title">
                Browser journey
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Use resilient, user-facing locators. Rhythm reports ambiguity
                instead of silently changing a locator.
              </p>
            </div>
          </div>
          <JourneyBuilder
            onChange={setSteps}
            onSelectedStepIDChange={setSelectedStepID}
            selectedStepID={selectedStepID}
            steps={steps}
          />
        </section>

        <section className="mt-9" aria-labelledby="schedule-title">
          <h2 className="text-lg font-semibold" id="schedule-title">
            Schedule and enable
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Scheduled executions use pinned Chromium. Firefox and WebKit are
            available later as on-demand compatibility runs.
          </p>
          <div className="mt-4 grid gap-5 rounded-xl border p-4 md:grid-cols-2 md:p-5">
            <Field label="Run frequency" id="browser-frequency">
              <Select
                onValueChange={(value) => setFrequencySeconds(Number(value))}
                value={String(frequencySeconds)}
              >
                <SelectTrigger id="browser-frequency">
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
            <div className="flex min-h-20 items-center justify-between gap-4 rounded-lg bg-muted/30 px-4 py-3">
              <div>
                <Label htmlFor="browser-enable">Enable after creation</Label>
                <p className="mt-1 text-xs/5 text-muted-foreground">
                  The initial revision is published and the first execution is
                  scheduled immediately after the selected interval.
                </p>
              </div>
              <Switch
                checked={enabled}
                id="browser-enable"
                onCheckedChange={setEnabled}
              />
            </div>
          </div>
        </section>

        <PreviewPanel preview={preview} previewing={previewing} />

        <section className="mt-8 rounded-xl border bg-muted/15 p-4 md:p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <p className="font-medium">Ready to create?</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Readiness ready={readiness.named} label="Named" />
                <Readiness ready={readiness.validURL} label="Valid URL" />
                <Readiness
                  ready={readiness.hasSteps}
                  label="Journey configured"
                />
                <Readiness
                  ready={readiness.hasBlockingCheck}
                  label="Blocking outcome"
                  advisory
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={previewing || !readiness.validURL}
                onClick={() => void runPreview()}
                variant="outline"
              >
                <Play />
                Run safe preview
              </Button>
              <Button
                disabled={!canCreate}
                onClick={() => void createMonitor()}
              >
                {submitting ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <ShieldCheck />
                )}
                {enabled ? "Create and enable" : "Create draft"}
              </Button>
            </div>
          </div>
        </section>
      </PageContainer>
    </main>
  )
}

function PreviewPanel({
  preview,
  previewing,
}: {
  preview: BrowserPreview | null
  previewing: boolean
}) {
  if (!preview && !previewing) return null
  const screenshot = preview?.artifacts.find(
    (artifact) => artifact.contentType === "image/png"
  )
  return (
    <section className="mt-9" aria-labelledby="preview-title">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Eye className="size-4" />
        </span>
        <div>
          <h2 className="text-lg font-semibold" id="preview-title">
            Safe preview
          </h2>
          <p className="text-sm text-muted-foreground">
            Preview uses the same isolated browser path without saving a run.
          </p>
        </div>
      </div>
      {previewing ? (
        <div className="mt-4 flex min-h-40 items-center justify-center rounded-xl border">
          <LoaderCircle className="mr-2 size-4 animate-spin text-primary motion-reduce:animate-none" />
          <span className="text-sm text-muted-foreground">
            Running the browser journey…
          </span>
        </div>
      ) : preview ? (
        <div className="mt-4 grid overflow-hidden rounded-xl border lg:grid-cols-[1fr_22rem]">
          <div className="min-h-56 bg-muted/30 p-3">
            {screenshot ? (
              <img
                alt="Masked final browser preview"
                className="max-h-[32rem] w-full rounded-lg object-contain"
                src={`data:${screenshot.contentType};base64,${screenshot.contentBase64}`}
              />
            ) : (
              <div className="flex h-full min-h-52 items-center justify-center text-sm text-muted-foreground">
                No screenshot was captured by this draft.
              </div>
            )}
          </div>
          <div className="border-t p-4 lg:border-t-0 lg:border-l">
            <div className="flex items-center gap-2">
              {preview.status === "SUCCESS" ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <CircleAlert className="size-4 text-destructive" />
              )}
              <p className="font-medium">
                {preview.status.toLowerCase().replaceAll("_", " ")}
              </p>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <PreviewValue
                label="Journey"
                value={formatDuration(preview.durationMs)}
              />
              <PreviewValue
                label="Browser"
                value={`${preview.browserName} ${preview.browserVersion}`}
              />
              <PreviewValue
                label="Steps"
                value={`${preview.steps.filter((step) => step.status === "PASSED").length} / ${preview.steps.length} passed`}
              />
              <PreviewValue
                label="Warnings"
                value={String(preview.warningCount)}
              />
            </dl>
            {preview.failureReason ? (
              <p className="mt-4 rounded-lg bg-destructive/5 p-3 text-xs/5 text-destructive">
                {preview.failureReason}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function PreviewValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

function Readiness({
  ready,
  label,
  advisory = false,
}: {
  ready: boolean
  label: string
  advisory?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
        ready
          ? "bg-success-soft text-success-foreground"
          : advisory
            ? "bg-warning-soft text-warning-foreground"
            : "bg-muted text-muted-foreground"
      }`}
    >
      {ready ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <Clock3 className="size-3.5" />
      )}
      {label}
    </span>
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

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return slug || `ui-monitor-${Date.now()}`
}
