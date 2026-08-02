# Rhythm on Hydra

This package maps Rhythm to four independently created Hydra services. Each
service has its own Dockerfile, Helm values, Vault secret inventory, workflow
URL, routability setting, and scaling policy. Local development remains in
`compose.yaml`; never deploy the Compose stack to Hydra.

## Services to create in the Hydra console

Create all four services under the same Hydra project so non-routable services
can communicate through the project-local/global service addresses.

| Service | Routability | SSO | Steady/max replicas | Purpose |
|---|---|---|---:|---|
| `rhythm-frontdoor` | Routable with SSO | Enabled | 2 / 4 | Web, public API, webhooks, SSO boundary |
| `rhythm-control` | Non-routable | Disabled | 1 / 1 | Scheduler, outbox, notifications, orchestration |
| `rhythm-api-executor` | Non-routable | Disabled | 3 / 12 | API runs and colocated JavaScript sandbox |
| `rhythm-browser-executor` | Non-routable | Disabled | 1 / 4 | Chromium, visual checks, browser diagnostics |

Use these common console choices:

- Platform: **On-Prem**; network: **Intranet**; maximum environment: **E3**.
- Workload: **Regular Application**; persistent storage: **No Storage**.
- Deployment: **Rolling**. Every container listens only on `0.0.0.0:8080`.
- Health check: `/health` for E1, E2, and E3.
- Standard corporate trust comes from the approved buildpack. Leave inbound
  mTLS, outbound mTLS, and message-signing certificates off unless a separate
  application security requirement calls for them.

For the frontdoor, set Application URL Prefix to `rhythm`. Hydra then creates:

```text
https://rhythm-dev.aexp.com
https://rhythm-qa.aexp.com
https://rhythm.aexp.com
```

Hydra SSO must authoritatively set the headers configured as
`X-Rhythm-User` and `X-Rhythm-Groups`, stripping any client-supplied versions.
Confirm the actual Hydra SSO header names during onboarding and adjust the two
values if its standard names differ. Verify the mapped actor and roles through
`GET /api/v1/session` before admitting users.

Each service has a complete console contract in
`services/<service>/hydra-service.yaml`.

## Repository layout

```text
deploy/hydra/
├── launcher.mjs
├── service-catalog.yaml
└── services/
    ├── rhythm-frontdoor/
    │   ├── Dockerfile
    │   ├── hydra-service.yaml
    │   ├── helm/values_*.yaml
    │   └── vault/secrets.example
    ├── rhythm-control/...
    ├── rhythm-api-executor/...
    └── rhythm-browser-executor/...

.github/workflows/
├── deploy-rhythm-frontdoor.yml
├── deploy-rhythm-control.yml
├── deploy-rhythm-api-executor.yml
├── deploy-rhythm-browser-executor.yml
└── deploy-rhythm-database.yml
```

There is intentionally no shared Hydra Dockerfile. A source change can now
build and promote only the affected service image.

## Build each image

Use the same commit SHA while invoking the service-owned Dockerfile:

```bash
docker build -f deploy/hydra/services/rhythm-frontdoor/Dockerfile -t <REGISTRY>/rhythm-frontdoor:<SHA> .
docker build -f deploy/hydra/services/rhythm-control/Dockerfile -t <REGISTRY>/rhythm-control:<SHA> .
docker build -f deploy/hydra/services/rhythm-api-executor/Dockerfile -t <REGISTRY>/rhythm-api-executor:<SHA> .
docker build -f deploy/hydra/services/rhythm-browser-executor/Dockerfile -t <REGISTRY>/rhythm-browser-executor:<SHA> .
```

Every `FROM` default points at the approved internal buildpack catalog. Pin the
live platform-approved versions/digests before production. The browser image
installs Chromium and `nss-tools` only through the approved buildpack's RHEL
repositories; it never uses a public Playwright image.

## Service-to-service communication

Hydra enables communication in the same namespace. Prefer its zone-resilient
global address for a destination service:

```text
http://<service>-svc.<project>.global:8080
```

The full same-namespace address is:

```text
http://<service>-svc.<project>.svc.cluster.local:8080
```

The current values use the global browser destination:

```text
http://rhythm-browser-executor-svc.<HYDRA_PROJECT_NAME>.global:8080
```

Replace `<HYDRA_PROJECT_NAME>` in every values file. Keep
`automaticFailover: true` on destination services. The control and executor
services do not receive GTM/LTM routes and do not use SSO; job transport remains
Redis Enterprise, so normal executor traffic does not traverse service HTTP.

## Vault configuration per service

Hydra mounts a separate flat file into every service pod:

```text
/opt/epaas/vault/secrets/secrets
```

Upload the appropriate inventory independently for E1, E2, E3 IPC1, and E3
IPC2. Do not copy the union of all credentials into every service.

| Service | Inventory | Service-specific sensitive values |
|---|---|---|
| Frontdoor | `services/rhythm-frontdoor/vault/secrets.example` | SSO role groups, write-capable secret-provider token, local script token |
| Control | `services/rhythm-control/vault/secrets.example` | SMTP credentials, browser runner token |
| API executor | `services/rhythm-api-executor/vault/secrets.example` | Local script runner token, read-only secret-provider token |
| Browser executor | `services/rhythm-browser-executor/vault/secrets.example` | Browser runner token, read-only secret-provider token |

Database, Redis, encryption, and permitted S3 configuration appears in each
inventory only where the process requires it. `RHYTHM_SECRETS_ENCRYPTION_KEY`
must be the same value for all four services in an environment. The browser
runner token must match between callers and `rhythm-browser-executor`.

S3 uses Hydra workload identity; do not add long-lived AWS access keys. Values
from the secret file are loaded directly into process memory. The launcher does
not write an `.env` file and never logs secret values.

## Separate workflow URLs

Enter the corresponding GitHub Actions workflow URL in each Hydra service:

| Hydra service | Workflow file |
|---|---|
| `rhythm-frontdoor` | `.github/workflows/deploy-rhythm-frontdoor.yml` |
| `rhythm-control` | `.github/workflows/deploy-rhythm-control.yml` |
| `rhythm-api-executor` | `.github/workflows/deploy-rhythm-api-executor.yml` |
| `rhythm-browser-executor` | `.github/workflows/deploy-rhythm-browser-executor.yml` |

For a GitHub Enterprise repository, the console value normally has this form:

```text
https://github.aexp.com/<ORG>/<REPOSITORY>/actions/workflows/deploy-rhythm-frontdoor.yml
```

Use the matching filename for the other three services. Do not reuse the
frontdoor URL: Hydra associates each service with its own workflow entry point.

Each entry point has independent concurrency, path filters, Dockerfile, values
path, operation, environment, RFC, rollback version, and image digest inputs.
The shared repository-owned contract validates those paths and migration parity.

The supplied screenshots/reference do not identify the organization-owned
EarlyBird, build/push, Twistlock/Prisma, Permit-to-Operate, RFC, and Hydra deploy
reusable workflow/action references. Attach the approved internal jobs to
`_hydra-service-contract.yml` before entering these URLs in a production Hydra
service. The repository deliberately does not fabricate or bypass those gates.

Configure repository variable `HYDRA_PROJECT_NAME`. Configure the official
workflow's required Artifactory/Hydra/EarlyBird/Sonar/Twistlock credentials in
GitHub, not in runtime Vault. Runtime Vault and GitHub Actions secrets are
separate trust domains.

The reference deployment guide calls out these GitHub Actions secrets for the
organization-owned jobs. Confirm the current names with the Hydra team before
creating them:

```text
HYDRA_USERNAME
HYDRA_PASSWORD
ARTIFACTORY_USERNAME
ARTIFACTORY_PASSWORD
TWISTCLI_E3_USERNAME
TWISTCLI_E3_PASSWORD
SONARQUBE_TOKEN
EB_USERNAME
EB_PASSWORD
SLACK_BOT_USER_OAUTH_ACCESS_TOKEN
```

None of these values belongs in `/opt/epaas/vault/secrets/secrets`; that mount
contains runtime application secrets only.

## Database workflow

`.github/workflows/deploy-rhythm-database.yml` is independent of application
service deployments. It runs migration parity, Liquibase validation,
`update-sql`, protected `update`, and `status` on the approved database runner.
Set these protected environment values for `hydra-database-e1`, `-e2`, and
`-e3`:

```text
Repository variable: HYDRA_DATABASE_RUNNER_LABEL
Environment secrets: LIQUIBASE_URL, LIQUIBASE_USERNAME, LIQUIBASE_PASSWORD
```

E3 update requires a `CHG...` RFC and the explicit confirmation `APPLY`.
Confirm a PostgreSQL snapshot/PITR point before update. Never automate a
destructive rollback; follow expand/contract migration rules.

## Scaling and release order

`rhythm-control` exposes `rhythm_execution_required_replicas`, clamped from 3
to 12 using due-run lookahead and 70% of 256 slots per executor. Bind it through
Hydra's approved external-metric adapter. CPU HPA alone cannot guarantee the
15-second scheduled-start objective.

Release in this order:

1. Validate and apply Liquibase; verify the required schema revision.
2. Deploy `rhythm-control`.
3. Deploy `rhythm-api-executor`.
4. Deploy `rhythm-browser-executor` and verify corporate TLS in Chromium.
5. Deploy `rhythm-frontdoor` and verify SSO plus `/api/v1/session`.
6. Enable schedules gradually and run the 2,000-active-run acceptance test.

Before E3, all four images must pass the official security/compliance gates,
Redis TLS/failover, S3/KMS, database recovery, service DNS, SSO spoofing,
browser trust, queue recovery, and one-hour capacity soak tests.
