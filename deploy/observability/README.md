# Rhythm production observability

`rhythm-alerts.yaml` contains the initial Hydra control-plane and execution SLO
alerts. Submit it through the approved Hydra observability workflow after the
Prometheus Operator contract has been confirmed:

```sh
oc apply -n <RHYTHM_NAMESPACE> -f deploy/observability/rhythm-alerts.yaml
```

The application deliberately uses bounded labels. Routes are normalized and
run IDs, target URLs, secret aliases, dynamic step names, and customer values
are not metric labels.

Configure Hydra's approved Prometheus adapter to expose
`rhythm_execution_required_replicas` as the desired replica signal for
`rhythm-api-executor`. The metric is bounded to 3–12 replicas and includes
active executions plus schedules due within 15 seconds. CPU HPA may remain as a
safety signal, but it does not replace predictive scaling for the 15-second
scheduled-start SLO.

Scrape all four services on `/metrics`. Keep service/pod labels at the platform
layer; Rhythm deliberately avoids run IDs, target URLs, secret aliases, and
dynamic step names as application metric labels.
