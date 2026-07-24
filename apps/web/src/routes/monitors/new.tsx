import { useState } from "react"
import type { FormEvent } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
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
  CalendarClock,
  ChevronDown,
  CircleAlert,
  FileClock,
  LoaderCircle,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react"

import { createMonitorSchema } from "@/features/monitors/schema"
import {
  initialRequestDefinition,
  normalizeDefinitionScripts,
  RequestWorkbench,
} from "@/features/monitors/request-workbench"
import type { RequestDefinition } from "@/features/monitors/request-workbench"
import { createMonitor } from "@/lib/api-client/monitors"
import type { ScheduleContract } from "@/lib/api-client/contracts"
import {
  listELFApplications,
  setApplicationMonitorLink,
} from "@/lib/api-client/elf"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/monitors/new")({
  loader: () => listELFApplications(),
  component: NewMonitorPage,
})

type FormValues = {
  name: string
  slug: string
  description: string
  ownerId: string
  tags: string
}

const initialValues: FormValues = {
  name: "",
  slug: "",
  description: "",
  ownerId: "",
  tags: "",
}
const initialSchedule: ScheduleContract = {
  type: "INTERVAL",
  intervalSeconds: 300,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  jitterSeconds: 0,
  concurrencyPolicy: "SKIP_IF_RUNNING",
  missedRunPolicy: "SKIP",
  active: false,
}

const frequencyOptions = [
  [10, "Every 10 seconds"],
  [30, "Every 30 seconds"],
  [60, "Every minute"],
  [300, "Every 5 minutes"],
  [900, "Every 15 minutes"],
  [1800, "Every 30 minutes"],
  [3600, "Every hour"],
  [21600, "Every 6 hours"],
  [43200, "Every 12 hours"],
  [86400, "Every day"],
] as const

function NewMonitorPage() {
  const applications = Route.useLoaderData()
  const navigate = useNavigate()
  const [values, setValues] = useState(initialValues)
  const [definition, setDefinition] = useState<RequestDefinition>(
    initialRequestDefinition
  )
  const [schedule, setSchedule] = useState<ScheduleContract>(initialSchedule)
  const [enabled, setEnabled] = useState(false)
  const [slugEdited, setSlugEdited] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [slugAdvancedOpen, setSlugAdvancedOpen] = useState(false)
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [createdMonitorId, setCreatedMonitorId] = useState("")
  const [applicationId, setApplicationId] = useState("")

  function updateValue(field: keyof FormValues, value: string) {
    setValues((current) => {
      const next = { ...current, [field]: value }
      if (field === "name" && !slugEdited) next.slug = slugify(value)
      return next
    })
    setFieldErrors((current) => ({ ...current, [field]: "" }))
  }

  function regenerateSlug() {
    setSlugEdited(false)
    setValues((current) => ({ ...current, slug: slugify(current.name) }))
    setFieldErrors((current) => ({ ...current, slug: "" }))
  }

  function resolvedSlug(name: string, slug: string) {
    return slug.trim() || slugify(name)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")
    const missingURL = definition.steps.findIndex(
      (step) => step.type === "HTTP_REQUEST" && !step.request.url.trim()
    )
    if (missingURL >= 0) {
      setFormError(
        `Enter a request URL for step ${missingURL + 1} before creating the draft.`
      )
      document
        .querySelector<HTMLInputElement>('[aria-label="Request URL"]')
        ?.focus()
      return
    }
    for (const [index, step] of definition.steps.entries()) {
      if (step.type === "ACTION" || step.type === "METRIC_VALIDATION") continue
      try {
        const parsedURL = new URL(
          step.request.url.replace(/\{\{[^}]+\}\}/g, "template.example")
        )
        if (parsedURL.protocol !== "http:" && parsedURL.protocol !== "https:")
          throw new Error("unsupported protocol")
      } catch {
        setFormError(
          `Step ${index + 1} needs a valid HTTP or HTTPS request URL. Template expressions are supported.`
        )
        return
      }
      const body = step.request.body
      if (body.type === "json" && body.content.trim()) {
        try {
          JSON.parse(body.content)
        } catch {
          setFormError(`The JSON request body in step ${index + 1} is invalid.`)
          return
        }
      }
    }
    const slug = resolvedSlug(values.name, values.slug)
    if (slug !== values.slug) {
      setValues((current) => ({ ...current, slug }))
    }
    const result = createMonitorSchema.safeParse({
      name: values.name,
      slug,
      description: values.description,
      ownerId: values.ownerId,
      tags: values.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      definition: normalizeDefinitionScripts(definition),
      enabled,
      schedule,
    })
    if (!result.success) {
      const errors: Record<string, string> = {}
      for (const issue of result.error.issues)
        errors[String(issue.path[0])] ??= issue.message
      setFieldErrors(errors)
      setDetailsOpen(true)
      if (errors.slug) setSlugAdvancedOpen(true)
      if (errors.ownerId || errors.tags || errors.description)
        setMoreDetailsOpen(true)
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      )
      return
    }

    setSubmitting(true)
    try {
      const response = await createMonitor({ data: result.data })
      if (!response.ok) {
        setFieldErrors(response.fieldErrors ?? {})
        setFormError(response.message)
        setCreatedMonitorId(response.monitorId ?? "")
        return
      }
      if (applicationId) {
        const linkResult = await setApplicationMonitorLink({
          data: {
            applicationId,
            monitorId: response.monitor.id,
            linked: true,
          },
        })
        if (!linkResult.ok) {
          setCreatedMonitorId(response.monitor.id)
          setFormError(
            `The monitor was created, but its application tag could not be saved. ${linkResult.message}`
          )
          return
        }
      }
      await navigate({
        to: "/monitors/$monitorId/edit",
        params: { monitorId: response.monitor.id },
      })
    } catch {
      setFormError(
        "The monitor could not be created. Check the connection and try again."
      )
    } finally {
      setSubmitting(false)
    }
  }

  const configuredCount = countConfigured(definition)
  const nextRunPreview =
    enabled && schedule.type === "INTERVAL"
      ? new Date(Date.now() + (schedule.intervalSeconds ?? 300) * 1000)
      : null
  const submitLabel = enabled ? "Create & enable" : "Create draft"

  return (
    <form onSubmit={handleSubmit} noValidate className="min-h-full">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 md:px-6">
          <Button
            render={<Link to="/monitors" />}
            nativeButton={false}
            variant="ghost"
            size="icon-sm"
            aria-label="Back to monitors"
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">
                New API monitor
              </h1>
              <Badge variant="secondary">Draft</Badge>
            </div>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Configure the request, runtime actions, extraction, and success
              criteria.
            </p>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <Save className="size-3.5" /> Not saved
          </div>
          <Button
            render={<Link to="/monitors" />}
            nativeButton={false}
            variant="ghost"
            aria-disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : enabled ? (
              <Power data-icon="inline-start" />
            ) : (
              <FileClock data-icon="inline-start" />
            )}
            {submitting ? "Creating monitor…" : submitLabel}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-6 md:py-6">
        {formError ? (
          <Alert className="mb-5" variant="destructive">
            <CircleAlert />
            <AlertTitle>Check the monitor configuration</AlertTitle>
            <AlertDescription>
              {formError}
              {createdMonitorId ? (
                <>
                  {" "}
                  <Link
                    className="font-medium underline underline-offset-4"
                    to="/monitors/$monitorId/edit"
                    params={{ monitorId: createdMonitorId }}
                  >
                    Open the saved monitor
                  </Link>
                  .
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <section
          className="mb-5 rounded-xl border bg-muted/20"
          aria-labelledby="monitor-details-heading"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
          >
            <div className="min-w-0">
              <h2
                id="monitor-details-heading"
                className="text-sm font-semibold"
              >
                Monitor details
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                Identity, ownership, and tags
                <span className="hidden sm:inline">
                  {" "}
                  · {values.name || "Unnamed monitor"}
                </span>
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium text-primary">
              {detailsOpen ? "Collapse" : "Edit"}
            </span>
          </button>
          {detailsOpen ? (
            <div className="space-y-3 border-t bg-background px-4 py-3">
              <div className="grid gap-x-3 gap-y-2.5 md:grid-cols-2">
                <Field
                  className="gap-1.5"
                  data-invalid={Boolean(fieldErrors.name)}
                >
                  <FieldLabel htmlFor="monitor-name">Name</FieldLabel>
                  <Input
                    id="monitor-name"
                    autoFocus
                    value={values.name}
                    onChange={(event) =>
                      updateValue("name", event.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby="monitor-slug-preview"
                    placeholder="Protected payment journey"
                  />
                  <FieldError>{fieldErrors.name}</FieldError>
                  <p
                    id="monitor-slug-preview"
                    className="text-xs text-muted-foreground"
                  >
                    API id{" "}
                    <span className="font-mono text-foreground/70">
                      {resolvedSlug(values.name, values.slug) || "—"}
                    </span>
                    {slugEdited ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · customized
                      </span>
                    ) : null}
                  </p>
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="monitor-application">
                    Application{" "}
                    <span
                      className="font-normal text-muted-foreground"
                      title="Links this monitor to its owning application"
                    >
                      Optional
                    </span>
                  </FieldLabel>
                  <Select
                    value={applicationId || null}
                    onValueChange={(value) => setApplicationId(value ?? "")}
                    items={[
                      { value: null, label: "Not assigned" },
                      ...applications.map((application) => ({
                        value: application.id,
                        label: `${application.name}${application.carId ? ` · ${application.carId}` : ""}`,
                      })),
                    ]}
                  >
                    <SelectTrigger
                      id="monitor-application"
                      className="h-9 w-full"
                      aria-describedby="monitor-application-hint"
                      title="Links this monitor to its owning application"
                    >
                      <SelectValue placeholder="Not assigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>Not assigned</SelectItem>
                      {applications.map((application) => (
                        <SelectItem
                          key={application.id}
                          value={application.id}
                        >
                          {application.name}
                          {application.carId
                            ? ` · ${application.carId}`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span id="monitor-application-hint" className="sr-only">
                    Links this monitor to its owning application.
                  </span>
                </Field>
              </div>

              <div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setSlugAdvancedOpen((open) => !open)}
                  aria-expanded={slugAdvancedOpen}
                >
                  <ChevronDown
                    className={`size-3.5 transition-transform ${slugAdvancedOpen ? "rotate-0" : "-rotate-90"}`}
                  />
                  Customize slug
                </button>
                {slugAdvancedOpen ? (
                  <Field
                    className="mt-2 max-w-xl gap-1.5"
                    data-invalid={Boolean(fieldErrors.slug)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel htmlFor="monitor-slug">Slug</FieldLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={regenerateSlug}
                        disabled={!values.name.trim()}
                      >
                        <RefreshCw data-icon="inline-start" />
                        Regenerate from name
                      </Button>
                    </div>
                    <Input
                      id="monitor-slug"
                      className="font-mono"
                      value={values.slug}
                      onChange={(event) => {
                        setSlugEdited(true)
                        updateValue("slug", event.target.value)
                      }}
                      aria-invalid={Boolean(fieldErrors.slug)}
                      aria-describedby="monitor-slug-hint"
                      placeholder="protected-payment-journey"
                      title="Stable API identifier"
                    />
                    <span
                      id="monitor-slug-hint"
                      className="text-xs text-muted-foreground"
                    >
                      Stable API identifier. Editing stops auto-sync until you
                      regenerate.
                    </span>
                    <FieldError>{fieldErrors.slug}</FieldError>
                  </Field>
                ) : null}
              </div>

              <div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setMoreDetailsOpen((open) => !open)}
                  aria-expanded={moreDetailsOpen}
                >
                  <ChevronDown
                    className={`size-3.5 transition-transform ${moreDetailsOpen ? "rotate-0" : "-rotate-90"}`}
                  />
                  More details
                  <span className="font-normal">
                    · owner, tags, description
                  </span>
                </button>
                {moreDetailsOpen ? (
                  <div className="mt-2.5 grid gap-x-3 gap-y-2.5 md:grid-cols-2">
                    <Field
                      className="gap-1.5"
                      data-invalid={Boolean(fieldErrors.ownerId)}
                    >
                      <FieldLabel htmlFor="monitor-owner">
                        Owner{" "}
                        <span className="font-normal text-muted-foreground">
                          Optional
                        </span>
                      </FieldLabel>
                      <Input
                        id="monitor-owner"
                        value={values.ownerId}
                        onChange={(event) =>
                          updateValue("ownerId", event.target.value)
                        }
                        aria-invalid={Boolean(fieldErrors.ownerId)}
                        placeholder="Payments SRE"
                      />
                      <FieldError>{fieldErrors.ownerId}</FieldError>
                    </Field>
                    <Field
                      className="gap-1.5"
                      data-invalid={Boolean(fieldErrors.tags)}
                    >
                      <FieldLabel htmlFor="monitor-tags">
                        Tags{" "}
                        <span className="font-normal text-muted-foreground">
                          Optional
                        </span>
                      </FieldLabel>
                      <Input
                        id="monitor-tags"
                        value={values.tags}
                        onChange={(event) =>
                          updateValue("tags", event.target.value)
                        }
                        aria-invalid={Boolean(fieldErrors.tags)}
                        placeholder="payments, critical"
                      />
                      <FieldError>{fieldErrors.tags}</FieldError>
                    </Field>
                    <Field
                      className="gap-1.5 md:col-span-2"
                      data-invalid={Boolean(fieldErrors.description)}
                    >
                      <FieldLabel htmlFor="monitor-description">
                        Description{" "}
                        <span className="font-normal text-muted-foreground">
                          Optional
                        </span>
                      </FieldLabel>
                      <Textarea
                        id="monitor-description"
                        rows={2}
                        className="min-h-9 resize-y py-1.5"
                        value={values.description}
                        onChange={(event) =>
                          updateValue("description", event.target.value)
                        }
                        aria-invalid={Boolean(fieldErrors.description)}
                        placeholder="Business journey and the outcome it protects"
                      />
                      <FieldError>{fieldErrors.description}</FieldError>
                    </Field>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section
          className="mb-5 rounded-xl border bg-background"
          aria-labelledby="monitor-schedule-heading"
        >
          <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <CalendarClock className="size-4" />
              </span>
              <div>
                <h2
                  id="monitor-schedule-heading"
                  className="text-sm font-semibold"
                >
                  Run schedule
                </h2>
                <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                  Choose how often Rhythm runs this monitor. You can change
                  advanced scheduling options after creation.
                </p>
              </div>
            </div>
            <Field className="w-full lg:w-48">
              <FieldLabel htmlFor="schedule-mode">Run frequency</FieldLabel>
              <Select
                value={schedule.type}
                onValueChange={(value) => {
                  if (value == null) return
                  setSchedule((current) => ({
                    ...current,
                    type: value as ScheduleContract["type"],
                  }))
                }}
                items={{
                  INTERVAL: "On an interval",
                  MANUAL: "Manual only",
                }}
              >
                <SelectTrigger id="schedule-mode" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INTERVAL">On an interval</SelectItem>
                  <SelectItem value="MANUAL">Manual only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {schedule.type === "INTERVAL" ? (
              <Field className="w-full lg:w-52">
                <FieldLabel htmlFor="schedule-frequency">Repeat</FieldLabel>
                <Select
                  value={String(schedule.intervalSeconds ?? 300)}
                  onValueChange={(value) => {
                    if (value == null) return
                    setSchedule((current) => ({
                      ...current,
                      intervalSeconds: Number(value),
                    }))
                  }}
                  items={Object.fromEntries(
                    frequencyOptions.map(([seconds, label]) => [
                      String(seconds),
                      label,
                    ])
                  )}
                >
                  <SelectTrigger id="schedule-frequency" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {frequencyOptions.map(([seconds, label]) => (
                      <SelectItem key={seconds} value={String(seconds)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <div className="flex w-full items-center justify-between gap-4 rounded-lg bg-muted/45 px-4 py-3 lg:w-[310px]">
              <div>
                <p className="text-sm font-medium">Enable after creation</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {enabled
                    ? schedule.type === "INTERVAL"
                      ? "Publishes and starts the schedule."
                      : "Publishes for manual runs."
                    : "Keeps this monitor as a draft."}
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Enable monitor after creation"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t bg-muted/20 px-4 py-3 text-xs">
            <span className="font-medium">Next run</span>
            <span
              className={
                nextRunPreview ? "text-foreground" : "text-muted-foreground"
              }
            >
              {nextRunPreview
                ? formatDateTime(nextRunPreview)
                : enabled
                  ? "No automatic run — manual only"
                  : "Starts after the monitor is enabled"}
            </span>
            {nextRunPreview ? (
              <span className="text-muted-foreground">
                Exact time is confirmed when the monitor is created.
              </span>
            ) : null}
          </div>
        </section>

        <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-semibold">Request workbench</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Build an ordered workflow. Extracted outputs can be referenced by
              later request templates.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-success" /> {configuredCount}{" "}
            request areas configured
          </div>
        </div>

        <RequestWorkbench value={definition} onChange={setDefinition} />

        <div className="mt-5 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            {enabled
              ? "Rhythm will validate and publish revision 1, enable the monitor, and activate its schedule in one step."
              : "The configuration and schedule will be saved as draft revision 1. Enable it later when you are ready."}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              render={<Link to="/monitors" />}
              nativeButton={false}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : enabled ? (
                <Power data-icon="inline-start" />
              ) : (
                <FileClock data-icon="inline-start" />
              )}
              {submitting ? "Creating monitor…" : submitLabel}
            </Button>
          </div>
        </div>
      </main>
    </form>
  )
}

function countConfigured(definition: RequestDefinition) {
  const monitorScriptConfigured = Boolean(definition.scripts.preRequest.code.trim())
  return definition.steps.reduce((total, step) => {
    if (step.type === "ACTION")
      return total + step.actions.filter((item) => item.enabled).length
    if (step.type === "METRIC_VALIDATION") return total + 1
    const request = step.request
    return (
      total +
      [
        request.params.some((item) => item.enabled && item.key),
        request.headers.some((item) => item.enabled && item.key),
        request.auth.type !== "none",
        request.body.type !== "none",
        request.cookies.some((item) => item.enabled),
        Boolean(request.preRequestScript.code.trim()) ||
          monitorScriptConfigured,
        request.extractors.some((item) => item.enabled),
        request.assertions.some((item) => item.enabled),
        Boolean(request.tls.certificateProfileId || request.tls.caProfileId),
        request.proxy.mode !== "environment",
      ].filter(Boolean).length
    )
  }, 0)
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
