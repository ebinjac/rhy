# Rhythm API

The Go system-of-record API for Rhythm. It supports PostgreSQL for the Docker stack and an in-memory repository for zero-setup development and tests.

## Run locally

```bash
npm run dev:api
```

The API listens on `:8080` by default and exposes:

- `GET /health`, `GET /healthz`, and `GET /livez` — dependency-free process liveness
- `GET /readyz` — PostgreSQL, S3, runner, and schema diagnostics
- `GET /api/v1/monitors`
- `POST /api/v1/monitors`
- `GET /api/v1/monitors/{monitorId}`
- `PATCH /api/v1/monitors/{monitorId}` (requires the `If-Match` ETag returned by `GET`)
- `DELETE /api/v1/monitors/{monitorId}`
- `GET /api/v1/monitors/{monitorId}/revisions`
- `POST /api/v1/monitors/{monitorId}/runs` (runs the current draft)
- `GET /api/v1/monitors/{monitorId}/runs`
- `GET /api/v1/runs/{runId}`

Configuration:

```text
RHYTHM_HTTP_ADDR=:8080
RHYTHM_ALLOWED_ORIGIN=*
RHYTHM_AUTH_MODE=anonymous
RHYTHM_DEVELOPMENT_ACTOR_ID=anonymous
RHYTHM_STORAGE_MODE=memory
RHYTHM_DATABASE_URL=postgres://rhythm:rhythm@localhost:5432/rhythm?sslmode=disable
RHYTHM_UNRESTRICTED_OUTBOUND=true
```

Outbound execution accepts any HTTP(S) hostname by default, including private, loopback, link-local, multicast, and reserved targets. TLS verification and evidence masking remain active.

To use PostgreSQL, set `RHYTHM_STORAGE_MODE=postgres`, provide `RHYTHM_DATABASE_URL`, and run `npm run migrate:api` before starting the API. PostgreSQL then provides both persistence and asynchronous job coordination. The default `memory` mode remains available only for zero-setup development and automated tests.

Anonymous mode assigns every request the shared Administrator principal and requires no login or identity headers.

Long-running services create PostgreSQL and artifact clients without an
initial network probe. This allows a configured pod to start during an outage;
operations retry through their normal loops and `/readyz` reports unavailable
components. Migration commands remain fail-fast because applying schema changes
without a database is not meaningful.

Application secrets have one storage mode: AES-GCM encrypted values in
PostgreSQL, referenced by plain alias. External and environment-backed secret
profiles are not accepted.
