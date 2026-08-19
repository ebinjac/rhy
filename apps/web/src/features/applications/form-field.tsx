import { InfoHint } from "@/components/info-hint"

export function FormField({
  label,
  hint,
  info,
  children,
}: {
  label: string
  hint?: string
  info?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      {info ? (
        <>
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium">{label}</span>
            <InfoHint title={label}>{info}</InfoHint>
          </div>
          <label className="mt-1.5 block">
            <span className="sr-only">{label}</span>
            {children}
          </label>
        </>
      ) : (
        <label className="text-xs font-medium">
          {label}
          <span className="mt-1.5 block">{children}</span>
        </label>
      )}
      {hint ? (
        <p className="mt-1 text-xs font-normal text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function EditField({
  label,
  help,
  info,
  children,
}: {
  label: string
  help?: string
  info?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      {info ? (
        <>
          <div className="flex items-center gap-1">
            <span className="text-sm font-medium">{label}</span>
            <InfoHint title={label}>{info}</InfoHint>
          </div>
          <label className="mt-2 block">
            <span className="sr-only">{label}</span>
            {children}
          </label>
        </>
      ) : (
        <label className="text-sm font-medium">
          {label}
          <span className="mt-2 block">{children}</span>
        </label>
      )}
      {help ? (
        <p className="mt-1 text-xs font-normal text-muted-foreground">{help}</p>
      ) : null}
    </div>
  )
}
