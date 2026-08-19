# Rhythm API Test Lab

The Rhythm API Test Lab is a disposable local and CI target for exercising API
monitoring features without depending on public services. It deliberately exposes
successful, failing, slow, malformed, stateful, authenticated, proxied, and TLS
behaviors. It is not part of any Rhythm production or Hydra deployment.

> Test-only software. The fixed credentials and generated certificates in this
> directory are fixtures, not secrets. Never deploy this service to a shared or
> production environment.

## Start it

```bash
cd test-lab
docker compose up --build --wait
curl http://localhost:9080/health
```

Or from the repository root:

```bash
npm run test-lab:run
```

The service is immediately available on:

| Listener | Address | Purpose |
|---|---|---|
| HTTP | `http://localhost:9080` | Normal requests and most scenarios |
| Proxy | `http://localhost:9081` | Forward and CONNECT proxy tests |
| Trusted TLS | `https://localhost:9443` | Custom-CA validation |
| mTLS | `https://localhost:9444` | Required client-certificate validation |
| Self-signed | `https://localhost:9445` | Untrusted-certificate failure |
| Wrong host | `https://localhost:9446` | Hostname-validation failure |

Export the generated CA and client fixtures after Compose starts:

```bash
./scripts/export-test-certs.sh
curl --cacert certs/generated/ca.crt https://localhost:9443/tls
curl --cacert certs/generated/ca.crt \
  --cert certs/generated/client.crt \
  --key certs/generated/client.key \
  https://localhost:9444/mtls
```

## Fixture credentials

| Scenario | Credential |
|---|---|
| Basic | `rhythm` / `rhythm-test` |
| Bearer | `rhythm-test-token` |
| API key | `rhythm-api-key` |
| HMAC | client `rhythm-client`, secret `rhythm-hmac-secret` |
| MAC | key `rhythm-mac-key`, secret `rhythm-mac-secret` |
| Application token | client `rhythm-app-client`, Base64 secret `cmh5dGhtLWFwcC1zZWNyZXQ=` |
| JWT HS256 | `rhythm-jwt-secret` |
| Proxy (when enabled) | `rhythm` / `rhythm-proxy` |

All values are intentionally public test fixtures. The service masks authorization,
cookie, API-key, and other sensitive headers from echo responses and request logs by
default.

## Scenario map

The full machine-readable catalog is available from `GET /scenarios` and
`GET /openapi.json`. Important groups include:

- Discovery: `/`, `/health`, `/ready`, `/version`, `/scenarios`.
- Request inspection: `/api/echo`, `/api/query`, `/api/headers`, `/api/method`.
- Authentication: `/auth/basic`, `/auth/bearer`, `/auth/api-key`,
  `/auth/hmac`, `/auth/mac`, `/auth/application-token`, and `/auth/jwt/*`.
- Stateful flows: `/cookies/*`, `/workflow/*`, `/chain/*`, `/rate-limit`,
  `/unstable/{successAfter}`.
- Response formats: `/response/json*`, `/response/text`, `/response/xml`,
  `/response/malformed-json`, `/response/large/{size}`, and `/response/binary`.
- Transport: `/delay*`, `/redirect/*`, `/compression/*`, `/stream`, `/upload`,
  `/form`, `/tls`, and `/mtls`.
- Assertions and extraction: `/extract/*`, `/validation/schema`,
  `/validate/json`, `/validate/dynamic-body`, and `/trace/*`.
- Operations: `/metrics/test-lab` and `POST /admin/reset`.

See [TEST_MATRIX.md](TEST_MATRIX.md) for the exact feature-to-endpoint mapping.

## Examples

```bash
curl -u rhythm:rhythm-test http://localhost:9080/auth/basic
curl -H 'Authorization: Bearer rhythm-test-token' http://localhost:9080/auth/bearer
curl -H 'X-API-Key: rhythm-api-key' http://localhost:9080/auth/api-key
curl -c /tmp/rhythm-cookies -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"rhythm","password":"rhythm-test"}' \
  http://localhost:9080/cookies/login
curl -b /tmp/rhythm-cookies http://localhost:9080/cookies/profile
curl -x http://localhost:9081 http://localhost:9080/api/echo
curl -x http://localhost:9081 --cacert certs/generated/ca.crt \
  https://rhythm-test-lab:9443/tls
```

Set `TEST_LAB_PROXY_REQUIRE_AUTH=true` to exercise a `407` response, then use
`curl -x http://rhythm:rhythm-proxy@localhost:9081 …`. Use the normal proxy bypass
configuration with `NO_PROXY=localhost,127.0.0.1` to verify direct routing.

HMAC, MAC, token-chain, JWT, cookie, extractor, and multi-step examples are under
`fixtures/pre-request/`. The Postman assets are under `fixtures/postman/`, while
`fixtures/rhythm/api-test-lab-monitor.json` is importable into Rhythm.

## Configuration

Every option is environment-driven. Useful switches include:

| Variable | Default | Description |
|---|---|---|
| `TEST_LAB_ENVIRONMENT` | `development` | Startup guard rejects `production`, `prod`, and `e3` |
| `TEST_LAB_ALLOW_PRODUCTION` | `false` | Explicit escape hatch; never set in normal use |
| `TEST_LAB_DETERMINISTIC` | `false` | Stable IDs and pseudo-random behavior for CI |
| `TEST_LAB_ADMIN_ENABLED` | `true` | Enables the state reset endpoint |
| `TEST_LAB_ECHO_SENSITIVE` | `false` | Returns sensitive headers only when explicitly enabled |
| `TEST_LAB_MAC_REPLAY_PROTECTION` | `true` | Rejects repeated MAC nonce/timestamp pairs |
| `TEST_LAB_PROXY_REQUIRE_AUTH` | `false` | Requires the fixed proxy credential |
| `TEST_LAB_MAX_BODY_BYTES` | `2097152` | Maximum request body |
| `TEST_LAB_MAX_UPLOAD_BYTES` | `10485760` | Maximum multipart upload |

The service is concurrency-safe and keeps state only in memory. Restarting it clears
sessions, workflows, retry counters, rate windows, nonces, and metrics.

## Testing

```bash
./scripts/test.sh
docker compose up --build --wait
cd ../services/api
TEST_LAB_URL=http://localhost:9080 \
  go test -tags=testlab_integration ./internal/runs
```

The first command includes Go race detection. The tagged integration test sends real
requests through Rhythm's production `HTTPExecutor`, including scripts, extraction,
cookies, HMAC/MAC, retries, and token chaining.

Register the curated Test Lab monitor collection in a running local Rhythm instance:

```bash
node scripts/register-rhythm-monitors.mjs --run
```

The registration is idempotent. It publishes six grouped monitors without enabling a
schedule; `--run` also executes each monitor once. Override `RHYTHM_API_URL` or
`TEST_LAB_TARGET_URL` when Rhythm is not using the standard local Compose topology.

## Production isolation

- `test-lab/` is excluded by the repository `.dockerignore` used by Rhythm images.
- No Hydra service catalog, image, deployment workflow, runtime role, or Compose
  production profile references the Test Lab.
- Its CI workflow is path-scoped and launches only the dedicated Compose file.
- Startup fails in production-like environments unless a conspicuous override is set.
- The service has no PostgreSQL, Redis, S3, Vault, or other Rhythm dependency.
