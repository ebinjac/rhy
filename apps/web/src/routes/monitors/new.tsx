import { lazy, Suspense, useMemo, useRef, useState } from "react"
import type { FormEvent } from "react"
import {
  createFileRoute,
  Link,
  useBlocker,
  useNavigate,
} from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field"
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
  Play,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  Upload,
} from "lucide-react"

import { createMonitorSchema } from "@/features/monitors/schema"
import { MonitorImportDialog } from "@/features/monitors/monitor-import-dialog"
import type { ImportedMonitorDraft } from "@/features/monitors/monitor-import"
import { PageContainer } from "@/components/page-container"
import {
  initialRequestDefinition,
  normalizeDefinitionScripts,
} from "@/features/monitors/request-definition"
import type {
  RequestDefinition,
  RequestWorkbenchFocusTarget,
} from "@/features/monitors/request-definition"
import {
  cancelMonitorDraftPreview,
  createMonitor,
  listConfigurationProfiles,
  previewMonitorDraft,
} from "@/lib/api-client/monitors"
import type {
  DraftMonitorPreviewContract,
  ScheduleContract,
} from "@/lib/api-client/contracts"
import {
  listELFApplications,
  setApplicationMonitorLink,
} from "@/lib/api-client/elf"
import { formatDateTime } from "@/lib/format-date"

const RequestWorkbench = lazy(async () => ({
  default: (await import("@/features/monitors/request-workbench"))
    .RequestWorkbench,
}))

export const Route = createFileRoute("/monitors/new")({
  loader: async () => {
    const [applications, secrets, environments] = await Promise.all([
      listELFApplications(),
      listConfigurationProfiles({ data: { kind: "secrets" } }),
      listConfigurationProfiles({ data: { kind: "environments" } }),
    ])
    return { applications, secrets, environments }
  },
  head: () => ({
    meta: [
      { title: "Create API monitor · Rhythm" },
      {
        name: "description",
        content:
          "Build, safely preview, schedule, and enable a multi-step API monitor.",
      },
    ],
  }),
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
  const { applications, secrets, environments } = Route.useLoaderData()
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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createdMonitorId, setCreatedMonitorId] = useState("")
  const [applicationId, setApplicationId] = useState("")
  const [environmentId, setEnvironmentId] = useState("")
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<DraftMonitorPreviewContract | null>(
    null
  )
  const [previewError, setPreviewError] = useState("")
  const [previewConfirmationOpen, setPreviewConfirmationOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importNotice, setImportNotice] = useState<ImportedMonitorDraft | null>(
    null
  )
  const [focusTarget, setFocusTarget] =
    useState<RequestWorkbenchFocusTarget | null>(null)
  const [scheduleAnchor, setScheduleAnchor] = useState(() => Date.now())
  const initialSnapshot = useRef(
    JSON.stringify({
      values: initialValues,
      definition: initialRequestDefinition,
      schedule: initialSchedule,
      enabled: false,
      applicationId: "",
      environmentId: "",
    })
  )
  const currentPreviewId = useRef("")
  const creationId = useRef(newPreviewID())
  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const allowNavigationRef = useRef(false)
  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        values,
        definition,
        schedule,
        enabled,
        applicationId,
        environmentId,
      }),
    [applicationId, definition, enabled, environmentId, schedule, values]
  )
  const isDirty =
    !createdMonitorId && currentSnapshot !== initialSnapshot.current
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty && !allowNavigationRef.current,
    enableBeforeUnload: isDirty && !isSubmitting,
    disabled: isSubmitting || Boolean(createdMonitorId),
    withResolver: true,
  })

  function updateValue(field: keyof FormValues, value: string) {
    setValues((current) => {
      const next = { ...current, [field]: value }
      if (field === "name" && !slugEdited) next.slug = slugify(value)
      return next
    })
    setFieldErrors((current) => ({ ...current, [field]: "" }))
    if (!createdMonitorId) setFormError("")
  }

  function updateDefinition(value: RequestDefinition) {
    setDefinition(value)
    if (!createdMonitorId) setFormError("")
    setPreview(null)
    setPreviewError("")
  }

  function applyImport(draft: ImportedMonitorDraft) {
    const name = draft.name.slice(0, 255)
    setValues((current) => ({
      ...current,
      name,
      slug: slugify(name),
      description: draft.description.slice(0, 2000),
    }))
    setSlugEdited(false)
    setDefinition(draft.definition)
    setDetailsOpen(true)
    setFieldErrors({})
    setFormError("")
    setPreview(null)
    setPreviewError("")
    setImportNotice(draft)
    requestAnimationFrame(() =>
      document
        .getElementById("request-workbench-heading")
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    )
  }

  function regenerateSlug() {
    setSlugEdited(false)
    setValues((current) => ({ ...current, slug: slugify(current.name) }))
    setFieldErrors((current) => ({ ...current, slug: "" }))
  }

  function resolvedSlug(name: string, slug: string) {
    return slug.trim() || slugify(name)
  }

  const sideEffectingSteps = definition.steps.filter(
    (step) =>
      step.type === "HTTP_REQUEST" &&
      !["GET", "HEAD", "OPTIONS"].includes(step.request.method.toUpperCase())
  )

  function requestDraftPreview() {
    if (createdMonitorId) return
    const invalidStepIndex = definition.steps.findIndex(
      (step) =>
        step.type === "HTTP_REQUEST" &&
        (!step.request.url.trim() || !isValidTemplatedHTTPURL(step.request.url))
    )
    if (invalidStepIndex >= 0) {
      const invalidStep = definition.steps[invalidStepIndex]
      showValidationFailure(
        `Enter a valid HTTP or HTTPS request URL for step ${invalidStepIndex + 1} before running the preview.`,
        { stepId: invalidStep.id, section: "params", field: "url" }
      )
      return
    }
    for (const [index, step] of definition.steps.entries()) {
      if (
        step.type !== "HTTP_REQUEST" ||
        step.request.body.type !== "json" ||
        !step.request.body.content.trim()
      )
        continue
      try {
        JSON.parse(normalizeJSONTemplates(step.request.body.content))
      } catch {
        showValidationFailure(
          `Fix the JSON request body in step ${index + 1} before running the preview.`,
          { stepId: step.id, section: "body", field: "body" }
        )
        return
      }
    }
    if (sideEffectingSteps.length) {
      setPreviewConfirmationOpen(true)
      return
    }
    void runDraftPreview()
  }

  async function runDraftPreview() {
    if (previewing) return
    setPreviewConfirmationOpen(false)
    setPreviewing(true)
    setPreview(null)
    setPreviewError("")
    const previewId = newPreviewID()
    currentPreviewId.current = previewId
    try {
      const result = await previewMonitorDraft({
        data: {
          definition: normalizeDefinitionScripts(definition),
          previewId,
          environmentId: environmentId || undefined,
        },
      })
      if (currentPreviewId.current !== previewId) return
      if (!result.ok) {
        setPreviewError(result.message)
        return
      }
      setPreview(result.preview)
    } finally {
      if (currentPreviewId.current === previewId) {
        currentPreviewId.current = ""
        setPreviewing(false)
      }
    }
  }

  async function cancelDraftPreview() {
    const previewId = currentPreviewId.current
    if (!previewId) return
    currentPreviewId.current = ""
    setPreviewing(false)
    setPreviewError("Draft preview was cancelled.")
    await cancelMonitorDraftPreview({ data: { previewId } })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting || previewing || createdMonitorId) return
    setFormError("")
    setFocusTarget(null)
    const missingURL = definition.steps.findIndex(
      (step) => step.type === "HTTP_REQUEST" && !step.request.url.trim()
    )
    if (missingURL >= 0) {
      showValidationFailure(
        `Enter a request URL for step ${missingURL + 1} before creating the draft.`,
        {
          stepId: definition.steps[missingURL].id,
          section: "params",
          field: "url",
        }
      )
      return
    }
    for (const [index, step] of definition.steps.entries()) {
      if (step.type === "ACTION" || step.type === "METRIC_VALIDATION") continue
      if (!isValidTemplatedHTTPURL(step.request.url)) {
        showValidationFailure(
          `Step ${index + 1} needs a valid HTTP or HTTPS request URL. Template expressions such as {{baseUrl}} are supported.`,
          { stepId: step.id, section: "params", field: "url" }
        )
        return
      }
      const body = step.request.body
      if (body.type === "json" && body.content.trim()) {
        try {
          JSON.parse(normalizeJSONTemplates(body.content))
        } catch {
          showValidationFailure(
            `The JSON request body in step ${index + 1} is invalid. Template expressions are allowed in string and value positions.`,
            { stepId: step.id, section: "body", field: "body" }
          )
          return
        }
      }
    }
    const slug = resolvedSlug(values.name, values.slug)
    if (slug !== values.slug) {
      setValues((current) => ({ ...current, slug }))
    }
    const result = createMonitorSchema.safeParse({
      creationId: creationId.current,
      name: values.name,
      slug,
      description: values.description,
      ownerId: values.ownerId,
      environmentId: environmentId || undefined,
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
      requestAnimationFrame(() => {
        errorSummaryRef.current?.focus()
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }

    setIsSubmitting(true)
    try {
      const response = await createMonitor({ data: result.data })
      if (!response.ok) {
        setFieldErrors(response.fieldErrors ?? {})
        setFormError(response.message)
        setCreatedMonitorId(response.monitorId ?? "")
        requestAnimationFrame(() => errorSummaryRef.current?.focus())
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
          requestAnimationFrame(() => errorSummaryRef.current?.focus())
          return
        }
      }
      allowNavigationRef.current = true
      await navigate({
        to: "/monitors/$monitorId/edit",
        params: { monitorId: response.monitor.id },
      })
    } catch {
      setFormError(
        "The monitor could not be created. Check the connection and try again."
      )
      requestAnimationFrame(() => errorSummaryRef.current?.focus())
    } finally {
      setIsSubmitting(false)
    }
  }

  function showValidationFailure(
    message: string,
    target: Omit<RequestWorkbenchFocusTarget, "requestKey">
  ) {
    setFormError(message)
    setFocusTarget({ ...target, requestKey: Date.now() })
    requestAnimationFrame(() => errorSummaryRef.current?.focus())
  }

  const readiness = monitorReadiness(definition, values.name)
  const nextRunPreview =
    enabled && schedule.type === "INTERVAL"
      ? new Date(scheduleAnchor + (schedule.intervalSeconds ?? 300) * 1000)
      : null
  const submitLabel = enabled ? "Create & enable" : "Create draft"

  function leavePage() {
    if (isSubmitting || previewing) return
    void navigate({ to: "/monitors" })
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="min-h-full"
      aria-busy={isSubmitting || previewing}
    >
      <header className="sticky top-16 z-10 border-b bg-background/95 backdrop-blur-sm">
        <PageContainer
          padding="header"
          className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-2 md:flex md:gap-3"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 md:min-h-8 md:min-w-8"
            onClick={leavePage}
            disabled={isSubmitting || previewing}
            aria-label="Back to monitors"
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">
                New API monitor
              </h1>
              <Badge variant="secondary">
                {createdMonitorId ? "Saved" : "Draft"}
              </Badge>
            </div>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Configure the request, runtime actions, extraction, and success
              criteria.
            </p>
          </div>
          <div
            className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"
            role="status"
          >
            <Save className="size-3.5" />{" "}
            {createdMonitorId
              ? "Monitor saved"
              : isDirty
                ? "Unsaved changes"
                : "Not started"}
          </div>
          <div className="col-span-2 grid grid-cols-3 gap-2 md:col-auto md:flex">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 md:min-h-8"
              onClick={leavePage}
              disabled={isSubmitting || previewing}
            >
              Cancel
            </Button>
            <Button
              disabled={isSubmitting || Boolean(createdMonitorId)}
              onClick={
                previewing
                  ? () => void cancelDraftPreview()
                  : requestDraftPreview
              }
              type="button"
              variant="outline"
              className="min-h-11 md:min-h-8"
            >
              {previewing ? (
                <Square data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {previewing ? "Cancel preview" : "Run preview"}
            </Button>
            {createdMonitorId ? (
              <Button
                type="button"
                render={
                  <Link
                    to="/monitors/$monitorId/edit"
                    params={{ monitorId: createdMonitorId }}
                  />
                }
                nativeButton={false}
                className="min-h-11 md:min-h-8"
              >
                Open monitor
              </Button>
            ) : (
              <Button
                type="submit"
                className="min-h-11 md:min-h-8"
                disabled={isSubmitting || previewing}
              >
                {isSubmitting ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : enabled ? (
                  <Power data-icon="inline-start" />
                ) : (
                  <FileClock data-icon="inline-start" />
                )}
                {isSubmitting ? "Creating…" : submitLabel}
              </Button>
            )}
          </div>
        </PageContainer>
      </header>

      <PageContainer as="main" padding="compact">
        {importNotice ? (
          <Alert className="mb-5" role="status" aria-live="polite">
            <Upload />
            <AlertTitle>
              {importNotice.source === "postman"
                ? "Postman collection loaded"
                : "cURL request loaded"}
            </AlertTitle>
            <AlertDescription>
              <p>
                Added {importNotice.summary.requests} request
                {importNotice.summary.requests === 1 ? "" : "s"} to this unsaved
                draft. Review the workbench, map secret placeholders, then run a
                preview before creating the monitor.
              </p>
              {importNotice.warnings.length ? (
                <p className="mt-1">
                  {importNotice.warnings.length} import item
                  {importNotice.warnings.length === 1 ? "" : "s"} need review.
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {preview || previewError ? (
          <Alert
            className="mb-5"
            role="status"
            aria-live="polite"
            variant={
              previewError || preview?.status === "FAILED"
                ? "destructive"
                : "default"
            }
          >
            {previewError || preview?.status === "FAILED" ? (
              <CircleAlert />
            ) : (
              <ShieldCheck />
            )}
            <AlertTitle>
              {previewError
                ? "Draft preview failed"
                : preview?.status === "SUCCESS"
                  ? "Draft request succeeded"
                  : `Draft preview ${preview?.status.toLowerCase().replaceAll("_", " ")}`}
            </AlertTitle>
            <AlertDescription>
              {previewError ? (
                previewError
              ) : preview ? (
                <div className="space-y-3">
                  <p>
                    {preview.steps.length} step
                    {preview.steps.length === 1 ? "" : "s"} executed in{" "}
                    {preview.durationMs.toLocaleString()} ms.{" "}
                    {preview.failureReason ||
                      "This real execution was not persisted and did not change the monitor."}
                  </p>
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {preview.steps.map((previewStep) => (
                      <li
                        key={previewStep.stepDefinitionId}
                        className="flex items-center justify-between gap-3 rounded-md border bg-background/70 p-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {previewStep.stepName}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {previewStep.status} ·{" "}
                            {previewStep.durationMs.toLocaleString()} ms
                            {previewStep.errorMessage
                              ? ` · ${previewStep.errorMessage}`
                              : ""}
                          </span>
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setFocusTarget({
                              requestKey: Date.now(),
                              stepId: previewStep.stepDefinitionId,
                              section: previewFailureSection(previewStep),
                              field: "section",
                            })
                          }
                        >
                          Edit
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {formError ? (
          <Alert
            ref={errorSummaryRef}
            tabIndex={-1}
            className="mb-5 scroll-mt-36"
            variant="destructive"
            role="alert"
            aria-live="assertive"
          >
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
            aria-controls="monitor-details-panel"
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
            <div
              id="monitor-details-panel"
              className="space-y-3 border-t bg-background px-4 py-3"
            >
              <div className="grid gap-x-3 gap-y-2.5 md:grid-cols-2">
                <Field
                  className="gap-1.5"
                  data-invalid={Boolean(fieldErrors.name)}
                >
                  <FieldLabel htmlFor="monitor-name">Name</FieldLabel>
                  <Input
                    id="monitor-name"
                    value={values.name}
                    onChange={(event) =>
                      updateValue("name", event.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={
                      fieldErrors.name
                        ? "monitor-name-error monitor-slug-preview"
                        : "monitor-slug-preview"
                    }
                    placeholder="Protected payment journey"
                  />
                  <FieldError id="monitor-name-error">
                    {fieldErrors.name}
                  </FieldError>
                  <p
                    id="monitor-slug-preview"
                    className="text-xs text-muted-foreground"
                  >
                    API identifier{" "}
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
                    onValueChange={(value) => {
                      setApplicationId(value ?? "")
                      if (!createdMonitorId) setFormError("")
                    }}
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
                        <SelectItem key={application.id} value={application.id}>
                          {application.name}
                          {application.carId ? ` · ${application.carId}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span id="monitor-application-hint" className="sr-only">
                    Links this monitor to its owning application.
                  </span>
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="monitor-environment">
                    Runtime environment{" "}
                    <span className="font-normal text-muted-foreground">
                      Optional
                    </span>
                  </FieldLabel>
                  <Select
                    value={environmentId || null}
                    onValueChange={(next) => {
                      setEnvironmentId(next ?? "")
                      setPreview(null)
                      setPreviewError("")
                    }}
                    items={[
                      { value: null, label: "No environment" },
                      ...environments.map((profile) => ({
                        value: profile.id,
                        label: `${profile.name} · ${profile.profileType}`,
                      })),
                    ]}
                  >
                    <SelectTrigger
                      id="monitor-environment"
                      className="h-9 w-full"
                      aria-describedby="monitor-environment-help"
                    >
                      <SelectValue placeholder="No environment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>No environment</SelectItem>
                      {environments.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name} · {profile.profileType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p
                    id="monitor-environment-help"
                    className="text-xs text-muted-foreground"
                  >
                    Loads baseUrl, region, variables, and secret references for
                    previews and scheduled runs.
                  </p>
                </Field>
              </div>

              <div>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-7"
                  onClick={() => setSlugAdvancedOpen((open) => !open)}
                  aria-expanded={slugAdvancedOpen}
                  aria-controls="monitor-slug-advanced"
                >
                  <ChevronDown
                    className={`size-3.5 transition-transform ${slugAdvancedOpen ? "rotate-0" : "-rotate-90"}`}
                  />
                  Customize API identifier
                </button>
                {slugAdvancedOpen ? (
                  <Field
                    id="monitor-slug-advanced"
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
                      aria-describedby={
                        fieldErrors.slug
                          ? "monitor-slug-hint monitor-slug-error"
                          : "monitor-slug-hint"
                      }
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
                    <FieldError id="monitor-slug-error">
                      {fieldErrors.slug}
                    </FieldError>
                  </Field>
                ) : null}
              </div>

              <div>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-7"
                  onClick={() => setMoreDetailsOpen((open) => !open)}
                  aria-expanded={moreDetailsOpen}
                  aria-controls="monitor-more-details"
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
                  <div
                    id="monitor-more-details"
                    className="mt-2.5 grid gap-x-3 gap-y-2.5 md:grid-cols-2"
                  >
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
                        aria-describedby={
                          fieldErrors.ownerId ? "monitor-owner-error" : undefined
                        }
                        placeholder="Payments SRE"
                      />
                      <FieldError id="monitor-owner-error">
                        {fieldErrors.ownerId}
                      </FieldError>
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
                        aria-describedby={
                          fieldErrors.tags ? "monitor-tags-error" : undefined
                        }
                        placeholder="payments, critical"
                      />
                      <FieldError id="monitor-tags-error">
                        {fieldErrors.tags}
                      </FieldError>
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
                        aria-describedby={
                          fieldErrors.description
                            ? "monitor-description-error"
                            : undefined
                        }
                        placeholder="Business journey and the outcome it protects"
                      />
                      <FieldError id="monitor-description-error">
                        {fieldErrors.description}
                      </FieldError>
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
          <div
            className={`grid gap-4 p-4 xl:items-end ${
              schedule.type === "INTERVAL"
                ? "xl:grid-cols-[minmax(260px,1fr)_12rem_13rem_minmax(260px,310px)]"
                : "xl:grid-cols-[minmax(260px,1fr)_12rem_minmax(260px,310px)]"
            }`}
          >
            <div className="flex min-w-0 items-start gap-3 xl:self-center">
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
            <Field className="w-full">
              <FieldLabel htmlFor="schedule-mode">Run frequency</FieldLabel>
              <Select
                value={schedule.type}
                onValueChange={(value) => {
                  if (value == null) return
                  setSchedule((current) => ({
                    ...current,
                    type: value,
                  }))
                  setScheduleAnchor(Date.now())
                  if (!createdMonitorId) setFormError("")
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
              <Field className="w-full">
                <FieldLabel htmlFor="schedule-frequency">Repeat</FieldLabel>
                <Select
                  value={String(schedule.intervalSeconds ?? 300)}
                  onValueChange={(value) => {
                    if (value == null) return
                    setSchedule((current) => ({
                      ...current,
                      intervalSeconds: Number(value),
                    }))
                    setScheduleAnchor(Date.now())
                    if (!createdMonitorId) setFormError("")
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
            <div className="flex min-h-20 w-full items-center justify-between gap-4 rounded-lg bg-muted/45 px-4 py-3">
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
                onCheckedChange={(checked) => {
                  setEnabled(checked)
                  setScheduleAnchor(Date.now())
                  if (!createdMonitorId) setFormError("")
                }}
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

        <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2
              id="request-workbench-heading"
              className="scroll-mt-36 text-lg font-semibold"
            >
              Request workbench
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Build an ordered workflow. Extracted outputs can be referenced by
              later request templates.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-8"
              onClick={() => setImportOpen(true)}
              disabled={isSubmitting || previewing || Boolean(createdMonitorId)}
            >
              <Upload /> Import Postman or cURL
            </Button>
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground"
              role="status"
            >
              {readiness.ready ? (
                <ShieldCheck className="size-4 text-success-foreground" />
              ) : (
                <CircleAlert className="size-4 text-warning-foreground" />
              )}
              {readiness.label}
            </div>
          </div>
        </div>

        <Suspense
          fallback={
            <div
              className="flex min-h-96 items-center justify-center rounded-xl border text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              Loading request workbench…
            </div>
          }
        >
          <RequestWorkbench
            value={definition}
            onChange={updateDefinition}
            secrets={secrets}
            environments={environments}
            environmentId={environmentId}
            preview={preview}
            focusTarget={focusTarget}
          />
        </Suspense>

        <div className="mt-5 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            {enabled
              ? "Rhythm will validate and publish revision 1, enable the monitor, and activate its schedule in one step."
              : "The configuration and schedule will be saved as draft revision 1. Enable it later when you are ready."}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={leavePage}
              disabled={isSubmitting || previewing}
            >
              Cancel
            </Button>
            {createdMonitorId ? (
              <Button
                type="button"
                render={
                  <Link
                    to="/monitors/$monitorId/edit"
                    params={{ monitorId: createdMonitorId }}
                  />
                }
                nativeButton={false}
                size="lg"
              >
                Open saved monitor
              </Button>
            ) : (
              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting || previewing}
              >
                {isSubmitting ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : enabled ? (
                  <Power data-icon="inline-start" />
                ) : (
                  <FileClock data-icon="inline-start" />
                )}
                {isSubmitting ? "Creating monitor…" : submitLabel}
              </Button>
            )}
          </div>
        </div>
      </PageContainer>

      <MonitorImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={applyImport}
        actionLabel={
          isDirty ? "Replace draft with import" : "Use imported monitor"
        }
      />

      <AlertDialog
        open={previewConfirmationOpen}
        onOpenChange={setPreviewConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Run requests against real targets?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Draft preview executes the complete workflow now. It includes{" "}
              {sideEffectingSteps
                .map(
                  (step) =>
                    `${step.request.method.toUpperCase()} ${step.name || "request"}`
                )
                .join(", ")}
              , which may create, change, or delete target data. Preview
              evidence is masked and is not saved as a monitor run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => void runDraftPreview()}
            >
              Run real requests
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.status === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this monitor draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Your monitor details, schedule, request workflow, scripts, and
              checks have not been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={() => blocker.proceed?.()}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

function monitorReadiness(definition: RequestDefinition, name: string) {
  const missing: string[] = []
  if (!name.trim()) missing.push("monitor name")
  const missingURLs = definition.steps.filter(
    (step) => step.type === "HTTP_REQUEST" && !step.request.url.trim()
  ).length
  if (missingURLs)
    missing.push(`${missingURLs} request URL${missingURLs === 1 ? "" : "s"}`)
  return {
    ready: missing.length === 0,
    label: missing.length
      ? `Needs ${missing.join(" and ")}`
      : `${definition.steps.length} workflow step${definition.steps.length === 1 ? "" : "s"} ready to create`,
  }
}

function isValidTemplatedHTTPURL(value: string) {
  let candidate = value.trim()
  candidate = candidate.replace(/^\{\{[^}]+\}\}:\/\//, "https://")
  candidate = candidate.replace(
    /^\{\{[^}]+\}\}(?=\/|$)/,
    "https://template.example"
  )
  candidate = candidate.replace(/\{\{[^}]+\}\}/g, "template")
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function normalizeJSONTemplates(value: string) {
  let output = ""
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      output += character
      escaped = false
      continue
    }
    if (character === "\\" && inString) {
      output += character
      escaped = true
      continue
    }
    if (character === '"') {
      output += character
      inString = !inString
      continue
    }
    if (character === "{" && value[index + 1] === "{") {
      const end = value.indexOf("}}", index + 2)
      if (end >= 0) {
        output += inString ? "template" : "0"
        index = end + 1
        continue
      }
    }
    output += character
  }
  return output
}

function newPreviewID() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID()
  return `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function previewFailureSection(
  step: DraftMonitorPreviewContract["steps"][number]
): RequestWorkbenchFocusTarget["section"] {
  if (step.preRequestScript?.status === "FAILED") return "pre-request"
  if (step.testScript?.status === "FAILED") return "assertions"
  if (step.extractors.some((extractor) => !extractor.success))
    return "extractors"
  if (step.assertions.some((assertion) => !assertion.passed))
    return "assertions"
  return "params"
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
