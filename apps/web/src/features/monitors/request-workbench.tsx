import {
  Children,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { EditorLoading } from "@/components/editor-loading"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ArrowDown,
  ArrowUp,
  Braces,
  ChartNoAxesCombined,
  CheckCircle2,
  Cookie,
  Download,
  EyeOff,
  KeyRound,
  Network,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wand2,
} from "lucide-react"

import {
  SecretPicker,
  secretAliasFromRef,
  toSecretRef,
} from "@/features/configuration/secret-credential-field"
import {
  createKeyValueRow,
  initialRequestDefinition,
} from "@/features/monitors/request-definition"
import type {
  KeyValueRow,
  RequestDefinition,
  RequestWorkbenchFocusTarget,
  RequestWorkbenchSection,
} from "@/features/monitors/request-definition"
import { normalizeScriptDefinition } from "@/features/monitors/script-definition"
import type { ScriptDefinition } from "@/features/monitors/script-definition"
import type {
  ConfigurationProfileContract,
  DraftMonitorPreviewContract,
  ScriptResultContract,
} from "@/lib/api-client/contracts"
import { buildVariableCatalog } from "@/features/monitors/variable-catalog"
import type { VariableCatalogEntry } from "@/features/monitors/variable-catalog"
import {
  VariableCatalogSheet,
  VariablePicker,
} from "@/features/monitors/variable-picker"

const PreRequestScriptEditor = lazy(async () => ({
  default: (await import("@/features/monitors/pre-request-script-editor"))
    .PreRequestScriptEditor,
}))

const row = createKeyValueRow

type Props = {
  value: RequestDefinition
  onChange: (value: RequestDefinition) => void
  monitorId?: string
  revisionId?: string
  secrets?: ConfigurationProfileContract[]
  environments?: ConfigurationProfileContract[]
  environmentId?: string
  preview?: DraftMonitorPreviewContract | null
  focusTarget?: RequestWorkbenchFocusTarget | null
}

export function RequestWorkbench({
  value,
  onChange,
  monitorId,
  revisionId,
  secrets = [],
  environments = [],
  environmentId,
  preview,
  focusTarget,
}: Props) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedStepID, setSelectedStepID] = useState(value.steps[0]?.id ?? "")
  const [activeSection, setActiveSection] =
    useState<RequestWorkbenchSection>("params")
  const [deleteStepOpen, setDeleteStepOpen] = useState(false)
  const selectedIndex = Math.max(
    0,
    value.steps.findIndex((candidate) => candidate.id === selectedStepID)
  )
  const step = value.steps[selectedIndex] ?? value.steps[0]
  const request = step.request
  const observedVariables = useMemo(() => {
    const observed: Array<{
      name: string
      scope: "variables" | "environment" | "collection" | "globals"
      masked?: boolean
    }> = []
    const collect = (result?: ScriptResultContract) => {
      for (const change of result?.variableChanges ?? []) {
        if (change.operation === "removed") continue
        const scope =
          change.scope === "collection"
            ? "collection"
            : change.scope === "environment" ||
                change.scope === "globals" ||
                change.scope === "variables"
              ? change.scope
              : null
        if (scope)
          observed.push({
            name: change.key,
            scope,
            masked: change.state === "MASKED",
          })
      }
    }
    collect(preview?.setupScript)
    for (const result of preview?.steps ?? []) {
      const index = value.steps.findIndex(
        (candidate) => candidate.id === result.stepDefinitionId
      )
      if (index < 0 || index > selectedIndex) continue
      collect(result.preRequestScript)
      if (index < selectedIndex) collect(result.testScript)
    }
    return observed
  }, [preview, selectedIndex, value.steps])
  const variableCatalog = useMemo(
    () =>
      buildVariableCatalog({
        definition: value,
        selectedStepIndex: selectedIndex,
        environments,
        secrets,
        environmentId,
        observed: observedVariables,
      }),
    [
      environmentId,
      environments,
      observedVariables,
      secrets,
      selectedIndex,
      value,
    ]
  )

  useEffect(() => {
    if (!focusTarget) return
    setSelectedStepID(focusTarget.stepId)
    setActiveSection(focusTarget.section)
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(
          focusTarget.field === "url"
            ? `request-url-${focusTarget.stepId}`
            : focusTarget.field === "body"
              ? `request-body-${focusTarget.stepId}`
              : focusTarget.field === "name"
                ? `step-name-${focusTarget.stepId}`
                : `request-section-${focusTarget.stepId}-${focusTarget.section}`
        )
        ?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusTarget])

  function updateRequest(patch: Partial<typeof request>) {
    onChange({
      ...value,
      steps: value.steps.map((candidate, index) =>
        index === selectedIndex
          ? { ...step, request: { ...request, ...patch } }
          : candidate
      ),
    })
  }

  function updateStep(patch: Partial<typeof step>) {
    onChange({
      ...value,
      steps: value.steps.map((candidate, index) =>
        index === selectedIndex ? { ...step, ...patch } : candidate
      ),
    })
  }

  function addStep() {
    const next = structuredClone(initialRequestDefinition.steps[0])
    next.id = newID("step-request")
    next.name = `Request ${value.steps.length + 1}`
    const steps = [...value.steps, next]
    onChange({ ...value, steps })
    setSelectedStepID(next.id)
  }

  function duplicateStep() {
    const next = structuredClone(step)
    next.id = newID("step-request")
    next.name = `${step.name} copy`
    const steps = [
      ...value.steps.slice(0, selectedIndex + 1),
      next,
      ...value.steps.slice(selectedIndex + 1),
    ]
    onChange({ ...value, steps })
    setSelectedStepID(next.id)
  }

  function removeStep() {
    if (value.steps.length === 1) return
    const steps = value.steps.filter((_, index) => index !== selectedIndex)
    onChange({ ...value, steps })
    setSelectedStepID(steps[Math.max(0, selectedIndex - 1)].id)
    setDeleteStepOpen(false)
  }

  function moveStep(offset: number) {
    const target = selectedIndex + offset
    if (target < 0 || target >= value.steps.length) return
    const steps = [...value.steps]
    ;[steps[selectedIndex], steps[target]] = [
      steps[target],
      steps[selectedIndex],
    ]
    onChange({ ...value, steps })
  }

  const renderedURL = useMemo(() => {
    const enabledParams = request.params.filter(
      (item) => item.enabled && item.key
    )
    if (!enabledParams.length) return request.url
    const separator = request.url.includes("?") ? "&" : "?"
    return `${request.url}${separator}${enabledParams.map((item) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`).join("&")}`
  }, [request.params, request.url])

  return (
    <section
      aria-labelledby="request-workbench-heading"
      className="overflow-hidden rounded-xl border bg-background"
    >
      <div className="flex flex-col gap-3 border-b bg-muted/20 p-3 xl:flex-row xl:items-center">
        <Tabs
          value={selectedStepID}
          onValueChange={(nextStepId) => {
            if (nextStepId) setSelectedStepID(nextStepId)
          }}
          className="min-w-0 flex-1 gap-0"
        >
          <div className="overflow-x-auto">
            <TabsList
              aria-label="Workflow steps"
              variant="line"
              className="h-auto min-w-max justify-start gap-2 py-1"
            >
              {value.steps.map((candidate, index) => (
                <TabsTrigger
                  value={candidate.id}
                  className="h-auto min-w-40 justify-start rounded-lg border bg-background px-3 py-2 text-left data-active:border-primary data-active:bg-primary/5"
                  key={candidate.id}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-muted-foreground">
                      Step {index + 1}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
                      {candidate.name}
                    </span>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <VariableCatalogSheet entries={variableCatalog} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => moveStep(-1)}
            disabled={selectedIndex === 0}
          >
            <ArrowUp data-icon="inline-start" /> Move up
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => moveStep(1)}
            disabled={selectedIndex === value.steps.length - 1}
          >
            <ArrowDown data-icon="inline-start" /> Move down
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={duplicateStep}
          >
            Duplicate
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDeleteStepOpen(true)}
            disabled={value.steps.length === 1}
          >
            <Trash2 data-icon="inline-start" /> Delete
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={addStep}>
            <Plus data-icon="inline-start" /> Add request
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-b bg-muted/35 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <label
            className="text-xs font-medium"
            htmlFor={`step-name-${step.id}`}
          >
            Step name
          </label>
          <Input
            id={`step-name-${step.id}`}
            className="mt-1 h-9 max-w-sm bg-background text-sm font-semibold"
            value={step.name}
            onChange={(event) => updateStep({ name: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {step.type === "ACTION"
              ? "Controlled actions"
              : step.type === "METRIC_VALIDATION"
                ? "Telemetry validation"
                : "HTTP request"}{" "}
            · Step {selectedIndex + 1} · Draft
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden="true" /> Sensitive values
          are masked
        </div>
      </div>

      {step.type === "ACTION" ? (
        <div className="min-h-[390px] p-4 md:p-5">
          <PreRequestEditor
            rows={step.actions}
            onChange={(actions) => updateStep({ actions })}
            variables={variableCatalog}
          />
        </div>
      ) : step.type === "METRIC_VALIDATION" ? (
        <MetricEditor
          value={step.metric}
          onChange={(metric) => updateStep({ metric })}
        />
      ) : (
        <div>
          <div className="p-3">
            <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
              <div>
                <label
                  className="sr-only"
                  htmlFor={`request-method-${step.id}`}
                >
                  HTTP method
                </label>
                <Select
                  value={request.method}
                  onValueChange={(method) => {
                    if (method) updateRequest({ method })
                  }}
                  items={HTTP_METHODS.map((method) => ({
                    value: method,
                    label: method,
                  }))}
                >
                  <SelectTrigger
                    id={`request-method-${step.id}`}
                    size="sm"
                    className={`h-10 w-full font-medium ${httpMethodClassName(request.method)}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {HTTP_METHODS.map((method) => (
                      <SelectItem
                        value={method}
                        key={method}
                        className={httpMethodClassName(method)}
                      >
                        {method}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="sr-only" htmlFor={`request-url-${step.id}`}>
                  Request URL
                </label>
                <TemplateValueInput
                  id={`request-url-${step.id}`}
                  className="h-10 min-w-0 font-mono text-sm"
                  value={request.url}
                  onChange={(url) => updateRequest({ url })}
                  placeholder="https://api.example.com/v1/health"
                  entries={variableCatalog}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 sm:w-auto"
                aria-expanded={previewOpen}
                aria-controls={`request-summary-${step.id}`}
                onClick={() => setPreviewOpen((open) => !open)}
              >
                {previewOpen ? (
                  <EyeOff data-icon="inline-start" />
                ) : (
                  <Send data-icon="inline-start" />
                )}
                {previewOpen ? "Hide summary" : "Request summary"}
              </Button>
            </div>
          </div>

          {previewOpen ? (
            <div id={`request-summary-${step.id}`}>
              <RequestPreview
                method={request.method}
                url={renderedURL}
                headers={request.headers}
                body={request.body}
                authType={request.auth.type}
              />
            </div>
          ) : null}

          <Tabs
            value={activeSection}
            onValueChange={(section) => {
              if (section) setActiveSection(section as RequestWorkbenchSection)
            }}
            orientation="vertical"
            className="flex-col gap-0 border-t lg:flex-row"
          >
            <div className="border-b p-3 lg:hidden">
              <label
                className="text-xs font-medium"
                htmlFor={`request-section-${step.id}`}
              >
                Request configuration
              </label>
              <NativeSelect
                id={`request-section-${step.id}`}
                className="mt-2 w-full"
                value={activeSection}
                onChange={(event) =>
                  setActiveSection(
                    event.target.value as RequestWorkbenchSection
                  )
                }
              >
                {REQUEST_SECTION_GROUPS.flatMap((group) =>
                  group.items.map((item) => (
                    <NativeSelectOption key={item.value} value={item.value}>
                      {group.label} · {item.label}
                    </NativeSelectOption>
                  ))
                )}
              </NativeSelect>
            </div>
            <div className="hidden w-52 shrink-0 border-r bg-muted/15 p-3 lg:block">
              <TabsList
                aria-label="Request configuration sections"
                variant="line"
                className="h-auto w-full items-stretch gap-1"
              >
                <WorkbenchGroupLabel>Request</WorkbenchGroupLabel>
                <WorkbenchTab
                  value="params"
                  label="Params"
                  count={configuredRows(request.params)}
                />
                <WorkbenchTab
                  value="auth"
                  label="Auth"
                  active={request.auth.type !== "none"}
                />
                <WorkbenchTab
                  value="headers"
                  label="Headers"
                  count={configuredRows(request.headers)}
                />
                <WorkbenchTab
                  value="body"
                  label="Body"
                  active={request.body.type !== "none"}
                />
                <WorkbenchTab
                  value="cookies"
                  label="Cookies"
                  count={configuredRows(request.cookies)}
                />
                <WorkbenchGroupLabel>Automation</WorkbenchGroupLabel>
                <WorkbenchTab
                  value="pre-request"
                  label="Pre-request"
                  count={Number(Boolean(request.preRequestScript.code.trim()))}
                />
                <WorkbenchTab
                  value="extractors"
                  label="Extractors"
                  count={
                    request.extractors.filter((item) => item.enabled).length
                  }
                />
                <WorkbenchGroupLabel>Checks</WorkbenchGroupLabel>
                <WorkbenchTab
                  value="assertions"
                  label="Tests"
                  count={
                    request.assertions.filter((item) => item.enabled).length +
                    Number(Boolean(request.testScript.code.trim()))
                  }
                />
                <WorkbenchGroupLabel>Connection</WorkbenchGroupLabel>
                <WorkbenchTab
                  value="tls"
                  label="TLS"
                  active={Boolean(
                    request.tls.certificateProfileId || request.tls.caProfileId
                  )}
                />
                <WorkbenchTab
                  value="proxy"
                  label="Proxy"
                  active={request.proxy.mode !== "environment"}
                />
                <WorkbenchTab value="settings" label="Settings" />
              </TabsList>
            </div>

            <div className="min-w-0 flex-1 p-4 md:min-h-[390px] md:p-5">
              <TabsContent
                id={`request-section-${step.id}-params`}
                tabIndex={-1}
                value="params"
              >
                <KeyValueEditor
                  title="Query parameters"
                  description="Enabled parameters are encoded and appended to the request URL."
                  rows={request.params}
                  variables={variableCatalog}
                  onChange={(params) => updateRequest({ params })}
                />
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-headers`}
                tabIndex={-1}
                value="headers"
              >
                <KeyValueEditor
                  title="Request headers"
                  description="Use templates such as {{ variables.apiVersion }}. Mark credentials and signatures as sensitive."
                  rows={request.headers}
                  variables={variableCatalog}
                  allowSensitive
                  onChange={(headers) => updateRequest({ headers })}
                />
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-auth`}
                tabIndex={-1}
                value="auth"
              >
                <AuthEditor
                  value={request.auth}
                  onChange={(auth) => updateRequest({ auth })}
                  secrets={secrets}
                  variables={variableCatalog}
                />
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-body`}
                tabIndex={-1}
                value="body"
              >
                <BodyEditor
                  stepId={step.id}
                  value={request.body}
                  onChange={(body) => updateRequest({ body })}
                  variables={variableCatalog}
                />
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-cookies`}
                tabIndex={-1}
                value="cookies"
              >
                <CookieEditor
                  rows={request.cookies}
                  persistCookies={request.persistCookies}
                  onPersistChange={(persistCookies) =>
                    updateRequest({ persistCookies })
                  }
                  onChange={(cookies) => updateRequest({ cookies })}
                  variables={variableCatalog}
                />
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-pre-request`}
                tabIndex={-1}
                value="pre-request"
              >
                <Suspense
                  fallback={
                    <EditorLoading label="Loading JavaScript editor…" />
                  }
                >
                  <PreRequestWorkspace
                    script={request.preRequestScript}
                    onScriptChange={(preRequestScript) =>
                      updateRequest({
                        preRequestScript:
                          normalizeScriptDefinition(preRequestScript),
                      })
                    }
                    monitorId={monitorId}
                    revisionId={revisionId}
                    stepId={step.id}
                    request={request}
                    variables={variableCatalog}
                  />
                </Suspense>
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-extractors`}
                tabIndex={-1}
                value="extractors"
              >
                <ExtractorEditor
                  rows={request.extractors}
                  onChange={(extractors) => updateRequest({ extractors })}
                />
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-assertions`}
                tabIndex={-1}
                value="assertions"
              >
                <Suspense
                  fallback={
                    <EditorLoading label="Loading JavaScript editor…" />
                  }
                >
                  <TestsWorkspace
                    script={request.testScript}
                    onScriptChange={(testScript) =>
                      updateRequest({
                        testScript: normalizeScriptDefinition(testScript),
                      })
                    }
                    assertions={request.assertions}
                    onAssertionsChange={(assertions) =>
                      updateRequest({ assertions })
                    }
                    monitorId={monitorId}
                    revisionId={revisionId}
                    stepId={step.id}
                    request={request}
                    variables={variableCatalog}
                  />
                </Suspense>
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-tls`}
                tabIndex={-1}
                value="tls"
              >
                <TLSEditor
                  value={request.tls}
                  onChange={(tls) => updateRequest({ tls })}
                />
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-proxy`}
                tabIndex={-1}
                value="proxy"
              >
                <ProxyEditor
                  value={request.proxy}
                  onChange={(proxy) => updateRequest({ proxy })}
                  secrets={secrets}
                />
              </TabsContent>
              <TabsContent
                id={`request-section-${step.id}-settings`}
                tabIndex={-1}
                value="settings"
              >
                <SettingsEditor
                  value={request.settings}
                  onChange={(settings) =>
                    onChange({
                      ...value,
                      steps: value.steps.map((candidate, index) =>
                        index === selectedIndex
                          ? {
                              ...step,
                              timeoutMs: settings.timeoutMs,
                              request: { ...request, settings },
                            }
                          : candidate
                      ),
                    })
                  }
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}
      <AlertDialog open={deleteStepOpen} onOpenChange={setDeleteStepOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{step.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the request, its scripts, extractors, and checks from
              the draft. This cannot be undone after you create the monitor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep step</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={removeStep}
            >
              Delete step
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function WorkbenchGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="presentation"
      className="mt-3 px-3 pb-1 text-xs font-semibold text-muted-foreground first:mt-0"
    >
      {children}
    </span>
  )
}

function WorkbenchTab({
  value,
  label,
  count,
  active,
}: {
  value: string
  label: string
  count?: number
  active?: boolean
}) {
  return (
    <TabsTrigger value={value} className="min-h-9 justify-start px-3">
      {label}
      {count ? (
        <Badge
          variant="secondary"
          className="h-5 min-w-5 justify-center px-1.5 text-[10px]"
        >
          {count}
        </Badge>
      ) : active ? (
        <span
          className="size-1.5 rounded-full bg-primary"
          aria-label="Configured"
        />
      ) : null}
    </TabsTrigger>
  )
}

function SectionHeading({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Braces
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
      <div className="flex gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {action ? <div className="w-full sm:w-auto">{action}</div> : null}
    </div>
  )
}

function KeyValueEditor({
  title,
  description,
  rows,
  onChange,
  allowSensitive = false,
  variables = [],
}: {
  title: string
  description: string
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  allowSensitive?: boolean
  variables?: VariableCatalogEntry[]
}) {
  function update(id: string, patch: Partial<KeyValueRow>) {
    onChange(
      rows.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  }
  return (
    <div>
      <SectionHeading
        icon={SlidersHorizontal}
        title={title}
        description={description}
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange([...rows, row(newID("row"))])}
          >
            <Plus data-icon="inline-start" /> Add
          </Button>
        }
      />
      <div>
        <div>
          <div
            className={`hidden ${allowSensitive ? "md:grid-cols-[36px_1fr_1.2fr_1fr_80px_36px]" : "md:grid-cols-[36px_1fr_1.2fr_1fr_36px]"} gap-2 border-b pb-2 text-xs font-medium text-muted-foreground md:grid`}
          >
            <span />
            <span>Key</span>
            <span>Value</span>
            <span>Description</span>
            {allowSensitive ? <span>Sensitive</span> : null}
            <span />
          </div>
          {rows.map((item) => (
            <div
              key={item.id}
              className={`mt-3 grid gap-3 rounded-lg border bg-muted/15 p-3 md:mt-0 md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:p-0 md:py-2 ${allowSensitive ? "md:grid-cols-[36px_1fr_1.2fr_1fr_80px_36px]" : "md:grid-cols-[36px_1fr_1.2fr_1fr_36px]"} md:items-center md:last:border-b-0`}
            >
              <div className="flex items-center justify-between md:block">
                <span className="text-xs font-medium md:sr-only">Enabled</span>
                <Switch
                  size="sm"
                  checked={item.enabled}
                  onCheckedChange={(checked) =>
                    update(item.id, { enabled: checked })
                  }
                  aria-label={`Enable ${item.key || "row"}`}
                />
              </div>
              <RowInput
                id={`${item.id}-key`}
                label="Key"
                value={item.key}
                onChange={(next) => update(item.id, { key: next })}
                placeholder="key"
              />
              <TemplateValueInput
                id={`${item.id}-value`}
                label="Value"
                className="font-mono"
                type={item.sensitive ? "password" : "text"}
                value={item.value}
                onChange={(next) => update(item.id, { value: next })}
                placeholder="value or {{ template }}"
                entries={variables}
              />
              <RowInput
                id={`${item.id}-description`}
                label="Description"
                value={item.description}
                onChange={(next) => update(item.id, { description: next })}
                placeholder="Optional note"
              />
              {allowSensitive ? (
                <div className="flex items-center justify-between md:block">
                  <span className="text-xs font-medium md:sr-only">
                    Sensitive
                  </span>
                  <Switch
                    size="sm"
                    checked={Boolean(item.sensitive)}
                    onCheckedChange={(checked) =>
                      update(item.id, { sensitive: checked })
                    }
                    aria-label={`Mark ${item.key || "value"} sensitive`}
                  />
                </div>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11 justify-self-end md:min-h-7 md:w-7 md:px-0"
                onClick={() =>
                  onChange(rows.filter((rowItem) => rowItem.id !== item.id))
                }
                aria-label={`Remove ${item.key || "row"}`}
              >
                <Trash2 data-icon="inline-start" />
                <span className="md:sr-only">Remove</span>
              </Button>
            </div>
          ))}
          {rows.length === 0 ? (
            <EmptyRows
              message="No entries configured."
              onAdd={() => onChange([row(newID("row"))])}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function AuthEditor({
  value,
  onChange,
  secrets,
  variables,
}: {
  value: RequestDefinition["steps"][0]["request"]["auth"]
  onChange: (value: RequestDefinition["steps"][0]["request"]["auth"]) => void
  secrets: ConfigurationProfileContract[]
  variables: VariableCatalogEntry[]
}) {
  const fields = AUTH_FIELDS[value.type] ?? []
  return (
    <div>
      <SectionHeading
        icon={KeyRound}
        title="Authentication"
        description="Credentials remain references or masked sensitive fields. Authentication is applied after the pre-request script."
      />
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div>
          <label className="text-xs font-medium" htmlFor="auth-type">
            Auth type
          </label>
          <NativeSelect
            id="auth-type"
            className="mt-2 w-full"
            value={value.type}
            onChange={(event) =>
              onChange({ type: event.target.value, fields: {} })
            }
          >
            {Object.entries(AUTH_LABELS).map(([key, label]) => (
              <NativeSelectOption key={key} value={key}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            For reusable production credentials, pick a Secrets alias or use
            authentication profile references.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.length ? (
            fields.map((field) =>
              field.secretPicker ? (
                <div key={field.key}>
                  <label className="text-xs font-medium">{field.label}</label>
                  <div className="mt-2">
                    <SecretPicker
                      ariaLabel={`${field.label} secret`}
                      secrets={secrets}
                      value={secretAliasFromRef(value.fields[field.key] ?? "")}
                      onValueChange={(alias) =>
                        onChange({
                          ...value,
                          fields: {
                            ...value.fields,
                            [field.key]: toSecretRef(alias),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              ) : (
                <LabeledInput
                  key={field.key}
                  label={field.label}
                  value={value.fields[field.key] ?? ""}
                  type={field.sensitive ? "password" : "text"}
                  placeholder={field.placeholder}
                  onChange={(next) =>
                    onChange({
                      ...value,
                      fields: { ...value.fields, [field.key]: next },
                    })
                  }
                  variables={variables}
                />
              )
            )
          ) : (
            <div className="rounded-lg bg-muted/50 p-5 text-sm text-muted-foreground sm:col-span-2">
              No authentication will be added to this request.
            </div>
          )}
          {fields.some((field) => field.secretPicker) && !secrets.length ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground sm:col-span-2">
              No reusable secrets are configured.{" "}
              <a
                className="font-medium text-primary underline underline-offset-4"
                href="/configuration?kind=secrets"
              >
                Add a secret in Configuration
              </a>
              .
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function BodyEditor({
  stepId,
  value,
  onChange,
  variables,
}: {
  stepId: string
  value: RequestDefinition["steps"][0]["request"]["body"]
  onChange: (value: RequestDefinition["steps"][0]["request"]["body"]) => void
  variables: VariableCatalogEntry[]
}) {
  return (
    <div>
      <SectionHeading
        icon={Braces}
        title="Request body"
        description="Build a templated request body. Content type is applied automatically for structured formats."
      />
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label="Request body type"
      >
        {BODY_TYPES.map((type) => (
          <Button
            type="button"
            key={type.value}
            size="sm"
            variant={value.type === type.value ? "secondary" : "ghost"}
            role="radio"
            aria-checked={value.type === type.value}
            onClick={() => onChange({ ...value, type: type.value })}
          >
            {type.label}
          </Button>
        ))}
      </div>
      {value.type === "none" ? (
        <div className="mt-6 rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          This request has no body.
        </div>
      ) : (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`request-body-${stepId}`}>
            Request body
          </label>
          <TemplateValueInput
            id={`request-body-${stepId}`}
            className="min-h-64 resize-y font-mono text-sm leading-6"
            multiline
            value={value.content}
            onChange={(content) => onChange({ ...value, content })}
            placeholder={bodyPlaceholder(value.type)}
            entries={variables}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>Templates and step outputs are supported.</span>
            <span>{value.content.length} characters</span>
          </div>
        </div>
      )}
    </div>
  )
}

function CookieEditor({
  rows,
  persistCookies,
  onPersistChange,
  onChange,
  variables,
}: {
  rows: Array<KeyValueRow & { domain: string; path: string }>
  persistCookies: boolean
  onPersistChange: (value: boolean) => void
  onChange: (
    rows: Array<KeyValueRow & { domain: string; path: string }>
  ) => void
  variables: VariableCatalogEntry[]
}) {
  const update = (id: string, patch: Partial<(typeof rows)[number]>) =>
    onChange(
      rows.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  return (
    <div>
      <SectionHeading
        icon={Cookie}
        title="Cookies and session"
        description="Add explicit request cookies. Runtime response cookies can also persist in the monitor session jar."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange([
                ...rows,
                { ...row(newID("cookie")), domain: "", path: "/" },
              ])
            }
          >
            <Plus data-icon="inline-start" /> Add cookie
          </Button>
        }
      />
      <ToggleLine
        label="Persist response cookies"
        description="Keep Set-Cookie values for later workflow steps."
        checked={persistCookies}
        onChange={onPersistChange}
      />
      <div className="mt-4 space-y-2">
        {rows.map((item) => (
          <div
            className="grid gap-3 rounded-lg border bg-muted/20 p-3 lg:grid-cols-[28px_1fr_1fr_1fr_100px_44px] lg:items-center"
            key={item.id}
          >
            <Switch
              aria-label={`Enable cookie ${item.key || "row"}`}
              size="sm"
              checked={item.enabled}
              onCheckedChange={(checked) =>
                update(item.id, { enabled: checked })
              }
            />
            <Input
              aria-label="Cookie name"
              value={item.key}
              onChange={(event) => update(item.id, { key: event.target.value })}
              placeholder="Cookie name"
            />
            <TemplateValueInput
              id={`${item.id}-cookie-value`}
              label={`Value for cookie ${item.key || "row"}`}
              type={item.sensitive ? "password" : "text"}
              value={item.value}
              onChange={(next) => update(item.id, { value: next })}
              placeholder="Value"
              entries={variables}
            />
            <Input
              aria-label={`Domain for cookie ${item.key || "row"}`}
              value={item.domain}
              onChange={(event) =>
                update(item.id, { domain: event.target.value })
              }
              placeholder="Domain (optional)"
            />
            <Input
              aria-label={`Path for cookie ${item.key || "row"}`}
              value={item.path}
              onChange={(event) =>
                update(item.id, { path: event.target.value })
              }
              placeholder="Path"
            />
            <Button
              aria-label={`Remove cookie ${item.key || "row"}`}
              type="button"
              size="icon"
              variant="ghost"
              className="min-h-11 min-w-11"
              onClick={() =>
                onChange(rows.filter((candidate) => candidate.id !== item.id))
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {!rows.length ? (
          <EmptyRows
            message="No explicit cookies. The session jar can still capture response cookies."
            onAdd={() =>
              onChange([{ ...row(newID("cookie")), domain: "", path: "/" }])
            }
          />
        ) : null}
      </div>
    </div>
  )
}

function PreRequestWorkspace({
  script,
  onScriptChange,
  monitorId,
  revisionId,
  stepId,
  request,
  variables,
}: {
  script: ScriptDefinition
  onScriptChange: (value: ScriptDefinition) => void
  monitorId?: string
  revisionId?: string
  stepId: string
  request: RequestDefinition["steps"][0]["request"]
  variables: VariableCatalogEntry[]
}) {
  const previewRequest = {
    method: request.method,
    url: request.url,
    headers: request.headers
      .filter((item) => item.enabled)
      .map((item) => ({
        key: item.key,
        value: item.value,
        sensitive: item.sensitive,
      })),
    query: request.params
      .filter((item) => item.enabled)
      .map((item) => ({
        key: item.key,
        value: item.value,
        sensitive: item.sensitive,
      })),
    body: { type: request.body.type, content: request.body.content },
    auth: { type: request.auth.type, fields: request.auth.fields },
  }
  return (
    <div className="min-w-0">
      <PreRequestScriptEditor
        value={script}
        onChange={onScriptChange}
        monitorId={monitorId}
        revisionId={revisionId}
        stepId={stepId}
        request={previewRequest}
        variables={variables}
      />
    </div>
  )
}

function TestsWorkspace({
  script,
  onScriptChange,
  assertions,
  onAssertionsChange,
  monitorId,
  revisionId,
  stepId,
  request,
  variables,
}: {
  script: ScriptDefinition
  onScriptChange: (value: ScriptDefinition) => void
  assertions: RequestDefinition["steps"][0]["request"]["assertions"]
  onAssertionsChange: (
    value: RequestDefinition["steps"][0]["request"]["assertions"]
  ) => void
  monitorId?: string
  revisionId?: string
  stepId: string
  request: RequestDefinition["steps"][0]["request"]
  variables: VariableCatalogEntry[]
}) {
  const previewRequest = {
    method: request.method,
    url: request.url,
    headers: request.headers
      .filter((item) => item.enabled)
      .map((item) => ({
        key: item.key,
        value: item.value,
        sensitive: item.sensitive,
      })),
    query: request.params
      .filter((item) => item.enabled)
      .map((item) => ({
        key: item.key,
        value: item.value,
        sensitive: item.sensitive,
      })),
    body: { type: request.body.type, content: request.body.content },
    auth: { type: request.auth.type, fields: request.auth.fields },
  }
  return (
    <div>
      <SectionHeading
        icon={CheckCircle2}
        title="Response tests"
        description="Check the response with guided rules or Postman-compatible JavaScript. JavaScript runs after extractors and before the guided assertions."
      />
      <Tabs defaultValue="rules">
        <TabsList aria-label="Response test type">
          <TabsTrigger value="rules">
            Rules
            {assertions.filter((item) => item.enabled).length
              ? ` (${assertions.filter((item) => item.enabled).length})`
              : ""}
          </TabsTrigger>
          <TabsTrigger value="javascript">
            JavaScript{script.code.trim() ? " (1)" : ""}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="pt-4">
          <AssertionEditor rows={assertions} onChange={onAssertionsChange} />
        </TabsContent>
        <TabsContent value="javascript" className="pt-4">
          <PreRequestScriptEditor
            value={script}
            onChange={onScriptChange}
            monitorId={monitorId}
            revisionId={revisionId}
            stepId={stepId}
            request={previewRequest}
            phase="test"
            variables={variables}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PreRequestEditor({
  rows,
  onChange,
  variables,
}: {
  rows: RequestDefinition["steps"][0]["request"]["preRequest"]
  onChange: (
    rows: RequestDefinition["steps"][0]["request"]["preRequest"]
  ) => void
  variables: VariableCatalogEntry[]
}) {
  const update = (id: string, patch: Partial<(typeof rows)[number]>) =>
    onChange(
      rows.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  return (
    <div>
      <SectionHeading
        icon={Wand2}
        title="Pre-request actions"
        description="Generate controlled runtime values before the request. Actions run in order and expose outputs to templates."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange([
                ...rows,
                {
                  id: newID("action"),
                  enabled: true,
                  type: "uuid",
                  output: "",
                  expression: "",
                  sensitive: false,
                },
              ])
            }
          >
            <Plus data-icon="inline-start" /> Add action
          </Button>
        }
      />
      <OrderedRows empty="No pre-request actions. Add one to generate IDs, timestamps, hashes, signatures, or tokens.">
        {rows.map((item, index) => (
          <div
            className="mb-3 grid gap-3 rounded-lg border bg-muted/15 p-3 last:mb-0 lg:mb-0 lg:grid-cols-[32px_28px_170px_1fr_1.2fr_1.2fr_72px_44px] lg:items-center lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-transparent lg:px-0"
            key={item.id}
          >
            <span className="font-mono text-xs text-muted-foreground">
              {index + 1}
            </span>
            <Switch
              aria-label={`Enable pre-request action ${index + 1}`}
              size="sm"
              checked={item.enabled}
              onCheckedChange={(enabled) => update(item.id, { enabled })}
            />
            <NativeSelect
              aria-label={`Type for pre-request action ${index + 1}`}
              className="w-full"
              value={item.type}
              onChange={(event) =>
                update(item.id, { type: event.target.value })
              }
            >
              {ACTION_TYPES.map((type) => (
                <NativeSelectOption key={type.value} value={type.value}>
                  {type.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label={`Output variable for pre-request action ${index + 1}`}
              value={item.output}
              onChange={(event) =>
                update(item.id, { output: event.target.value })
              }
              placeholder="Output variable"
            />
            <TemplateValueInput
              id={`${item.id}-action-expression`}
              label={`Expression for pre-request action ${index + 1}`}
              className="font-mono"
              value={item.expression}
              onChange={(expression) => update(item.id, { expression })}
              placeholder="Input expression"
              entries={variables}
            />
            <Input
              className="font-mono text-xs"
              value={JSON.stringify(item.fields ?? {})}
              onChange={(event) => {
                try {
                  update(item.id, { fields: JSON.parse(event.target.value) })
                } catch {
                  /* keep the last valid options object */
                }
              }}
              aria-label={`Options JSON for action ${index + 1}`}
              placeholder='{"algorithm":"SHA256"}'
            />
            <Switch
              size="sm"
              checked={item.sensitive}
              onCheckedChange={(sensitive) => update(item.id, { sensitive })}
              aria-label={`Mark action ${index + 1} output sensitive`}
            />
            <Button
              aria-label={`Remove pre-request action ${index + 1}`}
              type="button"
              size="icon"
              className="min-h-11 min-w-11"
              variant="ghost"
              onClick={() =>
                onChange(rows.filter((candidate) => candidate.id !== item.id))
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </OrderedRows>
    </div>
  )
}

function ExtractorEditor({
  rows,
  onChange,
}: {
  rows: RequestDefinition["steps"][0]["request"]["extractors"]
  onChange: (
    rows: RequestDefinition["steps"][0]["request"]["extractors"]
  ) => void
}) {
  const update = (id: string, patch: Partial<(typeof rows)[number]>) =>
    onChange(
      rows.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  return (
    <div>
      <SectionHeading
        icon={Download}
        title="Response extractors"
        description="Capture safe response values for later workflow steps. Sensitive outputs are masked everywhere."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange([
                ...rows,
                {
                  id: newID("extractor"),
                  enabled: true,
                  source: "jsonpath",
                  variable: "",
                  expression: "",
                  sensitive: false,
                },
              ])
            }
          >
            <Plus data-icon="inline-start" /> Add extractor
          </Button>
        }
      />
      <OrderedRows empty="No extractors configured. Add one to capture JSONPath, headers, cookies, regex matches, status, or timing.">
        {rows.map((item, index) => (
          <div
            className="mb-3 grid gap-3 rounded-lg border bg-muted/15 p-3 last:mb-0 lg:mb-0 lg:grid-cols-[32px_28px_150px_1fr_1.4fr_82px_44px] lg:items-center lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-transparent lg:px-0"
            key={item.id}
          >
            <span className="font-mono text-xs text-muted-foreground">
              {index + 1}
            </span>
            <Switch
              aria-label={`Enable extractor ${index + 1}`}
              size="sm"
              checked={item.enabled}
              onCheckedChange={(enabled) => update(item.id, { enabled })}
            />
            <NativeSelect
              aria-label={`Source for extractor ${index + 1}`}
              className="w-full"
              value={item.source}
              onChange={(event) =>
                update(item.id, { source: event.target.value })
              }
            >
              {EXTRACTOR_TYPES.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {labelize(type)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label={`Variable for extractor ${index + 1}`}
              value={item.variable}
              onChange={(event) =>
                update(item.id, { variable: event.target.value })
              }
              placeholder="Variable name"
            />
            <Input
              aria-label={`Expression for extractor ${index + 1}`}
              className="font-mono"
              value={item.expression}
              onChange={(event) =>
                update(item.id, { expression: event.target.value })
              }
              placeholder="$.data.id or header name"
            />
            <Switch
              size="sm"
              checked={item.sensitive}
              onCheckedChange={(sensitive) => update(item.id, { sensitive })}
              aria-label={`Mark extractor ${index + 1} output sensitive`}
            />
            <Button
              aria-label={`Remove extractor ${index + 1}`}
              type="button"
              size="icon"
              className="min-h-11 min-w-11"
              variant="ghost"
              onClick={() =>
                onChange(rows.filter((candidate) => candidate.id !== item.id))
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </OrderedRows>
    </div>
  )
}

function AssertionEditor({
  rows,
  onChange,
}: {
  rows: RequestDefinition["steps"][0]["request"]["assertions"]
  onChange: (
    rows: RequestDefinition["steps"][0]["request"]["assertions"]
  ) => void
}) {
  const update = (id: string, patch: Partial<(typeof rows)[number]>) =>
    onChange(
      rows.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  return (
    <div>
      <SectionHeading
        icon={CheckCircle2}
        title="Assertions"
        description="Define what success means. Failures identify the exact assertion and observed safe value."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange([
                ...rows,
                {
                  id: newID("assertion"),
                  enabled: true,
                  type: "status",
                  expression: "status",
                  expected: "200",
                },
              ])
            }
          >
            <Plus data-icon="inline-start" /> Add assertion
          </Button>
        }
      />
      <OrderedRows empty="No assertions configured. Without assertions, only transport failures fail this step.">
        {rows.map((item, index) => (
          <div
            className="mb-3 grid gap-3 rounded-lg border bg-muted/15 p-3 last:mb-0 lg:mb-0 lg:grid-cols-[32px_28px_160px_1.2fr_150px_1fr_44px] lg:items-center lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-transparent lg:px-0"
            key={item.id}
          >
            <span className="font-mono text-xs text-muted-foreground">
              {index + 1}
            </span>
            <Switch
              aria-label={`Enable assertion ${index + 1}`}
              size="sm"
              checked={item.enabled}
              onCheckedChange={(enabled) => update(item.id, { enabled })}
            />
            <NativeSelect
              aria-label={`Type for assertion ${index + 1}`}
              className="w-full"
              value={item.type}
              onChange={(event) =>
                update(item.id, { type: event.target.value })
              }
            >
              {ASSERTION_TYPES.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {labelize(type)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label={`Expression for assertion ${index + 1}`}
              className="font-mono"
              value={item.expression}
              onChange={(event) =>
                update(item.id, { expression: event.target.value })
              }
              placeholder={
                item.type === "json-schema"
                  ? "Inline JSON Schema"
                  : "Selector / source"
              }
            />
            <NativeSelect
              aria-label={`Operator for assertion ${index + 1}`}
              value={item.operator ?? "equals"}
              onChange={(event) =>
                update(item.id, { operator: event.target.value })
              }
            >
              {ASSERTION_OPERATORS.map((operator) => (
                <NativeSelectOption key={operator.value} value={operator.value}>
                  {operator.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label={`Expected value for assertion ${index + 1}`}
              className="font-mono"
              value={item.expected}
              onChange={(event) =>
                update(item.id, { expected: event.target.value })
              }
              placeholder="Expected value"
            />
            <Button
              aria-label={`Remove assertion ${index + 1}`}
              type="button"
              size="icon"
              className="min-h-11 min-w-11"
              variant="ghost"
              onClick={() =>
                onChange(rows.filter((candidate) => candidate.id !== item.id))
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </OrderedRows>
    </div>
  )
}

function TLSEditor({
  value,
  onChange,
}: {
  value: RequestDefinition["steps"][0]["request"]["tls"]
  onChange: (value: RequestDefinition["steps"][0]["request"]["tls"]) => void
}) {
  return (
    <div>
      <SectionHeading
        icon={ShieldCheck}
        title="TLS and certificates"
        description="Reference governed client certificates and trust bundles. Private key material is never entered here."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <LabeledInput
          label="Client certificate profile"
          value={value.certificateProfileId}
          onChange={(certificateProfileId) =>
            onChange({ ...value, certificateProfileId })
          }
          placeholder="Select or enter profile ID"
        />
        <LabeledInput
          label="Custom CA profile"
          value={value.caProfileId}
          onChange={(caProfileId) => onChange({ ...value, caProfileId })}
          placeholder="Optional trust bundle profile"
        />
        <div>
          <label className="text-xs font-medium" htmlFor="tls-version">
            Minimum TLS version
          </label>
          <NativeSelect
            id="tls-version"
            className="mt-2 w-full"
            value={value.minimumVersion}
            onChange={(event) =>
              onChange({ ...value, minimumVersion: event.target.value })
            }
          >
            <NativeSelectOption>TLS 1.2</NativeSelectOption>
            <NativeSelectOption>TLS 1.3</NativeSelectOption>
          </NativeSelect>
        </div>
        <ToggleLine
          label="Verify hostname"
          description="Reject certificates that do not match the request host."
          checked={value.verifyHostname}
          onChange={(verifyHostname) => onChange({ ...value, verifyHostname })}
        />
      </div>
    </div>
  )
}

function ProxyEditor({
  value,
  onChange,
  secrets,
}: {
  value: RequestDefinition["steps"][0]["request"]["proxy"]
  onChange: (value: RequestDefinition["steps"][0]["request"]["proxy"]) => void
  secrets: ConfigurationProfileContract[]
}) {
  return (
    <div>
      <SectionHeading
        icon={Network}
        title="Proxy routing"
        description="Inherit environment routing, use a governed profile, or configure a request-specific HTTP, HTTPS, or SOCKS5 proxy."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium" htmlFor="proxy-mode">
            Proxy mode
          </label>
          <NativeSelect
            id="proxy-mode"
            className="mt-2 w-full"
            value={value.mode}
            onChange={(event) =>
              onChange({ ...value, mode: event.target.value })
            }
          >
            {PROXY_MODES.map((mode) => (
              <NativeSelectOption key={mode.value} value={mode.value}>
                {mode.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <LabeledInput
          label="Proxy profile ID"
          value={value.profileId}
          onChange={(profileId) => onChange({ ...value, profileId })}
          placeholder="proxy-corporate-egress"
        />
        <LabeledInput
          label="Proxy URL"
          value={value.url}
          onChange={(url) => onChange({ ...value, url })}
          placeholder="http://proxy.internal:8080"
        />
        <LabeledInput
          label="No-proxy hosts"
          value={value.noProxy}
          onChange={(noProxy) => onChange({ ...value, noProxy })}
          placeholder="localhost, *.internal"
        />
        <div>
          <p className="text-xs font-medium">Username secret</p>
          <div className="mt-2">
            <SecretPicker
              ariaLabel="Proxy username secret"
              secrets={secrets}
              value={secretAliasFromRef(value.usernameSecretRef)}
              onValueChange={(alias) =>
                onChange({ ...value, usernameSecretRef: toSecretRef(alias) })
              }
            />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium">Password secret</p>
          <div className="mt-2">
            <SecretPicker
              ariaLabel="Proxy password secret"
              secrets={secrets}
              value={secretAliasFromRef(value.passwordSecretRef)}
              onValueChange={(alias) =>
                onChange({ ...value, passwordSecretRef: toSecretRef(alias) })
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsEditor({
  value,
  onChange,
}: {
  value: RequestDefinition["steps"][0]["request"]["settings"]
  onChange: (
    value: RequestDefinition["steps"][0]["request"]["settings"]
  ) => void
}) {
  return (
    <div>
      <SectionHeading
        icon={Settings2}
        title="Request execution settings"
        description="Bound request behavior so retries, redirects, timeouts, and captured diagnostics remain predictable."
      />
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <ToggleLine
          label="Follow redirects"
          description="Follow safe HTTP redirects up to the configured limit."
          checked={value.followRedirects}
          onChange={(followRedirects) =>
            onChange({ ...value, followRedirects })
          }
        />
        <LabeledNumber
          label="Maximum redirects"
          value={value.maxRedirects}
          onChange={(maxRedirects) => onChange({ ...value, maxRedirects })}
        />
        <ToggleLine
          label="Accept compression"
          description="Advertise and decode supported compressed responses."
          checked={value.compression}
          onChange={(compression) => onChange({ ...value, compression })}
        />
        <LabeledNumber
          label="Timeout (milliseconds)"
          value={value.timeoutMs}
          onChange={(timeoutMs) => onChange({ ...value, timeoutMs })}
        />
        <LabeledNumber
          label="Retry attempts"
          value={value.retries}
          onChange={(retries) => onChange({ ...value, retries })}
        />
        <div>
          <label className="text-xs font-medium" htmlFor="retry-backoff">
            Retry backoff
          </label>
          <NativeSelect
            id="retry-backoff"
            className="mt-2 w-full"
            value={value.retryBackoff}
            onChange={(event) =>
              onChange({ ...value, retryBackoff: event.target.value })
            }
          >
            <NativeSelectOption value="fixed">Fixed</NativeSelectOption>
            <NativeSelectOption value="linear">Linear</NativeSelectOption>
            <NativeSelectOption value="exponential">
              Exponential with jitter
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <ToggleLine
          label="Capture response body"
          description="Store a redacted, size-limited body for diagnostics."
          checked={value.captureBody}
          onChange={(captureBody) => onChange({ ...value, captureBody })}
        />
        <LabeledNumber
          label="Maximum captured bytes"
          value={value.maxBodyBytes}
          onChange={(maxBodyBytes) => onChange({ ...value, maxBodyBytes })}
        />
      </div>
    </div>
  )
}

function RequestPreview({
  method,
  url,
  headers,
  body,
  authType,
}: {
  method: string
  url: string
  headers: KeyValueRow[]
  body: { type: string; content: string }
  authType: string
}) {
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-lg bg-foreground text-background">
      <div className="flex items-center justify-between border-b border-background/15 px-4 py-2 text-xs">
        <span className="font-medium">Safe request preview</span>
        <span className="text-background/65">Secrets masked</span>
      </div>
      <pre className="max-h-64 overflow-auto p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
        <span className="font-semibold text-background">{method}</span>{" "}
        {maskSecretTemplates(url || "https://api.example.com/path")}
        {"\n"}
        {headers
          .filter((item) => item.enabled && item.key)
          .map(
            (item) =>
              `${item.key}: ${item.sensitive ? "••••••••" : maskSecretTemplates(item.value)}`
          )
          .join("\n")}
        {authType !== "none"
          ? `\nAuthorization: •••••••• (${AUTH_LABELS[authType]})`
          : ""}
        {body.type !== "none" && body.content
          ? `\n\n${maskSecretTemplates(body.content)}`
          : ""}
      </pre>
    </div>
  )
}

function MetricEditor({
  value,
  onChange,
}: {
  value: RequestDefinition["steps"][number]["metric"]
  onChange: (value: RequestDefinition["steps"][number]["metric"]) => void
}) {
  return (
    <div className="min-h-[430px] p-5">
      <SectionHeading
        icon={ChartNoAxesCombined}
        title="Dynatrace metric validation"
        description="Query a governed telemetry provider and turn application metrics into a deployment-gate assertion."
      />
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <LabeledInput
          label="Telemetry profile ID or name"
          value={value.profileId}
          onChange={(profileId) => onChange({ ...value, profileId })}
          placeholder="dynatrace-production"
        />
        <LabeledInput
          label="Metric selector"
          value={value.metricSelector}
          onChange={(metricSelector) => onChange({ ...value, metricSelector })}
          placeholder="builtin:host.cpu.usage"
        />
        <div className="md:col-span-2">
          <LabeledInput
            label="Entity selector"
            value={value.entitySelector}
            onChange={(entitySelector) =>
              onChange({ ...value, entitySelector })
            }
            placeholder={'type(HOST),tag("application:payments")'}
          />
        </div>
        <div>
          <label className="text-xs font-medium" htmlFor="metric-aggregation">
            Aggregation
          </label>
          <NativeSelect
            id="metric-aggregation"
            className="mt-2 w-full"
            value={value.aggregation}
            onChange={(event) =>
              onChange({ ...value, aggregation: event.target.value })
            }
          >
            {["AVG", "MAX", "MIN", "SUM", "LAST"].map((item) => (
              <NativeSelectOption value={item} key={item}>
                {item}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <LabeledInput
          label="Time window"
          value={value.window}
          onChange={(window) => onChange({ ...value, window })}
          placeholder="10m"
        />
        <LabeledInput
          label="Resolution"
          value={value.resolution}
          onChange={(resolution) => onChange({ ...value, resolution })}
          placeholder="1m"
        />
        <LabeledInput
          label="Baseline window (optional)"
          value={value.baselineWindow}
          onChange={(baselineWindow) => onChange({ ...value, baselineWindow })}
          placeholder="24h"
        />
        <div>
          <label className="text-xs font-medium" htmlFor="metric-comparison">
            Comparison
          </label>
          <NativeSelect
            id="metric-comparison"
            className="mt-2 w-full"
            value={value.operator}
            onChange={(event) =>
              onChange({ ...value, operator: event.target.value })
            }
          >
            <NativeSelectOption value="LESS_THAN">Less than</NativeSelectOption>
            <NativeSelectOption value="LESS_THAN_OR_EQUAL">
              At most
            </NativeSelectOption>
            <NativeSelectOption value="GREATER_THAN">
              Greater than
            </NativeSelectOption>
            <NativeSelectOption value="GREATER_THAN_OR_EQUAL">
              At least
            </NativeSelectOption>
            <NativeSelectOption value="EQUAL">Equals</NativeSelectOption>
          </NativeSelect>
        </div>
        <LabeledNumber
          label="Threshold"
          value={value.threshold}
          onChange={(threshold) => onChange({ ...value, threshold })}
        />
        <div>
          <label className="text-xs font-medium" htmlFor="metric-missing-data">
            Missing data
          </label>
          <NativeSelect
            id="metric-missing-data"
            className="mt-2 w-full"
            value={value.missingDataPolicy}
            onChange={(event) =>
              onChange({ ...value, missingDataPolicy: event.target.value })
            }
          >
            <NativeSelectOption value="FAIL">
              Fail validation
            </NativeSelectOption>
            <NativeSelectOption value="PASS">
              Allow missing data
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
      <div className="mt-6 rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        <ShieldCheck className="mr-2 inline size-4" />
        Provider tokens are resolved from secret references at execution time
        and never stored in monitor definitions or run evidence.
      </div>
    </div>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  variables = [],
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  variables?: VariableCatalogEntry[]
}) {
  const id = useId()
  return (
    <div>
      <label className="text-xs font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="mt-2">
        <TemplateValueInput
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={type === "password" ? "font-mono" : ""}
          entries={variables}
        />
      </div>
    </div>
  )
}

function RowInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  className?: string
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-xs font-medium md:sr-only" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        className={className}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function TemplateValueInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
  entries,
  multiline = false,
}: {
  id: string
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  className?: string
  entries: VariableCatalogEntry[]
  multiline?: boolean
}) {
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const selection = useRef({ start: value.length, end: value.length })

  function rememberSelection(target: HTMLInputElement | HTMLTextAreaElement) {
    selection.current = {
      start: target.selectionStart ?? value.length,
      end: target.selectionEnd ?? value.length,
    }
  }

  function updateFromField(target: HTMLInputElement | HTMLTextAreaElement) {
    rememberSelection(target)
    onChange(target.value)
    const caret = target.selectionStart ?? 0
    if (target.value.slice(Math.max(0, caret - 2), caret) === "{{")
      setPickerOpen(true)
  }

  function insert(entry: VariableCatalogEntry, explicit: boolean) {
    const syntax = explicit ? entry.explicitTemplate : entry.template
    let { start } = selection.current
    const { end } = selection.current
    if (value.slice(Math.max(0, start - 2), start) === "{{") start -= 2
    const next = `${value.slice(0, start)}${syntax}${value.slice(end)}`
    const caret = start + syntax.length
    onChange(next)
    requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(caret, caret)
      selection.current = { start: caret, end: caret }
    })
  }

  const common = {
    ref: fieldRef as never,
    value,
    placeholder,
    className,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => updateFromField(event.target),
    onSelect: (
      event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => rememberSelection(event.currentTarget),
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      if ((event.metaKey || event.ctrlKey) && event.code === "Space") {
        event.preventDefault()
        rememberSelection(event.currentTarget)
        setPickerOpen(true)
      }
    },
  }
  return (
    <div className="min-w-0">
      {label ? (
        <label
          className="mb-1 block text-xs font-medium md:sr-only"
          htmlFor={id}
        >
          {label}
        </label>
      ) : null}
      <div className="flex min-w-0 items-start gap-1.5">
        {multiline ? (
          <Textarea
            id={id}
            aria-label={label || "Request field"}
            {...common}
            spellCheck={false}
          />
        ) : (
          <Input
            id={id}
            aria-label={label || "Request field"}
            {...common}
            type={type}
          />
        )}
        <VariablePicker
          entries={entries}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onInsert={insert}
          label=""
        />
      </div>
    </div>
  )
}

function LabeledNumber({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div>
      <label className="text-xs font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        className="mt-2 font-mono"
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
function ToggleLine({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/35 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}
function OrderedRows({
  children,
  empty,
}: {
  children: ReactNode
  empty: string
}) {
  return (
    <div>
      {Children.count(children) ? children : <EmptyRows message={empty} />}
    </div>
  )
}
function EmptyRows({
  message,
  onAdd,
}: {
  message: string
  onAdd?: () => void
}) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-lg bg-muted/35 p-5 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onAdd ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={onAdd}
        >
          <Plus data-icon="inline-start" /> Add first entry
        </Button>
      ) : null}
    </div>
  )
}
function configuredRows(rows: Array<{ enabled: boolean; key: string }>) {
  return rows.filter((item) => item.enabled && item.key.trim()).length
}
function maskSecretTemplates(value: string) {
  return value.replace(
    /\{\{\s*(?:secrets?|credentials?)\.[^}]+\}\}/gi,
    "••••••••"
  )
}
function newID(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
function labelize(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
function bodyPlaceholder(type: string) {
  if (type === "json") return '{\n  "message": "{{ variables.message }}"\n}'
  if (type === "graphql") return "query Health {\n  health { status }\n}"
  if (type === "form") return "key=value&other={{ variables.other }}"
  if (type === "xml")
    return "<request>\n  <id>{{ generated.uuid }}</id>\n</request>"
  return "Enter request content or a template expression."
}

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const

const REQUEST_SECTION_GROUPS: Array<{
  label: string
  items: Array<{ value: RequestWorkbenchSection; label: string }>
}> = [
  {
    label: "Request",
    items: [
      { value: "params", label: "Params" },
      { value: "auth", label: "Auth" },
      { value: "headers", label: "Headers" },
      { value: "body", label: "Body" },
      { value: "cookies", label: "Cookies" },
    ],
  },
  {
    label: "Automation",
    items: [
      { value: "pre-request", label: "Pre-request" },
      { value: "extractors", label: "Extractors" },
    ],
  },
  {
    label: "Checks",
    items: [{ value: "assertions", label: "Tests" }],
  },
  {
    label: "Connection",
    items: [
      { value: "tls", label: "TLS" },
      { value: "proxy", label: "Proxy" },
      { value: "settings", label: "Settings" },
    ],
  },
]

function httpMethodClassName(method: string) {
  switch (method) {
    case "GET":
      return "text-success-foreground focus:text-success-foreground focus:**:text-success-foreground"
    case "POST":
      return "text-primary focus:text-primary focus:**:text-primary"
    case "PUT":
      return "text-warning-foreground focus:text-warning-foreground focus:**:text-warning-foreground"
    case "PATCH":
      return "text-primary focus:text-primary focus:**:text-primary"
    case "DELETE":
      return "text-destructive focus:text-destructive focus:**:text-destructive"
    case "HEAD":
    case "OPTIONS":
    default:
      return "text-muted-foreground focus:text-muted-foreground focus:**:text-muted-foreground"
  }
}
const BODY_TYPES = [
  { value: "none", label: "None" },
  { value: "json", label: "JSON" },
  { value: "raw", label: "Raw" },
  { value: "xml", label: "XML" },
  { value: "graphql", label: "GraphQL" },
  { value: "form", label: "Form URL encoded" },
  { value: "multipart", label: "Multipart" },
]
const AUTH_LABELS: Record<string, string> = {
  none: "No auth",
  basic: "Basic auth",
  bearer: "Bearer token",
  apiKey: "API key",
  oauth2: "OAuth 2.0 client credentials",
  jwt: "JWT client assertion",
  hmac: "HMAC signature",
}
const AUTH_FIELDS: Record<
  string,
  Array<{
    key: string
    label: string
    placeholder: string
    sensitive?: boolean
    secretPicker?: boolean
  }>
> = {
  basic: [
    {
      key: "username",
      label: "Username",
      placeholder: "Username or {{ secrets.user }}",
    },
    {
      key: "password",
      label: "Password",
      placeholder: "Password or {{ secrets.pass }}",
      sensitive: true,
    },
  ],
  bearer: [
    {
      key: "token",
      label: "Bearer token",
      placeholder: "{{ secrets.apiToken }}",
      sensitive: true,
    },
  ],
  apiKey: [
    { key: "name", label: "Key name", placeholder: "X-API-Key" },
    {
      key: "value",
      label: "Key value",
      placeholder: "{{ secrets.apiKey }}",
      sensitive: true,
    },
    { key: "location", label: "Add to", placeholder: "header or query" },
  ],
  oauth2: [
    {
      key: "tokenUrl",
      label: "Token URL",
      placeholder: "https://idp.example.com/oauth/token",
    },
    { key: "clientId", label: "Client ID", placeholder: "Client ID" },
    {
      key: "clientSecret",
      label: "Client secret",
      placeholder: "{{ secrets.clientSecret }}",
      sensitive: true,
    },
    { key: "scope", label: "Scope", placeholder: "payments.read" },
  ],
  jwt: [
    { key: "issuer", label: "Issuer", placeholder: "service-client" },
    {
      key: "audience",
      label: "Audience",
      placeholder: "https://idp.example.com",
    },
    {
      key: "keyRef",
      label: "Signing key",
      placeholder: "jwt-private-key",
      sensitive: true,
      secretPicker: true,
    },
    { key: "algorithm", label: "Algorithm", placeholder: "RS256" },
  ],
  hmac: [
    { key: "algorithm", label: "Algorithm", placeholder: "SHA-256" },
    {
      key: "secretRef",
      label: "HMAC secret",
      placeholder: "api-hmac",
      sensitive: true,
      secretPicker: true,
    },
    {
      key: "canonicalTemplate",
      label: "Canonical input",
      placeholder: "{{ request.method }}\n{{ request.path }}",
    },
    {
      key: "outputHeader",
      label: "Signature header",
      placeholder: "X-Signature",
    },
  ],
}
const ACTION_TYPES = [
  { value: "timestamp", label: "Generate timestamp" },
  { value: "uuid", label: "Generate UUID" },
  { value: "nonce", label: "Generate nonce" },
  { value: "random-string", label: "Random string" },
  { value: "sha", label: "SHA-256 hash" },
  { value: "sha512", label: "SHA-512 hash" },
  { value: "hmac", label: "HMAC signature" },
  { value: "jwt", label: "Generate JWT" },
  { value: "oauth-token", label: "Acquire OAuth token" },
  { value: "base64-encode", label: "Base64 encode" },
  { value: "base64-decode", label: "Base64 decode" },
  { value: "url-encode", label: "URL encode" },
  { value: "url-decode", label: "URL decode" },
  { value: "json-stringify", label: "JSON stringify" },
  { value: "copy-value", label: "Copy value" },
  { value: "unset-variable", label: "Unset variable" },
  { value: "set-variable", label: "Set variable" },
]
const EXTRACTOR_TYPES = [
  "jsonpath",
  "header",
  "cookie",
  "regex",
  "status",
  "timing",
]
const ASSERTION_TYPES = [
  "status",
  "header",
  "body-contains",
  "regex",
  "jsonpath",
  "json-schema",
  "response-time",
  "response-size",
  "final-url",
  "tls-trusted",
  "tls-version",
  "tls-days-until-expiry",
  "tls-issuer",
  "tls-subject",
]
const ASSERTION_OPERATORS = [
  { value: "equals", label: "Equals" },
  { value: "not-equals", label: "Not equals" },
  { value: "exists", label: "Exists" },
  { value: "contains", label: "Contains" },
  { value: "matches", label: "Matches regex" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "At least" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "At most" },
]
const PROXY_MODES = [
  { value: "environment", label: "Inherit environment" },
  { value: "none", label: "Direct / no proxy" },
  { value: "profile", label: "Proxy profile" },
  { value: "http", label: "HTTP proxy" },
  { value: "https", label: "HTTPS proxy" },
  { value: "socks5", label: "SOCKS5 proxy" },
]
