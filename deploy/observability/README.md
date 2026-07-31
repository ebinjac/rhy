# Rhythm production observability

`rhythm-alerts.yaml` contains the initial control-plane and execution SLO
alerts. Apply it only when the OpenShift cluster has the Prometheus Operator:

```sh
oc apply -n rhythm -f deploy/observability/rhythm-alerts.yaml
```

The application deliberately uses bounded labels. Routes are normalized and
run IDs, target URLs, secret aliases, dynamic step names, and customer values
are not metric labels.

Configure the Prometheus Adapter to expose
`rhythm_execution_oldest_queued_job_age_seconds` as an external metric before
enabling the queue-age HPA signal in `deploy/openshift/autoscaling.yaml`.

