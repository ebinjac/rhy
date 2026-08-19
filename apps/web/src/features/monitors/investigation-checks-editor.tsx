import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { ChevronDown, Plus, Trash2 } from "lucide-react"

import { InfoHint } from "@/components/info-hint"
import { defaultEnvironmentBindingId } from "@/features/applications/default-environment-binding"
import type { InvestigationCheck } from "@/features/monitors/request-definition"
import type {
  DynatraceEnvironmentBindingContract,
  ELFQueryContract,
} from "@/lib/api-client/contracts"
import {
  ensureApplicationDynatraceContext,
  listApplicationEnvironments,
} from "@/lib/api-client/dynatrace"
import { listELFQueries } from "@/lib/api-client/elf"

const MAX_CHECKS = 20

export function InvestigationChecksEditor({
  applicationId,
  value,
  onChange,
}: {
  applicationId: string
  value: InvestigationCheck[]
  onChange: (next: InvestigationCheck[]) => void
}) {
  const [open, setOpen] = useState(value.length > 0)
  const [queries, setQueries] = useState<ELFQueryContract[]>([])
  const [environments, setEnvironments] = useState<
    DynatraceEnvironmentBindingContract[]
  >([])

  useEffect(() => {
    if (!applicationId) {
      setQueries([])
      setEnvironments([])
      return
    }
    let cancelled = false
    void Promise.all([
      listELFQueries(),
      listApplicationEnvironments({ data: { applicationId } }),
    ]).then(([allQueries, bindings]) => {
      if (cancelled) return
      setQueries(
        allQueries.filter((query) => query.applicationId === applicationId)
      )
      setEnvironments(bindings)
    })
    return () => {
      cancelled = true
    }
  }, [applicationId])

  const checks = value ?? []
  const linked = Boolean(applicationId)
  const atCap = checks.length >= MAX_CHECKS

  async function addCheck(kind: InvestigationCheck["kind"]) {
    if (!linked || atCap) return
    let environmentBindingId = defaultEnvironmentBindingId(environments)
    if (kind === "DYNATRACE" && !environmentBindingId) {
      const ensured = await ensureApplicationDynatraceContext({
        data: { applicationId },
      })
      if (ensured.ok) {
        environmentBindingId = ensured.binding.id
        setEnvironments((current) =>
          current.some((item) => item.id === ensured.binding.id)
            ? current
            : [ensured.binding, ...current]
        )
      }
    }
    const query = queries[0]
    onChange([
      ...checks,
      {
        id: crypto.randomUUID(),
        kind,
        label:
          kind === "ELF_QUERY"
            ? (query?.name ?? "ELF query")
            : "Dynatrace infrastructure",
        queryId: kind === "ELF_QUERY" ? query?.id : undefined,
        applicationId,
        environmentBindingId:
          kind === "DYNATRACE" ? environmentBindingId : undefined,
        serviceIds: [],
      },
    ])
    setOpen(true)
  }

  function update(index: number, patch: Partial<InvestigationCheck>) {
    onChange(
      checks.map((item, current) =>
        current === index ? { ...item, ...patch } : item
      )
    )
  }

  return (
    <section
      aria-labelledby="monitor-investigation-heading"
      className="rounded-xl border"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2
            className="flex items-center gap-1.5 text-sm font-semibold"
            id="monitor-investigation-heading"
          >
            If this monitor fails
            <InfoHint title="If this monitor fails">
              These checks run automatically when a new alert opens. They gather
              ELF logs and Dynatrace metrics for this journey so operators do
              not start from a blank workbench.
            </InfoHint>
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Advisory evidence only. Link an application, then add ELF or
            Dynatrace checks.
          </p>
        </div>
        <Button
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open ? (
        <div className="border-t px-4 py-4">
          {!linked ? (
            <p className="text-sm text-muted-foreground">
              Link an application and add ELF or Dynatrace checks so failures
              gather evidence automatically.
            </p>
          ) : null}
          {linked && checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No investigation checks. Add ELF or Dynatrace checks so failures
              gather evidence automatically.
            </p>
          ) : null}
          {checks.length ? (
            <ul className="divide-y rounded-xl border">
              {checks.map((check, index) => (
                <li
                  className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  key={check.id}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select
                      items={[
                        { value: "ELF_QUERY", label: "ELF query" },
                        { value: "DYNATRACE", label: "Dynatrace" },
                      ]}
                      onValueChange={(kind) => {
                        if (kind !== "ELF_QUERY" && kind !== "DYNATRACE")
                          return
                        if (kind === "ELF_QUERY") {
                          const query = queries[0]
                          update(index, {
                            kind,
                            label: query?.name ?? "ELF query",
                            queryId: query?.id,
                            environmentBindingId: undefined,
                          })
                          return
                        }
                        update(index, {
                          kind,
                          label: "Dynatrace infrastructure",
                          queryId: undefined,
                          applicationId,
                          environmentBindingId:
                            defaultEnvironmentBindingId(environments),
                        })
                      }}
                      value={check.kind}
                    >
                      <SelectTrigger
                        aria-label="Check type"
                        className="h-9 w-full"
                        disabled={!linked}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ELF_QUERY">ELF query</SelectItem>
                        <SelectItem value="DYNATRACE">Dynatrace</SelectItem>
                      </SelectContent>
                    </Select>
                    {check.kind === "ELF_QUERY" ? (
                      <Select
                        items={queries.map((query) => ({
                          value: query.id,
                          label: query.name,
                        }))}
                        onValueChange={(queryId) => {
                          if (!queryId) return
                          const query = queries.find(
                            (item) => item.id === queryId
                          )
                          update(index, {
                            queryId,
                            label: query?.name ?? check.label,
                            applicationId,
                          })
                        }}
                        value={check.queryId || null}
                      >
                        <SelectTrigger
                          aria-label="ELF query"
                          className="h-9 w-full"
                          disabled={!linked}
                        >
                          <SelectValue placeholder="Select ELF query" />
                        </SelectTrigger>
                        <SelectContent>
                          {queries.map((query) => (
                            <SelectItem key={query.id} value={query.id}>
                              {query.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        items={environments.map((binding) => ({
                          value: binding.id,
                          label: binding.environmentName,
                        }))}
                        onValueChange={(bindingId) => {
                          if (!bindingId) return
                          update(index, {
                            environmentBindingId: bindingId,
                            applicationId,
                          })
                        }}
                        value={check.environmentBindingId || null}
                      >
                        <SelectTrigger
                          aria-label="Dynatrace environment"
                          className="h-9 w-full"
                          disabled={!linked}
                        >
                          <SelectValue placeholder="Select environment" />
                        </SelectTrigger>
                        <SelectContent>
                          {environments.map((binding) => (
                            <SelectItem key={binding.id} value={binding.id}>
                              {binding.environmentName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <Button
                    aria-label={`Remove ${check.label}`}
                    disabled={!linked}
                    onClick={() =>
                      onChange(checks.filter((item) => item.id !== check.id))
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={!linked || atCap}
              onClick={() => void addCheck("ELF_QUERY")}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus data-icon="inline-start" />
              Add ELF query
            </Button>
            <Button
              disabled={!linked || atCap}
              onClick={() => void addCheck("DYNATRACE")}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus data-icon="inline-start" />
              Add Dynatrace
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
