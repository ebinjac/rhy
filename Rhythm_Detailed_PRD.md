# Product Requirements Document: Rhythm

## Synthetic API Monitoring, Workflow Validation, and Deployment Assurance Platform

**Product name:** Rhythm  
**Document type:** Detailed Product Requirements Document  
**Document status:** Proposed  
**Primary release:** Rhythm v1  
**Frontend:** TanStack Start + React + TypeScript + shadcn/ui  
**Backend:** Go  
**Primary database:** PostgreSQL  
**Queue and coordination:** Redis  

---

## 1. Executive Summary

Rhythm is a self-service synthetic API monitoring and validation platform for creating, scheduling, and diagnosing real API workflows.

Unlike a basic uptime monitor that calls one URL, Rhythm must support complete request journeys such as:

1. Loading configuration and secret references.
2. Reading a client certificate and private key.
3. Generating a timestamp, nonce, UUID, or correlation ID.
4. Generating and signing a JWT.
5. Calling an identity provider to fetch an access token.
6. Extracting the token from the response.
7. Building a dynamic JSON, XML, text, or form body.
8. Generating an HMAC signature from the final request content.
9. Routing the request through an HTTP, HTTPS, or SOCKS proxy.
10. Calling one or more protected APIs in sequence.
11. Extracting response values and reusing them in later requests.
12. Validating status, headers, body, schema, timing, TLS, and business outcomes.
13. Recording safe, masked diagnostics at monitor, step, request, and assertion level.
14. Alerting only when an actionable failure condition is met.

Rhythm is designed as a workflow engine rather than a collection of hard-coded monitor types. The same execution model should later support deployment validation, Dynatrace metric gates, infrastructure checks, certificate-expiry checks, DNS/TCP checks, and release assurance without replacing the core engine.

---

## 2. Product Naming

The product name is **Rhythm**.

Recommended display name:

```text
Rhythm
Synthetic Monitoring & Validation
```

Recommended short description:

```text
Build, run, and observe real API journeys.
```

Naming rules:

- Use `Rhythm` in all user-facing text.
- Use `rhythm` for repository names, service names, API prefixes, database names, secret paths, Kubernetes resources, and telemetry attributes.
- Use `Rhythm` consistently in all new code, schemas, examples, and documentation.

Example technical names:

```text
rhythm-web
rhythm-api
rhythm-scheduler
rhythm-worker
rhythm-agent
rhythm-postgres
rhythm-redis
secret/data/rhythm/<environment>/<application>
```

---

## 3. Product Vision

Rhythm should become the central validation platform used to answer four questions:

```text
Is the service reachable?
Does the complete business API journey work?
Is the response technically and functionally correct?
Did a deployment preserve application health and performance?
```

Rhythm should make advanced synthetic validation configurable through a safe user interface rather than requiring a new script or custom service for every application.

---

## 4. Problem Statement

Traditional endpoint monitoring is insufficient for modern services because a successful API check may depend on authentication, request signing, secrets, network routing, certificates, dynamic data, and previous API responses.

Current alternatives create several problems:

- Teams maintain custom scripts with inconsistent logging and security controls.
- Secrets and tokens are frequently embedded in code or CI variables.
- Proxy and certificate configuration differs between tools.
- Complex Postman collections are difficult to operate as reliable production monitors.
- Failure reports show only that a request failed, not which prerequisite or assertion failed.
- Response values cannot always be safely propagated across calls.
- Monitoring logic is not versioned, governed, or auditable.
- Release validation is separate from continuous synthetic monitoring.
- Raw request and response logging can accidentally expose credentials or personal data.

Rhythm solves these problems using a secure, deterministic workflow builder and a distributed execution engine.

---

## 5. Product Principles

### 5.1 Workflow first

Every monitor is an ordered workflow composed of reusable step types. Simple endpoint monitoring is represented as a one-step workflow.

### 5.2 Secure by default

Secrets, tokens, private keys, cookies, signatures, and configured sensitive fields are masked before data leaves the worker process.

### 5.3 Configuration over custom code

Common behavior must be available as typed actions, extractors, assertions, authentication profiles, certificate profiles, and proxy profiles.

### 5.4 Safe extensibility

Advanced users may use a sandboxed script step, but scripts must not receive filesystem access, unrestricted networking, process access, or unbounded CPU and memory.

### 5.5 Explain every failure

Each failed run should identify:

```text
What failed
Where it failed
Why it failed
What was expected
What was received
Whether the failure is retriable
Which configuration area should be checked
```

### 5.6 Reusable configuration

Proxy, certificate, authentication, secret, environment, notification, and validation configurations should be reusable across monitors.

### 5.7 Immutable execution evidence

Each run must reference the exact monitor revision that was executed. Editing a monitor must not alter historical run interpretation.

### 5.8 Operationally quiet

Alerts should represent incidents or policy violations, not every temporary request failure.

---

## 6. Goals

Rhythm v1 must allow users to:

- Create and manage synthetic monitors.
- Build sequential, multi-step API journeys.
- Call one API before another.
- Generate JWTs using HMAC or asymmetric signing.
- Fetch OAuth access tokens.
- Generate timestamps, UUIDs, nonces, random strings, and correlation IDs.
- Generate HMAC signatures from configurable canonical input.
- Build dynamic request URLs, headers, query parameters, and bodies.
- Use values from variables, secrets, generated data, and previous steps.
- Extract values from JSON, XML, text, headers, cookies, URLs, and status metadata.
- Use client certificates for mutual TLS.
- Configure CA bundles, trust behavior, TLS versions, SNI, and certificate validation.
- Use HTTP, HTTPS CONNECT, and SOCKS5 proxies where supported by an execution agent.
- Configure proxy authentication and no-proxy rules.
- Apply assertions to technical and business response data.
- Schedule workflows and run them manually.
- Run checks from one or more execution agents.
- View safe request, response, assertion, extraction, certificate, proxy, and timing diagnostics.
- Retry only eligible failures using configurable backoff.
- Alert through email, Slack webhook, and generic webhook.
- Auto-resolve alerts when recovery criteria are met.
- Version monitor configuration.
- Audit configuration and secret-reference changes.
- Export and import a Rhythm-native monitor definition.

---

## 7. Non-Goals for Rhythm v1

The following are not required for the first production release:

- General-purpose load testing.
- Browser synthetic monitoring.
- Full Postman collection compatibility.
- Full OpenAPI-based monitor generation.
- Arbitrary operating-system commands.
- Unrestricted JavaScript execution.
- Packet capture.
- Permanent storage of complete unmasked bodies.
- Full incident management replacement.
- Full secrets-manager replacement.
- Global public monitoring locations operated by Rhythm.
- Advanced AI diagnosis or monitor generation.
- Native ServiceNow incident creation.
- Full Kubernetes deployment orchestration.

The architecture must nevertheless permit later addition of these capabilities where appropriate.

---

## 8. Personas

### 8.1 Site Reliability Engineer

Needs to create production-grade monitors, diagnose failures quickly, compare performance, and prevent alert noise.

### 8.2 Application Engineer

Needs to validate that a protected API journey works using the same authentication and request-signing logic used by the application.

### 8.3 Platform Engineer

Needs reusable certificate, proxy, secret, environment, and execution-agent configuration.

### 8.4 Release Engineer

Needs to execute a group of validations before and after a deployment and decide whether a release can proceed.

### 8.5 Security Engineer

Needs assurance that private keys, tokens, secret values, and sensitive response fields are not displayed or persisted insecurely.

### 8.6 Read-only Operator

Needs to inspect monitor state, active alerts, and run details without changing configuration.

---

## 9. Primary Use Cases

### UC-01: Simple health endpoint

Call `GET /health`, assert status 200, body status `UP`, and response time under 2 seconds.

### UC-02: OAuth client credentials

Call a token endpoint using client ID and client secret, extract `access_token`, call the protected endpoint, and validate the response.

### UC-03: JWT client assertion

Generate an RS256-signed JWT using a secret-managed private key, exchange it for an access token, and call the target API.

### UC-04: HMAC-signed API

Generate a timestamp and nonce, build a canonical request string, calculate HMAC-SHA256, add the signature to a header, and call the API.

### UC-05: Mutual TLS API

Use a client certificate and private key, validate the server certificate against a configured CA bundle, and record safe TLS diagnostics.

### UC-06: Proxied internal service

Send a request through an authenticated corporate proxy while excluding internal hosts using no-proxy rules.

### UC-07: Dynamic transaction journey

Create an entity, extract its ID, query it, update it, validate the final state, and optionally delete it during cleanup.

### UC-08: Deployment validation

Trigger a monitor suite after deployment, compare API outcomes and performance with a baseline, and optionally validate Dynatrace CPU and memory gates.

### UC-09: Certificate policy check

Inspect the remote server certificate and fail or warn when it is expired, untrusted, hostname-invalid, uses a prohibited protocol, or is within an expiry threshold.

---

## 10. Product Scope

Rhythm consists of the following product modules.

### 10.1 Monitor Management

Create, edit, clone, enable, disable, archive, version, import, export, and run monitors.

### 10.2 Workflow Builder

Configure steps, actions, data dependencies, assertions, extractors, failure behavior, retry behavior, and cleanup steps.

### 10.3 Configuration Library

Manage reusable:

- Environments.
- Variables.
- Secret references.
- Authentication profiles.
- Certificate profiles.
- Proxy profiles.
- Notification channels.
- Execution agents.
- Assertion templates.

### 10.4 Execution Platform

Schedule, queue, lock, execute, retry, cancel, mask, persist, and summarize monitor runs.

### 10.5 Observability and Diagnostics

Dashboard, run history, step timeline, request timing, failure categorization, alert state, trends, and execution-agent health.

### 10.6 Validation Suites

Group multiple monitors into an ordered or parallel validation suite for release and deployment assurance.

---

## 11. Core Domain Model

### 11.1 Monitor

A monitor defines when and how a synthetic workflow should run.

### 11.2 Monitor Revision

An immutable snapshot of a monitor definition. Every run points to a revision.

### 11.3 Step

One executable unit in a workflow.

### 11.4 Action

A controlled transformation or generation operation executed before or after a request.

### 11.5 Runtime Context

The in-memory, per-run data store containing variables, generated values, secret values, step outputs, cookies, and execution metadata.

### 11.6 Extractor

A rule that reads a value from a step result and stores it in runtime context.

### 11.7 Assertion

A rule that decides whether a step result is acceptable.

### 11.8 Environment

A named set of non-secret variables and bindings, such as Dev, Test, or Production.

### 11.9 Secret Reference

A pointer to a secret stored in Vault, another supported secret manager, or encrypted local storage.

### 11.10 Certificate Profile

A reusable configuration that defines client certificate material, trust material, and TLS behavior.

### 11.11 Proxy Profile

A reusable proxy endpoint, authentication reference, protocol, and bypass configuration.

### 11.12 Execution Agent

A worker or worker pool capable of reaching a specific network environment.

### 11.13 Run

One execution of a monitor revision.

### 11.14 Alert Instance

The lifecycle record for an active or resolved monitor problem.

---

## 12. Recommended Technology Stack

### 12.1 Frontend

```text
TanStack Start
React
TypeScript
Vite
TanStack Router
TanStack Query
TanStack Form or React Hook Form
Zod
Tailwind CSS
shadcn/ui
TanStack Table
Recharts
Monaco Editor for advanced JSON/XML/template editing
Lucide icons
```

TanStack Start responsibilities:

- Application shell and route composition.
- Server functions for frontend-to-backend orchestration where useful.
- Type-safe route parameters and search parameters.
- Server-side rendering for initial application shell and detail pages.
- Session-aware route guards.
- Streaming and deferred loading for large run details.

Frontend rules:

- The Go API remains the system-of-record API.
- TanStack Start server functions must not duplicate domain logic from Go.
- Secret values must never be returned to a browser.
- Query keys must include monitor ID, revision ID, run ID, filters, and environment where applicable.
- Forms must validate locally with Zod and again in Go.

### 12.2 Backend

```text
Go
Chi or Fiber
PostgreSQL
Redis
OpenTelemetry
Prometheus metrics
Structured JSON logging
```

Recommended service split:

```text
rhythm-api
rhythm-scheduler
rhythm-worker
rhythm-agent (optional remote worker distribution)
rhythm-notifier
```

For the initial deployment, scheduler, notifier, and worker may share one repository and deployment artifact while remaining separate commands.

### 12.3 Persistence

```text
PostgreSQL for configuration, revisions, runs, alerts, audit records, and summaries
Redis for queueing, distributed locks, idempotency, ephemeral cancellation state, and rate coordination
Object storage optionally for large masked artifacts and long-term exports
```

### 12.4 Secret Providers

Priority order:

1. HashiCorp Vault or enterprise internal secret manager.
2. Cloud secret managers through provider adapters.
3. Encrypted PostgreSQL storage for local development or tightly controlled MVP usage.

### 12.5 Deployment

```text
Docker or OCI images
Kubernetes for production
Helm or approved internal deployment packaging
PostgreSQL managed service or HA cluster
Redis managed service or HA cluster
```

---

## 13. High-Level Architecture

```text
+---------------------------------------------------------+
|                    TanStack Start UI                    |
| shadcn/ui | Router | Query | Forms | Run Diagnostics    |
+-----------------------------+---------------------------+
                              |
                              v
+---------------------------------------------------------+
|                       Rhythm API                        |
| Auth | CRUD | Validation | Revisions | Audit | RBAC     |
+--------------+--------------------------+---------------+
               |                          |
               v                          v
+---------------------------+   +-------------------------+
|        PostgreSQL         |   |          Redis          |
| Config, Runs, Alerts      |   | Queue, Locks, Cache     |
+---------------------------+   +------------+------------+
                                             |
                                             v
                                +-------------------------+
                                | Rhythm Scheduler        |
                                | Due-run calculation     |
                                +------------+------------+
                                             |
                                             v
                                +-------------------------+
                                | Rhythm Worker / Agent   |
                                | Resolver + Executors    |
                                | Masker + Assertions     |
                                +------+--------+---------+
                                       |        |
                          +------------+        +------------+
                          v                                  v
              +------------------------+       +------------------------+
              | Secrets / Certificates |       | Target APIs / Proxies |
              +------------------------+       +------------------------+
```

Optional deployment-validation integrations:

```text
CI/CD pipeline -> Rhythm suite trigger -> Synthetic workflows
                                      -> Dynatrace validation adapter
                                      -> Result and gate decision
```

---

## 14. Information Architecture and Routes

Recommended frontend routes:

```text
/
/dashboard
/monitors
/monitors/new
/monitors/$monitorId
/monitors/$monitorId/edit
/monitors/$monitorId/revisions
/monitors/$monitorId/runs
/runs/$runId
/suites
/suites/new
/suites/$suiteId
/environments
/secrets
/auth-profiles
/certificates
/proxies
/agents
/alerts
/audit
/settings
```

Recommended route sections:

- Overview.
- Configuration.
- Execution.
- Validation.
- Administration.

---

## 15. UX and Design Requirements

### 15.1 Visual Direction

Rhythm should feel like a modern reliability control plane rather than a generic CRUD dashboard.

Use:

- A calm dark or light neutral foundation.
- A restrained blue/cyan accent for active and healthy states.
- Amber for warning.
- Red only for actionable failures.
- Clear density controls for operational tables.
- Monospace typography only for technical values, request content, expressions, and identifiers.
- Strong visual hierarchy between monitor status, workflow structure, and diagnostics.

All components should use shadcn/ui primitives and application-specific wrappers.

### 15.2 Application Shell

The application shell should contain:

- Collapsible navigation.
- Global environment selector.
- Global search or command palette.
- Current execution-agent health indicator.
- Active alert indicator.
- User menu.
- Contextual page actions.

### 15.3 Monitor Builder Layout

Recommended desktop layout:

```text
Left: ordered workflow step navigator
Center: selected step configuration
Right: variable/output inspector and live validation panel
Bottom: test console and execution timeline
```

The builder should support:

- Drag-and-drop reordering.
- Keyboard reordering.
- Duplicate step.
- Disable step.
- Collapse groups.
- Search steps.
- Inline validation.
- Unsaved-change indicator.
- Auto-save draft with explicit publish action.
- JSON definition preview.
- Test selected step.
- Test from selected step.
- Test full workflow.

### 15.4 Safe Data Presentation

The UI must distinguish:

```text
Not captured
Captured and empty
Captured and masked
Captured and truncated
Unavailable due to policy
```

A masked value must never be revealed through hover, copy, DOM attributes, accessibility labels, export, or API payload.

---

## 16. Monitor Lifecycle

Monitor states:

```text
DRAFT
PUBLISHED
ENABLED
DISABLED
ARCHIVED
```

Lifecycle behavior:

- New monitors begin as draft.
- Publishing creates an immutable revision.
- Enabling schedules the latest published revision.
- Editing an enabled monitor changes the draft only until republished.
- Manual runs may execute the draft or latest published revision, but the selected mode must be explicit.
- Archiving disables future schedules but preserves history.
- Deleting should be soft-delete by default.

Required monitor actions:

```text
Create
Edit draft
Validate definition
Publish revision
Run draft
Run published
Enable
Disable
Clone
Export
Archive
Restore
Delete permanently (admin only)
```

---

## 17. Monitor Configuration

Required monitor fields:

```text
Name
Slug
Description
Owner
Tags
Environment binding
Execution agent or agent group
Schedule
Timezone
Overall timeout
Default step timeout
Default retry policy
Failure threshold
Recovery threshold
Concurrency policy
Alert policy
Data retention policy
Is enabled
```

Example:

```json
{
  "name": "Protected Payment API Journey",
  "slug": "protected-payment-api-journey",
  "description": "Generates a signed JWT, obtains an access token, signs the request, and validates the payment status API.",
  "environmentId": "env-prod",
  "agentGroupId": "agent-group-internal-prod",
  "schedule": {
    "type": "cron",
    "expression": "*/5 * * * *",
    "timezone": "Asia/Kolkata",
    "jitterSeconds": 15
  },
  "timeoutMs": 60000,
  "stepTimeoutMs": 15000,
  "failureThreshold": 3,
  "recoveryThreshold": 2,
  "concurrencyPolicy": "SKIP_IF_RUNNING",
  "enabled": true
}
```

---

## 18. Workflow Model

Rhythm v1 should use a deterministic ordered workflow with limited control-flow steps.

Supported structures:

- Sequential steps.
- Conditional step execution.
- Step groups.
- Cleanup/finally steps.
- Optional steps.
- Continue-on-failure steps.
- Fail-fast behavior.

Rhythm v1 should not implement unrestricted cyclic graphs. Loops may be introduced later with strict iteration limits.

Each step must contain:

```text
ID
Name
Description
Order
Type
Enabled
Condition
Timeout
Retry policy
Continue on failure
Run in cleanup phase
Input configuration
Actions
Extractors
Assertions
Output schema
Logging policy
```

---

## 19. Step Types

Rhythm v1 should support the following step types.

### 19.1 HTTP Request

Calls an HTTP or HTTPS endpoint.

### 19.2 Action

Executes one or more controlled transformations without making a request.

### 19.3 Delay

Waits for a configured duration with a maximum allowed delay.

### 19.4 Condition

Evaluates an expression and sets an outcome used to include or skip later steps.

### 19.5 Script

Executes a sandboxed script for logic not covered by controlled actions.

### 19.6 Metric Validation

Queries a configured observability provider, initially optional for Dynatrace deployment validation.

### 19.7 Certificate Validation

Connects to an endpoint and validates remote certificate properties without requiring an application-level request.

### 19.8 DNS or TCP Validation

Future-ready step type; may be implemented after v1 without changing the workflow model.

---

## 20. HTTP Request Step

Supported methods:

```text
GET
POST
PUT
PATCH
DELETE
HEAD
OPTIONS
```

Request configuration:

```text
URL template
Method
Path parameters
Query parameters
Headers
Cookies
Body type
Body template
Authentication profile or inline auth
Certificate profile
Proxy profile
Redirect policy
Compression policy
HTTP version preference
Timeout
Retry override
Response capture policy
```

Supported body types:

```text
None
JSON
Raw text
XML
GraphQL
Form URL encoded
Multipart form data
Binary from approved artifact source
```

Required parameter behaviors:

- Each header and query parameter can be enabled or disabled.
- Duplicate headers may be supported where legal.
- Values may contain template expressions.
- A field may be marked sensitive even when it does not reference a known secret.
- The final rendered request must be previewable with values masked.
- Content length and content type should be set automatically where appropriate.
- User-specified host header behavior must be guarded by policy.

Example:

```json
{
  "name": "Call Protected API",
  "type": "HTTP_REQUEST",
  "request": {
    "method": "POST",
    "url": "{{ variables.baseUrl }}/v1/payments/{{ runtime.paymentId }}",
    "headers": [
      {
        "name": "Authorization",
        "value": "Bearer {{ steps.getToken.outputs.accessToken }}",
        "sensitive": true
      },
      {
        "name": "X-Correlation-ID",
        "value": "{{ generated.correlationId }}"
      },
      {
        "name": "X-Signature",
        "value": "{{ generated.requestSignature }}",
        "sensitive": true
      }
    ],
    "body": {
      "type": "JSON",
      "template": {
        "paymentId": "{{ runtime.paymentId }}",
        "amount": "{{ variables.amount }}",
        "requestedAt": "{{ generated.isoTimestamp }}"
      }
    },
    "certificateProfileId": "cert-profile-payment-mtls",
    "proxyProfileId": "proxy-corporate-egress"
  }
}
```

---

## 21. Authentication Support

Rhythm should support reusable authentication profiles and inline step-level authentication.

Required authentication types:

```text
None
Basic authentication
Bearer token
API key in header
API key in query parameter
OAuth 2.0 client credentials
OAuth 2.0 refresh token
OAuth 2.0 JWT bearer or client assertion
Mutual TLS
Custom HMAC signing
Custom header templates
```

Authentication profile rules:

- Profiles store only references to secrets, not raw values.
- A monitor may override non-sensitive profile values.
- Token caching may be enabled with a strict scope key.
- Cached tokens must be encrypted or kept only in protected volatile storage.
- Token expiry must be determined from `expires_in`, JWT `exp`, configured TTL, or conservative default.
- Token cache keys must include environment, profile, audience, scope, and client identity.
- Token acquisition failures must be categorized separately from target API failures.

---

## 22. JWT Generation

Rhythm must provide a first-class JWT generation action.

Supported algorithms for v1:

```text
HS256
HS384
HS512
RS256
RS384
RS512
ES256
ES384
```

Optional later algorithms:

```text
PS256
PS384
PS512
EdDSA
```

JWT configuration:

```text
Algorithm
Header claims
Payload claims
Issuer
Subject
Audience
Issued-at behavior
Expiry behavior
Not-before behavior
JWT ID behavior
Clock skew allowance
Signing key reference
Output variable
Sensitive flag
```

Claim values may be:

- Static values.
- Variable expressions.
- Secret expressions.
- Generated timestamps.
- Previous-step outputs.
- Arrays and nested objects.

Example:

```json
{
  "type": "GENERATE_JWT",
  "algorithm": "RS256",
  "headers": {
    "typ": "JWT",
    "kid": "{{ variables.keyId }}"
  },
  "claims": {
    "iss": "{{ secrets.clientId }}",
    "sub": "{{ secrets.clientId }}",
    "aud": "{{ variables.tokenAudience }}",
    "iat": "{{ time.epochSeconds }}",
    "exp": "{{ time.epochSecondsPlus(300) }}",
    "jti": "{{ random.uuid }}"
  },
  "signingKey": "{{ secrets.jwtPrivateKey }}",
  "output": "clientAssertion",
  "sensitive": true
}
```

Validation requirements:

- Reject unsupported algorithm and key-type combinations.
- Reject missing required key material before sending requests.
- Allow PEM and JWK references where supported.
- Validate ECDSA curve compatibility.
- Limit maximum token lifetime through policy.
- Never persist the complete generated token unmasked.

---

## 23. OAuth Access Token Acquisition

Token acquisition can be built manually with an HTTP step, but Rhythm should also provide an authentication helper.

Required capabilities:

- Client credentials using HTTP Basic authentication.
- Client credentials with credentials in form body.
- Client assertion using generated JWT.
- Scope and audience parameters.
- Additional token parameters.
- Token response field mapping.
- Custom token type field mapping.
- Expiry extraction.
- Optional token caching.
- Safe token diagnostics.

Example token flow:

```text
Generate JWT action
        ↓
POST token endpoint
        ↓
Assert HTTP 200
        ↓
Extract access_token
        ↓
Extract expires_in
        ↓
Store access token as sensitive runtime output
        ↓
Call protected API
```

---

## 24. Timestamp, Random, and Identifier Generation

Required generation actions:

```text
Current ISO-8601 timestamp
Current RFC 3339 timestamp
Epoch seconds
Epoch milliseconds
Timestamp plus or minus duration
Formatted timestamp with approved format patterns
UUID v4
Random integer
Random hexadecimal string
Random base64 string
Cryptographic nonce
Correlation ID
Idempotency key
```

Generation requirements:

- Use cryptographically secure randomness for signatures, nonces, and token identifiers.
- Permit deterministic values only in explicit test mode.
- Record generation metadata without exposing sensitive generated values.
- Make generated values available in the current step and all later steps.

---

## 25. Dynamic Request Construction

Every request field should support the Rhythm template language unless prohibited by policy.

Templatable fields:

```text
URL
Path
Query parameter name and value
Header name and value
Cookie name and value
JSON field values
XML text and attributes
Raw body
Form field names and values
Multipart text fields
GraphQL variables
Proxy username reference
SNI override
Assertion expected values
```

The request builder must render data in this order:

```text
1. Load monitor and environment variables.
2. Load approved secret values.
3. Load prior step outputs.
4. Execute pre-request actions.
5. Render URL, parameters, headers, and body.
6. Canonicalize content when requested.
7. Generate signatures from final canonical content.
8. Inject authentication.
9. Apply proxy and TLS configuration.
10. Mask a diagnostic copy.
11. Send the actual request.
```

This ordering is critical because a signature must be generated from the final request representation.

---

## 26. Template and Expression Language

Recommended syntax:

```text
{{ variables.baseUrl }}
{{ environment.region }}
{{ secrets.clientSecret }}
{{ generated.timestamp }}
{{ steps.getToken.outputs.accessToken }}
{{ steps.createOrder.response.statusCode }}
{{ run.id }}
```

Supported namespaces:

```text
variables
environment
secrets
generated
runtime
steps
run
monitor
agent
time
random
```

Recommended expression engine:

- CEL or a similarly restricted expression language for conditions and transformations.
- A separate strict template renderer for string interpolation.

Required functions:

```text
string
number
boolean
json
jsonEncode
jsonDecode
base64Encode
base64Decode
urlEncode
urlDecode
lower
upper
trim
replace
substring
join
split
length
coalesce
default
sha256
sha512
hmacSha256
timeFormat
timeAdd
uuid
```

Rules:

- Missing required expressions fail with a precise path.
- Optional expressions may provide a default.
- Secret values remain tagged as sensitive after transformation.
- Data derived from a sensitive input remains sensitive unless an explicit safe one-way transform policy permits declassification.
- Template recursion is not allowed.
- Expression depth, input size, and execution time are limited.

---

## 27. Variable Scopes and Precedence

Supported scopes:

```text
System variables
Environment variables
Monitor variables
Runtime override variables
Generated variables
Step local variables
Step outputs
Secret aliases
```

Recommended precedence from highest to lowest:

```text
Step local override
Runtime override
Monitor variable
Environment variable
System default
```

Secrets use a separate namespace and cannot be overridden by ordinary variables.

Variable types:

```text
String
Number
Boolean
JSON object
JSON array
Duration
URL
Timestamp
```

Each variable may include:

```text
Name
Type
Value
Description
Required
Sensitive
Allowed override
Validation rule
```

---

## 28. Controlled Pre-request and Post-response Actions

Required actions:

```text
Set variable
Unset variable
Copy value
Generate timestamp
Generate UUID
Generate nonce
Generate random string
Base64 encode/decode
URL encode/decode
Hex encode/decode
SHA-256/SHA-512 hash
HMAC signature
Generate JWT
JSON parse/stringify
JSON merge
JSON set/remove path
XML parse
String concatenate
String replace
Regex replace
Create canonical request
Set header
Remove header
Set query parameter
Remove query parameter
Set body value
Read previous step output
Calculate duration
```

Each action must provide:

```text
Type
Input expression or structured inputs
Output variable
Sensitive flag
Error behavior
Preview with masked data
```

---

## 29. HMAC Signature Generation

Rhythm must support HMAC-based signing as a first-class action.

Required algorithms:

```text
HMAC-SHA256
HMAC-SHA384
HMAC-SHA512
```

Input options:

```text
Raw string
Rendered request body
Canonical JSON
Canonical query string
HTTP method
Path
Selected headers
Timestamp
Nonce
Concatenated field list
Custom expression result
```

Output encodings:

```text
Hex lowercase
Hex uppercase
Base64
Base64 URL-safe
Raw bytes for downstream encoding
```

Example:

```json
{
  "type": "GENERATE_HMAC",
  "algorithm": "HMAC_SHA256",
  "secret": "{{ secrets.hmacSecret }}",
  "canonicalInput": {
    "type": "JOIN",
    "separator": "\n",
    "values": [
      "{{ request.method }}",
      "{{ request.path }}",
      "{{ generated.epochSeconds }}",
      "{{ request.body.sha256 }}"
    ]
  },
  "outputEncoding": "BASE64",
  "output": "requestSignature",
  "sensitive": true
}
```

Canonicalization requirements:

- Canonical JSON must define key sorting, whitespace, number handling, Unicode handling, and array preservation.
- Canonical query strings must define sorting and encoding.
- Header canonicalization must define case normalization and whitespace trimming.
- A diagnostic view may show the canonical-input structure, but sensitive segments must be masked.

---

## 30. Chained API Calls and Data Dependency

Rhythm must support using one response in another request.

Example:

```text
Step 1: Generate JWT
Step 2: Fetch token
Step 3: Extract access token
Step 4: Create transaction
Step 5: Extract transaction ID
Step 6: Query transaction
Step 7: Assert business status
Step 8: Delete test transaction in cleanup
```

Requirements:

- Steps execute in configured order.
- Later steps can reference any successful earlier output.
- An output has a type, sensitivity classification, source, and optional expiry.
- A missing required output causes `DEPENDENCY_RESOLUTION_FAILURE`.
- An optional dependency may use a default.
- Skipped-step outputs are unavailable unless explicitly initialized.
- Cleanup steps can reference outputs from failed main steps when those outputs were successfully created.

---

## 31. Extractors

Extractors read a value from a response or execution result and publish it as a step output.

Required extractor types:

```text
JSONPath
JMESPath (optional in v1)
XML XPath
Response header
Set-Cookie header
Cookie jar
Regex capture group
Body text
Body substring
HTTP status code
HTTP reason phrase
Response duration
Response size
Final URL after redirects
Redirect location
TLS certificate field
JSON Web Token claim from a response field
GraphQL data path
```

Extractor configuration:

```text
Name
Source
Type
Expression or path
Data type
Required or optional
Default value
Sensitive
Transform actions
Validation rule
Allow multiple values
```

Example JSONPath extractor:

```json
{
  "name": "accessToken",
  "type": "JSON_PATH",
  "source": "RESPONSE_BODY",
  "path": "$.access_token",
  "dataType": "STRING",
  "required": true,
  "sensitive": true
}
```

Example header extractor:

```json
{
  "name": "requestId",
  "type": "HEADER",
  "headerName": "x-request-id",
  "required": false,
  "sensitive": false
}
```

Example regex extractor:

```json
{
  "name": "sessionId",
  "type": "REGEX",
  "pattern": "sessionId=([A-Za-z0-9_-]+)",
  "group": 1,
  "required": true,
  "sensitive": true
}
```

Extractor behavior:

- Execute after response receipt and before dependent assertions where configured.
- Provide precise failure messages including extractor name and source type.
- Never include the raw sensitive extracted value in failure details.
- Limit regex execution time and input size.
- Support optional extraction without failing the step.
- Preserve sensitivity through transformations.

---

## 32. Assertions

Assertions determine technical and functional success.

Required assertion categories:

### 32.1 HTTP assertions

```text
Status equals
Status not equals
Status in list
Status class is 2xx/3xx/4xx/5xx
Header exists
Header missing
Header equals/contains/matches
Cookie exists/matches
Redirect count
Final URL
```

### 32.2 Body assertions

```text
Body contains
Body does not contain
Regex matches
JSONPath exists
JSONPath equals/not equals
JSONPath contains
JSONPath numeric comparison
JSONPath array length
XPath exists/equality
JSON schema validation
XML schema validation (later)
GraphQL errors absent
Body size comparison
```

### 32.3 Performance assertions

```text
DNS time
Connection time
TLS handshake time
Time to first byte
Total response time
Downloaded bytes
Maximum redirect duration
```

### 32.4 TLS assertions

```text
Certificate is trusted
Hostname matches
Certificate not expired
Minimum days until expiry
Issuer equals or contains
Subject matches
Fingerprint equals
Public-key algorithm allowed
Minimum key length
TLS version allowed
Cipher suite allowed
OCSP or revocation status where available
```

### 32.5 Business assertions

```text
Extracted value equals expected value
Value changed or did not change from previous step
Two extracted values are equal
Expression evaluates true
Collection contains an object matching a condition
```

Assertion fields:

```text
Name
Type
Source
Path or expression
Operator
Expected value
Severity
Required
Sensitive
Failure message template
```

Severity behavior:

```text
INFO: recorded only
WARNING: step succeeds with warning
ERROR: step fails
CRITICAL: step and monitor fail immediately
```

---

## 33. JSON Schema Validation

Rhythm should support JSON Schema assertions.

Requirements:

- Support a documented JSON Schema draft selected by the backend library.
- Store schema inline or reference a reusable schema artifact.
- Limit schema size and reference depth.
- Block uncontrolled remote `$ref` resolution.
- Return a compact list of validation errors with JSON paths.
- Allow configured additional-property policy.
- Mask sensitive values in error output.

---

## 34. Conditional Logic

A step may include a condition such as:

```text
{{ steps.getToken.response.statusCode == 200 }}
{{ runtime.shouldRunCleanup == true }}
{{ steps.queryOrder.outputs.state != "COMPLETED" }}
```

Condition outcomes:

```text
TRUE: execute step
FALSE: mark step SKIPPED_CONDITION
ERROR: fail with CONDITION_EVALUATION_FAILURE unless configured to skip
```

Condition requirements:

- No side effects.
- Strict execution timeout.
- Typed values.
- Secret-safe error messages.
- Expression preview using sample or masked runtime values.

---

## 35. Sandboxed Script Step

Controlled actions should cover most use cases. A script step is required for advanced transformations that cannot be represented otherwise.

Recommended implementation options:

- Goja JavaScript sandbox with strict host isolation.
- Starlark interpreter.
- Another embedded deterministic language with controlled capabilities.

The script environment must not provide:

```text
Filesystem access
Process execution
Arbitrary network access
Environment variables
Host reflection
Dynamic package loading
Unbounded loops
Unbounded memory
```

The script may receive:

```text
A deep-copied, size-limited runtime input object
Approved helper functions
A logger that automatically masks sensitive data
A method to return typed outputs
```

Required controls:

```text
CPU timeout
Memory limit
Instruction or operation limit
Input/output size limit
No recursion or limited recursion
Versioned runtime
Static validation before publish
```

---

## 36. Certificate and TLS Management

Certificates are a first-class Rhythm capability.

### 36.1 Certificate Profile Types

```text
Client mTLS profile
Custom trust bundle profile
Combined mTLS and trust profile
Remote certificate validation profile
```

### 36.2 Client Certificate Inputs

Supported references:

```text
PEM certificate secret reference
PEM private-key secret reference
PKCS#12/PFX secret reference plus password reference
Certificate chain reference
Hardware or enterprise key-provider adapter in a later phase
```

Rhythm must not store raw private keys in monitor definitions.

### 36.3 Trust Configuration

Supported trust modes:

```text
System trust store
Custom CA bundle only
System plus custom CA bundle
Pinned leaf certificate fingerprint
Pinned SPKI fingerprint
```

`skip TLS verification` may be available only behind an administrative policy, must display a high-risk warning, and should be disabled by default.

### 36.4 TLS Options

```text
Minimum TLS version
Maximum TLS version
SNI server name override
Hostname verification
Allowed cipher suites where the Go runtime permits control
Renegotiation policy where supported
ALPN preference
Client certificate selection
```

### 36.5 Certificate Diagnostics

Safe run details should show:

```text
TLS version
Cipher suite
Server name
Leaf subject
Leaf issuer
Serial number
Not before
Not after
Days until expiry
SAN DNS names, subject to capture policy
Certificate fingerprint
Chain length
Hostname validation result
Trust validation result
Client certificate alias used, never the private key
```

### 36.6 Certificate Expiry Monitoring

Rhythm should support expiry assertions for:

- Remote server certificate.
- Configured client certificate.
- Intermediate certificates.
- CA certificates where expiry is available.

Thresholds:

```text
Critical: expired or <= 7 days
Warning: <= 30 days
Informational: <= 60 days
```

Thresholds must be configurable.

### 36.7 Certificate Acceptance Criteria

- User can create a certificate profile from secret references.
- User can test the profile without retrieving raw key material.
- HTTP steps can select a certificate profile.
- Worker validates certificate-key compatibility.
- Worker validates certificate time validity before execution.
- TLS failures are categorized accurately.
- Certificate details are recorded without exposing private material.
- Rotation of a secret-managed certificate should not require editing every monitor.

---

## 37. Proxy Management

Proxy configuration is reusable and may be assigned at agent, environment, monitor, or step level.

### 37.1 Proxy Types

```text
HTTP proxy
HTTPS proxy using CONNECT
SOCKS5 proxy
System or agent default proxy
Direct connection
```

### 37.2 Proxy Profile Fields

```text
Name
Description
Protocol
Host
Port
Authentication type
Username secret reference
Password secret reference
Custom proxy headers
TLS configuration for HTTPS proxy
No-proxy host patterns
Connection timeout
Health-check target
Agent-group restrictions
```

### 37.3 Proxy Authentication

Required initial support:

```text
None
Basic authentication
Static proxy authorization header from secret reference
```

Possible later support:

```text
NTLM
Kerberos/SPNEGO
Enterprise proxy adapter
```

### 37.4 No-Proxy Rules

Support:

```text
Exact hostname
Domain suffix
IP address
CIDR
Port-qualified host
Wildcard patterns with strict documented behavior
```

### 37.5 Proxy Precedence

Recommended precedence:

```text
Step proxy override
Monitor proxy
Environment proxy
Agent default proxy
Direct connection
```

Administrative policy may prohibit overriding the agent proxy.

### 37.6 Proxy Diagnostics

Run details should show:

```text
Proxy profile name
Proxy type
Proxy host and port
Whether bypass rule matched
Proxy connection duration
CONNECT response status where applicable
Proxy authentication failure category
```

Credentials must always be masked.

### 37.7 Proxy Acceptance Criteria

- User can create, edit, test, disable, and delete a proxy profile.
- Proxy credentials use secret references.
- A monitor can inherit or override a proxy.
- No-proxy evaluation is deterministic and testable in the UI.
- Worker differentiates target connection failures from proxy failures.
- Proxy configuration never appears in exported definitions with raw credentials.

---

## 38. Cookie and Session Handling

Each run should have an optional isolated cookie jar.

Modes:

```text
Disabled
Workflow-local cookie jar
Explicit cookie extraction and injection only
```

Rules:

- Cookies never persist between runs unless a future managed-session feature is explicitly enabled.
- Sensitive cookies are masked.
- Domain, path, secure, expiry, and same-site metadata may be shown safely.
- Cleanup occurs at run completion.

---

## 39. Redirect Handling

Configuration options:

```text
Do not follow redirects
Follow up to N redirects
Preserve method where protocol requires
Strip sensitive headers on cross-host redirect
Allowlist redirect hosts
Fail on protocol downgrade
```

Diagnostics must record each redirect hop, timing, status, and target host without exposing sensitive URL parameters.

---

## 40. Timeouts, Retries, and Backoff

Timeout layers:

```text
Run timeout
Step timeout
DNS timeout
Connection timeout
TLS handshake timeout
Response-header timeout
Idle connection timeout
Request body write timeout where supported
```

Retry configuration:

```text
Maximum attempts
Fixed, linear, or exponential backoff
Initial delay
Maximum delay
Jitter
Retryable failure categories
Retryable status codes
Respect Retry-After
Idempotency requirement
```

Default safe behavior:

- Do not retry non-idempotent methods unless explicitly enabled or an idempotency key is configured.
- Do not retry assertion failures unless the assertion is explicitly marked transient.
- Retry DNS, connection, selected 5xx, 408, and 429 failures according to policy.
- Record each attempt separately inside the step run.

---

## 41. Scheduling

Supported schedule types:

```text
Manual only
Fixed interval
Cron expression
One-time execution
External trigger only
Deployment-gate trigger
```

Preset intervals:

```text
Every 1 minute
Every 5 minutes
Every 10 minutes
Every 15 minutes
Every 30 minutes
Every hour
Every 6 hours
Daily
```

Schedule fields:

```text
Type
Expression or interval
Timezone
Start time
End time
Jitter
Maintenance windows
Blackout windows
Missed-run policy
Concurrency policy
```

Concurrency policies:

```text
ALLOW
SKIP_IF_RUNNING
QUEUE_ONE
CANCEL_PREVIOUS
```

Missed-run policies:

```text
SKIP
RUN_ONCE_IMMEDIATELY
BACKFILL_LIMITED
```

Scheduler requirements:

- Use distributed locks or durable due-run claiming.
- Avoid duplicate scheduled jobs.
- Record why a run was skipped.
- Handle daylight-saving transitions using configured timezone semantics.
- Support schedule preview in the UI.

---

## 42. Execution Engine

Execution flow:

```text
1. Receive run job.
2. Acquire idempotency and concurrency lock.
3. Load immutable monitor revision.
4. Resolve environment and agent policy.
5. Create run record.
6. Load non-secret variables.
7. Fetch required secrets and certificate material.
8. Initialize cookie jar and runtime context.
9. Execute main workflow steps in order.
10. Execute configured cleanup/finally steps.
11. Mask all persistable data in worker memory.
12. Persist step results and run summary.
13. Evaluate incident/alert state.
14. Emit metrics, traces, and audit events.
15. Release locks and delete volatile secret material.
```

Runtime guarantees:

- Secret values are fetched as late as practical.
- Secret values are removed from references and buffers where reasonably possible after use.
- Persisted objects are produced only from masked copies.
- A worker crash should leave a run recoverable as `ABORTED` or `WORKER_LOST`.
- Duplicate jobs should return the existing run or be rejected idempotently.
- Cancellation should stop future steps and attempt to cancel active requests.

---

## 43. Run and Step Statuses

Run statuses:

```text
QUEUED
STARTING
RUNNING
SUCCESS
SUCCESS_WITH_WARNINGS
FAILED
TIMED_OUT
CANCELLED
ABORTED
SKIPPED
```

Step statuses:

```text
PENDING
RUNNING
SUCCESS
SUCCESS_WITH_WARNINGS
FAILED
TIMED_OUT
CANCELLED
SKIPPED_CONDITION
SKIPPED_DEPENDENCY
SKIPPED_DISABLED
```

Failure categories:

```text
CONFIGURATION_ERROR
VARIABLE_RESOLUTION_FAILURE
DEPENDENCY_RESOLUTION_FAILURE
SECRET_FETCH_FAILURE
SECRET_PERMISSION_FAILURE
CERTIFICATE_LOAD_FAILURE
CERTIFICATE_EXPIRED
CERTIFICATE_MISMATCH
TLS_HANDSHAKE_FAILURE
TLS_TRUST_FAILURE
TLS_HOSTNAME_FAILURE
PROXY_CONNECTION_FAILURE
PROXY_AUTH_FAILURE
DNS_FAILURE
CONNECTION_REFUSED
CONNECTION_RESET
NETWORK_UNREACHABLE
REQUEST_TIMEOUT
RESPONSE_TIMEOUT
HTTP_ERROR
REDIRECT_POLICY_FAILURE
AUTHENTICATION_FAILURE
TOKEN_ACQUISITION_FAILURE
JWT_GENERATION_FAILURE
HMAC_GENERATION_FAILURE
PRE_REQUEST_ACTION_FAILURE
SCRIPT_FAILURE
EXTRACTOR_FAILURE
ASSERTION_FAILURE
SCHEMA_VALIDATION_FAILURE
RATE_LIMITED
AGENT_UNAVAILABLE
WORKER_LOST
CANCELLED_BY_USER
UNKNOWN_ERROR
```

---

## 44. Execution Agents and Network Locations

A central worker may not reach every target network. Rhythm therefore requires an execution-agent model.

Agent capabilities:

```text
Agent registration
Heartbeat
Capability advertisement
Network zone tags
Certificate and proxy capability tags
Maximum concurrency
Version reporting
Drain mode
Health state
```

Agent selection:

- Direct agent ID.
- Agent group.
- Required tag expression.
- Round-robin or least-loaded selection.
- Sticky selection for a suite when configured.

Security requirements:

- Agents authenticate to the control plane using mTLS or another strong machine identity.
- Jobs are signed or delivered over mutually authenticated channels.
- Agents receive only secrets required for that run.
- Agent logs are masked locally.
- The control plane can revoke an agent.

---

## 45. Manual Run and Test Console

Manual execution modes:

```text
Run latest published revision
Run current draft
Run one step with supplied mock dependencies
Run from selected step using prior test outputs
Run full workflow with temporary variable overrides
```

Temporary override rules:

- Secret overrides are not accepted as raw text in production mode.
- Variable overrides are audited.
- Temporary overrides are not saved unless explicitly applied to the draft.
- Draft test results are clearly labeled and do not affect production alert state by default.

Live console requirements:

- Stream step state transitions.
- Show timing as steps complete.
- Show masked rendered request preview.
- Show extractor and assertion results.
- Allow cancellation.
- Never stream raw secrets.

---

## 46. Run History and Diagnostics

Run summary fields:

```text
Run ID
Monitor ID
Monitor revision
Environment
Agent
Trigger type
Trigger source
Status
Started at
Ended at
Duration
Queue delay
Failed step
Failure category
Failure reason
Retry count
Warning count
Alert impact
```

Step detail fields:

```text
Step name and type
Status
Attempt history
Rendered request summary
Response summary
Timing breakdown
TLS details
Proxy details
Extractor results
Assertion results
Generated outputs, masked when sensitive
Error details
Logs
```

Timing breakdown:

```text
Queue wait
Secret fetch
DNS lookup
Proxy connection
TCP connection
TLS handshake
Request write
Server wait / TTFB
Response download
Extractor processing
Assertion processing
Total
```

Capture policy options:

```text
Metadata only
Headers with masking
Truncated body
Selected JSON/XML paths only
Full masked body within size limit
No body
```

---

## 47. Data Masking and Sensitive-Data Controls

### 47.1 Automatically Sensitive Inputs

Any value from the following sources is sensitive by default:

```text
Secret reference
Private key
Certificate password
Authorization header
Proxy authorization header
Cookie marked secure or HttpOnly
OAuth token
JWT
HMAC signature
User-marked sensitive field
```

### 47.2 Sensitive Key Detection

Auto-mask case-insensitive keys containing or matching:

```text
password
passwd
secret
client_secret
api_key
apikey
token
access_token
refresh_token
authorization
proxy-authorization
private_key
assertion
signature
session
cookie
set-cookie
```

### 47.3 Redaction Rules

- Exact sensitive values discovered at runtime must be added to a run-local redaction dictionary.
- URL query parameters can be masked by key.
- JSON and XML paths can be configured for masking.
- Regex redaction rules can be administratively configured.
- Long sensitive values must be matched safely without causing excessive CPU usage.
- Derived sensitive values remain sensitive.
- Data must be masked before persistence, event publishing, logging, alerting, tracing, or frontend transmission.

### 47.4 Body Limits

Default limits should be configurable:

```text
Maximum request body captured: 64 KB after masking
Maximum response body captured: 256 KB after masking
Maximum body processed by extractor: 5 MB
Maximum body downloaded: 10 MB
```

Larger responses should be truncated or rejected according to policy.

---

## 48. Alerting

Supported channels for v1:

```text
Email
Slack webhook
Generic webhook
```

Alert triggers:

```text
N consecutive failed scheduled runs
Failure ratio over a rolling window
Critical assertion failure
Response time above threshold for N runs
Certificate expiry threshold
Agent unavailable
Schedule not executing
Recovery after N successful runs
```

Alert lifecycle:

```text
HEALTHY
PENDING_FAILURE
OPEN
ACKNOWLEDGED
RESOLVED
SUPPRESSED
```

Noise-control features:

- Failure threshold.
- Recovery threshold.
- Cooldown.
- Deduplication key.
- Maintenance windows.
- Alert grouping.
- Reminder interval.
- Escalation after duration.
- Do-not-alert for manual draft tests.

Alert payload:

```text
Monitor name
Environment
Current state
Failed step
Failure category
Safe failure reason
First failure time
Latest failure time
Consecutive failures
Run link
Owner and tags
```

---

## 49. Dashboard and Reporting

Dashboard cards:

```text
Total monitors
Enabled monitors
Healthy monitors
Failing monitors
Monitors with warnings
Active alerts
Success rate over selected period
Average and p95 duration
Runs in progress
Unavailable agents
Certificates expiring soon
```

Dashboard visualizations:

- Status trend.
- Success-rate trend.
- p50/p95/p99 duration trend.
- Failure-category distribution.
- Top failing monitors.
- Slowest monitors.
- Recent state changes.
- Agent capacity and health.

Filters:

```text
Time range
Environment
Owner
Tag
Agent group
Status
Failure category
Monitor type
```

---

## 50. Monitor List

Columns:

```text
Name
Environment
Current state
Schedule
Last run
Last duration
Success rate
Failed step
Agent group
Owner
Tags
Enabled
```

Actions:

```text
Open
Run now
Edit draft
Clone
Enable/disable
View runs
View revisions
Export
Archive
```

The table should support server-side filtering, sorting, pagination, column visibility, saved views, and CSV export.

---

## 51. Configuration Library Pages

### 51.1 Environments

Manage environment variables and bindings.

### 51.2 Secrets

Manage secret references and access tests. Never reveal values.

### 51.3 Authentication Profiles

Manage reusable token, API key, basic auth, JWT, and HMAC configurations.

### 51.4 Certificates

Manage mTLS and trust profiles, test certificate loading, and show non-secret metadata.

### 51.5 Proxies

Manage proxy profiles, bypass rules, connectivity tests, and usage references.

### 51.6 Agents

View version, health, capacity, tags, last heartbeat, and active jobs.

### 51.7 Notification Channels

Manage email, Slack webhook, and generic webhook destinations through secret references.

---

## 52. Revisioning and Change Management

Every publish operation creates a monitor revision containing:

```text
Monitor metadata
Environment binding
Step definitions
Actions
Extractors
Assertions
Referenced profile IDs and versions
Schedule
Alert policy
Capture policy
Schema version
Published by
Published at
Change summary
```

Revision requirements:

- Immutable after publish.
- Diff view between revisions.
- Restore a previous revision into a new draft.
- Every run references one revision.
- Secret value rotation does not create a monitor revision; secret reference changes do.
- Profile changes should be versioned or snapshot-referenced to preserve reproducibility.

---

## 53. Audit Logging

Audit events:

```text
Monitor created, edited, published, enabled, disabled, archived, deleted
Manual run initiated or cancelled
Secret reference created, updated, tested, deleted
Certificate profile created, updated, tested, deleted
Proxy profile created, updated, tested, deleted
Authentication profile changed
Environment changed
Agent registered, revoked, drained
Alert acknowledged, suppressed, resolved
Export and import
Permission change
```

Audit record fields:

```text
Event ID
Actor
Action
Resource type
Resource ID
Timestamp
Source IP or session identifier where available
Before summary
After summary
Request correlation ID
Outcome
```

Never store raw secret values in audit records.

---

## 54. Roles and Permissions

Recommended initial roles:

```text
Administrator
Editor
Operator
Viewer
```

Permission examples:

### Administrator

Full product configuration, agent control, retention, policies, and user access.

### Editor

Create, edit, publish, and run monitors; manage approved reusable profiles within assigned scope.

### Operator

Run monitors, cancel runs, acknowledge alerts, and inspect diagnostics.

### Viewer

Read-only access to monitors, runs, dashboards, and alerts.

Secret permissions must be evaluated independently from monitor edit permissions.

---

## 55. Deployment Validation Suites

Rhythm should support grouping monitors into a validation suite.

Suite fields:

```text
Name
Description
Environment
Ordered stages
Monitors per stage
Parallelism
Fail-fast policy
Required and optional checks
Overall timeout
Baseline comparison policy
Notification policy
```

Example stages:

```text
1. Availability checks
2. Authentication checks
3. Critical business journeys
4. Dependency checks
5. Dynatrace CPU and memory validation
6. Recovery confirmation
```

Suite trigger methods:

```text
Manual
API
CI/CD webhook
Deployment event
Scheduled
```

Suite result:

```text
PASSED
PASSED_WITH_WARNINGS
FAILED
TIMED_OUT
CANCELLED
```

The suite API should return a machine-readable gate decision suitable for pipelines.

---

## 56. Dynatrace and Telemetry Validation Extension

This module may be delivered after the core synthetic engine but should use the same step and assertion model.

Potential metric checks:

```text
CPU usage below threshold
Memory usage below threshold
Error rate below threshold
Response time below threshold
Problem count equals zero
Service availability above threshold
No new critical problems after deployment
Metric change versus pre-deployment baseline
```

Metric step configuration:

```text
Provider profile
Entity selector
Metric selector
Aggregation
Time window
Resolution
Baseline window
Comparison operator
Threshold
Missing-data behavior
```

Example:

```json
{
  "type": "METRIC_VALIDATION",
  "provider": "DYNATRACE",
  "metricSelector": "builtin:host.cpu.usage",
  "entitySelector": "type(HOST),tag(\"application:payments\")",
  "window": "10m",
  "aggregation": "AVG",
  "assertion": {
    "operator": "LESS_THAN",
    "value": 80
  }
}
```

Provider credentials must use secret references.

---

## 57. Database Design

The exact schema may evolve, but the following model is required.

### 57.1 monitors

```sql
CREATE TABLE monitors (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    owner_id VARCHAR(255),
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    environment_id UUID,
    agent_group_id UUID,
    state VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    current_draft_revision_id UUID,
    latest_published_revision_id UUID,
    deleted_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL,
    updated_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.2 monitor_revisions

```sql
CREATE TABLE monitor_revisions (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    schema_version INTEGER NOT NULL,
    definition_json JSONB NOT NULL,
    change_summary TEXT,
    published_by VARCHAR(255),
    published_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (monitor_id, revision_number)
);
```

### 57.3 environments

```sql
CREATE TABLE environments (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    variables_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    default_proxy_profile_id UUID,
    default_certificate_profile_id UUID,
    default_agent_group_id UUID,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.4 secret_references

```sql
CREATE TABLE secret_references (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    alias VARCHAR(255) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    provider_config_json JSONB NOT NULL,
    secret_path TEXT,
    secret_key VARCHAR(255),
    encrypted_value BYTEA,
    value_type VARCHAR(50) NOT NULL DEFAULT 'STRING',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_status VARCHAR(50),
    last_tested_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (alias)
);
```

### 57.5 certificate_profiles

```sql
CREATE TABLE certificate_profiles (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    profile_type VARCHAR(100) NOT NULL,
    client_cert_secret_id UUID REFERENCES secret_references(id),
    client_key_secret_id UUID REFERENCES secret_references(id),
    pkcs12_secret_id UUID REFERENCES secret_references(id),
    pkcs12_password_secret_id UUID REFERENCES secret_references(id),
    ca_bundle_secret_id UUID REFERENCES secret_references(id),
    tls_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_status VARCHAR(50),
    last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.6 proxy_profiles

```sql
CREATE TABLE proxy_profiles (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    protocol VARCHAR(50) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    username_secret_id UUID REFERENCES secret_references(id),
    password_secret_id UUID REFERENCES secret_references(id),
    auth_header_secret_id UUID REFERENCES secret_references(id),
    no_proxy_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    tls_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_status VARCHAR(50),
    last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.7 auth_profiles

```sql
CREATE TABLE auth_profiles (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    auth_type VARCHAR(100) NOT NULL,
    config_json JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.8 monitor_schedules

```sql
CREATE TABLE monitor_schedules (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    schedule_type VARCHAR(50) NOT NULL,
    expression VARCHAR(255),
    interval_seconds INTEGER,
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    jitter_seconds INTEGER NOT NULL DEFAULT 0,
    concurrency_policy VARCHAR(50) NOT NULL DEFAULT 'SKIP_IF_RUNNING',
    missed_run_policy VARCHAR(50) NOT NULL DEFAULT 'SKIP',
    next_run_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.9 monitor_runs

```sql
CREATE TABLE monitor_runs (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES monitors(id),
    revision_id UUID NOT NULL REFERENCES monitor_revisions(id),
    environment_id UUID,
    agent_id UUID,
    status VARCHAR(50) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_source VARCHAR(255),
    idempotency_key VARCHAR(255),
    failure_category VARCHAR(100),
    failure_reason TEXT,
    failed_step_id VARCHAR(255),
    warning_count INTEGER NOT NULL DEFAULT 0,
    queue_delay_ms BIGINT,
    duration_ms BIGINT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);
```

### 57.10 monitor_step_runs

```sql
CREATE TABLE monitor_step_runs (
    id UUID PRIMARY KEY,
    monitor_run_id UUID NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
    step_definition_id VARCHAR(255) NOT NULL,
    step_order INTEGER NOT NULL,
    step_name VARCHAR(255) NOT NULL,
    step_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    request_summary_json JSONB,
    response_summary_json JSONB,
    timing_json JSONB,
    tls_summary_json JSONB,
    proxy_summary_json JSONB,
    extractor_results_json JSONB,
    assertion_results_json JSONB,
    output_metadata_json JSONB,
    failure_category VARCHAR(100),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_ms BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.11 step_attempts

```sql
CREATE TABLE step_attempts (
    id UUID PRIMARY KEY,
    step_run_id UUID NOT NULL REFERENCES monitor_step_runs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    request_summary_json JSONB,
    response_summary_json JSONB,
    timing_json JSONB,
    failure_category VARCHAR(100),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_ms BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (step_run_id, attempt_number)
);
```

### 57.12 alerts

```sql
CREATE TABLE alerts (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES monitors(id),
    deduplication_key VARCHAR(255) NOT NULL,
    state VARCHAR(50) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    failure_category VARCHAR(100),
    failed_step_id VARCHAR(255),
    first_triggered_at TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(255),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.13 agents

```sql
CREATE TABLE agents (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    agent_group_id UUID,
    version VARCHAR(100),
    status VARCHAR(50) NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    max_concurrency INTEGER NOT NULL DEFAULT 1,
    active_runs INTEGER NOT NULL DEFAULT 0,
    last_heartbeat_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 57.14 audit_events

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    actor_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    outcome VARCHAR(50) NOT NULL,
    before_summary_json JSONB,
    after_summary_json JSONB,
    correlation_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 58. Backend API Requirements

Base API prefix:

```text
/api/v1
```

### 58.1 Monitor APIs

```text
GET    /api/v1/monitors
POST   /api/v1/monitors
GET    /api/v1/monitors/{monitorId}
PATCH  /api/v1/monitors/{monitorId}
DELETE /api/v1/monitors/{monitorId}
POST   /api/v1/monitors/{monitorId}/clone
POST   /api/v1/monitors/{monitorId}/publish
POST   /api/v1/monitors/{monitorId}/enable
POST   /api/v1/monitors/{monitorId}/disable
POST   /api/v1/monitors/{monitorId}/archive
GET    /api/v1/monitors/{monitorId}/revisions
GET    /api/v1/monitors/{monitorId}/revisions/{revisionId}
GET    /api/v1/monitors/{monitorId}/diff?from={id}&to={id}
POST   /api/v1/monitors/{monitorId}/validate
```

### 58.2 Execution APIs

```text
POST   /api/v1/monitors/{monitorId}/runs
GET    /api/v1/monitors/{monitorId}/runs
GET    /api/v1/runs/{runId}
GET    /api/v1/runs/{runId}/steps
POST   /api/v1/runs/{runId}/cancel
GET    /api/v1/runs/{runId}/events
POST   /api/v1/monitors/{monitorId}/test-step
```

`POST /runs` should accept an idempotency key.

### 58.3 Environment APIs

```text
GET    /api/v1/environments
POST   /api/v1/environments
GET    /api/v1/environments/{environmentId}
PATCH  /api/v1/environments/{environmentId}
DELETE /api/v1/environments/{environmentId}
```

### 58.4 Secret APIs

```text
GET    /api/v1/secrets
POST   /api/v1/secrets
GET    /api/v1/secrets/{secretId}
PATCH  /api/v1/secrets/{secretId}
DELETE /api/v1/secrets/{secretId}
POST   /api/v1/secrets/{secretId}/test
```

The secret API must never return a raw secret value.

### 58.5 Certificate APIs

```text
GET    /api/v1/certificate-profiles
POST   /api/v1/certificate-profiles
GET    /api/v1/certificate-profiles/{profileId}
PATCH  /api/v1/certificate-profiles/{profileId}
DELETE /api/v1/certificate-profiles/{profileId}
POST   /api/v1/certificate-profiles/{profileId}/test
GET    /api/v1/certificate-profiles/{profileId}/metadata
```

### 58.6 Proxy APIs

```text
GET    /api/v1/proxy-profiles
POST   /api/v1/proxy-profiles
GET    /api/v1/proxy-profiles/{profileId}
PATCH  /api/v1/proxy-profiles/{profileId}
DELETE /api/v1/proxy-profiles/{profileId}
POST   /api/v1/proxy-profiles/{profileId}/test
POST   /api/v1/proxy-profiles/{profileId}/evaluate-bypass
```

### 58.7 Authentication Profile APIs

```text
GET    /api/v1/auth-profiles
POST   /api/v1/auth-profiles
GET    /api/v1/auth-profiles/{profileId}
PATCH  /api/v1/auth-profiles/{profileId}
DELETE /api/v1/auth-profiles/{profileId}
POST   /api/v1/auth-profiles/{profileId}/test
```

### 58.8 Alerts APIs

```text
GET    /api/v1/alerts
GET    /api/v1/alerts/{alertId}
POST   /api/v1/alerts/{alertId}/acknowledge
POST   /api/v1/alerts/{alertId}/resolve
POST   /api/v1/alerts/{alertId}/suppress
```

### 58.9 Agent APIs

```text
GET    /api/v1/agents
POST   /api/v1/agents/register
POST   /api/v1/agents/{agentId}/heartbeat
POST   /api/v1/agents/{agentId}/drain
POST   /api/v1/agents/{agentId}/activate
POST   /api/v1/agents/{agentId}/revoke
```

### 58.10 Suite APIs

```text
GET    /api/v1/suites
POST   /api/v1/suites
GET    /api/v1/suites/{suiteId}
PATCH  /api/v1/suites/{suiteId}
POST   /api/v1/suites/{suiteId}/runs
GET    /api/v1/suite-runs/{suiteRunId}
POST   /api/v1/suite-runs/{suiteRunId}/cancel
```

---

## 59. API Response Standards

Success envelope:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_123"
  }
}
```

Error envelope:

```json
{
  "error": {
    "code": "VARIABLE_RESOLUTION_FAILURE",
    "message": "Unable to resolve required variable.",
    "details": {
      "path": "steps.callProtectedApi.request.headers[0].value",
      "expression": "steps.getToken.outputs.accessToken"
    }
  },
  "meta": {
    "requestId": "req_123"
  }
}
```

API requirements:

- Cursor or page-based pagination with documented limits.
- Idempotency for run creation and mutating integration callbacks.
- ETags or optimistic concurrency for draft editing.
- Correlation ID in every response.
- Structured validation errors with field paths.
- No raw secrets in API errors.

---

## 60. Rhythm Monitor Definition Example

```yaml
apiVersion: rhythm.io/v1
kind: Monitor
metadata:
  name: Protected API Synthetic Check
  slug: protected-api-synthetic-check
  tags:
    - payments
    - production
spec:
  environment: production
  agentGroup: internal-prod
  schedule:
    type: cron
    expression: "*/5 * * * *"
    timezone: Asia/Kolkata
    jitterSeconds: 10
  execution:
    timeoutMs: 60000
    concurrencyPolicy: SKIP_IF_RUNNING
    failureThreshold: 3
    recoveryThreshold: 2
  variables:
    tokenUrl: https://auth.example.com/oauth/token
    baseUrl: https://api.example.com
    audience: protected-api
  bindings:
    secrets:
      clientId: secret-client-id
      jwtPrivateKey: secret-jwt-private-key
      hmacSecret: secret-hmac
    certificateProfile: payment-mtls
    proxyProfile: corporate-egress
  steps:
    - id: generate-auth-material
      name: Generate authentication material
      type: ACTION
      actions:
        - type: GENERATE_TIMESTAMP
          format: EPOCH_SECONDS
          output: requestTimestamp
        - type: GENERATE_UUID
          output: correlationId
        - type: GENERATE_JWT
          algorithm: RS256
          headers:
            kid: "{{ variables.keyId }}"
          claims:
            iss: "{{ secrets.clientId }}"
            sub: "{{ secrets.clientId }}"
            aud: "{{ variables.audience }}"
            iat: "{{ generated.requestTimestamp }}"
            exp: "{{ time.epochSecondsPlus(300) }}"
            jti: "{{ random.uuid }}"
          signingKey: "{{ secrets.jwtPrivateKey }}"
          output: clientAssertion
          sensitive: true

    - id: get-token
      name: Get access token
      type: HTTP_REQUEST
      request:
        method: POST
        url: "{{ variables.tokenUrl }}"
        headers:
          - name: Content-Type
            value: application/x-www-form-urlencoded
        body:
          type: FORM_URL_ENCODED
          fields:
            grant_type: client_credentials
            client_id: "{{ secrets.clientId }}"
            client_assertion_type: urn:ietf:params:oauth:client-assertion-type:jwt-bearer
            client_assertion: "{{ steps.generate-auth-material.outputs.clientAssertion }}"
      extractors:
        - name: accessToken
          type: JSON_PATH
          path: $.access_token
          required: true
          sensitive: true
        - name: tokenExpiresIn
          type: JSON_PATH
          path: $.expires_in
          dataType: NUMBER
          required: false
      assertions:
        - name: Token endpoint returns success
          type: STATUS_CODE
          operator: EQUALS
          expected: 200
        - name: Access token is present
          type: JSON_PATH
          path: $.access_token
          operator: EXISTS

    - id: build-signature
      name: Build request signature
      type: ACTION
      actions:
        - type: SET_VARIABLE
          output: requestBody
          value:
            operation: health-check
            requestedAt: "{{ generated.requestTimestamp }}"
            correlationId: "{{ generated.correlationId }}"
        - type: SHA256
          input: "{{ jsonEncode(runtime.requestBody) }}"
          outputEncoding: HEX_LOWER
          output: bodyHash
        - type: GENERATE_HMAC
          algorithm: HMAC_SHA256
          secret: "{{ secrets.hmacSecret }}"
          canonicalInput:
            type: JOIN
            separator: "\n"
            values:
              - POST
              - /v1/health/validate
              - "{{ generated.requestTimestamp }}"
              - "{{ runtime.bodyHash }}"
          outputEncoding: BASE64
          output: requestSignature
          sensitive: true

    - id: call-protected-api
      name: Call protected API
      type: HTTP_REQUEST
      request:
        method: POST
        url: "{{ variables.baseUrl }}/v1/health/validate"
        certificateProfile: payment-mtls
        proxyProfile: corporate-egress
        headers:
          - name: Authorization
            value: "Bearer {{ steps.get-token.outputs.accessToken }}"
            sensitive: true
          - name: X-Correlation-ID
            value: "{{ generated.correlationId }}"
          - name: X-Timestamp
            value: "{{ generated.requestTimestamp }}"
          - name: X-Signature
            value: "{{ generated.requestSignature }}"
            sensitive: true
        body:
          type: JSON
          template: "{{ runtime.requestBody }}"
      extractors:
        - name: serviceState
          type: JSON_PATH
          path: $.status
          required: true
        - name: upstreamRequestId
          type: HEADER
          headerName: x-request-id
          required: false
      assertions:
        - name: Protected API returns HTTP 200
          type: STATUS_CODE
          operator: EQUALS
          expected: 200
        - name: Service state is healthy
          type: JSON_PATH
          path: $.status
          operator: EQUALS
          expected: HEALTHY
        - name: Response under two seconds
          type: TOTAL_DURATION
          operator: LESS_THAN
          expected: 2000
        - name: Server certificate has at least 30 days remaining
          type: TLS_DAYS_UNTIL_EXPIRY
          operator: GREATER_THAN
          expected: 30
```

---

## 61. Go Service Structure

```text
cmd/
  api/
  scheduler/
  worker/
  agent/
  notifier/

internal/
  authz/
  monitors/
  revisions/
  environments/
  suites/
  runs/
  alerts/
  audit/
  agents/
  scheduler/
  queue/
  executor/
    workflow/
    http/
    action/
    condition/
    delay/
    script/
    metric/
    certificate/
  runtimecontext/
  templating/
  expressions/
  variables/
  secrets/
    vault/
    encrypteddb/
  certificates/
  proxies/
  authentication/
  jwt/
  signing/
  extractors/
    jsonpath/
    xpath/
    header/
    cookie/
    regex/
  assertions/
    http/
    json/
    xml/
    schema/
    timing/
    tls/
    expression/
  masking/
  httpclient/
  retention/
  observability/
  storage/
  config/
```

---

## 62. Core Go Interfaces

### 62.1 Step Executor

```go
type StepExecutor interface {
    Type() StepType
    Execute(ctx context.Context, input StepExecutionInput) (StepExecutionResult, error)
}
```

### 62.2 Secret Provider

```go
type SecretProvider interface {
    ProviderType() string
    Get(ctx context.Context, ref SecretReference) (SensitiveValue, error)
    Test(ctx context.Context, ref SecretReference) error
}
```

### 62.3 Extractor

```go
type Extractor interface {
    Type() ExtractorType
    Extract(ctx context.Context, source ExtractionSource, config ExtractorConfig) (ExtractedValue, error)
}
```

### 62.4 Assertion

```go
type Assertion interface {
    Type() AssertionType
    Evaluate(ctx context.Context, source AssertionSource, config AssertionConfig) (AssertionResult, error)
}
```

### 62.5 Certificate Provider

```go
type CertificateProvider interface {
    LoadClientCertificate(ctx context.Context, profile CertificateProfile) (*tls.Certificate, CertificateMetadata, error)
    LoadTrustPool(ctx context.Context, profile CertificateProfile) (*x509.CertPool, error)
}
```

### 62.6 Proxy Resolver

```go
type ProxyResolver interface {
    Resolve(ctx context.Context, target *url.URL, profile ProxyProfile) (ProxyDecision, error)
}
```

### 62.7 Masker

```go
type Masker interface {
    RegisterSensitive(value SensitiveValue)
    MaskText(input string) string
    MaskJSON(input any) any
    MaskHeaders(headers http.Header) http.Header
}
```

---

## 63. TanStack Start Frontend Structure

```text
src/
  routes/
    __root.tsx
    index.tsx
    dashboard.tsx
    monitors/
      index.tsx
      new.tsx
      $monitorId.tsx
      $monitorId.edit.tsx
      $monitorId.runs.tsx
    runs/
      $runId.tsx
    certificates/
    proxies/
    secrets/
    auth-profiles/
    environments/
    agents/
    alerts/
    suites/
  components/
    app-shell/
    monitor-builder/
    request-editor/
    action-builder/
    assertion-builder/
    extractor-builder/
    variable-inspector/
    run-timeline/
    response-viewer/
    certificate-profile-form/
    proxy-profile-form/
  features/
    monitors/
    runs/
    configuration/
    alerts/
    suites/
  lib/
    api-client/
    query-keys/
    schemas/
    permissions/
    masking-display/
    formatters/
  server/
    auth/
    session/
    api-proxy/
```

Frontend implementation requirements:

- Use route loaders for critical page data.
- Use TanStack Query for server state and invalidation.
- Use optimistic concurrency for draft edits.
- Use Zod schemas generated from or aligned with backend contracts.
- Use shadcn/ui forms, dialogs, sheets, tabs, tables, command menus, tooltips, alerts, badges, and resizable panels.
- Use virtualized rendering for large run logs and long workflow lists.
- Do not store secret values in client state.

---

## 64. Security Requirements

### 64.1 Transport Security

- HTTPS is mandatory.
- Service-to-service communication should use mTLS or authenticated internal networking.
- Agent communication must be mutually authenticated.

### 64.2 Data Encryption

- Encrypt database disks and backups.
- Encrypt any locally stored secret value using envelope encryption.
- Use a managed key or Vault transit key for encryption.
- Never store encryption keys alongside encrypted data.

### 64.3 SSRF Protection

Because Rhythm makes user-configured outbound requests, SSRF protection is critical.

Required controls:

- Network policy and agent-level egress boundaries.
- Configurable allowlists and denylists.
- Block cloud metadata endpoints by default.
- Resolve and validate DNS destinations before connection.
- Revalidate redirect destinations.
- Prevent DNS rebinding where feasible.
- Restrict non-HTTP schemes.
- Restrict ports according to policy.
- Audit blocked requests.

### 64.4 Secret Access

- Fetch only secrets referenced by the selected revision.
- Enforce secret-level permissions.
- Avoid returning provider error bodies that may contain values.
- Cache secrets only for the minimum run duration unless provider policy allows safe caching.

### 64.5 Input Security

- Limit request and response sizes.
- Limit regex complexity and execution time.
- Limit template and expression complexity.
- Validate URLs and header names.
- Prevent newline injection in headers.
- Sanitize filenames in multipart data.

### 64.6 Auditability

All security-sensitive configuration changes must be auditable.

---

## 65. Observability of Rhythm

Rhythm itself must expose:

### Metrics

```text
Scheduled jobs created
Queue depth
Queue age
Runs by status
Step executions by type and status
Run duration histogram
HTTP timing histogram
Secret-provider latency and error rate
Proxy failures
TLS failures
Agent heartbeat age
Active workers
Worker concurrency
Alert notifications sent and failed
Database query latency
```

### Traces

A trace should cover:

```text
API request
Run scheduling
Queue delivery
Worker execution
Secret fetch
Each step
Each HTTP request attempt
Extraction
Assertion evaluation
Persistence
Notification
```

Sensitive request values must never be added as trace attributes.

### Logs

Structured JSON logs with:

```text
timestamp
level
service
requestId
runId
monitorId
revisionId
stepId
agentId
failureCategory
message
```

Logs must be passed through masking before emission.

---

## 66. Performance and Scale Targets

Initial production targets:

```text
10,000 configured monitors
2,000 enabled monitors
500 scheduled run starts per minute
100 concurrent runs per worker pool
50 steps per monitor
10 MB maximum downloaded response by default
30 days detailed run retention
13 months aggregate availability retention
```

API targets excluding large run payloads:

```text
p95 read API latency under 500 ms
p95 write API latency under 800 ms
Dashboard initial useful content under 2.5 seconds on internal network
Scheduled run dispatch within 15 seconds of due time for 99% of runs
```

These are design targets and should be revised after load testing.

---

## 67. Data Retention

Recommended defaults:

```text
Detailed successful runs: 30 days
Detailed failed runs: 90 days
Alert records: 13 months
Aggregate metrics: 13 months
Audit records: according to enterprise policy, recommended at least 13 months
Draft test runs: 7 days
Large masked artifacts: 7 to 30 days
```

Retention should be configurable by environment and policy.

---

## 68. Reliability and High Availability

Requirements:

- API service horizontally scalable.
- Scheduler uses leader election or distributed due-run claiming.
- Redis queue configured for durability appropriate to run jobs.
- Workers are stateless outside active run memory.
- Agent loss produces an explicit failure category.
- PostgreSQL backups and point-in-time recovery.
- Graceful shutdown allows workers to finish or checkpoint active runs.
- Queue jobs use retry and dead-letter handling.
- Notification failures do not alter monitor execution status.

---

## 69. Testing Strategy

### 69.1 Unit Tests

Cover:

```text
Template resolution
Sensitivity propagation
Masking
JWT algorithms
HMAC canonicalization
JSONPath and XPath extraction
Assertions
Proxy bypass matching
Certificate parsing
Retry eligibility
Schedule calculation
Condition evaluation
```

### 69.2 Integration Tests

Use local test servers for:

```text
OAuth token endpoint
mTLS server
Custom CA server
Expired certificate server
Redirect chains
Proxy with authentication
Slow responses
Connection resets
Malformed JSON/XML
Large response bodies
```

### 69.3 End-to-End Tests

Cover creation, publishing, scheduling, execution, run inspection, alert opening, and recovery.

### 69.4 Security Tests

Cover:

```text
SSRF attempts
Header injection
Secret leakage in logs
Secret leakage in UI payloads
Malicious regex
Script sandbox escape attempts
Large decompression payloads
Redirect to blocked host
Certificate hostname mismatch
Proxy credential masking
```

### 69.5 Load Tests

Test scheduler accuracy, queue age, worker concurrency, run persistence, dashboard queries, and high-cardinality telemetry.

---

## 70. MVP Delivery Plan

### Phase 0: Foundation

Build:

- Repository structure.
- TanStack Start shell.
- Go API skeleton.
- PostgreSQL migrations.
- Redis queue.
- Authentication and basic roles.
- Shared error and telemetry standards.

### Phase 1: Monitor Configuration

Build:

- Monitor CRUD.
- Draft and publish revision flow.
- Environment variables.
- Ordered workflow builder.
- HTTP request editor.
- Definition validation.

Outcome:

```text
Users can define and publish one-step and multi-step HTTP monitors.
```

### Phase 2: Manual Execution and Diagnostics

Build:

- Worker execution engine.
- Manual run.
- Request timing.
- Run history.
- Step timeline.
- Status, body, header, JSONPath, and response-time assertions.

Outcome:

```text
Users can execute monitors and understand failures.
```

### Phase 3: Chaining, Extractors, and Dynamic Data

Build:

- Runtime context.
- Template renderer.
- JSONPath, header, cookie, regex, status, and timing extractors.
- Generated timestamps, UUIDs, nonces, and random values.
- Dynamic JSON/XML/form bodies.
- Conditional execution.

Outcome:

```text
Users can call one API before another and reuse extracted values.
```

### Phase 4: Authentication and Signing

Build:

- Secret references.
- Vault provider.
- Basic, bearer, and API-key authentication.
- OAuth client credentials.
- JWT generation.
- HMAC generation and canonicalization.
- Sensitivity propagation and masking.

Outcome:

```text
Users can monitor authenticated and signed APIs without exposing credentials.
```

### Phase 5: Certificates and Proxies

Build:

- Certificate profiles.
- mTLS.
- Custom CA bundles.
- TLS diagnostics and expiry assertions.
- HTTP/HTTPS/SOCKS5 proxy profiles.
- Proxy authentication.
- No-proxy rules.
- Certificate and proxy test flows.

Outcome:

```text
Users can execute monitors through enterprise network paths and mutual TLS.
```

### Phase 6: Scheduling and Alerting

Build:

- Distributed scheduler.
- Concurrency policy.
- Retries and backoff.
- Email, Slack, and webhook notifications.
- Failure and recovery thresholds.
- Maintenance windows.

Outcome:

```text
Rhythm provides continuous monitoring with controlled alerting.
```

### Phase 7: Agents and Validation Suites

Build:

- Remote agents.
- Agent groups and capabilities.
- Suite orchestration.
- CI/CD trigger API.
- Machine-readable gate result.

Outcome:

```text
Rhythm supports internal network zones and deployment validation.
```

### Phase 8: Dynatrace Validation

Build:

- Dynatrace provider profile.
- CPU, memory, error-rate, response-time, and problem assertions.
- Pre/post deployment baseline comparison.

Outcome:

```text
Rhythm can combine synthetic checks with application telemetry gates.
```

---

## 71. MVP Acceptance Criteria

The core MVP is accepted when all of the following are true:

1. A user can create, edit, validate, publish, clone, enable, disable, and archive a monitor.
2. A monitor can contain multiple ordered HTTP and action steps.
3. A user can generate a timestamp, UUID, nonce, JWT, SHA hash, and HMAC signature.
4. A user can fetch an OAuth access token and use it in a later request.
5. A user can build a dynamic JSON, XML, form, or raw request body.
6. A user can extract data using JSONPath, header, cookie, regex, status, and timing extractors.
7. A user can apply status, header, body, JSONPath, schema, timing, and TLS assertions.
8. A user can configure a client certificate and custom CA bundle through secret references.
9. A user can route requests through an HTTP, HTTPS, or SOCKS5 proxy.
10. Proxy and certificate failures are distinguishable from target API failures.
11. Scheduled and manual runs execute the same immutable revision model.
12. Secrets, tokens, signatures, private keys, and sensitive fields are never returned unmasked.
13. The run page shows step-level attempts, timings, extractors, assertions, TLS, proxy, and safe request/response diagnostics.
14. Retries respect idempotency and configured failure categories.
15. Alerts open after the configured failure threshold and resolve after the recovery threshold.
16. All meaningful configuration changes are auditable.
17. Rhythm can execute at least the full reference workflow in Section 60.

---

## 72. Success Metrics

Product metrics:

```text
Percentage of monitors created without custom code
Median time to create a production-ready monitor
Percentage of failures with a specific failure category
Mean time from failure to identified failed step
Percentage of alert incidents auto-resolved correctly
Number of applications replacing custom monitoring scripts
Monitor execution success rate excluding target failures
Schedule dispatch accuracy
Secret leakage incidents: target zero
```

Recommended initial goals:

```text
90% of failed runs have a specific non-UNKNOWN failure category
95% of scheduled runs start within 15 seconds of due time
100% of persisted run artifacts pass automated secret-leak tests
80% of common authentication journeys require no script step
50% reduction in custom API-monitor scripts for onboarded applications
```

---

## 73. Risks and Mitigations

### Risk: Secret leakage

Mitigation:

- Sensitivity tagging.
- Run-local redaction dictionary.
- Mask before persistence and logging.
- Automated leakage tests.
- Restricted capture policies.

### Risk: SSRF and internal network abuse

Mitigation:

- Agent egress policy.
- Destination allowlists.
- Metadata endpoint blocking.
- Redirect revalidation.
- RBAC and audit.

### Risk: Arbitrary script abuse

Mitigation:

- Prefer controlled actions.
- Strict sandbox.
- CPU and memory limits.
- No network/filesystem/process access.

### Risk: Duplicate scheduled runs

Mitigation:

- Idempotency keys.
- Durable due-run claiming.
- Distributed locks.
- Concurrency policy.

### Risk: Alert fatigue

Mitigation:

- Failure and recovery thresholds.
- Deduplication.
- Cooldowns.
- Maintenance windows.
- Clear warning versus error semantics.

### Risk: Certificate and proxy complexity

Mitigation:

- Reusable profiles.
- Test connection action.
- Precise failure categories.
- Inheritance preview.
- Safe diagnostics.

### Risk: Historical runs become uninterpretable after edits

Mitigation:

- Immutable monitor revisions.
- Versioned referenced profiles or snapshots.

---

## 74. Future Roadmap

Potential future capabilities:

```text
Postman collection import
OpenAPI import and monitor generation
GraphQL-specific operation builder
gRPC synthetic checks
WebSocket checks
DNS and raw TCP checks
Browser monitoring
Multi-region comparison
Kubernetes validation steps
ServiceNow incident integration
PagerDuty and Microsoft Teams notifications
SLO and error-budget views
AI-assisted monitor creation and diagnosis
Reusable workflow components
Approved loop and polling step
Test-data generators
Encrypted artifact attachments
Public status-page integration
k6 export or controlled load validation
```

---

## 75. Final Product Definition

Rhythm is not only an uptime checker. It is a secure workflow execution and validation platform capable of reproducing how a real client reaches and uses an API.

The first production release should include:

```text
TanStack Start and shadcn/ui frontend
Go API, scheduler, and workers
Monitor draft and revision management
Multi-step workflow builder
HTTP request execution
Dynamic URL, headers, query, cookies, and body construction
JWT generation
OAuth token acquisition
Timestamp, UUID, nonce, and random generation
HMAC and hashing
Variables and typed runtime context
Secrets and secure masking
Extractors
Assertions
mTLS and certificate validation
Custom trust bundles
Proxy profiles and bypass rules
Retries, timeouts, and scheduling
Run history and detailed diagnostics
Basic alerting and recovery
Audit logging
Remote-agent-ready architecture
```

The design must remain extensible so that deployment-validation suites and Dynatrace CPU, memory, error-rate, and response-time gates can be added without rewriting the workflow engine.

---

## 76. Definition of Done

Rhythm v1 is complete when a user can configure the following workflow entirely through the UI and execute it manually or on schedule:

```text
Load variables and secret references
Load a client certificate and trust bundle
Choose an authenticated proxy
Generate a timestamp, UUID, and nonce
Generate an RS256 JWT
Call an OAuth token endpoint
Extract the access token
Build a dynamic request body
Generate a canonical HMAC signature
Call a protected mTLS API through the proxy
Extract business data from the response
Validate HTTP, body, timing, and TLS requirements
Run cleanup steps
Store only masked diagnostics
Open an alert after repeated failure
Resolve the alert after confirmed recovery
```

That end-to-end journey is the minimum proof that Rhythm delivers its intended value.
