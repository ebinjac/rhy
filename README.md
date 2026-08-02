# Rhythm

Synthetic API monitoring, workflow validation, and deployment assurance.

## Run the local stack

Docker Desktop and Docker Compose are the only requirements.

```bash
docker compose up --build -d
docker compose ps
```

The stack includes PostgreSQL, Redis, MinIO, the database migration job, the Go API, the isolated JavaScript script runner, the browser agent, and the TanStack frontend. OpenSearch is not bundled — configure ELF against your shared/production cluster in the UI (or optionally set `RHYTHM_ELF_BOOTSTRAP_URL`).

```text
Frontend:   http://localhost:3100
API:        http://localhost:18080
API health: http://localhost:18080/healthz
PostgreSQL: localhost:55432
Redis:      localhost:56379
```

Ports can be overridden with `RHYTHM_WEB_PORT`, `RHYTHM_API_PORT`, `RHYTHM_POSTGRES_PORT`, and `RHYTHM_REDIS_PORT`.

Local Compose sets `RHYTHM_SECRETS_ENCRYPTION_KEY` on the API so Configuration → Secrets can store AES-GCM–encrypted values. Override it for any shared environment; without a valid 32-byte key (base64 or hex), only ENV/Vault secret references work.

Alert email defaults to the QA SMTP relay (`SMTP_HOST`, `SMTP_PORT=25`, `SMTP_FROM` / `SMTP_FROM_EMAIL`, optional `SMTP_FROM_NAME`) with no authentication. Override those env vars (or `RHYTHM_SMTP_*` aliases) as needed. Configure channels under **Configuration → Notifications**, and per-application destinations under **Applications**.

Useful commands:

```bash
docker compose logs -f api script-runner web
docker compose restart api script-runner web
docker compose down
docker compose down -v # also removes local Rhythm data
```

### ELF / OpenSearch

Configure ELF connection settings in the product (**ELF → Settings**) against your production or shared OpenSearch URL. Local Compose no longer starts OpenSearch, Dashboards, `elf-seed`, or `demo-log-generator`.

The frontend container runs the Vite development server for the current local-development phase. PostgreSQL and Redis data are retained in named Docker volumes.

## Implemented product surfaces

- Postman-style HTTP workbench with params, headers, JSON/XML/form/multipart/raw bodies, cookies, Basic/Bearer/API key/OAuth/JWT/HMAC auth, controlled actions, extractors, assertions, TLS, proxy, redirects, retries, compression, and evidence limits.
- Monitor- and request-level JavaScript pre-request scripts with a Monaco editor, preview (including `pm.sendRequest`), Postman-familiar `pm` variables/request/cookies/tests/vault APIs, cryptography, masked evidence, and a resource-limited isolated runtime.
- Ordered HTTP, action, conditional, and Dynatrace metric-validation steps with secret-safe output chaining and a shared per-run cookie jar.
- Draft editing, validation, immutable publishing, revision history/restore/diff/export, cloning, enable/disable/archive, and explicit draft or published manual runs.
- PostgreSQL-backed run history with per-attempt diagnostics, DNS/TCP/TLS/TTFB timings, assertions, extractors, TLS/proxy evidence, exact-value redaction, and specific failure categories.
- Interval and cron scheduling through PostgreSQL and Redis, with idempotent due-job claims and published-revision execution.
- Threshold alerts with acknowledgement/recovery and transactional Slack, webhook, or SMTP email delivery (global channel + per-application destination emails) through governed secret references.
- Staged deployment-validation suites with parallelism, fail-fast/required checks, timeout/cancellation, persisted results, and machine-readable pipeline gate decisions.
- Execution-agent registration, heartbeat health, groups/tags/capabilities, drain/activate/revoke lifecycle, capacity-aware routing, and run attribution.
- Administrator, Editor, Operator, and Viewer authorization rules, mutation audit history, and governed environment/secret/certificate/proxy/auth/notification/telemetry profiles.
- Secrets as named aliases (`secret://alias`, `pm.vault.get`) with three providers: **LOCAL** (AES-GCM encrypted values in PostgreSQL), **ENV** (API process environment), and **VAULT** (HashiCorp KV v1/v2). List APIs never return decrypted values. Set `RHYTHM_SECRETS_ENCRYPTION_KEY` (32-byte key as base64 or hex; aliases `RHYTHM_SECRETS_KEY` / `SECRETS_ENCRYPTION_KEY`) for stored secrets. Vault deployments also provide `RHYTHM_VAULT_ADDR` and `RHYTHM_VAULT_TOKEN`.

Primary UI routes:

```text
/                     System overview
/monitors             Monitor operations
/monitors/new         New workflow workbench
/alerts               Alert inbox
/suites               Deployment validation gates
/agents               Execution agent fleet
/audit                Audit history
/configuration        Governed profile library
```

Runtime safety defaults include private/reserved-address SSRF blocking, DNS revalidation, TLS 1.2 minimum and hostname verification, bounded timeouts/bodies/redirects/retries, idempotency enforcement for unsafe retries, and redaction before persistence.

The Compose profile uses the development authenticator and an Administrator principal (`local-admin`). Non-development runtimes reject this mode. Hydra uses verified identity headers from the front door, trusted-proxy CIDR enforcement, and corporate group-to-role mappings.

## Deploy to Hydra

Production uses four workload-aligned services backed by managed PostgreSQL,
Redis Enterprise, AWS S3, Vault, and corporate certificates:

- `rhythm-frontdoor`: two steady web/API pods.
- `rhythm-control`: one scheduler and background-orchestration pod.
- `rhythm-api-executor`: three pods scaling to twelve, with 256 run slots each.
- `rhythm-browser-executor`: one Chromium pod scaling to four.

Start with the [Hydra deployment package](deploy/hydra/README.md). It contains
four service-owned Dockerfiles, four separate workflow URLs, per-service Vault
inventories, E1/E2/E3 IPC values, internal Hydra DNS, the predictive-scaling
contract, and an independent Liquibase workflow. Run `npm run hydra:check` and
`npm run migrations:check` before every database or application release. The
production package does not replace or alter local Compose.

## Run checks

```bash
npm run test:api
npm run migrations:check
npm run typecheck
npm run lint --workspace web
npm run build --workspace web
```
# rhy
