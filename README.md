# Rhythm

Synthetic API monitoring, workflow validation, and deployment assurance.

## Run the local stack

Docker Desktop and Docker Compose are the only requirements.

```bash
docker compose up --build -d
docker compose ps
```

The stack includes PostgreSQL, Redis, OpenSearch, OpenSearch Dashboards, a continuously running demo-log generator, the database migration job, the Go API, the isolated JavaScript script runner, and the TanStack frontend.

```text
Frontend:   http://localhost:3100
API:        http://localhost:18080
API health: http://localhost:18080/healthz
PostgreSQL: localhost:55432
Redis:      localhost:56379
OpenSearch: http://localhost:19200
Dashboards: http://localhost:15601/app/discover
Mailpit:    http://localhost:18025
```

Ports can be overridden with `RHYTHM_WEB_PORT`, `RHYTHM_API_PORT`, `RHYTHM_POSTGRES_PORT`, `RHYTHM_REDIS_PORT`, `RHYTHM_OPENSEARCH_PORT`, `RHYTHM_OPENSEARCH_DASHBOARDS_PORT`, and `RHYTHM_MAILPIT_PORT`.

Local Compose sets `RHYTHM_SECRETS_ENCRYPTION_KEY` on the API so Configuration → Secrets can store AES-GCM–encrypted values. Override it for any shared environment; without a valid 32-byte key (base64 or hex), only ENV/Vault secret references work.

Local Compose includes [Mailpit](https://mailpit.axllent.org/) and seeds SMTP alert email defaults (`SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_FROM=rhythm-alerts@localhost`, no auth). Captured messages are visible at [localhost:18025](http://localhost:18025). Override with `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and optional `SMTP_TO` fallback recipients (or the `RHYTHM_SMTP_*` aliases). Configure channels under **Configuration → Notifications**, and per-application destinations under **Applications**.

Useful commands:

```bash
docker compose logs -f api script-runner web
docker compose restart api script-runner web
docker compose down
docker compose down -v # also removes local Rhythm data
```

### Local ELF demo data

The `elf-seed` job creates the `app-logs-demo-*` data view and a reproducible baseline covering successful requests, HTTP 4xx/5xx responses, validation errors, slow requests, dependency timeouts, database failures, retries, queue pressure, authentication/authorization events, and deployments. The `demo-log-generator` service then adds a fresh event every ten seconds.

Rhythm registers a **Demo Storefront** application (`CAR-DEMO-1001`), six services, service-specific index overrides, and five ready-to-run queries covering exact hit counts, latency ranges, authentication failures, dependency errors, and an average-latency aggregation. Open **ELF → Settings → Open Dashboards**, or go directly to [OpenSearch Discover](http://localhost:15601/app/discover). The default `app-logs-demo-*` data view and the last-15-minutes time range are preconfigured.

To watch the generator or reload the fixed baseline:

```bash
docker compose logs -f demo-log-generator
docker compose run --rm elf-seed
```

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

The Compose profile uses the development authenticator and an Administrator principal (`local-admin`). Production deployments should replace it with the organization identity provider and machine identity for agents before exposure outside a trusted environment.

## Run checks

```bash
npm run test:api
npm run typecheck
npm run lint --workspace web
npm run build --workspace web
```
# rhy
