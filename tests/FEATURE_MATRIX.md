# Rhythm feature test matrix

Capability coverage for unit tests, API scenario tests (`tests/scenarios`), and live/optional checks.  
Legend: **Y** = covered, **P** = partial, **—** = not yet, **skip** = gracefully skipped when deps unavailable.

| Capability | Unit | API scenario | Live/optional | Notes |
|---|---|---|---|---|
| HTTP GET health monitor create/publish/run | Y (`server_test`) | Y `health.test.mjs` | compose + test-target | Worker must reach test-target URL |
| HTTP status / echo / slow / retry | Y (executor) | P (health uses status assert) | test-target endpoints | `/retry-flaky`, `/slow` available for later waves |
| Redirect following | Y (settings) | — | `/redirect/:n` | |
| Basic auth | Y (executor) | Y `auth.test.mjs` | `/basic-auth` | auth fields are secret aliases → `test`/`secret` |
| Bearer auth | Y (executor) | Y `auth.test.mjs` | `/bearer` | auth field is secret alias → `test-token` |
| API key auth | Y (executor) | — | `/api-key` | header or query |
| OAuth2 client credentials | Y (executor) | — | `/oauth/token` | |
| HMAC signing | Y (executor) | — | `/hmac` | any non-empty `X-Signature` accepted by mock |
| JWT auth | Y (executor) | — | `/jwt-audience` | mock only checks Bearer present |
| Secrets library (`{{secrets.alias}}`) | Y (`secrets_test`) | Y `secrets.test.mjs` | LOCAL provider | alias = profile name |
| Certificates / custom CA | Y (executor TLS) | P `certs.test.mjs` | HTTPS 18443 | skip if TLS connect fails |
| mTLS client cert | Y (resolver) | — | `REQUIRE_CLIENT_CERT` | certs in `services/test-target/certs/` |
| Proxies config + test endpoint | Y (`proxies_test`) | P `proxy.test.mjs` | topology-dependent | create profile; monitor-via-proxy may skip |
| Auth profiles (config library) | Y | — | | |
| Notifications (email/webhook) | Y (`notifications_test`) | P `webhook.test.mjs` | webhook capture | optional; needs notification dispatch path |
| Telemetry / Dynatrace profiles | Y | — | live Dynatrace | |
| Environments / variables | Y | P (extractors) | | |
| JSONPath extractors + chained steps | Y (`server_test`) | Y `extractors.test.mjs` | `/json` | |
| Header / regex extractors | Y | — | `/headers-only`, `/regex-body` | |
| Assertions (status, jsonpath) | Y | Y health/alerts | | |
| JSON schema assertions | P | — | `/schema-ok`, `/schema-bad` | |
| Pre-request / test scripts | Y (runtime) | Y `scripts.test.mjs` | needs script-runner | pass + fail cases |
| Cookie jar across steps | Y | Y `cookies.test.mjs` | `/set-cookie` → `/cookie-echo` | |
| Alerts on failed run | Y (OpenSearch inbox) | P `alerts.test.mjs` | | asserts run FAILED; alerts list best-effort |
| Suites / deployment gates | Y | — | | |
| ELF bootstrap / credentials | Y | — | optional cluster | |
| Browser monitors (navigate) | Y | P `browser.test.mjs` | browser-agent | skip if agent/API down |
| Hydra deploy contracts | Y (`hydra:check`) | — | Hydra CI | |
| Web UI smoke | — | Playwright `product-smoke` | web:3100 | skip if web down |
| Anonymous API auth (local) | Y | Y (all scenarios) | `RHYTHM_AUTH_MODE=anonymous` | |

## How scenarios resolve URLs

| Runner location | API | Monitor target URL |
|---|---|---|
| Host (default) | `http://localhost:18080` | `http://host.docker.internal:18090` (workers in Docker reach published port) |
| Compose network | `http://api:8080` | `http://test-target:8080` when `RHYTHM_SCENARIO_NETWORK=compose` |

Override with `RHYTHM_API_URL` and `RHYTHM_TEST_TARGET_URL` / `RHYTHM_TEST_TARGET_HTTPS_URL`.
