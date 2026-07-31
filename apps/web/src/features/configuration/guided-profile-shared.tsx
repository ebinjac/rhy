import type { ReactNode } from "react"
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
import { Input } from "@workspace/ui/components/input"
import { CircleAlert, LoaderCircle, Plus, Trash2, TriangleAlert } from "lucide-react"

import { PageEmptyState } from "@/components/page-empty-state"

export function ConfigurationIntro({
  icon,
  title,
  description,
  aside,
  actionLabel,
  onAction,
}: {
  icon: ReactNode
  title: string
  description: string
  aside: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border bg-card">
      <div className="grid gap-6 p-5 md:grid-cols-[1fr_300px] md:p-6">
        <div className="flex gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <h2 className="font-heading text-lg font-semibold">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
            <Button className="mt-4 min-h-11 sm:min-h-9" onClick={onAction}>
              <Plus /> {actionLabel}
            </Button>
          </div>
        </div>
        <div className="rounded-xl border bg-muted/35 p-4">
          <Badge variant="secondary">How it works</Badge>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {aside}
          </p>
        </div>
      </div>
    </section>
  )
}

export function GuidedForm({
  title,
  description,
  message,
  children,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string
  description: string
  message: string
  children: ReactNode
  pending: boolean
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <section className="mt-5 rounded-2xl border bg-card p-5 md:p-6">
      <div className="max-w-2xl">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">{children}</div>
      {message ? (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {message}
        </div>
      ) : null}
      <div className="mt-6 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button
          className="min-h-11 sm:min-h-9"
          variant="ghost"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          className="min-h-11 sm:min-h-9"
          onClick={onSubmit}
          disabled={pending}
        >
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </section>
  )
}

export function FormField({
  label,
  help,
  required,
  wide,
  children,
}: {
  label: string
  help?: string
  required?: boolean
  wide?: boolean
  children: ReactNode
}) {
  return (
    <label className={`text-sm font-medium ${wide ? "md:col-span-2" : ""}`}>
      {label}
      {required ? <span className="text-destructive"> *</span> : null}
      <span className="mt-2 block">{children}</span>
      {help ? (
        <span className="mt-1.5 block text-xs leading-5 font-normal text-muted-foreground">
          {help}
        </span>
      ) : null}
    </label>
  )
}

export function IdentityFields({
  name,
  description,
  setName,
  setDescription,
}: {
  name: string
  description: string
  setName: (value: string) => void
  setDescription: (value: string) => void
}) {
  return (
    <>
      <FormField label="Profile name" required>
        <Input aria-label="Profile name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Production API"
        />
      </FormField>
      <FormField
        label="Description"
        help="Help monitor authors choose the right profile."
      >
        <Input aria-label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Used by production order-service checks"
        />
      </FormField>
    </>
  )
}

export function EmptyProfiles({
  title,
  description,
  onCreate,
}: {
  title: string
  description: string
  onCreate: () => void
}) {
  return (
    <PageEmptyState
      title={title}
      description={description}
      action={
        <Button className="min-h-11 sm:min-h-9" onClick={onCreate}>
          <Plus /> Create profile
        </Button>
      }
    />
  )
}

export function ReadonlyValue({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm">{value || "Not configured"}</dd>
    </div>
  )
}

export function DeleteProfileDialog({
  open,
  onOpenChange,
  title,
  description,
  confirming,
  onConfirm,
  confirmLabel = "Delete",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirming: boolean
  onConfirm: () => void
  confirmLabel?: string
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!confirming) onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlert />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirming}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirming}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {confirming ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            {confirming ? "Deleting…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
