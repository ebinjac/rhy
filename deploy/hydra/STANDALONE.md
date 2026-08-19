# Rhythm standalone Hydra profile

Use this profile when Hydra currently permits only one Rhythm service. Hydra
sees one routable regular application and one port, while the container
supervises four internal processes:

- the TanStack Start web server on `0.0.0.0:8080`;
- the complete Go API/control/worker runtime on `127.0.0.1:18080`;
- the Goja JavaScript runner on `127.0.0.1:8090`;
- the Chromium browser agent on `127.0.0.1:8091`.

PostgreSQL and S3 remain managed services outside the pod. PostgreSQL is the
only job queue and coordination backend. Redis and a persistent volume are not
required.

> This is the recommended presentation and small-installation profile, not the
> 2,000-concurrent-run production profile. A single pod is one failure domain
> and cannot scale API execution independently from Chromium or the web UI.

## Hydra console selection

Use the existing Rhythm service name if one is already approved; it does not
have to be named `rhythm-standalone`.

| Setting | Value |
|---|---|
| Platform / network | On-Prem / Intranet |
| Maximum environment | E3 |
| Workload | Regular Application |
| Persistent storage | No Storage |
| Deployment | Rolling |
| Routability | Routable without SSO |
| Application URL prefix | `rhythm` (or the already approved prefix) |
| GTM health path | `/health` |
| Container port | `8080` |
| CPU / memory limit | 4 vCPU / 8 GiB |
| Replicas | exactly 1 |

Register this workflow URL in the service:

```text
https://github.aexp.com/<ORG>/<REPOSITORY>/actions/workflows/deploy-rhythm-standalone.yml
```

Set repository variable `HYDRA_STANDALONE_SERVICE_NAME` when the approved Hydra
service has another name. The workflow still requires the organization-owned
Hydra build, scan, promotion, and deployment action to be connected in
`_hydra-service-contract.yml`; the repository does not fabricate that internal
action.

## Runtime Vault inventory

Populate the environment-specific Hydra mount at
`/opt/epaas/vault/secrets/secrets` from
`services/rhythm-standalone/vault/secrets.example`.

Required values are:

```text
RHYTHM_DATABASE_URL
RHYTHM_SECRETS_ENCRYPTION_KEY
RHYTHM_SCRIPT_RUNNER_TOKEN
RHYTHM_BROWSER_RUNNER_TOKEN
RHYTHM_ARTIFACT_STORE_URL
RHYTHM_ARTIFACT_STORE_ACCESS_KEY
RHYTHM_ARTIFACT_STORE_SECRET_KEY
RHYTHM_ARTIFACT_STORE_BUCKET
RHYTHM_ARTIFACT_STORE_REGION
RHYTHM_ARTIFACT_STORE_KMS_KEY_ID
```

The two runner tokens authenticate loopback-only processes and should be
different random values. Custom S3-compatible endpoints need URL plus static
access keys in this inventory; leave the URL empty to use AWS SDK endpoint
resolution and Hydra workload identity. Application credentials created in
Rhythm are encrypted in PostgreSQL and selected by plain alias. Hydra Vault is
only the bootstrap file mount supplied by the platform.

## Database deployment before the pod

Do not run migrations automatically from the application startup. Use the
independent `.github/workflows/deploy-rhythm-database.yml` workflow:

1. Run migration parity and Liquibase `validate`.
2. Generate and review `update-sql`.
3. Confirm a managed PostgreSQL snapshot/PITR point.
4. Apply Liquibase `update`.
5. Confirm `000034_ai_copilot` is present with Liquibase `status`.
6. Deploy the standalone image.

The pod uses `/health` for startup and GTM checks. This endpoint is
dependency-free, so PostgreSQL or S3 downtime does not cause a crash loop.
Use `/readyz` after deployment to see sanitized dependency states; it may
return `503` until PostgreSQL, S3, the script runner, and browser agent recover.

## Presentation deployment checklist

1. Apply the database migration workflow.
2. Populate the standalone Vault inventory for the target environment.
3. Confirm the service uses the matching `values_e1.yaml`, `values_e2.yaml`, or
   E3 IPC values file.
4. Build and deploy `services/rhythm-standalone/Dockerfile` through the approved
   Hydra workflow.
5. Verify `GET /health` returns `200` through the GTM URL.
6. Verify `GET /readyz`; resolve any degraded component before the demo.
7. Verify `GET /api/v1/session` returns the anonymous administrator contract.
8. Run one API monitor with JavaScript and one UI monitor that opens a page.
9. Confirm a browser screenshot/evidence object reaches the configured S3
   bucket and can be read back.
10. Keep schedules disabled until these checks pass, then enable only the
    monitors needed for the presentation.

## Capacity on 4 vCPU and 8 GiB

The values deliberately cap the pod at:

- 96 active API-monitor runs;
- four simultaneous JavaScript VMs;
- one active browser journey;
- two active deployment workflows;
- 12 active requests to one target host;
- 32 PostgreSQL connections;
- claim shutdown at 75% process memory pressure.

`96` is a concurrency ceiling, not runs per second. With five sequential HTTP
steps per monitor, an approximate 70%-utilization throughput is:

```text
runs per minute = 96 × 60 × 0.70 ÷ (5 × average step duration in seconds)
```

| Average duration per HTTP step | Approximate runs/minute |
|---:|---:|
| 0.5 s | 1,612 |
| 1.0 s | 806 |
| 1.5 s | 538 |
| 2.0 s | 403 |
| 5.0 s | 161 |

These are queueing estimates, not a production claim. TLS, scripts, payload
capture, slow targets, retries, database latency, and a concurrent Chromium run
reduce the result. For the presentation, keep the expected workload to roughly
300–500 one-minute, five-step monitors when average step latency is at most
1.5 seconds. A burst of 1,000 or 2,000 submissions is accepted into PostgreSQL
but is queued; the single service does not promise that all begin within 15
seconds.

Run a representative E1 load test before increasing any ceiling. Do not raise
worker concurrency merely because the pod has idle slots: confirm RSS, Go heap,
database acquisition time, target-host throttling, and queue age first.

## Move back to four services

No database or artifact migration is required. Both profiles use the same
PostgreSQL schema, S3 prefix contract, encryption key, run IDs, leases, and
artifact metadata.

1. Keep the standalone pod running while Liquibase applies any additive schema
   changes required by the new image.
2. Create/configure `rhythm-control`, `rhythm-api-executor`, and
   `rhythm-browser-executor` with the same PostgreSQL database, S3 bucket, and
   encryption key.
3. Deploy control, API executors, and browser executors. PostgreSQL leases make
   duplicate job claims idempotent while the standalone worker is still alive.
4. Deploy `rhythm-frontdoor` and verify its internal dependencies.
5. Switch the GTM route from the standalone service to frontdoor. Never expose
   both routable frontdoors for an extended period.
6. Stop the standalone service after active leases drain.
7. Enable predictive executor scaling and complete the 2,000-run acceptance
   test before making the higher-capacity SLO.

Rollback reverses the GTM switch while the standalone image remains compatible
with the expanded schema. Database rollback is never automatic or destructive.

## Local validation

The normal four-service Compose topology remains the default. The combined
image is an opt-in profile and uses port 3200 so it can be tested separately.
PostgreSQL is not started by the standalone service; migrate before the first
boot so `000034_ai_copilot` is present.

```bash
docker compose up -d postgres
docker compose --profile standalone build rhythm-standalone
docker compose --profile standalone run --rm --entrypoint /opt/rhythm/bin/rhythm-migrate rhythm-standalone
docker compose --profile standalone up -d rhythm-standalone
curl -fsS http://localhost:3200/health
curl -fsS http://localhost:3200/readyz
docker compose --profile standalone stop rhythm-standalone
```

