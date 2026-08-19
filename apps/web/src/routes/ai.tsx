import { useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@workspace/ui/components/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  ArrowUp,
  BookOpenText,
  CircleAlert,
  Plus,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react"

import { AssistantContent } from "@/features/ai/assistant-content"
import { PageContainer } from "@/components/page-container"
import {
  createAIConversation,
  deleteAIConversation,
  getAIConversation,
  getAISettings,
  listAIConversations,
  sendAIMessage,
  updateAIConversation,
} from "@/lib/api-client/ai"
import type {
  AIConversation,
  AIMessage,
  AISettings,
} from "@/lib/api-client/ai"
import { cn } from "@workspace/ui/lib/utils"

export const Route = createFileRoute("/ai")({ component: AskRhythmPage })

type ToolActivity = { name: string; status: "RUNNING" | "COMPLETE" }

const SPECIALISTS = [
  { value: "INCIDENT_ANALYST", label: "Incident" },
  { value: "PERFORMANCE_ANALYST", label: "Performance" },
  { value: "APPLICATION_HEALTH_ANALYST", label: "Health" },
  { value: "ELF_ANALYST", label: "ELF" },
] as const

type Specialist = (typeof SPECIALISTS)[number]["value"]
const defaultSpecialist: Specialist = SPECIALISTS[0].value

function normalizeSpecialist(value?: string): Specialist {
  return SPECIALISTS.some((item) => item.value === value)
    ? (value as Specialist)
    : defaultSpecialist
}

function AskRhythmPage() {
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [conversations, setConversations] = useState<AIConversation[]>([])
  const [activeId, setActiveId] = useState("")
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [input, setInput] = useState("")
  const [specialist, setSpecialist] = useState(defaultSpecialist)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [tools, setTools] = useState<ToolActivity[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([getAISettings(), listAIConversations()])
      .then(([provider, items]) => {
        if (!active) return
        setSettings(provider)
        setConversations(items)
        if (items[0]) {
          setActiveId(items[0].id)
          setSpecialist(normalizeSpecialist(items[0].contextType))
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Ask Rhythm could not load."
          )
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    let active = true
    setError("")
    void getAIConversation(activeId)
      .then((detail) => {
        if (!active) return
        setMessages(detail.messages)
        setSpecialist(normalizeSpecialist(detail.conversation.contextType))
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Conversation could not load."
          )
      })
    return () => {
      active = false
    }
  }, [activeId])

  const latestCitations = useMemo(
    () =>
      [...messages].reverse().find((message) => message.citations.length)
        ?.citations ?? [],
    [messages]
  )

  async function applySpecialist(next: string) {
    const value = normalizeSpecialist(next)
    setSpecialist(value)
    if (!activeId) return
    try {
      const updated = await updateAIConversation(activeId, {
        contextType: value,
      })
      setConversations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Focus could not be updated."
      )
    }
  }

  async function newConversation() {
    try {
      const created = await createAIConversation({ contextType: specialist })
      setConversations((current) => [created, ...current])
      setActiveId(created.id)
      setMessages([])
      setInput("")
      setError("")
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Conversation could not be created."
      )
    }
  }

  async function removeConversation(conversationId: string) {
    try {
      await deleteAIConversation(conversationId)
      const next = conversations.filter((item) => item.id !== conversationId)
      setConversations(next)
      if (activeId === conversationId) setActiveId(next[0]?.id ?? "")
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Conversation could not be deleted."
      )
    }
  }

  async function send() {
    const content = input.trim()
    if (!content || sending) return
    let conversationId = activeId
    if (!conversationId) {
      const created = await createAIConversation({ contextType: specialist })
      conversationId = created.id
      setActiveId(created.id)
      setConversations((current) => [created, ...current])
    } else {
      const active = conversations.find((item) => item.id === conversationId)
      if (active && normalizeSpecialist(active.contextType) !== specialist) {
        const updated = await updateAIConversation(conversationId, {
          contextType: specialist,
        })
        setConversations((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        )
      }
    }
    const now = new Date().toISOString()
    const userMessage: AIMessage = {
      id: `local-user-${Date.now()}`,
      conversationId,
      role: "USER",
      content,
      citations: [],
      status: "COMPLETE",
      createdAt: now,
    }
    setMessages((current) => [...current, userMessage])
    setInput("")
    setSending(true)
    setError("")
    setTools([])
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const updated = await sendAIMessage(
        conversationId,
        content,
        controller.signal
      )
      const list = await listAIConversations()
      setMessages(updated.messages)
      setConversations(list)
      setTools(updated.tools ?? [])
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Ask Rhythm could not complete the response."
        )
      if (controller.signal.aborted) {
        setMessages((current) =>
          current.map((message) =>
            message.id === userMessage.id
              ? { ...message, status: "CANCELLED" }
              : message
          )
        )
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  const providerReady =
    settings?.active && settings.hasCredential && settings.defaultModel

  return (
    <PageContainer
      className="flex h-full min-h-0 max-w-none flex-col overflow-hidden"
      padding="compact"
    >
      <header className="flex shrink-0 flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Ask Rhythm
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Investigate monitors, runs, applications, alerts, and log checks.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={specialist}
            onValueChange={(value) => {
              if (value) void applySpecialist(value)
            }}
          >
            <SelectTrigger
              aria-label="Focus"
              className="h-8 w-36"
              disabled={sending}
              id="ai-specialist"
            >
              <SelectValue>
                {SPECIALISTS.find((item) => item.value === specialist)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SPECIALISTS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link to="/configuration" search={{ kind: "ai" }} />}
          >
            <Settings2 /> Configure
          </Button>
        </div>
      </header>

      {error ? (
        <Alert className="mt-4 shrink-0" role="alert" variant="destructive">
          <CircleAlert />
          <AlertTitle>Ask Rhythm could not finish</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X />
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <div className="isolate mt-5 grid min-h-0 flex-1 grid-rows-[minmax(0,8.5rem)_minmax(0,1fr)_minmax(0,12rem)] overflow-hidden rounded-xl border bg-background lg:grid-cols-[16rem_minmax(0,1fr)_18rem] lg:grid-rows-[minmax(0,1fr)]">
        <aside
          className="z-0 flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-b bg-background lg:border-r lg:border-b-0"
          aria-label="AI conversations"
        >
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-2.5">
            <span className="text-sm font-medium">Conversations</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="New conversation"
              onClick={newConversation}
            >
              <Plus />
            </Button>
          </div>
          <ItemGroup className="min-h-0 min-w-0 flex-1 gap-0.5 overflow-x-hidden overflow-y-auto overscroll-contain p-2">
            {loading ? (
              <div className="space-y-2 p-1" aria-hidden="true">
                <Skeleton className="h-9 w-full rounded-lg" />
                <Skeleton className="h-9 w-4/5 rounded-lg" />
                <Skeleton className="h-9 w-3/5 rounded-lg" />
              </div>
            ) : null}
            {conversations.map((conversation) => (
              <Item
                key={conversation.id}
                className="max-w-full min-w-0 flex-nowrap overflow-hidden"
                size="xs"
                variant={activeId === conversation.id ? "outline" : "default"}
              >
                <ItemContent className="min-w-0 overflow-hidden">
                  <button
                    className="block min-h-10 w-full min-w-0 truncate px-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={conversation.title}
                    onClick={() => {
                      setActiveId(conversation.id)
                      setSpecialist(
                        normalizeSpecialist(conversation.contextType)
                      )
                    }}
                  >
                    {conversation.title}
                  </button>
                </ItemContent>
                <ItemActions className="shrink-0">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${conversation.title}`}
                    onClick={() => void removeConversation(conversation.id)}
                  >
                    <Trash2 />
                  </Button>
                </ItemActions>
              </Item>
            ))}
            {!loading && conversations.length === 0 ? (
              <p className="p-3 text-xs leading-5 text-muted-foreground">
                Start a conversation to investigate current operational
                evidence.
              </p>
            ) : null}
          </ItemGroup>
        </aside>

        <section
          className="relative z-10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
          aria-label="Ask Rhythm conversation"
        >
          <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
            <MessageScrollerProvider autoScroll>
              <MessageScroller className="h-full min-h-0">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-5 sm:px-6">
                    {loading ? <BriefingSkeleton /> : null}
                    {!loading && messages.length === 0 ? (
                      <ConversationStart
                        onPrompt={(prompt) => setInput(prompt)}
                        providerReady={Boolean(providerReady)}
                      />
                    ) : null}
                    {messages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "USER"}
                      >
                        <ThreadMessage message={message} />
                      </MessageScrollerItem>
                    ))}
                    {sending ? (
                      <MessageScrollerItem
                        messageId="ask-rhythm-waiting"
                        scrollAnchor
                      >
                        <WaitingBriefing tools={tools} />
                      </MessageScrollerItem>
                    ) : null}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
          <form
            className="shrink-0 border-t bg-background p-3 sm:p-4"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <InputGroup
              className="mx-auto max-w-4xl rounded-xl border bg-muted/15"
              data-disabled={!providerReady || sending || undefined}
            >
              <label className="sr-only" htmlFor="ask-rhythm-message">
                Message Ask Rhythm
              </label>
              <InputGroupTextarea
                id="ask-rhythm-message"
                className="min-h-20 px-3"
                disabled={!providerReady || sending}
                maxLength={32768}
                placeholder={
                  providerReady
                    ? "Ask about a monitor, run, application, service, alert, or log check…"
                    : "Configure and test Compass360 to start asking questions."
                }
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <InputGroupAddon align="block-end">
                <InputGroupText className="text-xs">
                  Read-only · grounded · 30-day retention
                </InputGroupText>
                {sending ? (
                  <InputGroupButton
                    className="ml-auto"
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => abortRef.current?.abort()}
                  >
                    <Square className="fill-current" /> Stop
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    className="ml-auto"
                    size="sm"
                    type="submit"
                    variant="default"
                    disabled={!providerReady || !input.trim()}
                  >
                    <ArrowUp /> Send
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            </InputGroup>
          </form>
        </section>

        <aside
          className="z-0 flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t bg-background lg:border-t-0 lg:border-l"
          aria-label="Evidence used by Ask Rhythm"
        >
          <div className="shrink-0 border-b p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-primary" /> Evidence and
              activity
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Facts come from authorized Rhythm read tools, never direct
              database or network access.
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
            {tools.length ? (
              <section>
                <h2 className="text-xs font-medium text-muted-foreground">
                  Tools used
                </h2>
                <div className="mt-2 space-y-2">
                  {tools.map((tool) => (
                    <Marker key={tool.name}>
                      <MarkerIcon>
                        {tool.status === "RUNNING" ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <Wrench />
                        )}
                      </MarkerIcon>
                      <MarkerContent>
                        {friendlyToolName(tool.name)}
                        {tool.status === "COMPLETE" ? " · Done" : ""}
                      </MarkerContent>
                    </Marker>
                  ))}
                </div>
              </section>
            ) : null}
            <section>
              <h2 className="text-xs font-medium text-muted-foreground">
                Cited evidence
              </h2>
              {latestCitations.length ? (
                <ItemGroup className="mt-2 gap-2">
                  {latestCitations.map((citation) => (
                    <Item
                      key={`${citation.resourceType}-${citation.resourceId}`}
                      render={<Link to={citation.href as "/"} />}
                      size="sm"
                      variant="outline"
                    >
                      <ItemContent>
                        <ItemTitle>{citation.label}</ItemTitle>
                        <p className="text-xs text-muted-foreground">
                          {citation.resourceType.replaceAll("_", " ")} ·{" "}
                          {citation.resourceId.slice(0, 8)}
                        </p>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              ) : (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Evidence links appear after Ask Rhythm reads a resource.
                </p>
              )}
            </section>
            <section className="border-t pt-4">
              <div className="flex items-start gap-2">
                <BookOpenText className="mt-0.5 size-4 text-muted-foreground" />
                <p className="text-xs leading-5 text-muted-foreground">
                  Ask Rhythm cannot run checks or change configuration. Any
                  future validation action is presented as an expiring proposal
                  requiring your confirmation.
                </p>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </PageContainer>
  )
}

function ConversationStart({
  onPrompt,
  providerReady,
}: {
  onPrompt: (prompt: string) => void
  providerReady: boolean
}) {
  const prompts = [
    "What needs attention across my monitors?",
    "Explain the latest failed API run",
    "Chart API response time for the monitor that needs attention",
    "Show active alerts and what I should check next",
  ]
  return (
    <Empty className="min-h-full justify-center border-0 p-0">
      <EmptyHeader className="max-w-xl items-start text-left">
        <EmptyTitle>Start with an operational question</EmptyTitle>
        <EmptyDescription className="text-left">
          Ask Rhythm locates the resource first, loads only approved evidence,
          and says when history was not recorded. Comparable numbers from those
          tools render as interactive charts in the answer.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-2xl items-stretch">
        <div className="grid gap-2 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <Button
              className="h-auto min-h-12 justify-start whitespace-normal py-3 text-left font-normal"
              disabled={!providerReady}
              key={prompt}
              variant="outline"
              onClick={() => onPrompt(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      </EmptyContent>
    </Empty>
  )
}

function ThreadMessage({ message }: { message: AIMessage }) {
  const assistant = message.role === "ASSISTANT"
  return (
    <Message
      align={assistant ? "start" : "end"}
      aria-label={assistant ? "Ask Rhythm response" : "Your message"}
    >
      <MessageAvatar aria-hidden="true">
        <Avatar size="sm">
          <AvatarFallback
            className={cn(
              assistant && "bg-primary text-primary-foreground"
            )}
          >
            {assistant ? "R" : "Y"}
          </AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>
          {assistant ? "Ask Rhythm" : "You"}
          {message.status === "FAILED" ? (
            <Badge className="ml-2" variant="destructive">
              Incomplete
            </Badge>
          ) : message.status === "CANCELLED" ? (
            <Badge className="ml-2" variant="outline">
              Cancelled
            </Badge>
          ) : null}
        </MessageHeader>
        <Bubble
          className={assistant ? "max-w-full" : undefined}
          variant={assistant ? "outline" : "secondary"}
        >
          <BubbleContent className={assistant ? "w-full overflow-visible" : undefined}>
            {assistant ? (
              <AssistantContent content={message.content} />
            ) : (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}
          </BubbleContent>
        </Bubble>
        {assistant && message.citations.length ? (
          <MessageFooter className="flex-wrap gap-2">
            {message.citations.map((citation) => (
              <Button
                key={`${citation.resourceType}-${citation.resourceId}`}
                nativeButton={false}
                size="sm"
                variant="outline"
                render={<Link to={citation.href as "/"} />}
              >
                {citation.label}
              </Button>
            ))}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

function WaitingBriefing({ tools }: { tools: ToolActivity[] }) {
  return (
    <Message>
      <MessageAvatar aria-hidden="true">
        <Avatar size="sm">
          <AvatarFallback className="bg-primary text-primary-foreground">
            R
          </AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <Marker role="status">
          <MarkerIcon>
            <Spinner />
          </MarkerIcon>
          <MarkerContent>
            Ask Rhythm is reading governed evidence…
          </MarkerContent>
        </Marker>
        {tools.length ? (
          <div className="space-y-1">
            {tools.map((tool) => (
              <Marker key={tool.name}>
                <MarkerIcon>
                  {tool.status === "RUNNING" ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <Wrench />
                  )}
                </MarkerIcon>
                <MarkerContent>{friendlyToolName(tool.name)}</MarkerContent>
              </Marker>
            ))}
          </div>
        ) : (
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="h-3 w-full max-w-prose rounded-md" />
            <Skeleton className="h-3 w-4/5 max-w-prose rounded-md" />
            <Skeleton className="h-[180px] w-full rounded-xl" />
          </div>
        )}
      </MessageContent>
    </Message>
  )
}

function BriefingSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4 py-6">
      <Skeleton className="h-5 w-48 rounded-md" />
      <Skeleton className="h-3 w-full max-w-xl rounded-md" />
      <Skeleton className="h-3 w-2/3 max-w-xl rounded-md" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
      <span className="sr-only">Loading conversations</span>
    </div>
  )
}

function friendlyToolName(name: string) {
  return name.replace(/^get_|^list_/, "").replaceAll("_", " ")
}
