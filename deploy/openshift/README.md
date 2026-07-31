# Rhythm OpenShift production profile

This profile starts with the scale assumptions used by Rhythm's 500-monitor
acceptance target: two APIs, two schedulers, four 32-slot API workers, two
script runners, two background workers, and two two-context browser agents.

Before applying it:

1. Publish the three production images and update the image names in
   `workloads.yaml`.
2. Replace `rhythm-runtime-secrets` with your approved secret integration.
3. Point the database URL at PgBouncer in transaction-pooling mode. Enable
   `pg_stat_statements` and preload it on the managed PostgreSQL service before
   running the migration Job.
4. Provide managed PostgreSQL, Redis, and S3-compatible object storage.
5. Set the outbound-host, TLS, proxy, and Dynatrace allowlists required by the
   installation.
6. Configure the Prometheus adapter so worker autoscaling can include oldest
   scheduled-job age in addition to CPU.

Apply with:

```sh
oc apply -k deploy/openshift
```

Wait for `rhythm-migrate` to complete before rolling application deployments.
For an upgrade, delete the completed migration Job before applying the new
image so OpenShift creates it again:

```sh
oc delete job rhythm-migrate --ignore-not-found
oc apply -k deploy/openshift
oc wait --for=condition=complete job/rhythm-migrate --timeout=15m
```

The API exposes dependency-free `/livez`, cached `/readyz`, and Prometheus
metrics at `/metrics`. Keep `/metrics` cluster-internal.
