import { lazy, Suspense, useEffect, useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CircleAlert,
  LoaderCircle,
  Rocket,
  Save,
} from "lucide-react"

import { EditorLoading } from "@/components/editor-loading"
import { PageContainer } from "@/components/page-container"
import { normalizeDefinitionScripts } from "@/features/monitors/request-definition"
import type { RequestDefinition } from "@/features/monitors/request-definition"
import type { ScheduleContract } from "@/lib/api-client/contracts"
import {
  listELFApplications,
  setApplicationMonitorLink,
} from "@/lib/api-client/elf"
import {
  getMonitorDraft,
  getMonitorSchedule,
  listConfigurationProfiles,
  mutateMonitor,
  saveMonitorDraft,
  saveMonitorSchedule,
} from "@/lib/api-client/monitors"
import { formatDateTime } from "@/lib/format-date"

const RequestWorkbench = lazy(async () => ({
  default: (await import("@/features/monitors/request-workbench"))
    .RequestWorkbench,
}))

export const Route = createFileRoute("/monitors/$monitorId/edit")({
  loader: async ({ params }) => {
    const [draft, applications, secrets, schedule] = await Promise.all([
      getMonitorDraft({ data: { monitorId: params.monitorId } }),
      listELFApplications(),
      listConfigurationProfiles({ data: { kind: "secrets" } }),
      getMonitorSchedule({ data: { monitorId: params.monitorId } }),
    ])
    return { ...draft, applications, secrets, schedule }
  },
  component: EditMonitorPage,
})

const defaultSchedule: ScheduleContract = {
  type: "MANUAL",
  timezone: "UTC",
  jitterSeconds: 0,
  concurrencyPolicy: "SKIP_IF_RUNNING",
  missedRunPolicy: "SKIP",
  active: false,
}

function EditMonitorPage() {
  const loaded = Route.useLoaderData()
  const router = useRouter()
  const [definition, setDefinition] = useState(
    normalizeDefinition(
      loaded.revision.definition as unknown as RequestDefinition
    )
  )
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "saved"
  )
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState("")
  const initialApplicationId =
    loaded.applications.find((application) =>
      application.monitorIds.includes(loaded.monitor.id)
    )?.id ?? ""
  const [applicationId, setApplicationId] = useState(initialApplicationId)
  const [linkedApplicationId, setLinkedApplicationId] =
    useState(initialApplicationId)
  const [schedule, setSchedule] = useState<ScheduleContract>(
    loaded.schedule ?? defaultSchedule
  )
  const [scheduleState, setScheduleState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle")
  const [scheduleMessage, setScheduleMessage] = useState("")

  useEffect(() => {
    if (state !== "idle" && state !== "saving") return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [state])

  function change(next: RequestDefinition) {
    setDefinition(next)
    setState("idle")
    setMessage("")
  }

  async function save() {
    setState("saving")
    const nextDefinition = normalizeDefinitionScripts(definition)
    setDefinition(nextDefinition)
    const result = await saveMonitorDraft({
      data: { monitorId: loaded.monitor.id, definition: nextDefinition },
    })
    if (!result.ok) {
      setState("error")
      setMessage(result.message)
      return false
    }
    if (linkedApplicationId !== applicationId) {
      if (applicationId) {
        const link = await setApplicationMonitorLink({
          data: {
            applicationId,
            monitorId: loaded.monitor.id,
            linked: true,
          },
        })
        if (!link.ok) {
          setState("error")
          setMessage(link.message)
          return false
        }
      } else if (linkedApplicationId) {
        const unlink = await setApplicationMonitorLink({
          data: {
            applicationId: linkedApplicationId,
            monitorId: loaded.monitor.id,
            linked: false,
          },
        })
        if (!unlink.ok) {
          setState("error")
          setMessage(unlink.message)
          return false
        }
      }
      setLinkedApplicationId(applicationId)
    }
    setState("saved")
    setMessage(`Draft revision ${result.revision.revisionNumber} saved`)
    return true
  }

  async function publish() {
    setPublishing(true)
    const saved = await save()
    if (!saved) {
      setPublishing(false)
      return
    }
    const result = await mutateMonitor({
      data: { monitorId: loaded.monitor.id, action: "publish" },
    })
    setPublishing(false)
    if (!result.ok) {
      setState("error")
      setMessage(result.message)
      return
    }
    setState("saved")
    setMessage("Draft saved and published")
    await router.invalidate()
  }

  async function saveSchedule() {
    setScheduleState("saving")
    const result = await saveMonitorSchedule({
      data: { monitorId: loaded.monitor.id, schedule },
    })
    if (!result.ok) {
      setScheduleState("error")
      setScheduleMessage(result.message)
      return
    }
    setSchedule(result.schedule)
    setScheduleState("saved")
    setScheduleMessage(
      result.schedule.active
        ? `Next run ${formatDateTime(result.schedule.nextRunAt!)}`
        : "Schedule saved; it activates when the monitor is enabled"
    )
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-sm">
        <PageContainer padding="header" className="flex items-center gap-3">
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
                {loaded.monitor.name}
              </h1>
              <Badge variant="secondary">
                Draft {loaded.revision.revisionNumber}
              </Badge>
            </div>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Changes remain isolated from the published revision until you
              publish again.
            </p>
          </div>
          <span
            className="hidden text-xs text-muted-foreground sm:inline"
            aria-live="polite"
          >
            {state === "saving"
              ? "Saving…"
              : state === "saved"
                ? message
                : "Unsaved changes"}
          </span>
          <Button type="button" onClick={save} disabled={state === "saving"}>
            {state === "saving" ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : state === "saved" ? (
              <Check data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            {state === "saving" ? "Saving…" : "Save draft"}
          </Button>
          <Button
            type="button"
            onClick={() => void publish()}
            disabled={state === "saving" || publishing}
            variant="outline"
          >
            {publishing ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Rocket />
            )}
            {publishing ? "Publishing…" : "Publish"}
          </Button>
        </PageContainer>
      </header>
      <PageContainer as="main">
        {state === "error" ? (
          <Alert className="mb-5" variant="destructive">
            <CircleAlert />
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        <section
          className="mb-5 rounded-xl border bg-muted/20 p-4"
          aria-labelledby="monitor-application-heading"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="min-w-0 flex-1">
              <h2
                id="monitor-application-heading"
                className="text-sm font-semibold"
              >
                Application ownership
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Tag this monitor with the internal application it validates. The
                association is saved with the draft.
              </p>
            </div>
            <ScheduleField label="Application">
              <NativeSelect
                className="w-full md:w-72"
                value={applicationId}
                onChange={(event) => {
                  setApplicationId(event.target.value)
                  setState("idle")
                }}
              >
                <NativeSelectOption value="">Not assigned</NativeSelectOption>
                {loaded.applications.map((application) => (
                  <NativeSelectOption
                    key={application.id}
                    value={application.id}
                  >
                    {application.name}
                    {application.carId ? ` · ${application.carId}` : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </ScheduleField>
          </div>
        </section>
        <div className="mb-4">
          <h2 className="font-heading text-xl font-semibold">
            Workflow editor
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reorder requests and pass extractor outputs into later steps with
            templates.
          </p>
        </div>
        <Suspense fallback={<EditorLoading label="Loading request workbench…" />}>
          <RequestWorkbench
            value={definition}
            onChange={change}
            monitorId={loaded.monitor.id}
            revisionId={loaded.revision.id}
            secrets={loaded.secrets}
          />
        </Suspense>
        <section className="mt-6 rounded-xl border p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-56 flex-1">
              <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
                <CalendarClock className="size-4" /> Schedule
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Published revisions are queued through Redis at the configured
                cadence.
              </p>
            </div>
            <ScheduleField label="Mode">
              <NativeSelect
                value={schedule.type}
                onChange={(event) =>
                  setSchedule({
                    ...schedule,
                    type: event.target.value as ScheduleContract["type"],
                  })
                }
              >
                <NativeSelectOption value="MANUAL">
                  Manual only
                </NativeSelectOption>
                <NativeSelectOption value="INTERVAL">
                  Interval
                </NativeSelectOption>
                <NativeSelectOption value="CRON">Cron</NativeSelectOption>
              </NativeSelect>
            </ScheduleField>
            {schedule.type === "INTERVAL" ? (
              <ScheduleField label="Every seconds">
                <Input
                  aria-label="Every seconds"
                  type="number"
                  min={10}
                  value={schedule.intervalSeconds ?? 60}
                  onChange={(event) =>
                    setSchedule({
                      ...schedule,
                      intervalSeconds: Number(event.target.value),
                    })
                  }
                />
              </ScheduleField>
            ) : null}
            {schedule.type === "CRON" ? (
              <ScheduleField label="Cron expression">
                <Input
                  aria-label="Cron expression"
                  className="font-mono"
                  value={schedule.expression ?? "*/5 * * * *"}
                  onChange={(event) =>
                    setSchedule({ ...schedule, expression: event.target.value })
                  }
                />
              </ScheduleField>
            ) : null}
            <ScheduleField label="Timezone">
              <Input
                aria-label="Timezone"
                value={schedule.timezone}
                onChange={(event) =>
                  setSchedule({ ...schedule, timezone: event.target.value })
                }
              />
            </ScheduleField>
            <Button
              type="button"
              variant="outline"
              onClick={saveSchedule}
              disabled={scheduleState === "saving"}
            >
              {scheduleState === "saving" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CalendarClock />
              )}{" "}
              Save schedule
            </Button>
          </div>
          {scheduleMessage ? (
            <p
              className={`mt-3 text-xs ${scheduleState === "error" ? "text-destructive" : "text-muted-foreground"}`}
              aria-live="polite"
            >
              {scheduleMessage}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-xs">
            <Badge variant={schedule.active ? "default" : "secondary"}>
              {schedule.active ? "Schedule active" : "Schedule inactive"}
            </Badge>
            <span className="font-medium">Next run</span>
            <span className="text-muted-foreground">
              {schedule.nextRunAt
                ? formatDateTime(schedule.nextRunAt)
                : schedule.type === "MANUAL"
                  ? "Manual only"
                  : "Enable the monitor to start this schedule"}
            </span>
          </div>
        </section>
        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            size="lg"
            onClick={save}
            disabled={state === "saving"}
          >
            <Save data-icon="inline-start" /> Save draft
          </Button>
        </div>
      </PageContainer>
    </div>
  )
}

function normalizeDefinition(value: RequestDefinition): RequestDefinition {
  type Step = RequestDefinition["steps"][number]
  type LegacyDefinition = Omit<RequestDefinition, "scripts" | "steps"> & {
    scripts?: Partial<RequestDefinition["scripts"]>
    steps: Array<
      Omit<Step, "request"> & {
        request: Omit<Step["request"], "preRequestScript" | "testScript"> & {
          preRequestScript?: Step["request"]["preRequestScript"]
          testScript?: Step["request"]["testScript"]
        }
      }
    >
  }
  const next = structuredClone(value) as LegacyDefinition
  next.schemaVersion = 2
  next.scripts ??= {
    preRequest: {
      enabled: false,
      language: "javascript",
      code: "",
      runtimeVersion: "rhythm-js-2",
    },
  }
  next.scripts.preRequest ??= {
    enabled: false,
    language: "javascript",
    code: "",
    runtimeVersion: "rhythm-js-2",
  }
  for (const step of next.steps) {
    step.request.preRequestScript ??= {
      enabled: false,
      language: "javascript",
      code: "",
      runtimeVersion: "rhythm-js-2",
    }
    step.request.testScript ??= {
      enabled: false,
      language: "javascript",
      code: "",
      runtimeVersion: "rhythm-js-2",
    }
  }
  // Migrate stuck enabled:false from the old toggle UI when script has content.
  return normalizeDefinitionScripts(next as RequestDefinition)
}

function ScheduleField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="min-w-40 text-xs font-medium">
      {label}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}
