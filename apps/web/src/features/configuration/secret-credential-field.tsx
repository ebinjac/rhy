import { useMemo } from "react"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import type { ConfigurationProfileContract } from "@/lib/api-client/contracts"

export type SecretInputMode = "value" | "secret"

export function toSecretRef(alias: string): string {
  const trimmed = alias.trim()
  if (!trimmed) return ""
  return trimmed.startsWith("secret://") ? trimmed : `secret://${trimmed}`
}

export function secretAliasFromRef(
  reference: string | undefined | null
): string {
  const trimmed = (reference ?? "").trim()
  if (!trimmed) return ""
  return trimmed.startsWith("secret://")
    ? trimmed.slice("secret://".length)
    : trimmed
}

export function secretAlias(profile: ConfigurationProfileContract): string {
  return profile.name.trim()
}

const modeLabels: Record<SecretInputMode, string> = {
  value: "Enter value",
  secret: "Use existing secret",
}

export function SecretPicker({
  secrets,
  value,
  onValueChange,
  placeholder = "Select a secret…",
  disabled,
  ariaLabel = "Secret alias",
}: {
  secrets: ConfigurationProfileContract[]
  value: string
  onValueChange: (alias: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const items = useMemo(() => {
    const entries: Record<string, string> = { "": placeholder }
    for (const profile of secrets) {
      const alias = secretAlias(profile)
      if (alias) entries[alias] = alias
    }
    return entries
  }, [placeholder, secrets])

  return (
    <Select
      value={value || null}
      onValueChange={(next) => onValueChange(next ?? "")}
      items={items}
      disabled={disabled}
    >
      <SelectTrigger aria-label={ariaLabel} className="h-9 w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {secrets.length ? (
          secrets.map((profile) => {
            const alias = secretAlias(profile)
            return (
              <SelectItem key={profile.id} value={alias}>
                {alias}
              </SelectItem>
            )
          })
        ) : (
          <SelectItem value="__none" disabled>
            No secrets configured yet
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}

export function SecretCredentialField({
  label,
  help,
  secrets,
  mode,
  onModeChange,
  value,
  onValueChange,
  secretAlias: selectedAlias,
  onSecretAliasChange,
  hasSaved = false,
  valuePlaceholder,
  password = true,
  modeLabelsOverride,
  wide,
}: {
  label: string
  help?: string
  secrets: ConfigurationProfileContract[]
  mode: SecretInputMode
  onModeChange: (mode: SecretInputMode) => void
  value: string
  onValueChange: (value: string) => void
  secretAlias: string
  onSecretAliasChange: (alias: string) => void
  hasSaved?: boolean
  valuePlaceholder?: string
  password?: boolean
  modeLabelsOverride?: Partial<Record<SecretInputMode, string>>
  wide?: boolean
}) {
  const labels = { ...modeLabels, ...modeLabelsOverride }
  return (
    <div className={`space-y-3 ${wide ? "md:col-span-2" : ""}`}>
      <label className="text-xs font-medium">
        {label}
        <span className="mt-2 block">
          <Select
            value={mode}
            onValueChange={(next) => {
              if (next == null) return
              onModeChange(next)
            }}
            items={labels}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="value">{labels.value}</SelectItem>
              <SelectItem value="secret">{labels.secret}</SelectItem>
            </SelectContent>
          </Select>
        </span>
      </label>
      {mode === "value" ? (
        <label className="text-xs font-medium">
          Value
          <span className="mt-2 block">
            <Input
              className="font-mono"
              type={password ? "password" : "text"}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={
                hasSaved && !value
                  ? "•••• (saved — leave blank to keep)"
                  : (valuePlaceholder ?? "Enter credential")
              }
              autoComplete="new-password"
            />
          </span>
          {help ? (
            <span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">
              {help}
            </span>
          ) : (
            <span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">
              Encrypted at rest. Never returned after save.
            </span>
          )}
        </label>
      ) : (
        <div className="text-xs font-medium">
          Secret alias
          <span className="mt-2 block">
            <SecretPicker
              secrets={secrets}
              value={selectedAlias}
              onValueChange={onSecretAliasChange}
              ariaLabel={`${label} secret alias`}
            />
          </span>
          <span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">
            Pick an alias from Configuration → Secrets. ENV and Vault providers
            work here too.
          </span>
        </div>
      )}
    </div>
  )
}
