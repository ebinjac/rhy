import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  FileCheck2,
  Gauge,
  KeyRound,
  Menu,
  Network,
  Rocket,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import marketingStylesheetUrl from "@/styles/rhythm-marketing.css?url"
import newsreaderLatinUrl from "@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2?url"

export const Route = createFileRoute("/rhythm")({
  head: () => ({
    meta: [
      {
        title: "Rhythm — Validate complete business API journeys",
      },
      {
        name: "description",
        content:
          "Rhythm helps American Express engineering teams build multi-step API monitors, diagnose failures, validate ELF logs, and release with evidence.",
      },
      {
        property: "og:title",
        content: "Rhythm — Validate the journey. Release with evidence.",
      },
      {
        property: "og:description",
        content:
          "Synthetic monitoring, incident-grade diagnostics, and before-and-after deployment validation for complete business API journeys.",
      },
    ],
    links: [
      { rel: "canonical", href: "/rhythm" },
      {
        rel: "preload",
        href: newsreaderLatinUrl,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: marketingStylesheetUrl },
    ],
  }),
  component: RhythmMarketingPage,
})

const journeyStages = [
  { label: "Request", detail: "POST /v1/payments", durationMs: 87 },
  { label: "Extract", detail: "authorization.id", durationMs: 12 },
  { label: "Assert", detail: "status = Approved", durationMs: 4 },
  { label: "ELF", detail: "0 blocking hits", durationMs: 64 },
  { label: "Gate", detail: "release allowed", durationMs: 0 },
] as const

const JOURNEY_TOTAL_MS = journeyStages.reduce(
  (sum, stage) => sum + stage.durationMs,
  0
)

const SCORE_PLAY_MS = 2800

const workflowSteps = [
  {
    title: "Build the journey",
    copy: "Compose requests, variables, scripts, extractors, assertions, authentication, proxies, and TLS in one workbench.",
  },
  {
    title: "Run it continuously",
    copy: "Publish a revision, choose a schedule, and execute through the right environment and agent.",
  },
  {
    title: "Diagnose precisely",
    copy: "See the failed step, attempt, check, network phase, and safe request or response evidence.",
  },
  {
    title: "Release with proof",
    copy: "Compare before and after performance, evaluate ELF logs, and produce a durable deployment decision.",
  },
] as const

const teams = [
  {
    title: "Application engineering",
    lede: "Prove that the business outcome works.",
    copy: "Test complete workflows with the same request controls, scripts, variables, and assertions your team needs during development.",
  },
  {
    title: "SRE and operations",
    lede: "Move from alert to evidence faster.",
    copy: "Trace failures to the exact step and phase, compare historical latency, and inspect masked execution evidence without hunting across tools.",
  },
  {
    title: "Release engineering",
    lede: "Turn validation into a release gate.",
    copy: "Capture a baseline, run post-deployment samples, add ELF checks, and share an auditable allow or block decision.",
  },
  {
    title: "Platform and security",
    lede: "Standardize validation safely.",
    copy: "Govern secrets, certificates, proxies, agents, revisions, retention, and audit evidence from a shared control plane.",
  },
] as const

function RhythmMarketingPage() {
  return (
    <div className="rhythm-marketing">
      <a className="rhythm-marketing__skip" href="#main-content">
        Skip to main content
      </a>

      <header className="rhythm-marketing__header">
        <div className="rhythm-marketing__nav-shell">
          <Link
            aria-label="Rhythm marketing home"
            className="rhythm-marketing__brand"
            to="/rhythm"
          >
            <AmexBrandMark className="rhythm-marketing__brand-mark" />
            <span className="rhythm-marketing__wordmark">Rhythm</span>
          </Link>

          <nav
            aria-label="Marketing navigation"
            className="rhythm-marketing__nav"
          >
            <a href="#capabilities">Capabilities</a>
            <a href="#how-it-works">How it works</a>
            <a href="#teams">Teams</a>
            <a href="#security">Security</a>
          </nav>

          <div className="rhythm-marketing__nav-actions">
            <a className="rhythm-marketing__docs-link" href="/docs">
              Docs
            </a>
            <ThemeToggle />
            <Link className="rhythm-button rhythm-button--primary" to="/">
              Open Rhythm
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>

          <details className="rhythm-marketing__mobile-menu">
            <summary>
              <Menu aria-hidden="true" />
              <span>Menu</span>
            </summary>
            <nav aria-label="Mobile marketing navigation">
              <a href="#capabilities">Capabilities</a>
              <a href="#how-it-works">How it works</a>
              <a href="#teams">Teams</a>
              <a href="#security">Security</a>
              <a href="/docs">Documentation</a>
              <Link to="/">Open Rhythm</Link>
              <div className="rhythm-marketing__mobile-theme">
                <span>Color mode</span>
                <ThemeToggle />
              </div>
            </nav>
          </details>
        </div>
      </header>

      <main id="main-content">
        <section className="rhythm-hero" aria-labelledby="rhythm-hero-title">
          <div className="rhythm-marketing__container rhythm-hero__mast">
            <h1 id="rhythm-hero-title">
              Validate the journey.
              <em>Release with evidence.</em>
            </h1>
            <div className="rhythm-hero__mast-end">
              <p className="rhythm-hero__lede">
                Synthetic monitoring for complete business API journeys—from the
                first request to the final deployment gate.
              </p>
              <div className="rhythm-hero__actions">
                <Link className="rhythm-button rhythm-button--primary" to="/">
                  Open Rhythm
                  <ArrowRight aria-hidden="true" />
                </Link>
                <a
                  className="rhythm-button rhythm-button--secondary"
                  href="/docs"
                >
                  Read documentation
                </a>
              </div>
            </div>
          </div>

          <div className="rhythm-marketing__container">
            <JourneyScore />
          </div>
        </section>

        <section className="rhythm-proof" aria-labelledby="rhythm-proof-title">
          <div className="rhythm-marketing__container">
            <h2 id="rhythm-proof-title">
              An endpoint can be up while the journey is broken.
            </h2>
            <p className="rhythm-proof__lede">
              A successful HTTP response does not prove that an identifier was
              extracted, a downstream request used it, the business outcome
              was recorded, or the release is safe.
            </p>

            <div className="rhythm-proof__instrument">
              <div className="rhythm-proof__request-row">
                <span className="rhythm-proof__method">POST</span>
                <code>/v1/payments/authorize</code>
                <span>200 OK</span>
              </div>

              <div className="rhythm-proof__readings">
                <article aria-label="Endpoint-only validation example">
                  <h3>Endpoint check</h3>
                  <div className="rhythm-proof__outcome rhythm-proof__outcome--failed">
                    <XCircle aria-hidden="true" />
                    <div>
                      <strong>Business outcome unknown</strong>
                      <span>Authorization was not verified downstream.</span>
                    </div>
                  </div>
                </article>

                <article aria-label="Rhythm journey validation example">
                  <h3>Rhythm journey</h3>
                  <div className="rhythm-proof__mini-trace" aria-hidden="true">
                    {["Request", "Extract", "Assert", "ELF", "Gate"].map(
                      (label) => (
                        <div key={label}>
                          <Check />
                          <span>{label}</span>
                        </div>
                      )
                    )}
                  </div>
                  <div className="rhythm-proof__outcome rhythm-proof__outcome--verified">
                    <CheckCircle2 aria-hidden="true" />
                    <div>
                      <strong>Business outcome verified</strong>
                      <span>
                        Authorization captured, asserted, and observed.
                      </span>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section
          className="rhythm-capabilities"
          id="capabilities"
          aria-labelledby="rhythm-capabilities-title"
        >
          <div className="rhythm-marketing__container">
            <div className="rhythm-capabilities__intro">
              <h2 id="rhythm-capabilities-title">
                Build the request. Prove the outcome.
              </h2>
              <p>
                Rhythm brings authoring, execution evidence, log checks, and
                release validation into one coherent workflow.
              </p>
            </div>

            <CapabilityAuthoring />
            <CapabilityDiagnostics />
            <CapabilityDeployment />
          </div>
        </section>

        <section
          className="rhythm-workflow"
          id="how-it-works"
          aria-labelledby="rhythm-workflow-title"
        >
          <div className="rhythm-marketing__container">
            <h2 id="rhythm-workflow-title">
              One evidence chain from design to deployment.
            </h2>
            <ol className="rhythm-workflow__steps">
              {workflowSteps.map((step) => (
                <li key={step.title}>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="rhythm-teams"
          id="teams"
          aria-labelledby="rhythm-teams-title"
        >
          <div className="rhythm-marketing__container rhythm-teams__layout">
            <div className="rhythm-teams__heading">
              <h2 id="rhythm-teams-title">
                Shared evidence. Clear decisions. Fewer handoffs.
              </h2>
              <p>
                Each team gets the depth it needs without creating another
                disconnected source of truth.
              </p>
            </div>

            <div className="rhythm-teams__list">
              {teams.map((team) => (
                <article key={team.title}>
                  <h3>{team.title}</h3>
                  <p className="rhythm-teams__lede">{team.lede}</p>
                  <p>{team.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="rhythm-security"
          id="security"
          aria-labelledby="rhythm-security-title"
        >
          <div className="rhythm-marketing__container rhythm-security__layout">
            <div className="rhythm-security__copy">
              <h2 id="rhythm-security-title">
                Deep evidence without exposing sensitive data.
              </h2>
              <p>
                Rhythm treats masking, scoped access, revision history, and
                auditable execution context as product behavior—not an
                afterthought.
              </p>
              <a className="rhythm-security__link" href="/docs">
                Explore the security model
                <ArrowRight aria-hidden="true" />
              </a>
            </div>

            <ul className="rhythm-security__controls">
              <SecurityControl
                icon={KeyRound}
                title="Secret-safe execution"
                copy="Reference managed secrets without exposing their values in definitions, evidence, or logs."
              />
              <SecurityControl
                icon={Network}
                title="Controlled network paths"
                copy="Use approved proxies, TLS profiles, target policies, and execution agents."
              />
              <SecurityControl
                icon={FileCheck2}
                title="Immutable evidence"
                copy="Tie every run and deployment decision to the exact published revision and context."
              />
              <SecurityControl
                icon={Database}
                title="Policy-aware retention"
                copy="Keep useful summaries while masking and expiring bounded evidence according to policy."
              />
            </ul>
          </div>
        </section>

        <section
          className="rhythm-final-cta"
          aria-labelledby="rhythm-final-title"
        >
          <JourneyWaveform className="rhythm-final-cta__wave" decorative />
          <div className="rhythm-marketing__container rhythm-final-cta__content">
            <h2 id="rhythm-final-title">
              Replace assumptions with execution evidence.
            </h2>
            <div>
              <Link className="rhythm-button rhythm-button--on-deep" to="/">
                Open Rhythm
                <ArrowRight aria-hidden="true" />
              </Link>
              <a
                className="rhythm-button rhythm-button--ghost-on-deep"
                href="/docs"
              >
                Read documentation
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="rhythm-marketing__footer">
        <div className="rhythm-marketing__container">
          <Link
            aria-label="Rhythm marketing home"
            className="rhythm-marketing__brand rhythm-marketing__brand--footer"
            to="/rhythm"
          >
            <AmexBrandMark className="rhythm-marketing__brand-mark" />
            <span className="rhythm-marketing__wordmark">Rhythm</span>
          </Link>
          <p>Validate complete business API journeys.</p>
          <nav aria-label="Footer navigation">
            <Link to="/">Product</Link>
            <a href="/docs">Documentation</a>
            <a href="#main-content">Back to top</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}

function JourneyScore() {
  const [runId, setRunId] = useState(0)
  const [elapsed, setElapsed] = useState(JOURNEY_TOTAL_MS)
  const [complete, setComplete] = useState(true)
  const rootRef = useRef<HTMLElement>(null)
  const frameRef = useRef<number>(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const animations = () => root.getAnimations({ subtree: true })
    const observer = new IntersectionObserver(
      ([entry]) => {
        for (const animation of animations()) {
          if (entry?.isIntersecting) {
            animation.play()
          } else {
            animation.pause()
          }
        }
      },
      { threshold: 0.2 }
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [runId])

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (media.matches) {
      setElapsed(JOURNEY_TOTAL_MS)
      setComplete(true)
      return
    }

    if (runId === 0) {
      setElapsed(0)
      setComplete(false)
    }

    const started = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / SCORE_PLAY_MS)
      setElapsed(Math.round(progress * JOURNEY_TOTAL_MS))
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(tick)
        return
      }
      setElapsed(JOURNEY_TOTAL_MS)
      setComplete(true)
    }
    frameRef.current = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [runId])

  return (
    <aside
      ref={rootRef}
      className="rhythm-score"
      aria-label="Example verified journey"
      data-complete={complete ? "true" : "false"}
    >
      <div className="rhythm-score__status">
        <div>
          <strong>Payment authorize</strong>
          <p aria-live="polite">
            {complete
              ? "Journey verified"
              : "Illustrative run in progress"}
          </p>
        </div>
        <div className="rhythm-score__status-end">
          <time dateTime={`PT${(elapsed / 1000).toFixed(3)}S`}>
            {elapsed} ms
          </time>
          <span
            className="rhythm-score__badge"
            data-visible={complete ? "true" : "false"}
          >
            <Check aria-hidden="true" />
            Passed
          </span>
        </div>
      </div>

      <div className="rhythm-score__run" key={runId}>
        <JourneyWaveform />

        <ol className="rhythm-score__stages">
          {journeyStages.map((stage, index) => {
            const arrivedAt =
              journeyStages
                .slice(0, index)
                .reduce((sum, item) => sum + item.durationMs, 0) /
              JOURNEY_TOTAL_MS
            return (
              <li
                className="rhythm-score__stage"
                key={stage.label}
                style={
                  {
                    "--stage-delay": `${arrivedAt * SCORE_PLAY_MS}ms`,
                  } as React.CSSProperties
                }
              >
                <span className="rhythm-score__dot" aria-hidden="true">
                  <Check />
                </span>
                <strong>{stage.label}</strong>
                <span>{stage.detail}</span>
                <time>
                  {stage.durationMs > 0 ? `${stage.durationMs} ms` : "Passed"}
                </time>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="rhythm-score__caption">
        <p>Illustrative execution evidence · {JOURNEY_TOTAL_MS} ms total</p>
        <button
          className="rhythm-score__replay"
          onClick={() => {
            setRunId((value) => value + 1)
            setElapsed(0)
            setComplete(false)
          }}
          type="button"
        >
          Replay run
        </button>
      </div>
    </aside>
  )
}

function JourneyWaveform({
  className,
  decorative = false,
}: {
  className?: string
  decorative?: boolean
}) {
  const clipId = useId().replace(/:/g, "")
  const measured = journeyStages.map((stage) =>
    Math.max(stage.durationMs, stage.label === "Gate" ? 18 : 0)
  )
  const max = Math.max(...measured)
  const width = 1000
  const height = 88
  const padX = 8
  const padY = 10
  const usableH = height - padY * 2
  const segment = (width - padX * 2) / measured.length

  const commands: string[] = []
  measured.forEach((duration, index) => {
    const x0 = padX + index * segment
    const x1 = x0 + segment
    const y = padY + (1 - duration / max) * usableH
    if (index === 0) {
      commands.push(`M ${x0.toFixed(1)} ${y.toFixed(1)}`)
    } else {
      commands.push(`V ${y.toFixed(1)}`)
    }
    commands.push(`H ${x1.toFixed(1)}`)
  })
  const path = commands.join(" ")
  const area = `${path} V ${height - padY} H ${padX} Z`

  return (
    <svg
      aria-hidden={decorative || undefined}
      className={className ?? "rhythm-score__wave"}
      fill="none"
      preserveAspectRatio="none"
      role={decorative ? "presentation" : "img"}
      viewBox={`0 0 ${width} ${height}`}
    >
      {!decorative ? (
        <title>Latency profile for the illustrative payment authorize journey</title>
      ) : null}
      <defs>
        <clipPath id={`${clipId}-draw`}>
          <rect
            className="rhythm-score__draw"
            height={height}
            width={width}
            x="0"
            y="0"
          />
        </clipPath>
      </defs>
      <path
        className="rhythm-score__wave-ghost"
        d={path}
        vectorEffect="non-scaling-stroke"
      />
      <g clipPath={`url(#${clipId}-draw)`}>
        <path className="rhythm-score__wave-fill" d={area} />
        <path
          className="rhythm-score__wave-line"
          d={path}
          vectorEffect="non-scaling-stroke"
        />
      </g>
      <rect
        className="rhythm-score__playhead"
        height={height}
        width="2"
        x="0"
        y="0"
      />
    </svg>
  )
}

function CapabilityAuthoring() {
  return (
    <article className="rhythm-feature rhythm-feature--authoring">
      <div className="rhythm-feature__copy">
        <h3>Express the complete API workflow.</h3>
        <p>
          Build multi-step monitors with parameters, headers, cookies, auth,
          bodies, proxies, TLS, scripts, variables, extractors, and assertions
          in a Postman-style workbench.
        </p>
        <ul>
          <li>
            <Check aria-hidden="true" />
            JavaScript pre-request and test sandbox
          </li>
          <li>
            <Check aria-hidden="true" />
            Secret and workflow-variable intelligence
          </li>
          <li>
            <Check aria-hidden="true" />
            Published revisions for reproducible execution
          </li>
        </ul>
      </div>

      <div
        className="rhythm-workbench-preview"
        aria-label="Request workbench preview"
      >
        <div className="rhythm-workbench-preview__tabs">
          <span>Request</span>
          <span>Pre-request</span>
          <span>Checks</span>
          <span>Network</span>
        </div>
        <div className="rhythm-workbench-preview__composer">
          <strong>POST</strong>
          <code>{"{{baseUrl}}/v1/orders"}</code>
          <span>Send</span>
        </div>
        <div className="rhythm-workbench-preview__content">
          <div>
            <span>Headers</span>
            <code>Content-Type</code>
            <code>application/json</code>
          </div>
          <div>
            <span>Body</span>
            <pre>
              <code>{`{
  "customerId": "{{customerId}}",
  "traceId": "{{traceId}}",
  "amount": {{orderAmount}}
}`}</code>
            </pre>
          </div>
          <div className="rhythm-workbench-preview__variables">
            <span>Variables available</span>
            <strong>18</strong>
          </div>
        </div>
      </div>
    </article>
  )
}

function CapabilityDiagnostics() {
  const phases = [
    ["DNS", "5 ms", "4%"],
    ["TCP", "18 ms", "14%"],
    ["TLS", "24 ms", "19%"],
    ["Write", "3 ms", "3%"],
    ["Server wait", "61 ms", "48%"],
    ["Download", "16 ms", "12%"],
  ] as const

  return (
    <article className="rhythm-feature rhythm-feature--diagnostics">
      <div
        className="rhythm-diagnostics-preview"
        aria-label="Run diagnostics preview"
      >
        <div className="rhythm-diagnostics-preview__header">
          <div>
            <Gauge aria-hidden="true" />
            <span>
              <strong>API response time</strong>
              <small>Network phases only</small>
            </span>
          </div>
          <strong>127 ms</strong>
        </div>
        <div className="rhythm-diagnostics-preview__bar" aria-hidden="true">
          {phases.map(([phase, , share]) => (
            <span
              key={phase}
              style={{ "--phase-share": share } as React.CSSProperties}
            />
          ))}
        </div>
        <dl>
          {phases.map(([phase, duration]) => (
            <div key={phase}>
              <dt>{phase}</dt>
              <dd>{duration}</dd>
            </div>
          ))}
        </dl>
        <div className="rhythm-diagnostics-preview__finding">
          <TerminalSquare aria-hidden="true" />
          <div>
            <strong>Slowest phase: server wait</strong>
            <span>
              The target spent 61 ms producing the first response byte.
            </span>
          </div>
        </div>
      </div>

      <div className="rhythm-feature__copy">
        <h3>Know what failed, where, and why.</h3>
        <p>
          Inspect every step, retry, timing phase, extractor, assertion, and
          structured event without exposing secret values. Incident-grade
          diagnostics stay on the API path, not the executor overhead.
        </p>
        <ul>
          <li>
            <Check aria-hidden="true" />
            API-only response time separated from execution overhead
          </li>
          <li>
            <Check aria-hidden="true" />
            p50, p95, p99, regressions, and spike navigation
          </li>
          <li>
            <Check aria-hidden="true" />
            Safe failure evidence and stable diagnostic help codes
          </li>
        </ul>
      </div>
    </article>
  )
}

function CapabilityDeployment() {
  return (
    <article className="rhythm-feature rhythm-feature--deployment">
      <div className="rhythm-feature__copy">
        <h3>Compare before and after. Gate with confidence.</h3>
        <p>
          Capture an immutable performance baseline, run post-deployment
          samples, evaluate ELF logs, and publish one durable decision.
        </p>
        <ul>
          <li>
            <Check aria-hidden="true" />
            Monitor and HTTP-step performance comparison
          </li>
          <li>
            <Check aria-hidden="true" />
            Blocking and advisory ELF log checks
          </li>
          <li>
            <Check aria-hidden="true" />
            Persistent report with decision reasons and evidence links
          </li>
        </ul>
      </div>

      <div
        className="rhythm-deployment-preview"
        aria-label="Deployment validation preview"
      >
        <div className="rhythm-deployment-preview__decision">
          <div>
            <Rocket aria-hidden="true" />
            <span>
              <small>Deployment decision</small>
              <strong>Allow</strong>
            </span>
          </div>
          <CheckCircle2 aria-hidden="true" />
        </div>
        <div className="rhythm-deployment-preview__comparison">
          <div>
            <span>Baseline p95</span>
            <strong>248 ms</strong>
            <small>Previous 24 hours</small>
          </div>
          <ArrowRight aria-hidden="true" />
          <div>
            <span>Post-deployment p95</span>
            <strong>231 ms</strong>
            <small>10 active samples</small>
          </div>
        </div>
        <div className="rhythm-deployment-preview__checks">
          <div>
            <Activity aria-hidden="true" />
            <span>
              <strong>Monitor performance</strong>
              <small>No meaningful regression</small>
            </span>
            <CheckCircle2 aria-hidden="true" />
          </div>
          <div>
            <Database aria-hidden="true" />
            <span>
              <strong>ELF deployment logs</strong>
              <small>0 blocking hits</small>
            </span>
            <CheckCircle2 aria-hidden="true" />
          </div>
        </div>
        <p>Illustrative deployment evidence</p>
      </div>
    </article>
  )
}

function SecurityControl({
  icon: Icon,
  title,
  copy,
}: {
  icon: typeof ShieldCheck
  title: string
  copy: string
}) {
  return (
    <li>
      <Icon aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>{copy}</span>
      </div>
    </li>
  )
}

function AmexBrandMark({ className }: { className?: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      decoding="async"
      height={48}
      src="/brand-logo.png"
      width={48}
    />
  )
}
