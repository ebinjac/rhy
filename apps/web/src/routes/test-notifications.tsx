import { useState } from "react"
import type { FormEvent } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  CircleAlert,
  LoaderCircle,
  Mail,
  MessageSquare,
  Send,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"

import { PageContainer } from "@/components/page-container"
import {
  getTestNotificationStatus,
  sendTestNotificationEmail,
  sendTestNotificationSahara,
} from "@/lib/api-client/test-notifications"
import type { TestNotificationResult } from "@/lib/api-client/test-notifications"

export const Route = createFileRoute("/test-notifications")({
  loader: () => getTestNotificationStatus(),
  head: () => ({
    meta: [
      { title: "Test notifications · Rhythm" },
      {
        name: "robots",
        content: "noindex, nofollow",
      },
      {
        name: "description",
        content: "Internal outbound channel verification for Rhythm operators.",
      },
    ],
  }),
  component: TestNotificationsPage,
})

type EmailForm = {
  from: string
  fromName: string
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
}

type SlackForm = {
  to: string
  subject: string
  body: string
}

type SaharaForm = {
  assignmentGroup: string
  reporterGroup: string
  environmentAffected: string
  severity: string
  summary: string
  description: string
  eventGenerator: string
}

function TestNotificationsPage() {
  const status = Route.useLoaderData()
  const [email, setEmail] = useState<EmailForm>({
    from: status.email.from,
    fromName: status.email.fromName,
    to: "",
    cc: "",
    bcc: "",
    subject: "Rhythm SMTP test",
    body: "This is a real Rhythm outbound email test.",
  })
  const [slack, setSlack] = useState<SlackForm>({
    to: "",
    subject: "Rhythm Slack email test",
    body: "This is a real Rhythm outbound message via Slack email-to-channel.",
  })
  const [sahara, setSahara] = useState<SaharaForm>({
    assignmentGroup: "DP_KMS_VRS_TKS_Support",
    reporterGroup: "",
    environmentAffected: "E3",
    severity: "Sev4",
    summary: "Rhythm Sahara ingest test",
    description: "This is a real Rhythm outbound Sahara test event.",
    eventGenerator: "Rhythm",
  })
  const [emailPending, setEmailPending] = useState(false)
  const [slackPending, setSlackPending] = useState(false)
  const [saharaPending, setSaharaPending] = useState(false)
  const [emailResult, setEmailResult] = useState<TestNotificationResult | null>(
    null
  )
  const [slackResult, setSlackResult] = useState<TestNotificationResult | null>(
    null
  )
  const [saharaResult, setSaharaResult] =
    useState<TestNotificationResult | null>(null)

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    setEmailPending(true)
    setEmailResult(null)
    const result = await sendTestNotificationEmail({ data: email })
    setEmailResult(result)
    setEmailPending(false)
  }

  async function submitSlack(event: FormEvent) {
    event.preventDefault()
    setSlackPending(true)
    setSlackResult(null)
    const result = await sendTestNotificationEmail({
      data: {
        from: email.from,
        fromName: email.fromName,
        to: slack.to,
        cc: "",
        bcc: "",
        subject: slack.subject,
        body: slack.body,
      },
    })
    setSlackResult(result)
    setSlackPending(false)
  }

  async function submitSahara(event: FormEvent) {
    event.preventDefault()
    setSaharaPending(true)
    setSaharaResult(null)
    const result = await sendTestNotificationSahara({ data: sahara })
    setSaharaResult(result)
    setSaharaPending(false)
  }

  const smtpLabel = status.email.configured
    ? `${status.email.smtpHost || "SMTP"}:${status.email.smtpPort || 25}`
    : "SMTP host missing"
  const saharaLabel = status.sahara.configured
    ? status.sahara.host
    : "RHYTHM_SAHARA_INGEST_URL is not set"

  return (
    <PageContainer>
      <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Internal
      </p>
      <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
        Test notifications
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        This page is for verifying outbound channels. Messages are real: SMTP
        mail, Slack email-to-channel, and Sahara ingest all leave this
        environment.
      </p>

      <Alert className="mt-6">
        <TriangleAlert />
        <AlertTitle>Not linked from navigation</AlertTitle>
        <AlertDescription>
          Open this URL directly. It is not listed in the sidebar, overview, or
          search. Anyone who knows the path can use it with the current session.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="email" className="mt-8 gap-0">
        <TabsList
          aria-label="Outbound test channels"
          variant="line"
          className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0"
        >
          <TabsTrigger
            value="email"
            className="rounded-none px-3 py-2 data-active:bg-transparent"
          >
            <Mail /> Email
          </TabsTrigger>
          <TabsTrigger
            value="slack"
            className="rounded-none px-3 py-2 data-active:bg-transparent"
          >
            <MessageSquare /> Slack
          </TabsTrigger>
          <TabsTrigger
            value="sahara"
            className="rounded-none px-3 py-2 data-active:bg-transparent"
          >
            Sahara
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="pt-6">
          <section className="rounded-2xl border bg-card p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-lg font-semibold">
                SMTP email
              </h2>
              <Badge variant={status.email.configured ? "secondary" : "destructive"}>
                {smtpLabel}
              </Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Sends through the same unauthenticated SMTP path as production
              notifications. Put a Slack channel email in To if you want that
              channel to receive this message.
            </p>
            <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={submitEmail}>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="email-from">From</FieldLabel>
                <Input
                  id="email-from"
                  type="email"
                  value={email.from}
                  onChange={(event) =>
                    setEmail({ ...email, from: event.target.value })
                  }
                  placeholder="no-reply@rythm.test.com"
                />
                <FieldDescription>
                  Defaults from SMTP_FROM / SMTP_FROM_EMAIL.
                </FieldDescription>
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="email-from-name">From name</FieldLabel>
                <Input
                  id="email-from-name"
                  value={email.fromName}
                  onChange={(event) =>
                    setEmail({ ...email, fromName: event.target.value })
                  }
                  placeholder="rythm_support"
                />
                <FieldDescription>Defaults from SMTP_FROM_NAME.</FieldDescription>
              </Field>
              <Field className="gap-1.5 md:col-span-2">
                <FieldLabel htmlFor="email-to">To</FieldLabel>
                <Input
                  id="email-to"
                  required
                  type="email"
                  value={email.to}
                  onChange={(event) =>
                    setEmail({ ...email, to: event.target.value })
                  }
                  placeholder="ops@example.com"
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="email-cc">CC</FieldLabel>
                <Input
                  id="email-cc"
                  value={email.cc}
                  onChange={(event) =>
                    setEmail({ ...email, cc: event.target.value })
                  }
                  placeholder="optional"
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="email-bcc">BCC</FieldLabel>
                <Input
                  id="email-bcc"
                  value={email.bcc}
                  onChange={(event) =>
                    setEmail({ ...email, bcc: event.target.value })
                  }
                  placeholder="optional"
                />
              </Field>
              <Field className="gap-1.5 md:col-span-2">
                <FieldLabel htmlFor="email-subject">Subject</FieldLabel>
                <Input
                  id="email-subject"
                  value={email.subject}
                  onChange={(event) =>
                    setEmail({ ...email, subject: event.target.value })
                  }
                />
              </Field>
              <Field className="gap-1.5 md:col-span-2">
                <FieldLabel htmlFor="email-body">Body</FieldLabel>
                <Textarea
                  id="email-body"
                  rows={6}
                  value={email.body}
                  onChange={(event) =>
                    setEmail({ ...email, body: event.target.value })
                  }
                />
              </Field>
              <div className="md:col-span-2">
                <Button disabled={emailPending} type="submit">
                  {emailPending ? <LoaderCircle className="animate-spin" /> : <Send />}
                  Send email
                </Button>
              </div>
            </form>
            <ResultAlert result={emailResult} />
          </section>
        </TabsContent>

        <TabsContent value="slack" className="pt-6">
          <section className="rounded-2xl border bg-card p-5 md:p-6">
            <h2 className="font-heading text-lg font-semibold">
              Slack via email
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Rhythm delivers Slack through the channel’s email address (Slack
              email-to-channel), not a chat webhook. This reuses the SMTP send
              path with To set to that address.
            </p>
            <form className="mt-5 grid gap-4" onSubmit={submitSlack}>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="slack-to">Slack channel email</FieldLabel>
                <Input
                  id="slack-to"
                  required
                  type="email"
                  value={slack.to}
                  onChange={(event) =>
                    setSlack({ ...slack, to: event.target.value })
                  }
                  placeholder="channel-name@company.slack.com"
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="slack-subject">Subject</FieldLabel>
                <Input
                  id="slack-subject"
                  value={slack.subject}
                  onChange={(event) =>
                    setSlack({ ...slack, subject: event.target.value })
                  }
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="slack-body">Message</FieldLabel>
                <Textarea
                  id="slack-body"
                  rows={6}
                  value={slack.body}
                  onChange={(event) =>
                    setSlack({ ...slack, body: event.target.value })
                  }
                />
              </Field>
              <div>
                <Button disabled={slackPending} type="submit">
                  {slackPending ? <LoaderCircle className="animate-spin" /> : <Send />}
                  Send to Slack email
                </Button>
              </div>
            </form>
            <ResultAlert result={slackResult} />
          </section>
        </TabsContent>

        <TabsContent value="sahara" className="pt-6">
          <section className="rounded-2xl border bg-card p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-lg font-semibold">
                Sahara incident
              </h2>
              <Badge variant={status.sahara.configured ? "secondary" : "destructive"}>
                {status.sahara.configured ? "Ingest configured" : "Ingest missing"}
              </Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Posts a test event through the Rhythm Sahara client so the ingest
              URL, timeout, and logging match production. {saharaLabel}.
            </p>
            <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={submitSahara}>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="sahara-assignment">
                  Assignment / support group
                </FieldLabel>
                <Input
                  id="sahara-assignment"
                  required
                  className="font-mono"
                  value={sahara.assignmentGroup}
                  onChange={(event) =>
                    setSahara({ ...sahara, assignmentGroup: event.target.value })
                  }
                  placeholder="DP_KMS_VRS_TKS_Support"
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="sahara-reporter">Reporter group</FieldLabel>
                <Input
                  id="sahara-reporter"
                  className="font-mono"
                  value={sahara.reporterGroup}
                  onChange={(event) =>
                    setSahara({ ...sahara, reporterGroup: event.target.value })
                  }
                  placeholder="Same as assignment group"
                />
                <FieldDescription>
                  Optional. Defaults to the assignment group.
                </FieldDescription>
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="sahara-environment">
                  Environment affected
                </FieldLabel>
                <Input
                  id="sahara-environment"
                  value={sahara.environmentAffected}
                  onChange={(event) =>
                    setSahara({
                      ...sahara,
                      environmentAffected: event.target.value,
                    })
                  }
                  placeholder="E3"
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="sahara-severity">
                  Ticketing severity
                </FieldLabel>
                <Select
                  value={sahara.severity}
                  onValueChange={(value) =>
                    setSahara({ ...sahara, severity: value ?? "Sev4" })
                  }
                >
                  <SelectTrigger id="sahara-severity" aria-label="Ticketing severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Sev1">Sev1</SelectItem>
                    <SelectItem value="Sev2">Sev2</SelectItem>
                    <SelectItem value="Sev3">Sev3</SelectItem>
                    <SelectItem value="Sev4">Sev4</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="gap-1.5 md:col-span-2">
                <FieldLabel htmlFor="sahara-generator">Event generator</FieldLabel>
                <Input
                  id="sahara-generator"
                  value={sahara.eventGenerator}
                  onChange={(event) =>
                    setSahara({ ...sahara, eventGenerator: event.target.value })
                  }
                  placeholder="Rhythm"
                />
              </Field>
              <Field className="gap-1.5 md:col-span-2">
                <FieldLabel htmlFor="sahara-summary">Summary</FieldLabel>
                <Input
                  id="sahara-summary"
                  value={sahara.summary}
                  onChange={(event) =>
                    setSahara({ ...sahara, summary: event.target.value })
                  }
                />
              </Field>
              <Field className="gap-1.5 md:col-span-2">
                <FieldLabel htmlFor="sahara-description">Description</FieldLabel>
                <Textarea
                  id="sahara-description"
                  rows={5}
                  value={sahara.description}
                  onChange={(event) =>
                    setSahara({ ...sahara, description: event.target.value })
                  }
                />
              </Field>
              <div className="md:col-span-2">
                <Button disabled={saharaPending || !status.sahara.configured} type="submit">
                  {saharaPending ? <LoaderCircle className="animate-spin" /> : <Send />}
                  Send Sahara event
                </Button>
              </div>
            </form>
            <ResultAlert result={saharaResult} />
          </section>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}

function ResultAlert({ result }: { result: TestNotificationResult | null }) {
  if (!result) return null
  return (
    <Alert className="mt-5" variant={result.ok ? "default" : "destructive"}>
      {result.ok ? <ShieldCheck /> : <CircleAlert />}
      <AlertTitle>{result.ok ? "Sent" : "Failed"}</AlertTitle>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  )
}
