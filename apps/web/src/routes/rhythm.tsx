import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
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

import { ThemeToggle } from "@/components/app-shell/theme-toggle"
import "@/styles/rhythm-marketing.css"

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
    links: [{ rel: "canonical", href: "/rhythm" }],
  }),
  component: RhythmMarketingPage,
})

const journeyStages = [
  { label: "Request", detail: "POST /v1/payments", duration: "87 ms" },
  { label: "Extract", detail: "authorization.id", duration: "12 ms" },
  { label: "Assert", detail: "status = Approved", duration: "4 ms" },
  { label: "ELF", detail: "0 blocking hits", duration: "64 ms" },
  { label: "Gate", detail: "release allowed", duration: "Passed" },
] as const

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
    label: "Application engineering",
    title: "Prove that the business outcome works.",
    copy: "Test complete workflows with the same request controls, scripts, variables, and assertions your team needs during development.",
  },
  {
    label: "SRE and operations",
    title: "Move from alert to evidence faster.",
    copy: "Trace failures to the exact step and phase, compare historical latency, and inspect masked execution evidence without hunting across tools.",
  },
  {
    label: "Release engineering",
    title: "Turn validation into a release gate.",
    copy: "Capture a baseline, run post-deployment samples, add ELF checks, and share an auditable allow or block decision.",
  },
  {
    label: "Platform and security",
    title: "Standardize validation safely.",
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
          <div className="rhythm-hero__atmosphere" aria-hidden="true" />
          <div className="rhythm-marketing__container rhythm-hero__layout">
            <div className="rhythm-hero__copy">
              <h1 id="rhythm-hero-title">
                Validate the journey.
                <span className="rhythm-hero__headline-line">
                  Release with evidence.
                </span>
              </h1>
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

            <div className="rhythm-hero__visual">
              <JourneyEvidence />
            </div>
          </div>
        </section>

        <section className="rhythm-proof" aria-labelledby="rhythm-proof-title">
          <div className="rhythm-marketing__container rhythm-proof__layout">
            <div className="rhythm-proof__copy">
              <p className="rhythm-marketing__eyebrow">
                Beyond endpoint checks
              </p>
              <h2 id="rhythm-proof-title">
                An endpoint can be up while the journey is broken.
              </h2>
              <p>
                A successful HTTP response does not prove that an identifier was
                extracted, a downstream request used it, the business outcome
                was recorded, or the release is safe.
              </p>
            </div>

            <div className="rhythm-proof__comparison">
              <article aria-label="Endpoint-only validation example">
                <div className="rhythm-proof__comparison-heading">
                  <span>Endpoint check only</span>
                  <XCircle aria-hidden="true" />
                </div>
                <div className="rhythm-proof__request-row">
                  <span className="rhythm-proof__method">POST</span>
                  <code>/v1/payments/authorize</code>
                  <span>200 OK</span>
                </div>
                <div className="rhythm-proof__outcome rhythm-proof__outcome--failed">
                  <XCircle aria-hidden="true" />
                  <div>
                    <strong>Business outcome unknown</strong>
                    <span>Authorization was not verified downstream.</span>
                  </div>
                </div>
              </article>

              <ChevronRight
                aria-hidden="true"
                className="rhythm-proof__arrow"
              />

              <article aria-label="Rhythm journey validation example">
                <div className="rhythm-proof__comparison-heading">
                  <span>Rhythm journey validation</span>
                  <CheckCircle2 aria-hidden="true" />
                </div>
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
                    <span>Authorization captured, asserted, and observed.</span>
                  </div>
                </div>
              </article>
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
              <div>
                <p className="rhythm-marketing__eyebrow">Complete validation</p>
                <h2 id="rhythm-capabilities-title">
                  Build the request. Prove the outcome.
                </h2>
              </div>
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
            <div className="rhythm-workflow__heading">
              <p className="rhythm-marketing__eyebrow">How it works</p>
              <h2 id="rhythm-workflow-title">
                One evidence chain from design to deployment.
              </h2>
            </div>
            <ol className="rhythm-workflow__steps">
              {workflowSteps.map((step, index) => (
                <li key={step.title}>
                  <div className="rhythm-workflow__step-top">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
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
              <p className="rhythm-marketing__eyebrow">Built across teams</p>
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
                <article key={team.label}>
                  <div>
                    <p>{team.label}</p>
                    <h3>{team.title}</h3>
                    <p>{team.copy}</p>
                  </div>
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
              <div className="rhythm-security__icon">
                <ShieldCheck aria-hidden="true" />
              </div>
              <p className="rhythm-marketing__eyebrow">Governed by design</p>
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
          <div className="rhythm-final-cta__signal" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="rhythm-marketing__container rhythm-final-cta__content">
            <p>Ready when your journey is.</p>
            <h2 id="rhythm-final-title">
              Replace assumptions with execution evidence.
            </h2>
            <div>
              <Link className="rhythm-button rhythm-button--on-deep" to="/">
                Open Rhythm
                <ArrowRight aria-hidden="true" />
              </Link>
              <a className="rhythm-button rhythm-button--ghost-on-deep" href="/docs">
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

function JourneyEvidence() {
  return (
    <aside className="rhythm-evidence" aria-label="Example verified journey">
      <div className="rhythm-evidence__rail" aria-hidden="true" />
      <div className="rhythm-evidence__status">
        <div>
          <p className="rhythm-evidence__kicker">Payment authorize</p>
          <strong>Journey verified</strong>
        </div>
        <span className="rhythm-evidence__badge">
          <Check aria-hidden="true" />
          Passed
        </span>
      </div>

      <ol className="rhythm-evidence__timeline">
        {journeyStages.map((stage, index) => (
          <li className="rhythm-evidence__stage" key={stage.label}>
            <span className="rhythm-evidence__index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="rhythm-evidence__stage-body">
              <div>
                <strong>{stage.label}</strong>
                <span>{stage.detail}</span>
              </div>
              <time>{stage.duration}</time>
            </div>
            <span className="rhythm-evidence__dot" aria-hidden="true">
              <Check />
            </span>
          </li>
        ))}
      </ol>

      <p className="rhythm-evidence__caption">
        Illustrative execution evidence · 167 ms total
      </p>
    </aside>
  )
}

function CapabilityAuthoring() {
  return (
    <article className="rhythm-feature rhythm-feature--authoring">
      <div className="rhythm-feature__copy">
        <span className="rhythm-feature__number">01</span>
        <p className="rhythm-marketing__eyebrow">Postman-style authoring</p>
        <h3>Express the complete API workflow.</h3>
        <p>
          Build multi-step monitors with parameters, headers, cookies, auth,
          bodies, proxies, TLS, scripts, variables, extractors, and assertions.
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
        <span className="rhythm-feature__number">02</span>
        <p className="rhythm-marketing__eyebrow">Incident-grade diagnostics</p>
        <h3>Know what failed, where, and why.</h3>
        <p>
          Inspect every step, retry, timing phase, extractor, assertion, and
          structured event without exposing secret values.
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
        <span className="rhythm-feature__number">03</span>
        <p className="rhythm-marketing__eyebrow">Deployment validation</p>
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
