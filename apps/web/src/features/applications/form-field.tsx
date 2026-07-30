export function FormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <label className="text-xs font-medium">
        {label}
        <span className="mt-1.5 block">{children}</span>
      </label>
      {hint ? (
        <p className="mt-1 text-xs font-normal text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function EditField({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <label className="text-sm font-medium">
        {label}
        <span className="mt-2 block">{children}</span>
      </label>
      {help ? (
        <p className="mt-1 text-xs font-normal text-muted-foreground">{help}</p>
      ) : null}
    </div>
  )
}
