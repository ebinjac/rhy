import { useMemo } from "react"
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
  AlertTriangle,
  BarChart3,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Copy,
  Eye,
  GripVertical,
  MousePointer2,
  Navigation,
  Plus,
  Trash2,
  Type,
} from "lucide-react"

import type {
  BrowserLocator,
  BrowserStep,
} from "@/lib/api-client/browser-monitoring"

const stepOptions: Array<{
  type: BrowserStep["type"]
  label: string
  description: string
  icon: typeof Navigation
}> = [
  {
    type: "NAVIGATE",
    label: "Open page",
    description: "Navigate to a URL and wait for DOM content.",
    icon: Navigation,
  },
  {
    type: "CLICK",
    label: "Click element",
    description: "Activate a button, link, or other control.",
    icon: MousePointer2,
  },
  {
    type: "FILL",
    label: "Fill field",
    description: "Enter text or a masked secret into a field.",
    icon: Type,
  },
  {
    type: "WAIT",
    label: "Wait for element",
    description: "Wait until a user-visible element is ready.",
    icon: CircleDot,
  },
  {
    type: "ASSERT",
    label: "Assert page state",
    description: "Validate text, visibility, URL, errors, or performance.",
    icon: CheckCircle2,
  },
  {
    type: "GRAPH_CHECK",
    label: "Monitor graph or KPI",
    description: "Extract a structured value and evaluate a threshold.",
    icon: BarChart3,
  },
  {
    type: "SCREENSHOT",
    label: "Visual checkpoint",
    description:
      "Compare a stable page or element against an approved baseline.",
    icon: Camera,
  },
]

export function JourneyBuilder({
  steps,
  selectedStepID,
  onSelectedStepIDChange,
  onChange,
}: {
  steps: BrowserStep[]
  selectedStepID: string
  onSelectedStepIDChange: (stepID: string) => void
  onChange: (steps: BrowserStep[]) => void
}) {
  const selectedIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === selectedStepID)
  )
  const selected = steps[selectedIndex]
  const readiness = useMemo(
    () => ({
      hasNavigation: steps.some(
        (step) => step.enabled && step.type === "NAVIGATE"
      ),
      hasCheck: steps.some(
        (step) =>
          step.enabled &&
          ["ASSERT", "GRAPH_CHECK", "SCREENSHOT"].includes(step.type)
      ),
      unstableLocators: steps.filter(
        (step) =>
          step.enabled &&
          step.locator &&
          ["CSS", "XPATH"].includes(step.locator.strategy)
      ).length,
    }),
    [steps]
  )

  function addStep(type: BrowserStep["type"]) {
    const next = createStep(type)
    onChange([...steps, next])
    onSelectedStepIDChange(next.id)
  }

  function updateSelected(patch: Partial<BrowserStep>) {
    if (!selected) return
    onChange(
      steps.map((step) =>
        step.id === selected.id ? { ...step, ...patch } : step
      )
    )
  }

  function moveSelected(direction: -1 | 1) {
    if (!selected) return
    const target = selectedIndex + direction
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    ;[next[selectedIndex], next[target]] = [next[target], next[selectedIndex]]
    onChange(next)
  }

  function removeSelected() {
    if (!selected || steps.length === 1) return
    const next = steps.filter((step) => step.id !== selected.id)
    onChange(next)
    onSelectedStepIDChange(next[Math.min(selectedIndex, next.length - 1)].id)
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div className="flex flex-col border-b bg-muted/20 lg:grid lg:grid-cols-[19rem_1fr]">
        <div className="border-b p-4 lg:border-r lg:border-b-0">
          <p className="text-sm font-semibold">Journey steps</p>
          <p className="mt-1 text-xs/5 text-muted-foreground">
            Rhythm runs these actions in order in a fresh browser context.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3 lg:px-5">
          <ReadinessItem
            ready={readiness.hasNavigation}
            text={readiness.hasNavigation ? "Start page set" : "Add a page"}
          />
          <ReadinessItem
            ready={readiness.hasCheck}
            text={readiness.hasCheck ? "Outcome checked" : "Add a checkpoint"}
          />
          {readiness.unstableLocators ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs text-warning-foreground">
              <AlertTriangle className="size-3.5" />
              {readiness.unstableLocators} fragile locator
              {readiness.unstableLocators === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-[32rem] lg:grid-cols-[19rem_1fr]">
        <aside className="border-b p-3 lg:border-r lg:border-b-0">
          <ol className="space-y-1" aria-label="Browser journey steps">
            {steps.map((step, index) => {
              const Icon =
                stepOptions.find((option) => option.type === step.type)?.icon ??
                CircleDot
              return (
                <li key={step.id}>
                  <button
                    aria-current={step.id === selected?.id ? "step" : undefined}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      step.id === selected?.id
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onClick={() => onSelectedStepIDChange(step.id)}
                    type="button"
                  >
                    <GripVertical
                      aria-hidden="true"
                      className="size-3.5 shrink-0 opacity-40"
                    />
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-medium tabular-nums">
                      {index + 1}
                    </span>
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {step.name}
                      </span>
                      <span className="block truncate text-[11px]">
                        {step.type.toLowerCase().replaceAll("_", " ")}
                      </span>
                    </span>
                    {!step.enabled ? (
                      <span className="text-[10px] uppercase">Off</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="mt-3 border-t pt-3">
            <p className="px-2 text-xs font-medium text-muted-foreground">
              Add to journey
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-1">
              {stepOptions.map((option) => (
                <button
                  className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  key={option.type}
                  onClick={() => addStep(option.type)}
                  title={option.description}
                  type="button"
                >
                  <option.icon className="size-4 shrink-0" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {selected ? (
          <section
            aria-label={`Edit ${selected.name}`}
            className="min-w-0 p-4 md:p-6"
          >
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <p className="text-xs font-medium text-primary">
                  Step {selectedIndex + 1} ·{" "}
                  {selected.type.toLowerCase().replaceAll("_", " ")}
                </p>
                <h3 className="mt-1 text-lg font-semibold">{selected.name}</h3>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  aria-label="Move step up"
                  disabled={selectedIndex === 0}
                  onClick={() => moveSelected(-1)}
                  size="icon"
                  variant="outline"
                >
                  <ChevronUp />
                </Button>
                <Button
                  aria-label="Move step down"
                  disabled={selectedIndex === steps.length - 1}
                  onClick={() => moveSelected(1)}
                  size="icon"
                  variant="outline"
                >
                  <ChevronDown />
                </Button>
                <Button
                  aria-label="Duplicate step"
                  onClick={() => {
                    const duplicate = {
                      ...selected,
                      id: crypto.randomUUID(),
                      name: `${selected.name} copy`,
                    }
                    const next = [...steps]
                    next.splice(selectedIndex + 1, 0, duplicate)
                    onChange(next)
                    onSelectedStepIDChange(duplicate.id)
                  }}
                  size="icon"
                  variant="outline"
                >
                  <Copy />
                </Button>
                <Button
                  aria-label="Delete step"
                  disabled={steps.length === 1}
                  onClick={removeSelected}
                  size="icon"
                  variant="destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>

            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <Field label="Step name" id={`step-name-${selected.id}`}>
                <Input
                  id={`step-name-${selected.id}`}
                  onChange={(event) =>
                    updateSelected({ name: event.target.value })
                  }
                  value={selected.name}
                />
              </Field>
              <Field
                label="Timeout"
                id={`step-timeout-${selected.id}`}
                hint="Maximum time for this action, not the whole journey."
              >
                <Select
                  onValueChange={(value) =>
                    updateSelected({ timeoutMs: Number(value) })
                  }
                  value={String(selected.timeoutMs)}
                >
                  <SelectTrigger id={`step-timeout-${selected.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5000">5 seconds</SelectItem>
                    <SelectItem value="10000">10 seconds</SelectItem>
                    <SelectItem value="30000">30 seconds</SelectItem>
                    <SelectItem value="60000">60 seconds</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {selected.type === "NAVIGATE" ? (
              <div className="mt-5">
                <Field
                  label="Page URL"
                  id={`step-url-${selected.id}`}
                  hint="Variables and secret aliases use the same {{name}} syntax as API monitors."
                >
                  <Input
                    id={`step-url-${selected.id}`}
                    inputMode="url"
                    onChange={(event) =>
                      updateSelected({ url: event.target.value })
                    }
                    placeholder="https://example.internal/dashboard"
                    value={selected.url ?? ""}
                  />
                </Field>
              </div>
            ) : null}

            {requiresLocator(selected.type) ? (
              <LocatorEditor
                locator={selected.locator ?? defaultLocator()}
                onChange={(locator) => updateSelected({ locator })}
              />
            ) : null}

            {["FILL", "SELECT", "PRESS"].includes(selected.type) ? (
              <div className="mt-5">
                <Field
                  label={selected.type === "PRESS" ? "Keyboard key" : "Value"}
                  id={`step-value-${selected.id}`}
                  hint={
                    selected.type === "FILL"
                      ? "Use {{secrets.alias}} for credentials. Sensitive values are never stored in browser evidence."
                      : undefined
                  }
                >
                  <Input
                    id={`step-value-${selected.id}`}
                    onChange={(event) =>
                      updateSelected({
                        value: event.target.value,
                        sensitive:
                          selected.type === "FILL" &&
                          event.target.value.includes("{{secrets."),
                      })
                    }
                    placeholder={
                      selected.type === "FILL"
                        ? "{{environment.username}}"
                        : selected.type === "PRESS"
                          ? "Enter"
                          : "Option value"
                    }
                    value={selected.value ?? ""}
                  />
                </Field>
              </div>
            ) : null}

            {selected.type === "ASSERT" ? (
              <AssertionEditor step={selected} onChange={updateSelected} />
            ) : null}

            {selected.type === "GRAPH_CHECK" ? (
              <GraphEditor step={selected} onChange={updateSelected} />
            ) : null}

            {selected.type === "SCREENSHOT" ? (
              <ScreenshotEditor step={selected} onChange={updateSelected} />
            ) : null}

            <div className="mt-7 flex items-center justify-between gap-4 border-t pt-5">
              <div>
                <Label htmlFor={`step-enabled-${selected.id}`}>
                  Run this step
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Disabled steps stay in the draft but are skipped during
                  execution.
                </p>
              </div>
              <Switch
                checked={selected.enabled}
                id={`step-enabled-${selected.id}`}
                onCheckedChange={(enabled) => updateSelected({ enabled })}
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function LocatorEditor({
  locator,
  onChange,
}: {
  locator: BrowserLocator
  onChange: (locator: BrowserLocator) => void
}) {
  const stable = ["ROLE", "LABEL", "TEST_ID"].includes(locator.strategy)
  return (
    <div className="mt-6 rounded-lg border bg-muted/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Find the element</p>
          <p className="mt-0.5 text-xs/5 text-muted-foreground">
            Accessible roles, labels, and test IDs survive UI refactors more
            reliably than generated CSS.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
            stable
              ? "bg-success-soft text-success-foreground"
              : "bg-warning-soft text-warning-foreground"
          }`}
        >
          {stable ? "Resilient" : "Fragile"}
        </span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[12rem_1fr]">
        <Field label="Locator method" id="locator-strategy">
          <Select
            onValueChange={(strategy) =>
              onChange({
                ...locator,
                strategy: strategy as BrowserLocator["strategy"],
              })
            }
            value={locator.strategy}
          >
            <SelectTrigger id="locator-strategy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ROLE">Accessible role</SelectItem>
              <SelectItem value="LABEL">Field label</SelectItem>
              <SelectItem value="TEST_ID">Test ID</SelectItem>
              <SelectItem value="TEXT">Visible text</SelectItem>
              <SelectItem value="PLACEHOLDER">Placeholder</SelectItem>
              <SelectItem value="CSS">CSS selector</SelectItem>
              <SelectItem value="XPATH">XPath (last resort)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={locator.strategy === "ROLE" ? "Role" : "Locator value"}
          id="locator-value"
        >
          <Input
            id="locator-value"
            onChange={(event) =>
              onChange({ ...locator, value: event.target.value })
            }
            placeholder={
              locator.strategy === "ROLE"
                ? "button"
                : locator.strategy === "TEST_ID"
                  ? "submit-order"
                  : "Element label or selector"
            }
            value={locator.value}
          />
        </Field>
      </div>
      {locator.strategy === "ROLE" ? (
        <div className="mt-4">
          <Field label="Accessible name" id="locator-name">
            <Input
              id="locator-name"
              onChange={(event) =>
                onChange({ ...locator, name: event.target.value })
              }
              placeholder="Create order"
              value={locator.name ?? ""}
            />
          </Field>
        </div>
      ) : null}
    </div>
  )
}

function AssertionEditor({
  step,
  onChange,
}: {
  step: BrowserStep
  onChange: (patch: Partial<BrowserStep>) => void
}) {
  const check = step.checks?.[0] ?? createCheck()
  function update(patch: Partial<typeof check>) {
    onChange({ checks: [{ ...check, ...patch }] })
  }
  return (
    <div className="mt-6 rounded-lg border p-4">
      <p className="text-sm font-medium">Checkpoint</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="What to validate" id="assert-kind">
          <Select
            onValueChange={(kind) =>
              update({ kind: kind as typeof check.kind })
            }
            value={check.kind}
          >
            <SelectTrigger id="assert-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ELEMENT_VISIBLE">
                Element is visible
              </SelectItem>
              <SelectItem value="TEXT">Element text</SelectItem>
              <SelectItem value="URL">Current URL</SelectItem>
              <SelectItem value="TITLE">Page title</SelectItem>
              <SelectItem value="NO_JAVASCRIPT_ERRORS">
                No JavaScript errors
              </SelectItem>
              <SelectItem value="NO_FAILED_REQUESTS">
                No failed requests
              </SelectItem>
              <SelectItem value="ACCESSIBILITY">Accessibility scan</SelectItem>
              <SelectItem value="PERFORMANCE">Performance budget</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Gate impact" id="assert-gate">
          <Select
            onValueChange={(gateMode) =>
              update({ gateMode: gateMode as typeof check.gateMode })
            }
            value={check.gateMode}
          >
            <SelectTrigger id="assert-gate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BLOCKING">Blocking</SelectItem>
              <SelectItem value="ADVISORY">Advisory</SelectItem>
              <SelectItem value="EVIDENCE_ONLY">Evidence only</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {["TEXT", "URL", "TITLE", "PERFORMANCE"].includes(check.kind) ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Comparison" id="assert-operator">
            <Select
              onValueChange={(operator) =>
                update({ operator: operator ?? undefined })
              }
              value={check.operator}
            >
              <SelectTrigger id="assert-operator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EQUAL">Equals</SelectItem>
                <SelectItem value="CONTAINS">Contains</SelectItem>
                <SelectItem value="MATCHES">Matches pattern</SelectItem>
                <SelectItem value="LESS_OR_EQUAL">At most</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Expected value" id="assert-expected">
            <Input
              id="assert-expected"
              onChange={(event) =>
                update({
                  expected: event.target.value,
                  threshold: Number(event.target.value) || undefined,
                })
              }
              placeholder={check.kind === "PERFORMANCE" ? "2500" : "Expected"}
              value={check.expected ?? ""}
            />
          </Field>
        </div>
      ) : null}
    </div>
  )
}

function GraphEditor({
  step,
  onChange,
}: {
  step: BrowserStep
  onChange: (patch: Partial<BrowserStep>) => void
}) {
  const graph = step.graph ?? createGraph()
  function update(patch: Partial<typeof graph>) {
    onChange({ graph: { ...graph, ...patch } })
  }
  return (
    <div className="mt-6 rounded-lg border p-4">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BarChart3 className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium">Structured graph intelligence</p>
          <p className="mt-0.5 text-xs/5 text-muted-foreground">
            Prefer visible DOM or a bounded JSON response. Visual-only numeric
            extraction remains advisory until a baseline is calibrated.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Data source" id="graph-source">
          <Select
            onValueChange={(source) =>
              update({ source: source as typeof graph.source })
            }
            value={graph.source}
          >
            <SelectTrigger id="graph-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DOM">Visible DOM value</SelectItem>
              <SelectItem value="ACCESSIBILITY">Accessible value</SelectItem>
              <SelectItem value="NETWORK_JSON">
                Network JSON response
              </SelectItem>
              <SelectItem value="VISUAL">Calibrated visual fallback</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Aggregation" id="graph-aggregation">
          <Select
            onValueChange={(aggregation) =>
              update({ aggregation: aggregation as typeof graph.aggregation })
            }
            value={graph.aggregation}
          >
            <SelectTrigger id="graph-aggregation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LATEST">Latest value</SelectItem>
              <SelectItem value="MINIMUM">Minimum</SelectItem>
              <SelectItem value="MAXIMUM">Maximum</SelectItem>
              <SelectItem value="AVERAGE">Average</SelectItem>
              <SelectItem value="SUM">Sum</SelectItem>
              <SelectItem value="COUNT">Count</SelectItem>
              <SelectItem value="P95">p95</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {graph.source === "NETWORK_JSON" ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Response URL pattern" id="graph-url-pattern">
            <Input
              id="graph-url-pattern"
              onChange={(event) =>
                update({ responseUrlPattern: event.target.value })
              }
              placeholder="/api/metrics"
              value={graph.responseUrlPattern ?? ""}
            />
          </Field>
          <Field
            label="Numeric value path"
            id="graph-value-path"
            hint="Dot notation into the sanitized JSON response."
          >
            <Input
              id="graph-value-path"
              onChange={(event) => update({ valuePath: event.target.value })}
              placeholder="data.series.0.value"
              value={graph.valuePath ?? ""}
            />
          </Field>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Condition" id="graph-operator">
          <Select
            onValueChange={(operator) =>
              update({ operator: operator as typeof graph.operator })
            }
            value={graph.operator}
          >
            <SelectTrigger id="graph-operator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GREATER_THAN">Greater than</SelectItem>
              <SelectItem value="GREATER_OR_EQUAL">
                Greater than or equal
              </SelectItem>
              <SelectItem value="LESS_THAN">Less than</SelectItem>
              <SelectItem value="LESS_OR_EQUAL">Less than or equal</SelectItem>
              <SelectItem value="EQUAL">Equal to</SelectItem>
              <SelectItem value="NOT_EQUAL">Not equal to</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Threshold" id="graph-threshold">
          <Input
            id="graph-threshold"
            inputMode="decimal"
            onChange={(event) =>
              update({ threshold: Number(event.target.value) || 0 })
            }
            value={String(graph.threshold)}
          />
        </Field>
        <Field label="Gate impact" id="graph-gate">
          <Select
            onValueChange={(gateMode) =>
              update({ gateMode: gateMode as typeof graph.gateMode })
            }
            value={graph.gateMode}
          >
            <SelectTrigger id="graph-gate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BLOCKING">Blocking</SelectItem>
              <SelectItem value="ADVISORY">Advisory</SelectItem>
              <SelectItem value="EVIDENCE_ONLY">Evidence only</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </div>
  )
}

function ScreenshotEditor({
  step,
  onChange,
}: {
  step: BrowserStep
  onChange: (patch: Partial<BrowserStep>) => void
}) {
  const screenshot = step.screenshot ?? createScreenshot(step.id)
  function update(patch: Partial<typeof screenshot>) {
    onChange({ screenshot: { ...screenshot, ...patch } })
  }
  return (
    <div className="mt-6 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <Eye className="mt-0.5 size-5 text-primary" />
        <div>
          <p className="text-sm font-medium">Visual checkpoint</p>
          <p className="mt-0.5 text-xs/5 text-muted-foreground">
            The first successful screenshot becomes a proposed baseline. A
            person must approve it before differences can fail a run.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Difference tolerance" id="visual-tolerance">
          <div className="relative">
            <Input
              id="visual-tolerance"
              inputMode="decimal"
              onChange={(event) =>
                update({
                  diffThreshold: Math.max(
                    0,
                    Math.min(1, Number(event.target.value) / 100)
                  ),
                })
              }
              value={String(screenshot.diffThreshold * 100)}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          </div>
        </Field>
        <Field
          label="Mask selectors"
          id="visual-masks"
          hint="One CSS selector per line for dates, rotating IDs, or personal information."
        >
          <Textarea
            id="visual-masks"
            onChange={(event) =>
              update({
                maskSelectors: event.target.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
            placeholder={"[data-dynamic-date]\n.user-avatar"}
            value={(screenshot.maskSelectors ?? []).join("\n")}
          />
        </Field>
      </div>
    </div>
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

function ReadinessItem({ ready, text }: { ready: boolean; text: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        ready
          ? "bg-success-soft text-success-foreground"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {ready ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <Plus className="size-3.5" />
      )}
      {text}
    </span>
  )
}

function requiresLocator(type: BrowserStep["type"]) {
  return [
    "CLICK",
    "DOUBLE_CLICK",
    "FILL",
    "CLEAR",
    "SELECT",
    "CHECK",
    "UNCHECK",
    "HOVER",
    "FOCUS",
    "WAIT",
    "EXTRACT",
    "GRAPH_CHECK",
  ].includes(type)
}

export function createDefaultJourney(startUrl = ""): BrowserStep[] {
  return [
    {
      id: "step-open-start-page",
      name: "Open start page",
      type: "NAVIGATE",
      enabled: true,
      url: startUrl,
      waitUntil: "domcontentloaded",
      timeoutMs: 30000,
    },
    {
      id: "step-page-ready",
      name: "Page is ready",
      type: "ASSERT",
      enabled: true,
      timeoutMs: 10000,
      checks: [
        {
          id: "check-page-ready",
          name: "Page is ready",
          kind: "ELEMENT_VISIBLE",
          operator: "EQUAL",
          gateMode: "BLOCKING",
          locator: { strategy: "ROLE", value: "main" },
          enabled: true,
        },
      ],
    },
  ]
}

function createStep(type: BrowserStep["type"]): BrowserStep {
  const option = stepOptions.find((item) => item.type === type)
  const step: BrowserStep = {
    id: crypto.randomUUID(),
    name: option?.label ?? "Browser action",
    type,
    enabled: true,
    timeoutMs: type === "NAVIGATE" ? 30000 : 10000,
  }
  if (requiresLocator(type)) step.locator = defaultLocator()
  if (type === "ASSERT") step.checks = [createCheck()]
  if (type === "GRAPH_CHECK") {
    step.locator = defaultLocator()
    step.graph = createGraph()
  }
  if (type === "SCREENSHOT") step.screenshot = createScreenshot(step.id)
  return step
}

function defaultLocator(): BrowserLocator {
  return { strategy: "ROLE", value: "button", name: "" }
}

function createCheck(): NonNullable<BrowserStep["checks"]>[number] {
  return {
    id: crypto.randomUUID(),
    name: "Page is ready",
    kind: "ELEMENT_VISIBLE",
    operator: "EQUAL",
    gateMode: "BLOCKING",
    locator: { strategy: "ROLE", value: "main" },
    enabled: true,
  }
}

function createGraph(): NonNullable<BrowserStep["graph"]> {
  return {
    source: "DOM",
    aggregation: "LATEST",
    operator: "GREATER_OR_EQUAL",
    threshold: 0,
    consecutiveRuns: 2,
    gateMode: "ADVISORY",
  }
}

function createScreenshot(
  stepID: string
): NonNullable<BrowserStep["screenshot"]> {
  return {
    fullPage: true,
    checkpointId: `visual-${stepID}`,
    diffThreshold: 0.01,
    maskSelectors: [],
  }
}
