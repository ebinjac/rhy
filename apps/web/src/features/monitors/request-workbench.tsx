import { Children, useId, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
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
  Code2,
  Cookie,
  Download,
  Eye,
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
  normalizeScriptDefinition,
  PreRequestScriptEditor,
} from "@/features/monitors/pre-request-script-editor"
import type { ScriptDefinition } from "@/features/monitors/pre-request-script-editor"
import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"

export type KeyValueRow = {
  id: string
  enabled: boolean
  key: string
  value: string
  description: string
  sensitive?: boolean
}

export type RequestDefinition = {
  schemaVersion: number
  scripts: { preRequest: ScriptDefinition }
  steps: Array<{
    id: string
    name: string
    type: "HTTP_REQUEST" | "ACTION" | "METRIC_VALIDATION"
    enabled: boolean
    timeoutMs: number
    actions: Array<{
      id: string
      enabled: boolean
      type: string
      output: string
      expression: string
      sensitive: boolean
      fields?: Record<string, string>
    }>
    metric: {
      provider: string
      profileId: string
      metricSelector: string
      entitySelector: string
      aggregation: string
      window: string
      resolution: string
      baselineWindow: string
      operator: string
      threshold: number
      missingDataPolicy: string
    }
    request: {
      method: string
      url: string
      params: KeyValueRow[]
      headers: KeyValueRow[]
      cookies: Array<KeyValueRow & { domain: string; path: string }>
      persistCookies: boolean
      auth: { type: string; fields: Record<string, string> }
      body: { type: string; content: string }
      // Legacy controlled actions: still executed if present on old monitors, but Pre-request UI
      // edits only the script field going forward (script is source of truth for new work).
      preRequest: Array<{
        id: string
        enabled: boolean
        type: string
        output: string
        expression: string
        sensitive: boolean
        fields?: Record<string, string>
      }>
      preRequestScript: ScriptDefinition
      extractors: Array<{
        id: string
        enabled: boolean
        source: string
        variable: string
        expression: string
        sensitive: boolean
      }>
      assertions: Array<{
        id: string
        enabled: boolean
        type: string
        expression: string
        expected: string
        operator?: string
      }>
      tls: {
        certificateProfileId: string
        caProfileId: string
        minimumVersion: string
        verifyHostname: boolean
      }
      proxy: {
        mode: string
        profileId: string
        url: string
        noProxy: string
        usernameSecretRef: string
        passwordSecretRef: string
      }
      settings: {
        followRedirects: boolean
        maxRedirects: number
        compression: boolean
        timeoutMs: number
        retries: number
        retryBackoff: string
        captureBody: boolean
        maxBodyBytes: number
      }
    }
  }>
}

const row = (id: string): KeyValueRow => ({
  id,
  enabled: true,
  key: "",
  value: "",
  description: "",
})

export const initialRequestDefinition: RequestDefinition = {
  schemaVersion: 2,
  scripts: {
    preRequest: {
      enabled: false,
      language: "javascript",
      code: "",
      runtimeVersion: "rhythm-js-1",
    },
  },
  steps: [
    {
      id: "step-request-1",
      name: "Request 1",
      type: "HTTP_REQUEST",
      enabled: true,
      timeoutMs: 15000,
      actions: [],
      metric: {
        provider: "DYNATRACE",
        profileId: "",
        metricSelector: "builtin:host.cpu.usage",
        entitySelector: "",
        aggregation: "AVG",
        window: "10m",
        resolution: "1m",
        baselineWindow: "",
        operator: "LESS_THAN",
        threshold: 80,
        missingDataPolicy: "FAIL",
      },
      request: {
        method: "GET",
        url: "",
        params: [row("param-1")],
        headers: [
          { ...row("header-1"), key: "Accept", value: "application/json" },
        ],
        cookies: [],
        persistCookies: true,
        auth: { type: "none", fields: {} },
        body: { type: "none", content: "" },
        preRequest: [],
        preRequestScript: {
          enabled: false,
          language: "javascript",
          code: "",
          runtimeVersion: "rhythm-js-1",
        },
        extractors: [],
        assertions: [
          {
            id: "assertion-1",
            enabled: true,
            type: "status",
            expression: "status",
            expected: "200",
          },
        ],
        tls: {
          certificateProfileId: "",
          caProfileId: "",
          minimumVersion: "TLS 1.2",
          verifyHostname: true,
        },
        proxy: {
          mode: "environment",
          profileId: "",
          url: "",
          noProxy: "",
          usernameSecretRef: "",
          passwordSecretRef: "",
        },
        settings: {
          followRedirects: true,
          maxRedirects: 5,
          compression: true,
          timeoutMs: 15000,
          retries: 0,
          retryBackoff: "exponential",
          captureBody: true,
          maxBodyBytes: 1048576,
        },
      },
    },
  ],
}

/** Align enabled with script content before persist or load (Postman-style). */
export function normalizeDefinitionScripts(
  value: RequestDefinition
): RequestDefinition {
  const emptyScript: ScriptDefinition = {
    enabled: false,
    language: "javascript",
    code: "",
    runtimeVersion: "rhythm-js-1",
  }
  return {
    ...value,
    scripts: {
      ...value.scripts,
      preRequest: normalizeScriptDefinition(
        value.scripts?.preRequest ?? emptyScript
      ),
    },
    steps: value.steps.map((step) => ({
      ...step,
      request: {
        ...step.request,
        preRequestScript: normalizeScriptDefinition(
          step.request?.preRequestScript ?? emptyScript
        ),
      },
    })),
  }
}

type Props = {
  value: RequestDefinition
  onChange: (value: RequestDefinition) => void
  monitorId?: string
  revisionId?: string
  secrets?: ConfigurationProfileContract[]
}

export function RequestWorkbench({
  value,
  onChange,
  monitorId,
  revisionId,
  secrets = [],
}: Props) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedStepID, setSelectedStepID] = useState(value.steps[0]?.id ?? "")
  const selectedIndex = Math.max(
    0,
    value.steps.findIndex((candidate) => candidate.id === selectedStepID)
  )
  const step = value.steps[selectedIndex] ?? value.steps[0]
  const request = step.request

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
      <div className="flex flex-col gap-3 border-b bg-muted/20 p-3 lg:flex-row lg:items-center">
        <div
          className="flex min-w-0 flex-1 gap-2 overflow-x-auto"
          role="tablist"
          aria-label="Workflow steps"
        >
          {value.steps.map((candidate, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={candidate.id === step.id}
              onClick={() => setSelectedStepID(candidate.id)}
              className={`min-w-40 rounded-lg border px-3 py-2 text-left transition-colors ${candidate.id === step.id ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/40"}`}
              key={candidate.id}
            >
              <span className="block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Step {index + 1}
              </span>
              <span className="mt-0.5 block truncate text-sm font-medium">
                {candidate.name}
              </span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => moveStep(-1)}
            disabled={selectedIndex === 0}
            aria-label="Move step up"
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => moveStep(1)}
            disabled={selectedIndex === value.steps.length - 1}
            aria-label="Move step down"
          >
            <ArrowDown />
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
            size="icon-sm"
            variant="ghost"
            onClick={removeStep}
            disabled={value.steps.length === 1}
            aria-label="Delete step"
          >
            <Trash2 />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={addStep}>
            <Plus data-icon="inline-start" /> Add request
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-b bg-muted/35 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="step-name">
            Step name
          </label>
          <Input
            id="step-name"
            className="h-8 max-w-sm border-transparent bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:bg-background focus-visible:px-2"
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
            <InputGroup className="h-9">
              <InputGroupInput
                className="min-w-0 font-mono text-sm"
                value={request.url}
                onChange={(event) => updateRequest({ url: event.target.value })}
                placeholder="https://api.example.com/v1/health"
                aria-label="Request URL"
              />
              <InputGroupAddon align="inline-start">
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
                    size="sm"
                    className={`h-7 w-[6.75rem] border-0 bg-transparent font-medium shadow-none focus-visible:border-transparent focus-visible:ring-0 ${httpMethodClassName(request.method)}`}
                    aria-label="HTTP method"
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
              </InputGroupAddon>
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => setPreviewOpen((open) => !open)}
                >
                  {previewOpen ? (
                    <EyeOff data-icon="inline-start" />
                  ) : (
                    <Send data-icon="inline-start" />
                  )}
                  {previewOpen ? "Hide preview" : "Preview request"}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>

          {previewOpen ? (
            <RequestPreview
              method={request.method}
              url={renderedURL}
              headers={request.headers}
              body={request.body}
              authType={request.auth.type}
            />
          ) : null}

          <Tabs defaultValue="params" className="gap-0">
            <div className="overflow-x-auto border-y px-3">
              <TabsList
                aria-label="Request configuration sections"
                variant="line"
                className="h-auto min-w-max gap-1 py-1"
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
                  label="Assertions"
                  count={
                    request.assertions.filter((item) => item.enabled).length
                  }
                />
                <WorkbenchGroupLabel>Network</WorkbenchGroupLabel>
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
                <WorkbenchGroupLabel>Execution</WorkbenchGroupLabel>
                <WorkbenchTab value="settings" label="Settings" />
              </TabsList>
            </div>

            <div className="min-h-[390px] p-4 md:p-5">
              <TabsContent value="params">
                <KeyValueEditor
                  title="Query parameters"
                  description="Enabled parameters are encoded and appended to the request URL."
                  rows={request.params}
                  onChange={(params) => updateRequest({ params })}
                />
              </TabsContent>
              <TabsContent value="headers">
                <KeyValueEditor
                  title="Request headers"
                  description="Use templates such as {{ variables.apiVersion }}. Mark credentials and signatures as sensitive."
                  rows={request.headers}
                  allowSensitive
                  onChange={(headers) => updateRequest({ headers })}
                />
              </TabsContent>
              <TabsContent value="auth">
                <AuthEditor
                  value={request.auth}
                  onChange={(auth) => updateRequest({ auth })}
                  secrets={secrets}
                />
              </TabsContent>
              <TabsContent value="body">
                <BodyEditor
                  value={request.body}
                  onChange={(body) => updateRequest({ body })}
                />
              </TabsContent>
              <TabsContent value="cookies">
                <CookieEditor
                  rows={request.cookies}
                  persistCookies={request.persistCookies}
                  onPersistChange={(persistCookies) =>
                    updateRequest({ persistCookies })
                  }
                  onChange={(cookies) => updateRequest({ cookies })}
                />
              </TabsContent>
              <TabsContent value="pre-request">
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
                />
              </TabsContent>
              <TabsContent value="extractors">
                <ExtractorEditor
                  rows={request.extractors}
                  onChange={(extractors) => updateRequest({ extractors })}
                />
              </TabsContent>
              <TabsContent value="assertions">
                <AssertionEditor
                  rows={request.assertions}
                  onChange={(assertions) => updateRequest({ assertions })}
                />
              </TabsContent>
              <TabsContent value="tls">
                <TLSEditor
                  value={request.tls}
                  onChange={(tls) => updateRequest({ tls })}
                />
              </TabsContent>
              <TabsContent value="proxy">
                <ProxyEditor
                  value={request.proxy}
                  onChange={(proxy) => updateRequest({ proxy })}
                  secrets={secrets}
                />
              </TabsContent>
              <TabsContent value="settings">
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
    </section>
  )
}

function WorkbenchGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 border-l pl-3 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase first:ml-0 first:border-l-0 first:pl-0">
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
    <TabsTrigger value={value} className="px-2.5">
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
    <div className="mb-5 flex items-start justify-between gap-4">
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
      {action}
    </div>
  )
}

function KeyValueEditor({
  title,
  description,
  rows,
  onChange,
  allowSensitive = false,
}: {
  title: string
  description: string
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  allowSensitive?: boolean
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
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div
            className={`grid ${allowSensitive ? "grid-cols-[36px_1fr_1.2fr_1fr_80px_36px]" : "grid-cols-[36px_1fr_1.2fr_1fr_36px]"} gap-2 border-b pb-2 text-xs font-medium text-muted-foreground`}
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
              className={`grid ${allowSensitive ? "grid-cols-[36px_1fr_1.2fr_1fr_80px_36px]" : "grid-cols-[36px_1fr_1.2fr_1fr_36px]"} items-center gap-2 border-b py-2 last:border-b-0`}
            >
              <Switch
                size="sm"
                checked={item.enabled}
                onCheckedChange={(checked) =>
                  update(item.id, { enabled: checked })
                }
                aria-label={`Enable ${item.key || "row"}`}
              />
              <Input
                value={item.key}
                onChange={(event) =>
                  update(item.id, { key: event.target.value })
                }
                placeholder="key"
              />
              <Input
                className="font-mono"
                type={item.sensitive ? "password" : "text"}
                value={item.value}
                onChange={(event) =>
                  update(item.id, { value: event.target.value })
                }
                placeholder="value or {{ template }}"
              />
              <Input
                value={item.description}
                onChange={(event) =>
                  update(item.id, { description: event.target.value })
                }
                placeholder="Optional note"
              />
              {allowSensitive ? (
                <Switch
                  size="sm"
                  checked={Boolean(item.sensitive)}
                  onCheckedChange={(checked) =>
                    update(item.id, { sensitive: checked })
                  }
                  aria-label={`Mark ${item.key || "value"} sensitive`}
                />
              ) : null}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() =>
                  onChange(rows.filter((rowItem) => rowItem.id !== item.id))
                }
                aria-label="Remove row"
              >
                <Trash2 />
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
}: {
  value: RequestDefinition["steps"][0]["request"]["auth"]
  onChange: (value: RequestDefinition["steps"][0]["request"]["auth"]) => void
  secrets: ConfigurationProfileContract[]
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
                />
              )
            )
          ) : (
            <div className="rounded-lg bg-muted/50 p-5 text-sm text-muted-foreground sm:col-span-2">
              No authentication will be added to this request.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BodyEditor({
  value,
  onChange,
}: {
  value: RequestDefinition["steps"][0]["request"]["body"]
  onChange: (value: RequestDefinition["steps"][0]["request"]["body"]) => void
}) {
  return (
    <div>
      <SectionHeading
        icon={Braces}
        title="Request body"
        description="Build a templated request body. Content type is applied automatically for structured formats."
      />
      <div className="flex flex-wrap gap-2">
        {BODY_TYPES.map((type) => (
          <Button
            type="button"
            key={type.value}
            size="sm"
            variant={value.type === type.value ? "secondary" : "ghost"}
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
          <Textarea
            className="min-h-64 resize-y font-mono text-sm leading-6"
            spellCheck={false}
            value={value.content}
            onChange={(event) =>
              onChange({ ...value, content: event.target.value })
            }
            placeholder={bodyPlaceholder(value.type)}
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
}: {
  rows: Array<KeyValueRow & { domain: string; path: string }>
  persistCookies: boolean
  onPersistChange: (value: boolean) => void
  onChange: (
    rows: Array<KeyValueRow & { domain: string; path: string }>
  ) => void
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
            className="grid gap-2 rounded-lg bg-muted/35 p-3 sm:grid-cols-[28px_1fr_1fr_1fr_100px_36px] sm:items-center"
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
            <Input
              aria-label={`Value for cookie ${item.key || "row"}`}
              type={item.sensitive ? "password" : "text"}
              value={item.value}
              onChange={(event) =>
                update(item.id, { value: event.target.value })
              }
              placeholder="Value"
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
              size="icon-sm"
              variant="ghost"
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
}: {
  script: ScriptDefinition
  onScriptChange: (value: ScriptDefinition) => void
  monitorId?: string
  revisionId?: string
  stepId: string
  request: RequestDefinition["steps"][0]["request"]
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
        icon={Code2}
        title="Pre-request script"
        description="Postman-compatible JavaScript using pm.* APIs. Runs before this request is rendered and sent. Use pm.variables, pm.environment, pm.request, pm.sendRequest, and Web Crypto. Certificate and proxy settings stay in their own tabs."
      />
      <PreRequestScriptEditor
        value={script}
        onChange={onScriptChange}
        monitorId={monitorId}
        revisionId={revisionId}
        stepId={stepId}
        request={previewRequest}
      />
    </div>
  )
}

function PreRequestEditor({
  rows,
  onChange,
}: {
  rows: RequestDefinition["steps"][0]["request"]["preRequest"]
  onChange: (
    rows: RequestDefinition["steps"][0]["request"]["preRequest"]
  ) => void
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
            className="grid gap-2 border-b py-3 last:border-b-0 lg:grid-cols-[32px_28px_170px_1fr_1.2fr_1.2fr_72px_36px] lg:items-center"
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
            <Input
              aria-label={`Expression for pre-request action ${index + 1}`}
              className="font-mono"
              value={item.expression}
              onChange={(event) =>
                update(item.id, { expression: event.target.value })
              }
              placeholder="Input expression"
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
              size="icon-sm"
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
            className="grid gap-2 border-b py-3 last:border-b-0 lg:grid-cols-[32px_28px_150px_1fr_1.4fr_82px_36px] lg:items-center"
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
              size="icon-sm"
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
            className="grid gap-2 border-b py-3 last:border-b-0 lg:grid-cols-[32px_28px_160px_1.2fr_150px_1fr_36px] lg:items-center"
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
              size="icon-sm"
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
        <span className="text-primary">{method}</span>{" "}
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
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const secret = type === "password"
  return (
    <div>
      <label className="text-xs font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="relative mt-2">
        <Input
          id={id}
          type={secret && !visible ? "password" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={secret ? "pr-9 font-mono" : ""}
        />
        {secret ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="absolute top-0.5 right-0.5"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          >
            {visible ? <EyeOff /> : <Eye />}
          </Button>
        ) : null}
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
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        {Children.count(children) ? children : <EmptyRows message={empty} />}
      </div>
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

function httpMethodClassName(method: string) {
  switch (method) {
    case "GET":
      return "text-success focus:text-success focus:**:text-success"
    case "POST":
      return "text-sidebar-primary focus:text-sidebar-primary focus:**:text-sidebar-primary"
    case "PUT":
      return "text-warning focus:text-warning focus:**:text-warning"
    case "PATCH":
      return "text-violet-400 focus:text-violet-400 focus:**:text-violet-400"
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
