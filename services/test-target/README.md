# Rhythm test-target

Mock HTTP(S) application used by `tests/scenarios` and local Docker Compose (`profile: test`).

## Quick start

```bash
# Generate self-signed certs (once)
node services/test-target/scripts/generate-certs.mjs

# Run locally
node services/test-target/server.mjs
# or: cd services/test-target && npm start

curl -s http://localhost:8080/health
# → {"ok":true}
```

## Compose

```bash
docker compose --profile test up -d --build test-target
```

Published ports:

| Env | Default | Container |
|---|---|---|
| `RHYTHM_TEST_TARGET_PORT` | `18090` | `8080` |
| `RHYTHM_TEST_TARGET_HTTPS_PORT` | `18443` | `8443` |

When the API/workers run in Compose and scenarios run on the host, embed monitor URLs as:

```
RHYTHM_TEST_TARGET_URL=http://host.docker.internal:18090
RHYTHM_TEST_TARGET_HTTPS_URL=https://host.docker.internal:18443
```

Inside the Compose network use `http://test-target:8080` (`RHYTHM_SCENARIO_NETWORK=compose`).

## HTTPS / mTLS

Certs live in `certs/` (`ca.pem`, `server.pem`, `server-key.pem`, `client.pem`, `client-key.pem`).  
Set `REQUIRE_CLIENT_CERT=true` to require a client certificate on the HTTPS listener.

## Notable endpoints

- `GET /health`, `ALL /echo`, `GET|POST /json`
- Auth: `/basic-auth`, `/bearer`, `/api-key`, `POST /oauth/token`, `POST /hmac`, `/jwt-audience`
- Cookies: `/set-cookie`, `/cookie-echo`
- Extractors: `/headers-only`, `/regex-body`, `/schema-ok`, `/schema-bad`
- Browser: `/browser/home`
- Webhooks: `POST|GET|DELETE /webhook/capture`
- Flaky: `/retry-flaky` (fails first 2, then 200; `?reset=1`)
