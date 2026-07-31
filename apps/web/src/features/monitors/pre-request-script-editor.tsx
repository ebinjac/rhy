import { lazy, Suspense, useEffect, useRef, useState } from "react"
import type { OnMount } from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"
import { Badge } from "@workspace/ui/components/badge"
import { EditorLoading } from "@/components/editor-loading"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  AlignLeft,
  BookOpen,
  Braces,
  Check,
  CircleAlert,
  FileWarning,
  LoaderCircle,
  Map,
  Network,
  PackagePlus,
  Play,
  Plus,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Variable,
} from "lucide-react"

import type {
  ScriptProblemContract,
  ScriptResultContract,
} from "@/lib/api-client/contracts"
import {
  previewPreRequestScript,
  validatePreRequestScript,
} from "@/lib/api-client/monitors"
import { normalizeScriptDefinition } from "@/features/monitors/script-definition"
import type { ScriptDefinition } from "@/features/monitors/script-definition"
import type { VariableCatalogEntry } from "@/features/monitors/variable-catalog"
import { VariableCatalogSheet } from "@/features/monitors/variable-picker"

const MonacoEditor = lazy(async () => ({
  default: (await import("@monaco-editor/react")).default,
}))

type ScriptRequest = {
  method: string
  url: string
  headers: Array<{ key: string; value: string; sensitive?: boolean }>
  query: Array<{ key: string; value: string; sensitive?: boolean }>
  body: Record<string, unknown>
  auth: Record<string, unknown>
}

type Props = {
  value: ScriptDefinition
  onChange: (value: ScriptDefinition) => void
  monitorId?: string
  revisionId?: string
  stepId?: string
  request?: ScriptRequest
  phase?: "prerequest" | "test"
  variables?: VariableCatalogEntry[]
}

const preRequestStarter = `// Postman-compatible pre-request script (pm.*)
// Runs before the request is rendered and sent.
const traceId = crypto.randomUUID();
pm.variables.set("traceId", traceId);
pm.environment.set("preparedAt", String(Date.now()));

if (pm.request) {
  pm.request.headers.upsert({ key: "X-Trace-ID", value: traceId });
}

console.log("Prepared request", pm.variables.replaceIn("trace={{traceId}} / {{$guid}}"));
`

const testStarter = `// Postman-compatible response Tests script (pm.*)
// Runs after the response is received.
pm.test("request succeeded", () => {
  pm.response.to.have.status(200);
});

pm.test("response is JSON", () => {
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
  pm.expect(pm.response.json()).to.be.an("object");
});
`

const commonSnippets = [
  { label: "Insert snippet…", value: "" },
  { label: "Set variable", value: 'pm.variables.set("name", "value");' },
  { label: "Set environment", value: 'pm.environment.set("name", "value");' },
  {
    label: "Replace templates",
    value:
      'const url = pm.variables.replaceIn("https://api.example.com/{{id}}?nonce={{$guid}}");',
  },
  {
    label: "Read secret",
    value: 'const token = await pm.vault.get("api-token");',
  },
  {
    label: "Upsert header",
    value: 'pm.request.headers.upsert({ key: "X-Header", value: "value" });',
  },
  { label: "Remove header", value: 'pm.request.headers.remove("X-Header");' },
  {
    label: "Add query parameter",
    value: 'pm.request.query.upsert({ key: "key", value: "value" });',
  },
  { label: "Set cookie", value: 'pm.cookies.set("session", "value");' },
  { label: "Generate UUID", value: "const requestId = crypto.randomUUID();" },
  {
    label: "SHA-256 digest",
    value:
      'const bytes = new TextEncoder().encode("value");\nconst digest = await crypto.subtle.digest("SHA-256", bytes);',
  },
  {
    label: "HMAC SHA-256",
    value:
      'const encoder = new TextEncoder();\nconst key = await crypto.subtle.importKey(\n  "raw",\n  encoder.encode(await pm.vault.get("hmac-secret")),\n  { name: "HMAC", hash: "SHA-256" },\n  false,\n  ["sign"],\n);\nconst bytes = new Uint8Array(await crypto.subtle.sign(\n  { name: "HMAC", hash: "SHA-256" },\n  key,\n  encoder.encode(pm.request?.body?.content ?? ""),\n));\nconst signature = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");\npm.request?.headers.upsert({ key: "X-Signature", value: signature, sensitive: true });',
  },
  {
    label: "Send auxiliary request",
    value:
      'const response = await pm.sendRequest({\n  method: "GET",\n  url: "https://example.com/token",\n  headers: { Accept: "application/json" },\n});\nconst data = response.json();',
  },
  {
    label: "Assertion",
    value:
      'pm.test("value exists", () => {\n  pm.expect(pm.variables.get("value")).to.not.equal(undefined);\n});',
  },
  {
    label: "Import Lodash",
    value:
      'const _ = pm.require("npm:lodash@4.17.21");\nconst value = _.get(pm.response?.json(), "data.id");',
  },
  {
    label: "Import AJV",
    value:
      'const Ajv = pm.require("ajv");\nconst validate = new Ajv().compile({ type: "object", required: ["id"] });\npm.test("schema is valid", () => pm.expect(validate(pm.response.json())).to.equal(true));',
  },
  {
    label: "Import team package",
    value:
      "const helpers = pm.require('@team-domain/package-name');\nhelpers.functionName();",
  },
  {
    label: "Run-local state",
    value:
      'await pm.state.set("counter", 1);\nconst counter = await pm.state.increment("counter");',
  },
]
const testSnippets = [
  ...commonSnippets,
  {
    label: "Check status",
    value:
      'pm.test("status is 200", () => {\n  pm.response.to.have.status(200);\n});',
  },
  {
    label: "Check response header",
    value:
      'pm.test("content type is JSON", () => {\n  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");\n});',
  },
  {
    label: "Check JSON body",
    value:
      'const data = pm.response.json();\npm.test("response has an id", () => {\n  pm.expect(data).to.have.property("id");\n});',
  },
  {
    label: "Render visualizer",
    value:
      'pm.visualizer.set("<h1>{{title}}</h1>", { title: "Response summary" });',
  },
]

function variableTypoProblems(code: string): ScriptProblemContract[] {
  const problems: ScriptProblemContract[] = []
  for (const match of code.matchAll(/\bpm\.variable\s*\(/g)) {
    const before = code.slice(0, match.index)
    const lines = before.split("\n")
    problems.push({
      severity: "warning",
      message:
        "Use pm.variables instead of pm.variable. Replace this call with pm.variables.get(...) or pm.variables.set(...).",
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
      code: "PM_VARIABLE_TYPO",
    })
  }
  return problems
}

export function PreRequestScriptEditor({
  value,
  onChange,
  monitorId,
  revisionId,
  stepId,
  request,
  phase = "prerequest",
  variables = [],
}: Props) {
  const isTest = phase === "test"
  const starter = isTest ? testStarter : preRequestStarter
  const snippets = isTest ? testSnippets : commonSnippets
  const canPreview = Boolean(monitorId && revisionId)
  const [mounted, setMounted] = useState(false)
  const [desktop, setDesktop] = useState(true)
  const [dark, setDark] = useState(false)
  const [running, setRunning] = useState(false)
  const [minimap, setMinimap] = useState(false)
  const [result, setResult] = useState<ScriptResultContract | null>(null)
  const [problems, setProblems] = useState<ScriptProblemContract[]>([])
  const [message, setMessage] = useState("")
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const completionRef = useRef(variables)
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null)
  useEffect(() => {
    completionRef.current = variables
  }, [variables])
  useEffect(
    () => () => {
      completionDisposableRef.current?.dispose()
    },
    []
  )
  useEffect(() => {
    setMounted(true)
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setDesktop(media.matches)
    const updateTheme = () =>
      setDark(document.documentElement.classList.contains("dark"))
    const observer = new MutationObserver(updateTheme)
    update()
    updateTheme()
    media.addEventListener("change", update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => {
      media.removeEventListener("change", update)
      observer.disconnect()
    }
  }, [])
  function change(code: string) {
    onChange(normalizeScriptDefinition({ ...value, code }))
    setResult(null)
    setProblems([])
    setMessage("")
  }
  const mount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      pmTypes,
      "file:///rhythm-pm.d.ts"
    )
    completionDisposableRef.current?.dispose()
    completionDisposableRef.current =
      monaco.languages.registerCompletionItemProvider("javascript", {
        triggerCharacters: ['"', "'", "{"],
        provideCompletionItems(
          model: Monaco.editor.ITextModel,
          position: Monaco.Position
        ) {
          if (model !== editor.getModel()) return { suggestions: [] }
          const before = model
            .getLineContent(position.lineNumber)
            .slice(0, position.column - 1)
          const scoped = before.match(
            /pm\.(variables|environment|collectionVariables|globals)\.(?:get|has|set|unset)\(\s*["']([^"']*)$/
          )
          const vault = before.match(/pm\.vault\.get\(\s*["']([^"']*)$/)
          const template = before.match(/\{\{([^}]*)$/)
          if (!scoped && !vault && !template) return { suggestions: [] }
          const requestedScope =
            scoped?.[1] === "collectionVariables" ? "collection" : scoped?.[1]
          const typed = scoped?.[2] ?? vault?.[1] ?? template?.[1] ?? ""
          const startColumn = position.column - typed.length
          const suggestions = completionRef.current
            .filter((entry) => {
              if (entry.availability !== "now") return false
              if (vault) return entry.scope === "secret"
              if (scoped) return entry.scope === requestedScope
              return true
            })
            .map((entry) => ({
              label: entry.name,
              kind: monaco.languages.CompletionItemKind.Variable,
              detail: `${entry.scope} · ${entry.origin}${entry.sensitive ? " · MASKED" : ""}`,
              documentation: {
                value: [
                  `**${entry.name}**`,
                  "",
                  `Template: \`${entry.explicitTemplate}\``,
                  "",
                  `JavaScript: \`${entry.javascript}\``,
                  "",
                  entry.shadowed
                    ? "This name is shadowed. Use explicit scope when deterministic resolution matters."
                    : "Available at this workflow step.",
                ].join("\n"),
              },
              insertText: template
                ? entry.template.replace(/^\{\{|\}\}$/g, "")
                : entry.name,
              range: {
                startLineNumber: position.lineNumber,
                startColumn,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
              sortText: `${entry.shadowed ? "2" : "1"}-${entry.name}`,
            }))
          return { suggestions }
        },
      })
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => void preview()
    )
  }
  function applyMarkers(items: ScriptProblemContract[]) {
    const editor = editorRef.current,
      monaco = monacoRef.current
    if (!editor || !monaco) return
    const model = editor.getModel()
    if (!model) return
    monaco.editor.setModelMarkers(
      model,
      "rhythm-script",
      items.map((item) => ({
        severity:
          item.severity === "error"
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
        message: item.message,
        startLineNumber: item.line,
        startColumn: item.column,
        endLineNumber: item.line,
        endColumn: item.column + 1,
        code: item.code,
      }))
    )
  }
  async function validate() {
    setMessage("")
    try {
      const response = await validatePreRequestScript({
        data: { code: value.code },
      })
      const typoProblems = variableTypoProblems(value.code)
      const allProblems = [...response.problems, ...typoProblems]
      setProblems(allProblems)
      applyMarkers(allProblems)
      setMessage(
        response.valid && !typoProblems.length
          ? "Script is valid."
          : `${allProblems.length} problem${allProblems.length === 1 ? "" : "s"} found.`
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Validation failed.")
    }
  }
  async function preview() {
    if (!monitorId || !revisionId) {
      setMessage("Save the draft before running preview.")
      return
    }
    setRunning(true)
    setMessage("")
    try {
      const response = await previewPreRequestScript({
        data: {
          monitorId,
          revisionId,
          scope: isTest ? "test" : "request",
          stepId,
          code: value.code,
          packages: value.packages ?? [],
          variables: {},
          request: request ?? null,
          response: isTest
            ? {
                code: 200,
                status: "200 OK",
                headers: { "Content-Type": "application/json" },
                body: '{"preview":true,"id":"sample-id"}',
                responseTimeMs: 100,
                responseSize: 33,
                contentType: "application/json",
              }
            : null,
        },
      })
      setResult(response)
      setProblems(response.problems)
      applyMarkers(response.problems)
      setMessage(
        response.status === "SUCCESS"
          ? `Preview completed in ${response.durationMs} ms.`
          : (response.errorMessage ?? "Preview failed.")
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview failed.")
    } finally {
      setRunning(false)
    }
  }
  function insert(valueToInsert: string) {
    if (!valueToInsert) return
    if (editorRef.current) {
      const selection = editorRef.current.getSelection()
      if (selection)
        editorRef.current.executeEdits("snippet", [
          { range: selection, text: valueToInsert, forceMoveMarkers: true },
        ])
      editorRef.current.focus()
      const next = editorRef.current.getValue()
      change(next)
    } else change(`${value.code}${value.code ? "\n" : ""}${valueToInsert}`)
  }
  async function format() {
    await editorRef.current?.getAction("editor.action.formatDocument")?.run()
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div aria-live="polite" className="sr-only" role="status">
        {message}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/25 px-3 py-2">
        <div className="mr-auto">
          <p className="text-sm font-medium">
            {isTest ? "Tests script" : "Pre-request script"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isTest
              ? "Postman-compatible pm.* — runs after the response and can inspect pm.response."
              : "Postman-compatible pm.* — runs before the request when the script has content."}
          </p>
        </div>
        <Badge variant="outline">rhythm-js-2</Badge>
        <VariableCatalogSheet entries={variables} />
        {!value.code ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11 md:min-h-7"
            onClick={() => change(starter)}
          >
            <Braces data-icon="inline-start" /> Add starter
          </Button>
        ) : null}
        <NativeSelect
          className="min-h-11 w-44 md:min-h-9"
          aria-label="Insert script snippet"
          value=""
          onChange={(event) => insert(event.target.value)}
        >
          {snippets.map((item) => (
            <NativeSelectOption key={item.label} value={item.value}>
              {item.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {desktop ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11 md:min-h-7"
              onClick={() => void format()}
            >
              <AlignLeft data-icon="inline-start" /> Format
            </Button>
            <Button
              type="button"
              size="icon"
              className="min-h-11 min-w-11 md:min-h-8 md:min-w-8"
              variant={minimap ? "secondary" : "ghost"}
              onClick={() => setMinimap((current) => !current)}
              aria-label="Toggle code minimap"
              aria-pressed={minimap}
            >
              <Map />
            </Button>
          </>
        ) : null}
        <PackageLibrary
          packages={value.packages ?? []}
          onChange={(packages) =>
            onChange(normalizeScriptDefinition({ ...value, packages }))
          }
        />
        <ScriptDocs phase={phase} />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11 md:min-h-7"
          onClick={() => void validate()}
        >
          <FileWarning data-icon="inline-start" /> Validate
        </Button>
        <Button
          type="button"
          size="sm"
          className="min-h-11 md:min-h-7"
          onClick={() => void preview()}
          disabled={running || !value.code.trim() || !canPreview}
          aria-describedby={
            !canPreview ? "script-preview-requirement" : undefined
          }
        >
          {running ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Play data-icon="inline-start" />
          )}{" "}
          Run script preview
        </Button>
      </div>
      {!canPreview ? (
        <p
          id="script-preview-requirement"
          className="border-b bg-primary/5 px-3 py-2 text-xs leading-5 text-foreground"
        >
          Create the monitor to preview this script by itself.{" "}
          <strong>Run draft preview</strong> in the page header executes it now
          as part of the complete request workflow.
        </p>
      ) : null}
      <div className="relative min-h-[360px] bg-muted/25">
        {mounted && desktop ? (
          <Suspense fallback={<EditorLoading label="Loading editor…" />}>
            <MonacoEditor
              height="420px"
              language="javascript"
              theme={dark ? "vs-dark" : "light"}
              value={value.code}
              onChange={(code) => change(code ?? "")}
              onMount={mount}
              options={{
                fontSize: 13,
                lineHeight: 21,
                fontLigatures: true,
                minimap: { enabled: minimap },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                padding: { top: 14, bottom: 14 },
                tabSize: 2,
                formatOnPaste: true,
                quickSuggestions: true,
                accessibilitySupport: "auto",
              }}
            />
          </Suspense>
        ) : (
          <div className="p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Compact editor · use a desktop browser for autocomplete and
              advanced navigation.
            </p>
            <Textarea
              className="min-h-[330px] resize-y bg-background font-mono text-[13px] leading-5 text-foreground"
              spellCheck={false}
              value={value.code}
              onChange={(event) => change(event.target.value)}
              aria-label={`JavaScript ${isTest ? "Tests" : "pre-request"} code`}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span>{value.code.length.toLocaleString()} / 65,536 characters</span>
        <span>Ctrl/Cmd+Enter to preview</span>
        <span className="ml-auto flex items-center gap-1">
          <ShieldCheck className="size-3.5" /> Real secrets stay masked in
          preview
        </span>
      </div>
      <EvidencePanel result={result} problems={problems} message={message} />
    </div>
  )
}

function ScriptDocs({ phase }: { phase: "prerequest" | "test" }) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            type="button"
            size="icon"
            className="min-h-11 min-w-11 md:min-h-8 md:min-w-8"
            variant="ghost"
            aria-label="Open JavaScript runtime reference"
          />
        }
      >
        <BookOpen />
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Rhythm JavaScript runtime</SheetTitle>
          <SheetDescription>
            Postman-familiar APIs supported by the isolated rhythm-js-2 sandbox.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 overflow-y-auto px-6 pb-6 text-sm">
          <Doc
            title="Variables"
            code="pm.variables · pm.environment · pm.collectionVariables · pm.globals · pm.iterationData"
            text="Use has, get, set, unset, clear, replaceIn, and toObject. Mutations are isolated to this run."
          />
          <Doc
            title="Request, response, and cookies"
            code="pm.request · pm.response · pm.cookies · pm.cookies.jar()"
            text={
              phase === "test"
                ? "Inspect status, headers, JSON, text, size, and response time. Request and cookie context remains available."
                : "Mutate method, URL, headers, query, body, auth, and run-local cookies before rendering. pm.response becomes available in Tests."
            }
          />
          <Doc
            title="Secrets, state, and datasets"
            code={
              'await pm.vault.get("alias") · await pm.state.set("key", value) · pm.datasets("current-iteration")'
            }
            text="Vault values are read-only and masked. State and current-iteration dataset values are run-local; preview never mutates saved resources."
          />
          <Doc
            title="Checks and visualizers"
            code="pm.test · pm.expect · pm.visualizer.set"
            text="Tests support synchronous, Promise, and done-callback forms. Visualizers are captured in Tests and rendered as sanitized evidence."
          />
          <Doc
            title="Packages"
            code="pm.require · require"
            text="Built-ins include ajv, chai, cheerio, csv-parse, lodash, moment, postman-collection, uuid, xml2js, and safe Node-compatible modules. npm:/jsr: imports require exact versions and are cached; team packages are authored in the revision-scoped Package Library."
          />
          <Doc
            title="Auxiliary HTTP"
            code="await pm.sendRequest(config)"
            text="Promise and callback forms are supported, with five calls per script and the same target, timeout, cancellation, masking, proxy, and TLS policies."
          />
          <Doc
            title="Web APIs"
            code="crypto · URL · Blob · File · Streams · AbortController"
            text="Typed arrays, Web Crypto digest/HMAC, encoding, events, files, URL, timers, structured cloning, and deterministic stream primitives are available."
          />
          <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            Context-specific APIs stay discoverable: pm.message is only for gRPC
            On message scripts; pm.mock and persistent cross-run pm.state are
            for Postman code mocks; pm.execution.runRequest needs saved Postman
            collection requests. Rhythm returns SCRIPT_CONTEXT_UNAVAILABLE when
            an API has no HTTP-monitor equivalent. Use pm.sendRequest for
            governed auxiliary HTTP calls.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
function Doc({
  title,
  code,
  text,
}: {
  title: string
  code: string
  text: string
}) {
  return (
    <section>
      <h3 className="font-medium">{title}</h3>
      <code className="mt-1 block rounded bg-muted px-2 py-1.5 text-xs break-words">
        {code}
      </code>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{text}</p>
    </section>
  )
}

function PackageLibrary({
  packages,
  onChange,
}: {
  packages: Array<{ name: string; code: string }>
  onChange: (packages: Array<{ name: string; code: string }>) => void
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11 md:min-h-7"
          />
        }
      >
        <PackagePlus data-icon="inline-start" /> Packages
        {packages.length ? ` (${packages.length})` : ""}
      </SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Script Package Library</SheetTitle>
          <SheetDescription>
            Revision-scoped CommonJS packages for pm.require("@team/package").
            External npm:/jsr: imports must include an exact version.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 overflow-y-auto px-6 pb-6">
          {packages.map((item, index) => (
            <div
              className="rounded-xl border p-3"
              key={`${item.name}-${index}`}
            >
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`Package ${index + 1} name`}
                  placeholder="@team-domain/package-name"
                  value={item.name}
                  onChange={(event) =>
                    onChange(
                      packages.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, name: event.target.value }
                          : candidate
                      )
                    )
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  className="min-h-11 min-w-11"
                  variant="ghost"
                  aria-label={`Delete package ${item.name || index + 1}`}
                  onClick={() =>
                    onChange(
                      packages.filter(
                        (_, candidateIndex) => candidateIndex !== index
                      )
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <Textarea
                className="mt-3 min-h-40 font-mono text-xs"
                aria-label={`Package ${item.name || index + 1} CommonJS code`}
                placeholder={
                  'module.exports = {\n  functionName() {\n    return "value";\n  },\n};'
                }
                value={item.code}
                onChange={(event) =>
                  onChange(
                    packages.map((candidate, candidateIndex) =>
                      candidateIndex === index
                        ? { ...candidate, code: event.target.value }
                        : candidate
                    )
                  )
                }
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {item.code.length.toLocaleString()} / 65,536 characters ·
                package source is versioned with this monitor revision.
              </p>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => onChange([...packages, { name: "", code: "" }])}
          >
            <Plus data-icon="inline-start" /> Add team package
          </Button>
          <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            Package code runs inside the same isolated VM and limits as the
            script. Filesystem, process, environment variables, fetch, and
            XMLHttpRequest are unavailable.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function EvidencePanel({
  result,
  problems,
  message,
}: {
  result: ScriptResultContract | null
  problems: ScriptProblemContract[]
  message: string
}) {
  const aux = result?.auxiliaryRequests ?? [],
    packages = result?.packageImports ?? []
  return (
    <div className="min-h-40 resize-y overflow-auto border-t">
      <Tabs defaultValue="console" className="gap-0">
        <div className="overflow-x-auto border-b px-3">
          <TabsList variant="line" className="min-w-max">
            <TabsTrigger value="console">
              <ScrollText /> Console{" "}
              {result?.logs.length ? `(${result.logs.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="requests">
              <Network /> pm.sendRequest {aux.length ? `(${aux.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="packages">
              <Braces /> Packages{" "}
              {packages.length ? `(${packages.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="variables">
              <Variable /> Variables
            </TabsTrigger>
            <TabsTrigger value="changes">
              <Sparkles /> Request changes
            </TabsTrigger>
            <TabsTrigger value="tests">
              <Check /> Tests
            </TabsTrigger>
            <TabsTrigger value="problems">
              <CircleAlert /> Problems{" "}
              {problems.length ? `(${problems.length})` : ""}
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="max-h-64 overflow-auto p-3 font-mono text-xs">
          <TabsContent value="console">
            {message ? (
              <p
                className="mb-2 font-sans text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {message}
              </p>
            ) : null}
            {result?.logs.length ? (
              result.logs.map((log, index) => (
                <div
                  className="grid grid-cols-[56px_1fr] gap-2 border-b py-1.5 last:border-0"
                  key={`${log.timestamp}-${index}`}
                >
                  <span
                    className={
                      log.level === "error"
                        ? "text-destructive"
                        : log.level === "warn"
                          ? "text-warning-foreground"
                          : "text-muted-foreground"
                    }
                  >
                    {log.level}
                  </span>
                  <span className="break-words">{log.message}</span>
                </div>
              ))
            ) : (
              <Empty text="Console output appears here after preview." />
            )}
          </TabsContent>
          <TabsContent value="requests">
            {aux.length ? (
              aux.map((request, index) => {
                const ok = request.success !== false && !request.error
                return (
                  <div
                    className="space-y-1 border-b py-2 last:border-0"
                    key={`${request.method}-${request.url}-${index}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 font-sans text-xs">
                      <Badge variant="outline">Pre-request</Badge>
                      <span
                        className={
                          ok ? "text-success-foreground" : "text-destructive"
                        }
                      >
                        {ok ? "✓" : "×"}
                      </span>
                      <span className="font-mono font-medium">
                        {request.method || "GET"}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-muted-foreground"
                        title={request.url}
                      >
                        {request.url || "—"}
                      </span>
                      <span className="font-mono">
                        {request.status
                          ? `HTTP ${request.status}`
                          : request.error
                            ? "No response"
                            : "—"}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {request.durationMs ?? 0} ms
                      </span>
                    </div>
                    {request.error ? (
                      <p className="font-sans text-xs text-destructive">
                        {request.error}
                      </p>
                    ) : null}
                    <p className="font-sans text-[11px] text-muted-foreground">
                      pm.sendRequest #{index + 1}
                    </p>
                  </div>
                )
              })
            ) : (
              <Empty text="Outbound pm.sendRequest calls appear here after preview." />
            )}
          </TabsContent>
          <TabsContent value="packages">
            {packages.length ? (
              packages.map((item, index) => (
                <div
                  className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0"
                  key={`${item.specifier}-${index}`}
                >
                  <Badge variant="outline">{item.registry.toUpperCase()}</Badge>
                  <span className="min-w-0 flex-1 truncate">
                    {item.specifier}
                  </span>
                  <span className="text-muted-foreground">
                    {item.cached ? "cache" : "registry"} · {item.durationMs} ms
                  </span>
                </div>
              ))
            ) : (
              <Empty text="External npm:/jsr: package imports appear here. Built-in modules load locally." />
            )}
          </TabsContent>
          <TabsContent value="variables">
            <Changes
              items={result?.variableChanges ?? []}
              empty="No variable changes recorded."
            />
          </TabsContent>
          <TabsContent value="changes">
            <Changes
              items={result?.requestChanges ?? []}
              empty="No request changes recorded."
            />
          </TabsContent>
          <TabsContent value="tests">
            {result?.tests.length ? (
              result.tests.map((test, index) => (
                <div
                  className="flex gap-2 border-b py-2 last:border-0"
                  key={`${test.name}-${index}`}
                >
                  {test.skipped ? (
                    <span>○</span>
                  ) : test.passed ? (
                    <span className="text-success-foreground">✓</span>
                  ) : (
                    <span className="text-destructive">×</span>
                  )}
                  <div>
                    <p>{test.name}</p>
                    {test.error ? (
                      <p className="mt-0.5 text-destructive">{test.error}</p>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <Empty text="No script tests recorded." />
            )}
          </TabsContent>
          <TabsContent value="problems">
            {problems.length ? (
              problems.map((problem, index) => (
                <div
                  className="grid grid-cols-[70px_1fr] gap-2 border-b py-2 last:border-0"
                  key={`${problem.code}-${index}`}
                >
                  <span className="text-destructive">
                    Ln {problem.line}:{problem.column}
                  </span>
                  <div>
                    <p>{problem.message}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {problem.code}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <Empty text="No syntax or runtime problems." />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
function Changes({
  items,
  empty,
}: {
  items: ScriptResultContract["variableChanges"]
  empty: string
}) {
  return items.length ? (
    items.map((item, index) => (
      <div
        className="grid gap-1 border-b py-2 last:border-0 sm:grid-cols-[90px_150px_1fr]"
        key={`${item.scope}-${item.key}-${index}`}
      >
        <Badge variant="outline" className="w-fit">
          {item.operation}
        </Badge>
        <span>
          {item.scope}.{item.key}
        </span>
        <span className="break-words text-muted-foreground">
          {item.state === "MASKED"
            ? "MASKED"
            : `${String(item.before ?? "∅")} → ${String(item.after ?? "∅")}`}
        </span>
      </div>
    ))
  ) : (
    <Empty text={empty} />
  )
}
function Empty({ text }: { text: string }) {
  return (
    <p className="py-5 text-center font-sans text-xs text-muted-foreground">
      {text}
    </p>
  )
}
const pmTypes = `declare const pm: {
  variables: VariableScope; environment: VariableScope; collectionVariables: VariableScope; globals: VariableScope;
  iterationData: ReadonlyVariableScope;
  cookies: { has(name:string):boolean; get(name:string):string|undefined; set(name:string,value:unknown):void; unset(name:string):void; clear():void; toObject():Record<string,string>; jar():CookieJar };
  vault: { get(alias:string):Promise<string>; set():Promise<never>; unset():Promise<never> };
  request: { method:string; url:ScriptRequestUrl; headers:PropertyList; query:PropertyList; body:{type:string;content:string;raw:string;update(value:unknown):unknown}; auth:Record<string,unknown> } | null;
  response: ScriptResponse | undefined;
  info: { eventName:"prerequest"|"test"; monitorId:string; runId:string; revisionId:string; stepId:string; requestName:string; iteration:number; iterationCount:number; runtimeVersion:"rhythm-js-2" };
  test(name:string,callback:(done?:(error?:Error)=>void)=>void|Promise<void>):typeof pm; expect(value:unknown):any;
  sendRequest(config:string|Record<string,unknown>, callback?:(error:Error|null,response:ScriptResponse)=>void):Promise<ScriptResponse>|void;
  visualizer: { set(template:string,data?:Record<string,unknown>,options?:Record<string,unknown>):void };
  getData(callback?:(error:Error|null,data:Record<string,unknown>)=>void):Promise<Record<string,unknown>>|void;
  require(name:string):any;
  execution: { runRequest(requestId:string,options?:{variables?:Record<string,unknown>}):Promise<never>; skipRequest():void; setNextRequest(request:string|{id?:string;name?:string}|null):void; readonly location:ReadonlyArray<string>&{readonly current:string} };
  datasets: DatasetFactory;
  state: { get(key:string):Promise<unknown>; set(key:string,value:unknown):Promise<void>; delete(key:string):Promise<boolean>; unset(key:string):Promise<boolean>; keys():Promise<string[]>; size():Promise<number>; has(key:string):Promise<boolean>; clear():Promise<void>; toObject():Promise<Record<string,unknown>>; replace(value:Record<string,unknown>):Promise<void>; increment(key:string,amount?:number):Promise<number>; push(key:string,...items:unknown[]):Promise<number>; addToSet(key:string,item:unknown):Promise<boolean> };
  readonly message: never; readonly mock: never;
};
declare function require(name:"buffer"):RhythmBufferModule;
declare function require(name:string):any;
interface VariableScope { has(key:string):boolean; get(key:string):string|undefined; set(key:string,value:unknown):void; unset(key:string):void; clear():void; replaceIn(value:string):string; toObject():Record<string,string> }
interface ReadonlyVariableScope { has(key:string):boolean; get(key:string):string|undefined; replaceIn(value:string):string; toObject():Record<string,string> }
interface ScriptRequestUrl { toString():string; toJSON():string; getQueryString():string; addQueryParams(items:string|{key:string;value:string}|Array<{key:string;value:string}>):ScriptRequestUrl; removeQueryParams(names:string|string[]):ScriptRequestUrl }
interface PropertyList { add(item:{key:string;value:string;sensitive?:boolean}):PropertyList; append(item:{key:string;value:string;sensitive?:boolean}):PropertyList; upsert(item:{key:string;value:string;sensitive?:boolean}):PropertyList; remove(key:string):PropertyList; get(key:string):string|undefined; has(key:string):boolean; all():Array<{key:string;value:string}>; each(callback:(item:{key:string;value:string},index:number)=>void):PropertyList; count():number; clear():PropertyList; toObject():Record<string,string> }
interface CookieJar { get(url:string,name:string,callback?:(error:Error|null,value?:string)=>void):Promise<string|undefined>|void; getAll(url:string,callback?:(error:Error|null,value?:Array<{name:string;value:string}>)=>void):Promise<Array<{name:string;value:string}>>|void; set(url:string,cookie:{name:string;value:string},callback?:(error:Error|null)=>void):Promise<unknown>|void; unset(url:string,name:string,callback?:(error:Error|null)=>void):Promise<void>|void; clear(url:string,callback?:(error:Error|null)=>void):Promise<void>|void }
interface ScriptResponse { code:number; status:string; headers:PropertyList; responseTime:number; responseSize:number; stream:Uint8Array; text():string; json():unknown; toJSON():Record<string,unknown>; to:{have:{status(code:number):void;header(name:string,value?:string):void;jsonBody(path?:string,value?:unknown):void;body(value:string):void};be:{readonly success:void;readonly error:void;readonly clientError:void;readonly serverError:void}} }
interface DatasetResult { columns:string[]; rows:Array<Record<string,unknown>> }
interface DatasetHandle { executeView(viewId:string,params?:string[]):Promise<DatasetResult>; executeQuery(sql:string,params?:string[]):Promise<DatasetResult> }
interface DatasetFactory { (datasetId:string):DatasetHandle; getAll():Promise<unknown[]>; getOne(id:string):Promise<unknown>; getData(id:string):Promise<Array<Record<string,unknown>>>; getDataByRowIdentifier(id:string,row:number|string):Promise<Record<string,unknown>|undefined>; getDataByColumnIdentifier(id:string,column:string):Promise<unknown[]> }
interface RhythmBuffer extends Uint8Array { toString(encoding?:"utf8"|"base64"|"hex"|"ascii"|"latin1"|"utf16le"):string }
interface RhythmBufferConstructor { from(value:string|ArrayBuffer|ArrayLike<number>,encoding?:"utf8"|"base64"|"hex"):RhythmBuffer; alloc(size:number,fill?:number):RhythmBuffer; isBuffer(value:unknown):boolean; copyBytesFrom(view:ArrayBufferView,offset?:number,length?:number):RhythmBuffer; isAscii(value:ArrayBuffer|ArrayBufferView):boolean; isUtf8(value:ArrayBuffer|ArrayBufferView):boolean }
interface RhythmBufferModule { Buffer:RhythmBufferConstructor; isAscii(value:ArrayBuffer|ArrayBufferView):boolean; isUtf8(value:ArrayBuffer|ArrayBufferView):boolean; transcode(source:ArrayBuffer|ArrayBufferView,fromEncoding:string,toEncoding:string):RhythmBuffer; resolveObjectURL(id:string):Blob|undefined }
`
