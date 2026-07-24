# Rhythm API

The Go system-of-record API for Rhythm. It supports PostgreSQL for the Docker stack and an in-memory repository for zero-setup development and tests.

## Run locally

```bash
npm run dev:api
```

The API listens on `:8080` by default and exposes:

- `GET /healthz`
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
RHYTHM_ALLOWED_ORIGIN=http://localhost:3000
RHYTHM_DEVELOPMENT_ACTOR_ID=local-admin
RHYTHM_STORAGE_MODE=memory
RHYTHM_DATABASE_URL=postgres://rhythm:rhythm@localhost:5432/rhythm?sslmode=disable
RHYTHM_REDIS_URL=redis://localhost:6379/0
RHYTHM_ALLOW_PRIVATE_TARGETS=false
```

Outbound execution blocks private, loopback, link-local, multicast, and reserved targets by default. Set `RHYTHM_ALLOW_PRIVATE_TARGETS=true` only for an isolated development environment that intentionally monitors internal services.

To use PostgreSQL, set `RHYTHM_STORAGE_MODE=postgres`, provide `RHYTHM_DATABASE_URL`, and run `npm run migrate:api` before starting the API. The default `memory` mode remains available for zero-setup development and automated tests.

The development authenticator is intentionally isolated behind the `Authenticator` interface. It must be replaced before a production deployment.
