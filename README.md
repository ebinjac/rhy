# Rhythm

Synthetic API monitoring, workflow validation, and deployment assurance.

## Run the local stack

Docker Desktop and Docker Compose are the only requirements.

```bash
docker compose up --build -d
docker compose ps
```

The default stack includes PostgreSQL, MinIO, the database migration job, the Go API, the isolated JavaScript script runner, the browser agent, and the TanStack frontend. PostgreSQL is also the default durable queue, so Redis is not required. OpenSearch is not bundled — configure ELF against your shared/production cluster in the UI (or optionally set `RHYTHM_ELF_BOOTSTRAP_URL`).

```text
Frontend:   http://localhost:3100
API:        http://localhost:18080
API health: http://localhost:18080/healthz
PostgreSQL: localhost:55432
```

Ports can be overridden with `RHYTHM_WEB_PORT`, `RHYTHM_API_PORT`, and `RHYTHM_POSTGRES_PORT`.

Local Compose sets `RHYTHM_SECRETS_ENCRYPTION_KEY` on the API so Configuration → Secrets can store AES-GCM–encrypted values. Override it for any shared environment. Without a valid 32-byte key (base64 or hex), Rhythm refuses to create or decrypt application secrets.

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

The frontend container runs the production TanStack server. PostgreSQL data and MinIO artifacts are retained in named Docker volumes.

To test the retained Redis Streams transport later:

```bash
RHYTHM_QUEUE_BACKEND=redis \
RHYTHM_REDIS_URL=redis://redis:6379/0 \
docker compose --profile redis up --build -d
```

## Implemented product surfaces

- Postman-style HTTP workbench with params, headers, JSON/XML/form/multipart/raw bodies, cookies, Basic/Bearer/API key/OAuth/JWT/HMAC auth, controlled actions, extractors, assertions, TLS, proxy, redirects, retries, compression, and evidence limits.
- Monitor- and request-level JavaScript pre-request scripts with a Monaco editor, preview (including `pm.sendRequest`), Postman-familiar `pm` variables/request/cookies/tests/vault APIs, cryptography, masked evidence, and a resource-limited isolated runtime.
- Ordered HTTP, action, conditional, and Dynatrace metric-validation steps with secret-safe output chaining and a shared per-run cookie jar.
- Draft editing, validation, immutable publishing, revision history/restore/diff/export, cloning, enable/disable/archive, and explicit draft or published manual runs.
- PostgreSQL-backed run history with per-attempt diagnostics, DNS/TCP/TLS/TTFB timings, assertions, extractors, TLS/proxy evidence, exact-value redaction, and specific failure categories.
- Interval and cron scheduling through PostgreSQL, with idempotent due-job claims and published-revision execution. Redis Streams remain an optional transport.
- Threshold alerts with acknowledgement/recovery and transactional Slack, webhook, or SMTP email delivery (global channel + per-application destination emails) through governed secret references.
- Staged deployment-validation suites with parallelism, fail-fast/required checks, timeout/cancellation, persisted results, and machine-readable pipeline gate decisions.
- Execution-agent registration, heartbeat health, groups/tags/capabilities, drain/activate/revoke lifecycle, capacity-aware routing, and run attribution.
- Administrator, Editor, Operator, and Viewer authorization rules, mutation audit history, and governed environment/secret/certificate/proxy/auth/notification/telemetry profiles.
- Secrets are named aliases whose values are AES-GCM encrypted in PostgreSQL. Request templates use `{{secrets.alias}}`; Postman-compatible scripts may use `pm.vault.get("alias")` as an accessor to the same database-backed store. List APIs never return decrypted values. Set `RHYTHM_SECRETS_ENCRYPTION_KEY` (32-byte key as base64 or hex; aliases `RHYTHM_SECRETS_KEY` / `SECRETS_ENCRYPTION_KEY`).

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

This installation enables unrestricted HTTP(S) destinations, including private and reserved networks. TLS 1.2 minimum, hostname verification, bounded timeouts/bodies/redirects/retries, idempotency enforcement for unsafe retries, and redaction before persistence remain enabled.

Compose and Hydra use one shared anonymous Administrator principal. No login or identity headers are required; anyone who can reach the application can use every product capability.

## Deploy to Hydra

Production uses four workload-aligned services backed by managed PostgreSQL,
PostgreSQL-backed jobs, optional Redis Enterprise, AWS S3, Hydra runtime-secret injection, and corporate certificates:

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
