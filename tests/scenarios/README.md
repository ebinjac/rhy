# Rhythm API scenarios

End-to-end scenarios against a running Rhythm stack + `test-target` mock.

## Prerequisites

```bash
# Core stack
docker compose up -d --build

# Mock HTTP(S) target (profile: test)
docker compose --profile test up -d --build test-target
```

## Environment

Default for host-run scenarios (API on host port, workers inside Compose):

```bash
export RHYTHM_API_URL=http://localhost:18080
export RHYTHM_TEST_TARGET_URL=http://host.docker.internal:18090
export RHYTHM_TEST_TARGET_HTTPS_URL=https://host.docker.internal:18443
```

| Variable | Default | Purpose |
|---|---|---|
| `RHYTHM_API_URL` | `http://localhost:18080` | Rhythm API |
| `RHYTHM_TEST_TARGET_URL` | `http://host.docker.internal:18090` | URL **embedded in monitors** (must be reachable by workers) |
| `RHYTHM_TEST_TARGET_PROBE_URL` | `http://localhost:18090` | Host-side reachability probe |
| `RHYTHM_SCENARIO_NETWORK` | `host` | Set to `compose` to use `http://test-target:8080` |
| `RHYTHM_SCENARIO_PROXY_URL` | unset | Optional real forward proxy for proxy e2e |

When `RHYTHM_SCENARIO_NETWORK=compose`, monitor URLs default to `http://test-target:8080` (runner must share the Compose network).

## Run

From repo root:

```bash
npm run test:scenarios
# or CI wrapper with the same defaults:
npm run test:scenarios:ci
```

Scenarios skip gracefully when the API or test-target is unreachable.

## Wave-1 files

| File | Coverage |
|---|---|
| `health.test.mjs` | create → publish → run `/health` |
| `auth.test.mjs` | basic + bearer |
| `secrets.test.mjs` | LOCAL secret + `{{secrets.alias}}` |
| `extractors.test.mjs` | jsonpath chain |
| `scripts.test.mjs` | pass + fail test scripts |
| `proxy.test.mjs` | create proxy; full e2e needs `RHYTHM_SCENARIO_PROXY_URL` |
| `certs.test.mjs` | custom CA HTTPS (best-effort / may skip) |
| `cookies.test.mjs` | set-cookie → cookie-echo |
| `alerts.test.mjs` | assertion fail → FAILED |
| `browser.test.mjs` | browser navigate (skip if agent down) |
| `webhook.test.mjs` | notification webhook + capture endpoint |
