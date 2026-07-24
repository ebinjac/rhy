import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Activity,
  Cable,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  ShieldX,
} from "lucide-react"

import type { AgentContract } from "@/lib/api-client/contracts"
import {
  changeAgentStatus,
  listAgents,
  registerAgent,
} from "@/lib/api-client/agents"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/agents")({
  loader: () => listAgents(),
  component: AgentsPage,
})

function AgentsPage() {
  const agents = Route.useLoaderData()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [groupId, setGroupID] = useState("default")
  const [version, setVersion] = useState("1.0.0")
  const [tags, setTags] = useState("public, docker")
  const [maxConcurrency, setMaxConcurrency] = useState(4)
  const [capabilities, setCapabilities] = useState(
    '{"http":true,"https":true,"mtls":true}'
  )
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  async function register() {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(capabilities) as Record<string, unknown>
    } catch {
      setMessage("Capabilities must be a valid JSON object.")
      return
    }
    setPending(true)
    setMessage("")
    const result = await registerAgent({
      data: {
        name,
        groupId,
        version,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        capabilities: parsed,
        maxConcurrency,
      },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setOpen(false)
    setName("")
    await router.invalidate()
  }
  const healthy = agents.filter((agent) => agent.health === "HEALTHY").length
  const capacity = agents.reduce(
    (total, agent) => total + agent.maxConcurrency,
    0
  )
  const active = agents.reduce((total, agent) => total + agent.activeRuns, 0)
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Distributed execution
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold">
            Execution agents
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Network locations, advertised capabilities, heartbeat health, and
            job capacity.
          </p>
        </div>
        <Button onClick={() => setOpen((value) => !value)}>
          <Plus /> Register agent
        </Button>
      </div>
      <div className="mt-7 grid overflow-hidden rounded-xl border sm:grid-cols-3">
        <Metric
          icon={Activity}
          label="Healthy agents"
          value={`${healthy} / ${agents.length}`}
        />
        <Metric
          icon={Cable}
          label="Active jobs"
          value={`${active} / ${capacity}`}
        />
        <Metric icon={Clock3} label="Heartbeat SLA" value="90 sec" />
      </div>
      {message ? (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="size-4" />
          {message}
        </div>
      ) : null}
      {open ? (
        <section className="mt-6 rounded-xl border bg-muted/15 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Agent name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="datacenter-east-01"
              />
            </Field>
            <Field label="Agent group">
              <Input
                value={groupId}
                onChange={(event) => setGroupID(event.target.value)}
              />
            </Field>
            <Field label="Version">
              <Input
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              />
            </Field>
            <Field label="Maximum concurrency">
              <Input
                min={1}
                max={1000}
                type="number"
                value={maxConcurrency}
                onChange={(event) =>
                  setMaxConcurrency(Number(event.target.value))
                }
              />
            </Field>
            <Field label="Network and policy tags" wide>
              <Input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="private, eu-west, payments"
              />
            </Field>
            <Field label="Capabilities JSON" wide>
              <Textarea
                className="min-h-24 font-mono"
                value={capabilities}
                onChange={(event) => setCapabilities(event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button disabled={pending || !name} onClick={register}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}{" "}
              Register
            </Button>
          </div>
        </section>
      ) : null}
      <section className="mt-8">
        <h2 className="font-heading text-lg font-semibold">Agent fleet</h2>
        {agents.length ? (
          <div className="mt-4 space-y-3">
            {agents.map((agent) => (
              <AgentRow agent={agent} key={agent.id} />
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed py-14 text-center">
            <Cable className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 font-medium">No execution agents registered</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Register a worker location to route monitors by network and
              capability.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function AgentRow({ agent }: { agent: AgentContract }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  async function change(action: "drain" | "activate" | "revoke") {
    setPending(true)
    setMessage("")
    const result = await changeAgentStatus({
      data: { agentId: agent.id, action },
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    await router.invalidate()
  }
  const healthy = agent.health === "HEALTHY"
  return (
    <article className="rounded-xl border p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div
          className={`grid size-10 shrink-0 place-items-center rounded-lg ${healthy ? "bg-success-soft text-success-foreground" : "bg-muted text-muted-foreground"}`}
        >
          <Cable className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{agent.name}</h3>
            <Badge
              className={
                healthy
                  ? "bg-success-soft text-success-foreground"
                  : agent.health === "OFFLINE" || agent.health === "REVOKED"
                    ? "bg-destructive/10 text-destructive"
                    : ""
              }
              variant="secondary"
            >
              {agent.health}
            </Badge>
            <Badge variant="outline">v{agent.version || "unknown"}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {agent.groupId || "No group"} ·{" "}
            {agent.lastHeartbeatAt
              ? `Heartbeat ${formatDateTime(agent.lastHeartbeatAt)}`
              : "No heartbeat"}{" "}
            · {agent.activeRuns}/{agent.maxConcurrency} active
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {agent.tags.map((tag) => (
              <span
                className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                key={tag}
              >
                {tag}
              </span>
            ))}
            {Object.entries(agent.capabilities)
              .filter(([, enabled]) => enabled === true)
              .map(([capability]) => (
                <span
                  className="rounded bg-primary/10 px-2 py-1 text-[11px] text-primary"
                  key={capability}
                >
                  {capability}
                </span>
              ))}
          </div>
          {message ? (
            <p className="mt-2 text-xs text-destructive">{message}</p>
          ) : null}
        </div>
        {agent.status !== "REVOKED" ? (
          <div className="flex gap-2">
            {agent.status === "ACTIVE" ? (
              <Button
                disabled={pending}
                size="sm"
                variant="outline"
                onClick={() => change("drain")}
              >
                <Pause /> Drain
              </Button>
            ) : (
              <Button
                disabled={pending}
                size="sm"
                variant="outline"
                onClick={() => change("activate")}
              >
                <Play /> Activate
              </Button>
            )}
            <Button
              className="text-destructive hover:text-destructive"
              disabled={pending}
              size="sm"
              variant="ghost"
              onClick={() => change("revoke")}
            >
              <ShieldX /> Revoke
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 border-b p-5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
      <Icon className="size-4 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-heading text-xl font-semibold">{value}</p>
      </div>
    </div>
  )
}
function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`text-xs font-medium ${wide ? "md:col-span-2" : ""}`}>
      {label}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}
