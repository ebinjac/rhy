import { useEffect, useRef, useState } from "react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ArrowLeft,
  Braces,
  Check,
  CircleAlert,
  FileJson,
  LoaderCircle,
  ShieldCheck,
  Upload,
} from "lucide-react"

import {
  MonitorImportError,
  parseCurlCommand,
  parsePostmanCollection,
} from "@/features/monitors/monitor-import"
import type { ImportedMonitorDraft } from "@/features/monitors/monitor-import"

type ImportKind = "postman" | "curl"

export function MonitorImportDialog({
  open,
  onOpenChange,
  onImport,
  actionLabel = "Use imported monitor",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (draft: ImportedMonitorDraft) => Promise<void> | void
  actionLabel?: string
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<ImportKind>("postman")
  const [source, setSource] = useState("")
  const [fileName, setFileName] = useState("")
  const [draft, setDraft] = useState<ImportedMonitorDraft | null>(null)
  const [error, setError] = useState("")
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) {
      setSource("")
      setFileName("")
      setDraft(null)
      setError("")
      setImporting(false)
    }
  }, [open])

  function changeKind(value: ImportKind) {
    setKind(value)
    setSource("")
    setFileName("")
    setDraft(null)
    setError("")
  }

  function review() {
    setError("")
    try {
      setDraft(
        kind === "postman"
          ? parsePostmanCollection(source)
          : parseCurlCommand(source)
      )
    } catch (reason) {
      setDraft(null)
      setError(
        reason instanceof MonitorImportError
          ? reason.message
          : "Rhythm could not read this import."
      )
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError("Postman collection files are limited to 2 MB.")
      return
    }
    setError("")
    setDraft(null)
    setFileName(file.name)
    setSource(await file.text())
  }

  async function finishImport() {
    if (!draft || importing) return
    setImporting(true)
    setError("")
    try {
      await onImport(draft)
      onOpenChange(false)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The imported monitor could not be created."
      )
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100dvh-2rem))] gap-4 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-5 pt-5 pr-14">
          <DialogTitle>Import an API workflow</DialogTitle>
          <DialogDescription>
            Bring a Postman Collection v2.0/v2.1 JSON file into one ordered
            monitor, or convert one cURL command into a request.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <ImportReview draft={draft} />
        ) : (
          <div className="min-h-0 px-5">
            <Tabs
              value={kind}
              onValueChange={(value) => changeKind(value as ImportKind)}
            >
              <TabsList
                aria-label="Import source"
                className="h-11 w-full sm:h-8 sm:w-fit"
              >
                <TabsTrigger className="min-h-10 px-4 sm:min-h-0" value="postman">
                  <FileJson /> Postman collection
                </TabsTrigger>
                <TabsTrigger className="min-h-10 px-4 sm:min-h-0" value="curl">
                  <Braces /> cURL
                </TabsTrigger>
              </TabsList>
              <TabsContent value="postman" className="mt-4 space-y-4">
                <button
                  type="button"
                  className="flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 py-5 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => fileInput.current?.click()}
                  onDrop={(event) => {
                    event.preventDefault()
                    void readFile(event.dataTransfer.files[0])
                  }}
                  onDragOver={(event) => event.preventDefault()}
                >
                  <Upload className="mb-3 size-6 text-primary" />
                  <span className="font-medium">
                    {fileName || "Choose or drop a Postman collection"}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    JSON only · Collection v2.0 or v2.1 · Maximum 2 MB
                  </span>
                </button>
                <input
                  ref={fileInput}
                  className="sr-only"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                  aria-label="Choose Postman collection JSON"
                />
                <div>
                  <label
                    className="text-xs font-medium"
                    htmlFor="postman-import-source"
                  >
                    Or paste collection JSON
                  </label>
                  <Textarea
                    id="postman-import-source"
                    className="mt-2 min-h-40 resize-y font-mono text-xs"
                    spellCheck={false}
                    placeholder={'{\n  "info": { "name": "Payments API" },\n  "item": []\n}'}
                    value={source}
                    onChange={(event) => {
                      setSource(event.target.value)
                      setFileName("")
                      setError("")
                    }}
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Postman v3 is a multi-file YAML format. Export or migrate it
                  to Collection v2.1 JSON before importing into Rhythm.
                </p>
              </TabsContent>
              <TabsContent value="curl" className="mt-4 space-y-3">
                <div>
                  <label
                    className="text-xs font-medium"
                    htmlFor="curl-import-source"
                  >
                    cURL command
                  </label>
                  <Textarea
                    id="curl-import-source"
                    className="mt-2 min-h-64 resize-y font-mono text-xs"
                    spellCheck={false}
                    placeholder={`curl --request POST \\\n  --url https://api.example.com/orders \\\n  --header 'Content-Type: application/json' \\\n  --data '{"amount":1250}'`}
                    value={source}
                    onChange={(event) => {
                      setSource(event.target.value)
                      setError("")
                    }}
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Rhythm parses the command locally—it never executes it.
                  Likely tokens, passwords, cookies, and JSON credentials are
                  replaced with secret placeholders.
                </p>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {error ? (
          <Alert
            className="mx-5 w-auto shrink-0 rounded-lg"
            variant="destructive"
            role="alert"
          >
            <CircleAlert />
            <AlertTitle>Import could not continue</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="shrink-0 border-t bg-muted/20 px-5 py-4">
          {draft ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(null)
                setError("")
              }}
              disabled={importing}
            >
              <ArrowLeft /> Back
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          )}
          {draft ? (
            <Button
              type="button"
              onClick={() => void finishImport()}
              disabled={importing}
            >
              {importing ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Check />
              )}
              {importing ? "Importing…" : actionLabel}
            </Button>
          ) : (
            <Button type="button" onClick={review} disabled={!source.trim()}>
              Review import
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportReview({ draft }: { draft: ImportedMonitorDraft }) {
  return (
    <ScrollArea className="min-h-0 flex-1 border-y">
      <div className="space-y-5 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            {draft.source === "postman" ? <FileJson /> : <Braces />}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{draft.name}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {draft.description}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryValue label="Requests" value={draft.summary.requests} />
          <SummaryValue label="Folders" value={draft.summary.folders} />
          <SummaryValue label="Scripts" value={draft.summary.scripts} />
          <SummaryValue label="Variables" value={draft.summary.variables} />
        </dl>

        <section aria-labelledby="import-requests-heading">
          <div className="flex items-center justify-between gap-3">
            <h3 id="import-requests-heading" className="text-sm font-semibold">
              Ordered requests
            </h3>
            <Badge variant="secondary">
              {draft.definition.steps.length} step
              {draft.definition.steps.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <ol className="mt-2 divide-y rounded-xl border">
            {draft.definition.steps.map((step, index) => (
              <li
                key={step.id}
                className="grid grid-cols-[28px_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2.5"
              >
                <span className="text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <Badge variant="outline">{step.request.method}</Badge>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {step.name}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {safeRequestURL(step.request.url)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {draft.warnings.length ? (
          <section aria-labelledby="import-warnings-heading">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-warning-foreground" />
              <h3 id="import-warnings-heading" className="text-sm font-semibold">
                Review after import
              </h3>
              <Badge variant="outline">{draft.warnings.length}</Badge>
            </div>
            <ul className="mt-2 space-y-2">
              {draft.warnings.map((warning, index) => (
                <li
                  key={`${warning.code}-${index}`}
                  className="rounded-lg border bg-warning/5 px-3 py-2"
                >
                  {warning.location ? (
                    <p className="text-xs font-medium">{warning.location}</p>
                  ) : null}
                  <p className="text-xs leading-5 text-muted-foreground">
                    {warning.message}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <Alert className="rounded-lg">
            <Check />
            <AlertTitle>Ready to import</AlertTitle>
            <AlertDescription>
              Rhythm did not find unsupported features or likely plain-text
              credentials in this import.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </ScrollArea>
  )
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function safeRequestURL(value: string) {
  return value
    .replace(/\/\/[^/@\s]+@/, "//••••@")
    .replace(/\{\{\s*secrets\.[^}]+\}\}/gi, "••••")
}
