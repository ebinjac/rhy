# Rhythm

Synthetic API monitoring, workflow validation, and deployment assurance.

## Run the local stack

Docker Desktop and Docker Compose are the only requirements.

```bash
docker compose up -d postgres
docker compose build rhythm-control
docker compose run --rm --entrypoint /opt/rhythm/bin/rhythm-migrate rhythm-control
docker compose up --build -d rhythm-frontdoor rhythm-control rhythm-api-executor rhythm-browser-executor
docker compose ps
```

The local application uses the same four runtime boundaries as Hydra: `rhythm-frontdoor`, `rhythm-control`, `rhythm-api-executor`, and `rhythm-browser-executor`. PostgreSQL is the local stand-in for managed PostgreSQL. Browser artifacts go to the S3-compatible store configured in the gitignored `.env` (`RHYTHM_ARTIFACT_STORE_*`; see `.env.example`). Compose still ships a MinIO service if you point those variables back at `http://minio:9000`. The migration is an ephemeral command, not a fifth running Rhythm service. PostgreSQL is Rhythm's durable queue and coordination store.

```text
Frontend:   http://localhost:3100
API:        http://localhost:3100/api/v1
Health:     http://localhost:3100/healthz
PostgreSQL: localhost:55432
```

Ports can be overridden with `RHYTHM_WEB_PORT` and `RHYTHM_POSTGRES_PORT`.

Local Compose sets `RHYTHM_SECRETS_ENCRYPTION_KEY` on the API so Configuration → Secrets can store AES-GCM–encrypted values. Override it for any shared environment. Without a valid 32-byte key (base64 or hex), Rhythm refuses to create or decrypt application secrets.

Alert email defaults to the QA SMTP relay (`SMTP_HOST=usphx-smtp-qa.axp.com`, `SMTP_PORT=25`, `SMTP_FROM` / `SMTP_FROM_EMAIL`, optional `SMTP_FROM_NAME`) with no authentication. Override those env vars (or `RHYTHM_SMTP_*` aliases) as needed. Configure channels under **Configuration → Notifications**, and per-application destinations under **Applications**.

Useful commands:

```bash
docker compose logs -f rhythm-frontdoor rhythm-control rhythm-api-executor rhythm-browser-executor
docker compose restart rhythm-frontdoor rhythm-control rhythm-api-executor rhythm-browser-executor
docker compose down
docker compose down -v # also removes local Rhythm data
```

### ELF / OpenSearch

Configure ELF connection settings in the product (**ELF → Settings**) against your production or shared OpenSearch URL. Local Compose no longer starts OpenSearch, Dashboards, `elf-seed`, or `demo-log-generator`.

The frontend container runs the production TanStack server. PostgreSQL data is retained in a named Docker volume. Artifact objects live in the configured S3 bucket.

### Standalone profile (one container)

The combined image is the local analog of the Hydra presentation pod. It still
needs PostgreSQL and a completed migration. Port 3200 avoids colliding with the
four-service stack on 3100.

```bash
docker compose up -d postgres
docker compose --profile standalone build rhythm-standalone
docker compose --profile standalone run --rm --entrypoint /opt/rhythm/bin/rhythm-migrate rhythm-standalone
docker compose --profile standalone up -d rhythm-standalone
curl -fsS http://localhost:3200/health
curl -fsS http://localhost:3200/readyz
```

```text
Frontend: http://localhost:3200
API:      http://localhost:3200/api/v1
Health:   http://localhost:3200/health
```

UI work does not need an image rebuild. Keep standalone on 3200 and run Vite:

```bash
npm run dev:web
```

```text
HMR UI: http://localhost:3000
API:    standalone :3200 (Vite proxies /api/v1)
```

Rebuild `rhythm-standalone` only for Go/API, Dockerfile, or production web packaging changes.

Do not enable monitor schedules until a manual run succeeds. UI monitors also
need artifact-store variables in `.env` (or MinIO pointed at `http://minio:9000`).
Optional Ask Rhythm seeding uses `RHYTHM_AI_OPENROUTER_API_KEY` in `.env`.

## Implemented product surfaces

- Postman-style HTTP workbench with params, headers, JSON/XML/form/multipart/raw bodies, cookies, Basic/Bearer/API key/OAuth/JWT/HMAC auth, controlled actions, extractors, assertions, TLS, proxy, redirects, retries, compression, and evidence limits.
- Monitor- and request-level JavaScript pre-request scripts with a Monaco editor, preview (including `pm.sendRequest`), Postman-familiar `pm` variables/request/cookies/tests/vault APIs, cryptography, masked evidence, and a resource-limited isolated runtime.
- Ordered HTTP, action, conditional, and Dynatrace metric-validation steps with secret-safe output chaining and a shared per-run cookie jar.
- Draft editing, validation, immutable publishing, revision history/restore/diff/export, cloning, enable/disable/archive, and explicit draft or published manual runs.
- PostgreSQL-backed run history with per-attempt diagnostics, DNS/TCP/TLS/TTFB timings, assertions, extractors, TLS/proxy evidence, exact-value redaction, and specific failure categories.
- Interval and cron scheduling through PostgreSQL, with idempotent due-job claims and published-revision execution.
- Threshold alerts with acknowledgement/recovery and transactional Slack, webhook, or SMTP email delivery (global channel + per-application destination emails) through governed secret references.
- Staged deployment-validation suites with parallelism, fail-fast/required checks, timeout/cancellation, persisted results, and machine-readable pipeline gate decisions.
- Execution-agent registration, heartbeat health, groups/tags/capabilities, drain/activate/revoke lifecycle, capacity-aware routing, and run attribution.
- Mutation audit history and governed environment/secret/certificate/proxy/auth/notification/telemetry profiles.
- Secrets are named aliases whose values are AES-GCM encrypted in PostgreSQL. Request templates use `{{secrets.alias}}`; Postman-compatible scripts may use `pm.vault.get("alias")` as an accessor to the same database-backed store. List APIs never return decrypted values. Set `RHYTHM_SECRETS_ENCRYPTION_KEY` (32-byte key as base64 or hex; aliases `RHYTHM_SECRETS_KEY` / `SECRETS_ENCRYPTION_KEY`).

Primary UI routes:

```text
/                     System overview
/monitors             API monitor operations
/monitors/new         New workflow workbench
/ui-monitoring        Browser journeys
/alerts               Alert inbox
/ai                   Ask Rhythm
/suites               Deployment validation gates
/audit                Audit history
/configuration        Governed profile library
```

This installation enables unrestricted HTTP(S) destinations, including private and reserved networks. TLS 1.2 minimum, hostname verification, bounded timeouts/bodies/redirects/retries, idempotency enforcement for unsafe retries, and redaction before persistence remain enabled.

Compose and Hydra use one shared anonymous Administrator principal. No login or identity headers are required; anyone who can reach the application can use every product capability.

## Deploy to Hydra

Production uses four workload-aligned services backed by managed PostgreSQL,
PostgreSQL-backed jobs, AWS S3, Hydra runtime-secret injection, and corporate certificates:

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
