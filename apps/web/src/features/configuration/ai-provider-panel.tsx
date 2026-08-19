import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/sonner"
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
} from "lucide-react"

import {
  getAISettings,
  saveAISettings,
  testAISettings,
} from "@/lib/api-client/ai"
import type { AISettings } from "@/lib/api-client/ai"

const compassFallback: AISettings = {
  name: "Compass360",
  providerType: "COMPASS360",
  environment: "development",
  baseUrl: "https://compass360-dev.aexp.com",
  completionPath: "/v1/completions",
  defaultModel: "",
  approvedModels: [],
  requiredCapabilities: { streaming: false, toolCalling: true },
  timeoutSeconds: 120,
  maxConcurrency: 4,
  maxToolRounds: 8,
  maxInputTokens: 16000,
  maxOutputTokens: 4096,
  dailyRequestLimit: 1000,
  active: true,
  hasCredential: false,
  lastTestStatus: "NOT_TESTED",
}

const openRouterModel = "dots-studio/dots-3-note-preview:free"

function isOpenRouter(
  providerType: AISettings["providerType"] | string
): boolean {
  return providerType === "OPENROUTER" || providerType === "OPENROUTER_DEMO"
}

function applyProviderDefaults(
  current: AISettings,
  providerType: AISettings["providerType"]
): AISettings {
  if (isOpenRouter(providerType)) {
    const keepCustom =
      current.baseUrl.includes("openrouter.ai") &&
      current.completionPath.includes("chat/completions")
    return {
      ...current,
      providerType: "OPENROUTER_DEMO",
      name:
        current.name === "Compass360" || current.name === ""
          ? "OpenRouter"
          : current.name,
      baseUrl: keepCustom ? current.baseUrl : "https://openrouter.ai/api/v1",
      completionPath: keepCustom ? current.completionPath : "/chat/completions",
      defaultModel: current.defaultModel || openRouterModel,
    }
  }
  return {
    ...current,
    providerType: "COMPASS360",
    name:
      current.name === "OpenRouter" || current.name === ""
        ? "Compass360"
        : current.name,
    baseUrl: current.baseUrl.includes("openrouter.ai")
      ? compassFallback.baseUrl
      : current.baseUrl,
    completionPath: current.completionPath.includes("chat/completions")
      ? compassFallback.completionPath
      : current.completionPath,
  }
}

export function AIProviderPanel() {
  const [settings, setSettings] = useState<AISettings>(compassFallback)
  const [apiKey, setAPIKey] = useState("")
  const [approvedModels, setApprovedModels] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void getAISettings()
      .then((loaded) => {
        if (!active) return
        setSettings(loaded)
        setApprovedModels(loaded.approvedModels.join(", "))
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "AI settings could not load."
          )
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  function update<TKey extends keyof AISettings>(
    key: TKey,
    value: AISettings[TKey]
  ) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function selectProvider(providerType: AISettings["providerType"]) {
    setSettings((current) => applyProviderDefaults(current, providerType))
    if (isOpenRouter(providerType) && !approvedModels.trim()) {
      setApprovedModels(openRouterModel)
    }
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      const saved = await saveAISettings({
        ...settings,
        apiKey,
        approvedModels: approvedModels
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      })
      setSettings(saved)
      setAPIKey("")
      setApprovedModels(saved.approvedModels.join(", "))
      toast.success("AI provider settings saved.")
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "AI settings could not be saved."
      )
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setError("")
    try {
      const result = await testAISettings()
      const refreshed = await getAISettings()
      setSettings(refreshed)
      if (result.status === "PASSED")
        toast.success("AI provider connection verified.")
      else setError(result.message)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "AI provider test failed."
      )
      const refreshed = await getAISettings().catch(() => null)
      if (refreshed) setSettings(refreshed)
    } finally {
      setTesting(false)
    }
  }

  if (loading)
    return (
      <div
        className="mt-6 h-64 animate-pulse rounded-xl bg-muted"
        aria-label="Loading AI provider settings"
      />
    )

  const openRouter = isOpenRouter(settings.providerType)
  const passed = settings.lastTestStatus === "PASSED"
  return (
    <div className="mt-6 space-y-6">
      <section className="grid gap-5 border-b pb-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="size-5 text-primary" aria-hidden="true" />
            <h2 className="font-heading text-xl font-semibold">
              {openRouter ? "OpenRouter provider" : "Compass360 provider"}
            </h2>
            <Badge variant={passed ? "secondary" : "outline"}>
              {passed
                ? "Verified"
                : settings.lastTestStatus.replaceAll("_", " ").toLowerCase()}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Ask Rhythm sends only masked, governed evidence through a
            provider-neutral API. The bearer credential is encrypted in
            PostgreSQL and is never returned after saving.
          </p>
        </div>
        <div className="rounded-xl border bg-muted/25 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4 text-primary" /> Production boundary
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Compass360 is the production provider. OpenRouter is the
            OpenAI-compatible option for local model routing.
          </p>
        </div>
      </section>

      {error ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
          role="alert"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      ) : null}

      <section aria-labelledby="ai-connection-heading">
        <h3 id="ai-connection-heading" className="font-medium">
          Connection
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {openRouter
            ? "OpenRouter is OpenAI-compatible at https://openrouter.ai/api/v1. Rhythm calls /chat/completions with the stored bearer token."
            : "Use the exact internal completion endpoint and an approved model exposed by Compass360."}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Profile name">
            <Input
              value={settings.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <Field label="Provider type">
            <select
              className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
              value={
                openRouter ? "OPENROUTER_DEMO" : settings.providerType
              }
              onChange={(event) =>
                selectProvider(event.target.value as AISettings["providerType"])
              }
            >
              <option value="COMPASS360">Compass360</option>
              <option value="OPENROUTER_DEMO">OpenRouter</option>
            </select>
          </Field>
          <Field label="Base URL">
            <Input
              spellCheck={false}
              value={settings.baseUrl}
              onChange={(event) => update("baseUrl", event.target.value)}
            />
          </Field>
          <Field label="Completion path">
            <Input
              spellCheck={false}
              value={settings.completionPath}
              onChange={(event) => update("completionPath", event.target.value)}
            />
          </Field>
          <Field label="Environment">
            <Input
              value={settings.environment}
              onChange={(event) => update("environment", event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section
        className="border-t pt-6"
        aria-labelledby="ai-models-heading"
      >
        <h3 id="ai-models-heading" className="font-medium">
          Models settings
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {openRouter
            ? "Store the OpenRouter bearer token here. The model router is the ordered fallback list sent as OpenRouter's models array."
            : "Name the default model and any approved fallbacks before saving the bearer credential."}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Default model">
            <Input
              placeholder={
                openRouter
                  ? openRouterModel
                  : "Approved Compass360 model identifier"
              }
              value={settings.defaultModel}
              onChange={(event) => update("defaultModel", event.target.value)}
            />
          </Field>
          <Field label="Model router">
            <Input
              placeholder={
                openRouter
                  ? `${openRouterModel}, openrouter/auto`
                  : "model-a, model-b"
              }
              value={approvedModels}
              onChange={(event) => setApprovedModels(event.target.value)}
            />
          </Field>
          <Field label="Bearer token">
            <Input
              autoComplete="new-password"
              placeholder={
                settings.hasCredential
                  ? "Stored — enter only to rotate"
                  : openRouter
                    ? "OpenRouter sk-or-v1-… token"
                    : "Enter once to encrypt and store"
              }
              type="password"
              value={apiKey}
              onChange={(event) => setAPIKey(event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section
        className="border-t pt-6"
        aria-labelledby="ai-guardrails-heading"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 id="ai-guardrails-heading" className="font-medium">
              Guardrails and capacity
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Bound every turn before it reaches the provider.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="ai-provider-active">Provider active</Label>
            <Switch
              id="ai-provider-active"
              checked={settings.active}
              onCheckedChange={(checked) => update("active", checked)}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label="Concurrent turns"
            value={settings.maxConcurrency}
            min={1}
            max={32}
            onChange={(value) => update("maxConcurrency", value)}
          />
          <NumberField
            label="Tool rounds"
            value={settings.maxToolRounds}
            min={1}
            max={8}
            onChange={(value) => update("maxToolRounds", value)}
          />
          <NumberField
            label="Output tokens"
            value={settings.maxOutputTokens}
            min={128}
            max={32768}
            onChange={(value) => update("maxOutputTokens", value)}
          />
          <NumberField
            label="Daily requests"
            value={settings.dailyRequestLimit}
            min={1}
            max={1000000}
            onChange={(value) => update("dailyRequestLimit", value)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {passed ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <PlugZap className="size-4 text-muted-foreground" />
            )}
            {passed ? "Connection verified" : "Connection not verified"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {settings.lastTestMessage ||
              "Save a credential and model, then run the compatibility test."}
            {settings.lastTestLatencyMs
              ? ` · ${settings.lastTestLatencyMs} ms`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={testing || !settings.hasCredential}
            onClick={test}
          >
            {testing ? <LoaderCircle className="animate-spin" /> : <PlugZap />}
            Test connection
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? <LoaderCircle className="animate-spin" /> : null}Save
            provider
          </Button>
        </div>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  )
}
