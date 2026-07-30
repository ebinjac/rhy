import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { CopyButton } from "@workspace/ui/components/copy-button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  TriangleAlert,
  Webhook,
} from "lucide-react"

import { FormField } from "@/features/applications/form-field"
import { ReceiverAlertTriage } from "@/features/applications/receiver-alert-triage"
import type {
  AlertContract,
  ELFApplicationContract,
  OpenSearchAlertDeliveryContract,
  OpenSearchAlertReceiverContract,
  OpenSearchAlertSetupContract,
} from "@/lib/api-client/contracts"
import {
  getOpenSearchAlertSetup,
  listOpenSearchAlertDeliveries,
  receiverAction,
  saveOpenSearchAlertReceiver,
} from "@/lib/api-client/opensearch-alerts"
import { formatDateTime } from "@/lib/format-date"

export function OpenSearchReceivers({
  application,
  alerts,
  receivers,
  refresh,
}: {
  application: ELFApplicationContract
  alerts: AlertContract[]
  receivers: OpenSearchAlertReceiverContract[]
  refresh: () => Promise<void>
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("OpenSearch production alerts")
  const [serviceId, setServiceId] = useState("")
  const [dashboardUrl, setDashboardUrl] = useState(
    "http://localhost:15601/app/alerting"
  )
  const [pending, setPending] = useState("")
  const [message, setMessage] = useState("")
  const [issuedToken, setIssuedToken] = useState("")
  const [setup, setSetup] = useState<OpenSearchAlertSetupContract | null>(null)
  const [deliveries, setDeliveries] = useState<
    OpenSearchAlertDeliveryContract[]
  >([])
  const [deleteTarget, setDeleteTarget] =
    useState<OpenSearchAlertReceiverContract | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function createReceiver() {
    setPending("create")
    setMessage("")
    const result = await saveOpenSearchAlertReceiver({
      data: {
        applicationId: application.id,
        name,
        serviceId,
        enabled: true,
        dashboardUrl,
        expectedMonitorTypes: ["QUERY_LEVEL", "BUCKET_LEVEL", "DOCUMENT_LEVEL"],
        reconciliationIntervalSeconds: 60,
      },
    })
    setPending("")
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setIssuedToken(result.receiver.token ?? "")
    const nextSetup = await getOpenSearchAlertSetup({
      data: { receiverId: result.receiver.id },
    })
    setSetup(nextSetup)
    setDeliveries([])
    setCreating(false)
    await refresh()
  }

  async function showSetup(receiverId: string) {
    setPending(`setup:${receiverId}`)
    const [nextSetup, nextDeliveries] = await Promise.all([
      getOpenSearchAlertSetup({ data: { receiverId } }),
      listOpenSearchAlertDeliveries({ data: { receiverId } }),
    ]).finally(() => setPending(""))
    setSetup(nextSetup)
    setDeliveries(nextDeliveries)
    setIssuedToken("")
  }

  async function toggleReceiver(receiver: OpenSearchAlertReceiverContract) {
    setPending(`toggle:${receiver.id}`)
    setMessage("")
    const result = await saveOpenSearchAlertReceiver({
      data: {
        receiverId: receiver.id,
        applicationId: receiver.applicationId,
        name: receiver.name,
        serviceId: receiver.serviceId ?? "",
        enabled: !receiver.enabled,
        dashboardUrl: receiver.dashboardUrl ?? "",
        expectedMonitorTypes: receiver.expectedMonitorTypes,
        reconciliationIntervalSeconds: receiver.reconciliationIntervalSeconds,
      },
    })
    setPending("")
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setMessage(receiver.enabled ? "Receiver paused." : "Receiver resumed.")
    await refresh()
  }

  async function act(
    receiver: OpenSearchAlertReceiverContract,
    action: "rotate-token" | "test" | "reconcile"
  ) {
    setPending(`${action}:${receiver.id}`)
    setMessage("")
    const result = await receiverAction({
      data: { receiverId: receiver.id, action },
    })
    setPending("")
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    if (action === "rotate-token" && result.data && "token" in result.data) {
      setIssuedToken(String(result.data.token ?? ""))
      setSetup(
        await getOpenSearchAlertSetup({ data: { receiverId: receiver.id } })
      )
    }
    setMessage(
      action === "test"
        ? "Sanitized test alert created."
        : action === "reconcile"
          ? "Reconciliation completed."
          : "Token rotated. The previous token remains valid for 15 minutes."
    )
    await refresh()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setMessage("")
    const result = await receiverAction({
      data: { receiverId: deleteTarget.id, action: "delete" },
    })
    setDeleting(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setDeleteTarget(null)
    setMessage("Receiver deleted.")
    if (setup?.receiverId === deleteTarget.id) setSetup(null)
    await refresh()
  }

  return (
    <section aria-labelledby={`receivers-${application.id}`}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2
            id={`receivers-${application.id}`}
            className="inline-flex items-center gap-2 text-2xl font-semibold"
          >
            <Webhook aria-hidden="true" className="size-5" /> Alert receivers
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Receive OpenSearch Alerting notifications here and assign them to
            this application without trusting ownership fields in the payload.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreating((value) => !value)}
        >
          <Plus data-icon="inline-start" /> New receiver
        </Button>
      </div>

      {creating ? (
        <div className="mt-5 grid gap-3 border-y bg-muted/15 py-5 md:grid-cols-3">
          <FormField label="Receiver name">
            <Input
              aria-label="Receiver name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField
            label="Service"
            hint="Optional. Leave blank for all services."
          >
            <Select
              value={serviceId || "__all__"}
              onValueChange={(value) => {
                if (value == null) return
                setServiceId(value === "__all__" ? "" : value)
              }}
            >
              <SelectTrigger aria-label="Service" className="w-full">
                <SelectValue placeholder="All application services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  All application services
                </SelectItem>
                {application.services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="OpenSearch dashboard URL">
            <Input
              aria-label="OpenSearch dashboard URL"
              value={dashboardUrl}
              onChange={(event) => setDashboardUrl(event.target.value)}
            />
          </FormField>
          <div className="flex justify-end md:col-span-3">
            <Button
              disabled={pending === "create" || !name.trim()}
              onClick={() => void createReceiver()}
            >
              {pending === "create" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Webhook />
              )}
              Create receiver
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 divide-y border-y">
        {receivers.map((receiver) => (
          <div
            key={receiver.id}
            className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{receiver.name}</span>
                <Badge variant="secondary">
                  {receiver.enabled ? "Enabled" : "Paused"}
                </Badge>
                <Badge
                  className={
                    receiver.lastReconciliationStatus === "FAILED"
                      ? "bg-destructive/10 text-destructive"
                      : ""
                  }
                  variant="secondary"
                >
                  Sync{" "}
                  {receiver.lastReconciliationStatus
                    .toLowerCase()
                    .replace("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {receiver.serviceName || "All services"} · every{" "}
                {receiver.reconciliationIntervalSeconds}s
                {receiver.lastDeliveryAt
                  ? ` · last delivery ${formatDateTime(receiver.lastDeliveryAt)}`
                  : " · awaiting first delivery"}
              </p>
              {receiver.lastReconciliationError ? (
                <p className="mt-1 text-xs text-destructive">
                  {receiver.lastReconciliationError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void showSetup(receiver.id)}
              >
                {pending === `setup:${receiver.id}` ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ExternalLink />
                )}
                Setup
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void act(receiver, "test")}
              >
                Test
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void act(receiver, "reconcile")}
              >
                <RefreshCw data-icon="inline-start" /> Sync
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${receiver.enabled ? "Pause" : "Resume"} ${receiver.name}`}
                disabled={pending === `toggle:${receiver.id}`}
                onClick={() => void toggleReceiver(receiver)}
              >
                {receiver.enabled ? <Pause /> : <Play />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Rotate token for ${receiver.name}`}
                onClick={() => void act(receiver, "rotate-token")}
              >
                <RotateCw />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${receiver.name}`}
                onClick={() => setDeleteTarget(receiver)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
        {!receivers.length ? (
          <div className="py-12 text-center">
            <Webhook
              aria-hidden="true"
              className="mx-auto size-7 text-muted-foreground"
            />
            <h3 className="mt-3 font-medium">No receivers configured</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Create a receiver to bring OpenSearch monitor alerts into Rhythm’s
              alert inbox for this application.
            </p>
            <Button
              className="mt-4"
              size="sm"
              onClick={() => setCreating(true)}
            >
              <Plus data-icon="inline-start" /> New receiver
            </Button>
          </div>
        ) : null}
      </div>

      <ReceiverAlertTriage
        alerts={alerts}
        application={application}
        receivers={receivers}
        refresh={refresh}
      />

      {setup ? (
        <ReceiverSetup
          setup={setup}
          token={issuedToken}
          deliveries={deliveries}
          onClose={() => setSetup(null)}
        />
      ) : null}
      {message ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!deleting && !open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete receiver?</AlertDialogTitle>
            <AlertDialogDescription>
              OpenSearch deliveries to <strong>{deleteTarget?.name}</strong>{" "}
              will stop working. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              {deleting ? "Deleting…" : "Delete receiver"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function ReceiverSetup({
  setup,
  token,
  deliveries,
  onClose,
}: {
  setup: OpenSearchAlertSetupContract
  token: string
  deliveries: OpenSearchAlertDeliveryContract[]
  onClose: () => void
}) {
  const [template, setTemplate] = useState<"query" | "bucket" | "document">(
    "query"
  )
  const selected =
    template === "query"
      ? setup.queryTemplate
      : template === "bucket"
        ? setup.bucketTemplate
        : setup.documentTemplate
  return (
    <div className="mt-5 border-y bg-background py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">Connect OpenSearch Notifications</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Copy these values into a Custom webhook channel, then paste the
            matching message template into the monitor action.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {token ? (
        <div className="mt-4 rounded-lg bg-warning-soft p-3 text-sm">
          <p className="font-medium">Copy the new token now</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Rhythm stores only its hash and cannot show it again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md bg-background px-3 py-2 text-xs break-all">
              {token}
            </code>
            <CopyButton label="Copy receiver token" value={token} />
          </div>
        </div>
      ) : null}
      <SetupValue label="Webhook URL" value={setup.webhookUrl} />
      <SetupValue
        label="Authorization header"
        value={token ? `Bearer ${token}` : "Bearer <receiver-token>"}
      />
      <div className="mt-4">
        <p className="text-xs font-medium">Message template</p>
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="tablist"
          aria-label="OpenSearch monitor type"
        >
          {(["query", "bucket", "document"] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant={template === kind ? "default" : "outline"}
              onClick={() => setTemplate(kind)}
            >
              {kind[0].toUpperCase() + kind.slice(1)} level
            </Button>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-2">
          <pre className="max-h-52 min-w-0 flex-1 overflow-auto rounded-lg bg-muted p-3 text-xs break-all whitespace-pre-wrap">
            {selected}
          </pre>
          <CopyButton label="Copy message template" value={selected} />
        </div>
      </div>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {setup.dashboardSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-warning-foreground">
        {setup.credentialWarning}
      </p>
      <div className="mt-5 border-t pt-4">
        <p className="text-xs font-medium">Recent deliveries</p>
        {deliveries.length ? (
          <div className="mt-2 divide-y rounded-md border">
            {deliveries.slice(0, 5).map((delivery) => (
              <div
                key={delivery.id}
                className="flex flex-col justify-between gap-1 px-3 py-2 text-xs sm:flex-row sm:items-center"
              >
                <span>
                  <Badge variant="secondary">
                    {delivery.status.toLowerCase()}
                  </Badge>{" "}
                  {delivery.eventCount}{" "}
                  {delivery.eventCount === 1 ? "event" : "events"}
                </span>
                <span
                  className={
                    delivery.safeError
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {delivery.safeError || formatDateTime(delivery.receivedAt)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            No deliveries received yet. Use Test after closing setup to verify
            the alert inbox.
          </p>
        )}
      </div>
    </div>
  )
}

function SetupValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-medium">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-xs break-all">
          {value}
        </code>
        <CopyButton label={`Copy ${label}`} value={value} />
      </div>
    </div>
  )
}
