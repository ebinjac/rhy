import {
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import type { OnMount } from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"
import { EditorLoading } from "@/components/editor-loading"
import { findTemplatedJsonError } from "@/lib/templated-json"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

const MonacoEditor = lazy(async () => ({
  default: (await import("@monaco-editor/react")).default,
}))

export const PRODUCT_MONO_FONT =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

export type CodeEditorHandle = {
  insertText: (text: string) => void
  format: () => Promise<void>
  focus: () => void
  getValue: () => string
  getEditor: () => Monaco.editor.IStandaloneCodeEditor | null
  getMonaco: () => typeof Monaco | null
}

type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  language: string
  height?: number | string
  ariaLabel: string
  className?: string
  placeholder?: string
  allowTemplates?: boolean
  fallbackHint?: string
  options?: Monaco.editor.IStandaloneEditorConstructionOptions
  onMount?: OnMount
  onTemplateTrigger?: () => void
}

const DEFAULT_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: PRODUCT_MONO_FONT,
  fontSize: 13,
  lineHeight: 21,
  fontLigatures: true,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  wordWrap: "on",
  padding: { top: 12, bottom: 12 },
  tabSize: 2,
  formatOnPaste: true,
  accessibilitySupport: "auto",
  fixedOverflowWidgets: true,
  renderLineHighlight: "line",
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
}

let templateJsonUsers = 0

function acquireTemplateJson(monaco: typeof Monaco) {
  templateJsonUsers += 1
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: false,
    allowComments: false,
    schemas: [],
    enableSchemaRequest: false,
  })
}

function releaseTemplateJson(monaco: typeof Monaco) {
  templateJsonUsers = Math.max(0, templateJsonUsers - 1)
  if (templateJsonUsers === 0) {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemas: [],
      enableSchemaRequest: false,
    })
  }
}

function applyTemplateMarkers(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  source: string
) {
  const model = editor.getModel()
  if (!model) return
  const error = findTemplatedJsonError(source)
  monaco.editor.setModelMarkers(
    model,
    "rhythm-json",
    error
      ? [
          {
            severity: monaco.MarkerSeverity.Error,
            message: error.message,
            startLineNumber: error.line,
            startColumn: error.column,
            endLineNumber: error.line,
            endColumn: error.column + 1,
          },
        ]
      : []
  )
}

function languageExtension(language: string) {
  if (language === "javascript") return "js"
  if (language === "graphql") return "graphql"
  if (language === "xml") return "xml"
  if (language === "json") return "json"
  return "txt"
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    {
      value,
      onChange,
      language,
      height = 360,
      ariaLabel,
      className,
      placeholder,
      allowTemplates = false,
      fallbackHint,
      options,
      onMount,
      onTemplateTrigger,
    },
    ref
  ) {
    const reactId = useId().replace(/:/g, "")
    const [ready, setReady] = useState(false)
    const [desktop, setDesktop] = useState(false)
    const [dark, setDark] = useState(false)
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
    const monacoRef = useRef<typeof Monaco | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const valueRef = useRef(value)
    const onChangeRef = useRef(onChange)
    const onTemplateTriggerRef = useRef(onTemplateTrigger)
    const templateOwned = useRef(false)
    valueRef.current = value
    onChangeRef.current = onChange
    onTemplateTriggerRef.current = onTemplateTrigger

    useEffect(() => {
      const media = window.matchMedia("(min-width: 768px)")
      const syncViewport = () => setDesktop(media.matches)
      const syncTheme = () =>
        setDark(document.documentElement.classList.contains("dark"))
      syncViewport()
      syncTheme()
      setReady(true)
      const observer = new MutationObserver(syncTheme)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      })
      media.addEventListener("change", syncViewport)
      return () => {
        media.removeEventListener("change", syncViewport)
        observer.disconnect()
      }
    }, [])

    useEffect(() => {
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (!editor || !monaco || !allowTemplates || language !== "json") return
      applyTemplateMarkers(editor, monaco, value)
    }, [allowTemplates, language, value])

    useImperativeHandle(ref, () => ({
      insertText(text) {
        const editor = editorRef.current
        if (editor) {
          const selection = editor.getSelection()
          const model = editor.getModel()
          if (selection && model) {
            const start = selection.getStartPosition()
            const prefix = model.getValueInRange({
              startLineNumber: start.lineNumber,
              startColumn: Math.max(1, start.column - 2),
              endLineNumber: start.lineNumber,
              endColumn: start.column,
            })
            const range =
              prefix === "{{"
                ? {
                    startLineNumber: start.lineNumber,
                    startColumn: Math.max(1, start.column - 2),
                    endLineNumber: selection.endLineNumber,
                    endColumn: selection.endColumn,
                  }
                : selection
            editor.executeEdits("rhythm-insert", [
              { range, text, forceMoveMarkers: true },
            ])
          }
          editor.focus()
          onChangeRef.current(editor.getValue())
          return
        }
        const field = textareaRef.current
        if (field) {
          const start = field.selectionStart ?? valueRef.current.length
          const end = field.selectionEnd ?? valueRef.current.length
          const from = valueRef.current.slice(Math.max(0, start - 2), start) === "{{"
            ? start - 2
            : start
          const next = `${valueRef.current.slice(0, from)}${text}${valueRef.current.slice(end)}`
          onChangeRef.current(next)
          requestAnimationFrame(() => {
            field.focus()
            const caret = from + text.length
            field.setSelectionRange(caret, caret)
          })
          return
        }
        onChangeRef.current(`${valueRef.current}${text}`)
      },
      async format() {
        await editorRef.current?.getAction("editor.action.formatDocument")?.run()
      },
      focus() {
        editorRef.current?.focus()
        textareaRef.current?.focus()
      },
      getValue() {
        return editorRef.current?.getValue() ?? valueRef.current
      },
      getEditor() {
        return editorRef.current
      },
      getMonaco() {
        return monacoRef.current
      },
    }))

    const cssHeight = typeof height === "number" ? `${height}px` : height

    const mount: OnMount = (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco
      requestAnimationFrame(() => editor.layout())
      if (allowTemplates && language === "json" && !templateOwned.current) {
        acquireTemplateJson(monaco)
        templateOwned.current = true
        applyTemplateMarkers(editor, monaco, editor.getValue())
      }
      editor.onDidChangeModelContent(() => {
        const position = editor.getPosition()
        const model = editor.getModel()
        if (!position || !model) return
        const typed = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: Math.max(1, position.column - 2),
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })
        if (typed === "{{") onTemplateTriggerRef.current?.()
      })
      editor.onDidDispose(() => {
        if (templateOwned.current && monacoRef.current) {
          releaseTemplateJson(monacoRef.current)
          templateOwned.current = false
        }
        editorRef.current = null
      })
      onMount?.(editor, monaco)
    }

    return (
      <div
        className={cn("min-h-0 min-w-0 overflow-hidden bg-background", className)}
        style={{ height: cssHeight }}
      >
        {!ready ? (
          <EditorLoading className="h-full min-h-0 rounded-none border-0" />
        ) : desktop ? (
          <Suspense
            fallback={
              <EditorLoading className="h-full min-h-0 rounded-none border-0" />
            }
          >
            <MonacoEditor
              height="100%"
              width="100%"
              language={language}
              path={`file:///rhythm/${reactId}.${languageExtension(language)}`}
              theme={dark ? "vs-dark" : "light"}
              value={value}
              onChange={(next) => onChange(next ?? "")}
              onMount={mount}
              loading={
                <EditorLoading className="h-full min-h-0 rounded-none border-0" />
              }
              options={{
                ...DEFAULT_OPTIONS,
                ...options,
                ariaLabel,
                fontFamily: PRODUCT_MONO_FONT,
                automaticLayout: true,
              }}
            />
          </Suspense>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {fallbackHint ? (
              <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                {fallbackHint}
              </p>
            ) : null}
            <Textarea
              ref={textareaRef}
              aria-label={ariaLabel}
              className="h-full min-h-0 flex-1 resize-none overflow-auto rounded-none border-0 font-mono text-[13px] leading-5 field-sizing-fixed"
              placeholder={placeholder}
              spellCheck={false}
              value={value}
              onChange={(event) => {
                onChange(event.target.value)
                const caret = event.target.selectionStart ?? 0
                if (event.target.value.slice(Math.max(0, caret - 2), caret) === "{{") {
                  onTemplateTriggerRef.current?.()
                }
              }}
            />
          </div>
        )}
      </div>
    )
  }
)
CodeEditor.displayName = "CodeEditor"

export function useDesktopEditor() {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const sync = () => setDesktop(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])
  return desktop
}
