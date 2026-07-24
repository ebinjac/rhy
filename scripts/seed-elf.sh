#!/bin/sh
set -eu

until curl -fsS http://opensearch:9200/_cluster/health >/dev/null; do
  sleep 2
done

today="$(date -u +%Y.%m.%d)"
commerce_index="app-logs-demo-commerce-${today}"
orders_index="app-logs-demo-orders-${today}"
identity_index="app-logs-demo-identity-${today}"
bulk_file="/tmp/rhythm-demo-logs.ndjson"
: > "${bulk_file}"

curl -fsS -X PUT "http://opensearch:9200/_index_template/app-logs-demo" \
  -H 'Content-Type: application/json' \
  --data-binary '{
    "index_patterns": ["app-logs-demo-*"],
    "template": {
      "settings": {"number_of_shards": 1, "number_of_replicas": 0},
      "mappings": {
        "properties": {
          "@timestamp": {"type": "date"},
          "application": {"type": "keyword"},
          "carId": {"type": "keyword"},
          "environment": {"type": "keyword"},
          "service": {"type": "keyword"},
          "endpoint": {"type": "keyword"},
          "http.route": {"type": "keyword"},
          "http.method": {"type": "keyword"},
          "statusCode": {"type": "integer"},
          "http.status_code": {"type": "integer"},
          "responseTimeMs": {"type": "long"},
          "duration_ms": {"type": "long"},
          "log.level": {"type": "keyword"},
          "message": {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 512}}},
          "event.category": {"type": "keyword"},
          "event.outcome": {"type": "keyword"},
          "error.type": {"type": "keyword"},
          "error.code": {"type": "keyword"},
          "error.stack": {"type": "text", "index": false},
          "trace.id": {"type": "keyword"},
          "span.id": {"type": "keyword"},
          "request.id": {"type": "keyword"},
          "user.id": {"type": "keyword"},
          "customer.email": {"type": "keyword"},
          "deployment.version": {"type": "keyword"},
          "dependency.name": {"type": "keyword"},
          "dependency.duration_ms": {"type": "long"},
          "retryCount": {"type": "integer"},
          "queue.depth": {"type": "integer"},
          "region": {"type": "keyword"},
          "host.name": {"type": "keyword"},
          "tags": {"type": "keyword"}
        }
      }
    }
  }' >/dev/null

timestamp_ago() {
  seconds="$1"
  epoch="$(( $(date -u +%s) - seconds ))"
  date -u -d "@${epoch}" +%Y-%m-%dT%H:%M:%S.000Z
}

add_document() {
  index="$1"
  id="$2"
  age="$3"
  payload="$4"
  printf '{"index":{"_index":"%s","_id":"%s"}}\n' "${index}" "${id}" >> "${bulk_file}"
  printf '{"@timestamp":"%s",%s}\n' "$(timestamp_ago "${age}")" "${payload}" >> "${bulk_file}"
}

# Commerce traffic: normal requests, client errors, server failures, retries,
# dependency failures, deploy events, worker pressure, and safely fake PII.
add_document "${commerce_index}" seed-commerce-01 60 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"sample-web-app","endpoint":"/api/orders","http.route":"/api/orders","http.method":"GET","statusCode":200,"http.status_code":200,"responseTimeMs":118,"duration_ms":118,"log.level":"INFO","message":"Orders returned successfully","event.category":"web","event.outcome":"success","trace.id":"trace-demo-001","span.id":"span-001","request.id":"req-001","region":"local","host.name":"web-01","deployment.version":"2026.07.22.1","tags":["baseline","success"]'
add_document "${commerce_index}" seed-commerce-02 120 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"sample-web-app","endpoint":"/api/orders","http.route":"/api/orders","http.method":"POST","statusCode":201,"http.status_code":201,"responseTimeMs":246,"duration_ms":246,"log.level":"INFO","message":"Order created","event.category":"web","event.outcome":"success","trace.id":"trace-demo-002","request.id":"req-002","user.id":"user-demo-42","customer.email":"demo.customer@example.invalid","deployment.version":"2026.07.22.1","tags":["order","created"]'
add_document "${commerce_index}" seed-commerce-03 180 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"sample-web-app","endpoint":"/api/orders","http.route":"/api/orders","http.method":"POST","statusCode":400,"http.status_code":400,"responseTimeMs":37,"duration_ms":37,"log.level":"WARN","message":"Order request failed validation","event.category":"web","event.outcome":"failure","error.type":"ValidationException","error.code":"INVALID_QUANTITY","trace.id":"trace-demo-003","request.id":"req-003","tags":["validation","client-error"]'
add_document "${commerce_index}" seed-commerce-04 240 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"sample-web-app","endpoint":"/api/orders","http.route":"/api/orders","http.method":"POST","statusCode":500,"http.status_code":500,"responseTimeMs":742,"duration_ms":742,"log.level":"ERROR","message":"Unhandled error while creating order","event.category":"web","event.outcome":"failure","error.type":"NullPointerException","error.code":"ORDER_CREATE_FAILED","error.stack":"com.demo.orders.OrderService.create(OrderService.java:84)","trace.id":"trace-demo-004","request.id":"req-004","tags":["server-error","exception"]'
add_document "${commerce_index}" seed-commerce-05 300 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"sample-web-app","endpoint":"/api/orders","http.route":"/api/orders","http.method":"GET","statusCode":503,"http.status_code":503,"responseTimeMs":2300,"duration_ms":2300,"log.level":"ERROR","message":"Orders dependency timed out after retries","event.category":"dependency","event.outcome":"failure","error.type":"DependencyTimeout","error.code":"ORDERS_TIMEOUT","dependency.name":"orders-api","dependency.duration_ms":2150,"retryCount":2,"trace.id":"trace-demo-005","request.id":"req-005","tags":["timeout","retry","slow"]'
add_document "${commerce_index}" seed-commerce-06 360 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"checkout-api","endpoint":"/api/checkout","http.route":"/api/checkout","http.method":"POST","statusCode":200,"http.status_code":200,"responseTimeMs":312,"duration_ms":312,"log.level":"INFO","message":"Checkout completed","event.category":"web","event.outcome":"success","trace.id":"trace-demo-006","request.id":"req-006","dependency.name":"payments-api","dependency.duration_ms":190,"tags":["checkout","success"]'
add_document "${commerce_index}" seed-commerce-07 420 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"checkout-api","endpoint":"/api/checkout","http.route":"/api/checkout","http.method":"POST","statusCode":502,"http.status_code":502,"responseTimeMs":1840,"duration_ms":1840,"log.level":"ERROR","message":"Payment provider returned an invalid response","event.category":"dependency","event.outcome":"failure","error.type":"BadGateway","error.code":"PAYMENT_UPSTREAM_502","dependency.name":"payments-api","dependency.duration_ms":1710,"trace.id":"trace-demo-007","request.id":"req-007","tags":["checkout","dependency","server-error"]'
add_document "${commerce_index}" seed-commerce-08 480 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"payments-api","endpoint":"/api/payments/authorize","http.route":"/api/payments/authorize","http.method":"POST","statusCode":402,"http.status_code":402,"responseTimeMs":284,"duration_ms":284,"log.level":"WARN","message":"Card authorization declined","event.category":"business","event.outcome":"failure","error.type":"PaymentDeclined","error.code":"CARD_DECLINED","trace.id":"trace-demo-008","request.id":"req-008","tags":["payment","business-decline"]'
add_document "${commerce_index}" seed-commerce-09 540 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"payments-api","endpoint":"/api/payments/authorize","http.route":"/api/payments/authorize","http.method":"POST","statusCode":504,"http.status_code":504,"responseTimeMs":5100,"duration_ms":5100,"log.level":"ERROR","message":"Payment processor timed out","event.category":"dependency","event.outcome":"failure","error.type":"DependencyTimeout","error.code":"PROCESSOR_TIMEOUT","dependency.name":"demo-bank","dependency.duration_ms":5000,"retryCount":1,"trace.id":"trace-demo-009","request.id":"req-009","tags":["payment","timeout","latency-spike"]'
add_document "${commerce_index}" seed-commerce-10 600 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"inventory-worker","endpoint":"queue:inventory-reservations","statusCode":200,"responseTimeMs":91,"duration_ms":91,"log.level":"INFO","message":"Inventory reservation processed","event.category":"queue","event.outcome":"success","queue.depth":4,"retryCount":0,"trace.id":"trace-demo-010","tags":["worker","queue"]'
add_document "${commerce_index}" seed-commerce-11 660 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"inventory-worker","endpoint":"queue:inventory-reservations","statusCode":409,"responseTimeMs":640,"duration_ms":640,"log.level":"WARN","message":"Reservation conflict will be retried","event.category":"queue","event.outcome":"failure","error.type":"OptimisticLockException","error.code":"STOCK_CONFLICT","queue.depth":87,"retryCount":3,"trace.id":"trace-demo-011","tags":["worker","retry","queue-pressure"]'
add_document "${commerce_index}" seed-commerce-12 720 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"sample-web-app","log.level":"INFO","message":"Deployment completed and traffic shifted","event.category":"deployment","event.outcome":"success","deployment.version":"2026.07.22.1","tags":["deployment","release"]'

# A service-level index override for order-specific searches and aggregations.
add_document "${orders_index}" seed-orders-01 75 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"orders-api","endpoint":"/internal/orders/42","http.route":"/internal/orders/{id}","http.method":"GET","statusCode":200,"http.status_code":200,"responseTimeMs":64,"duration_ms":64,"log.level":"INFO","message":"Order loaded","event.category":"web","event.outcome":"success","trace.id":"trace-orders-001","request.id":"req-orders-001","tags":["orders","success"]'
add_document "${orders_index}" seed-orders-02 210 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"orders-api","endpoint":"/internal/orders","http.route":"/internal/orders","http.method":"POST","statusCode":500,"http.status_code":500,"responseTimeMs":880,"duration_ms":880,"log.level":"ERROR","message":"Database transaction rolled back","event.category":"database","event.outcome":"failure","error.type":"DatabaseException","error.code":"TX_ROLLBACK","dependency.name":"postgres-orders","dependency.duration_ms":790,"trace.id":"trace-orders-002","request.id":"req-orders-002","tags":["orders","database","server-error"]'
add_document "${orders_index}" seed-orders-03 390 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"orders-api","endpoint":"/internal/orders/search","http.route":"/internal/orders/search","http.method":"GET","statusCode":200,"http.status_code":200,"responseTimeMs":2780,"duration_ms":2780,"log.level":"WARN","message":"Order search exceeded latency objective","event.category":"database","event.outcome":"success","dependency.name":"postgres-orders","dependency.duration_ms":2650,"trace.id":"trace-orders-003","request.id":"req-orders-003","tags":["orders","slow-query","latency-spike"]'
add_document "${orders_index}" seed-orders-04 570 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"orders-api","endpoint":"/internal/orders/42","http.route":"/internal/orders/{id}","http.method":"DELETE","statusCode":404,"http.status_code":404,"responseTimeMs":43,"duration_ms":43,"log.level":"INFO","message":"Order was not found","event.category":"web","event.outcome":"failure","error.type":"NotFound","error.code":"ORDER_NOT_FOUND","trace.id":"trace-orders-004","request.id":"req-orders-004","tags":["orders","client-error"]'

# Identity traffic lives in another service override and includes security events.
add_document "${identity_index}" seed-identity-01 90 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"identity-api","endpoint":"/api/login","http.route":"/api/login","http.method":"POST","statusCode":200,"http.status_code":200,"responseTimeMs":176,"duration_ms":176,"log.level":"INFO","message":"User authenticated","event.category":"authentication","event.outcome":"success","trace.id":"trace-identity-001","request.id":"req-identity-001","user.id":"user-demo-42","tags":["auth","success"]'
add_document "${identity_index}" seed-identity-02 270 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"identity-api","endpoint":"/api/login","http.route":"/api/login","http.method":"POST","statusCode":401,"http.status_code":401,"responseTimeMs":82,"duration_ms":82,"log.level":"WARN","message":"Authentication failed","event.category":"authentication","event.outcome":"failure","error.type":"AuthenticationFailure","error.code":"BAD_CREDENTIALS","trace.id":"trace-identity-002","request.id":"req-identity-002","user.id":"user-demo-99","tags":["auth","security"]'
add_document "${identity_index}" seed-identity-03 450 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"identity-api","endpoint":"/api/admin","http.route":"/api/admin","http.method":"GET","statusCode":403,"http.status_code":403,"responseTimeMs":24,"duration_ms":24,"log.level":"WARN","message":"Access denied because required scope is missing","event.category":"authorization","event.outcome":"failure","error.type":"AuthorizationFailure","error.code":"MISSING_SCOPE","trace.id":"trace-identity-003","request.id":"req-identity-003","tags":["authz","security"]'
add_document "${identity_index}" seed-identity-04 630 '"application":"Demo Storefront","carId":"CAR-DEMO-1001","environment":"local","service":"identity-api","endpoint":"/api/login","http.route":"/api/login","http.method":"POST","statusCode":429,"http.status_code":429,"responseTimeMs":11,"duration_ms":11,"log.level":"WARN","message":"Login rate limit exceeded","event.category":"authentication","event.outcome":"failure","error.type":"RateLimitExceeded","error.code":"LOGIN_RATE_LIMIT","trace.id":"trace-identity-004","request.id":"req-identity-004","tags":["auth","rate-limit","security"]'

curl -fsS -X POST "http://opensearch:9200/_bulk?refresh=true" \
  -H 'Content-Type: application/x-ndjson' \
  --data-binary "@${bulk_file}" >/dev/null

# Make Discover immediately usable in the bundled local Dashboards instance.
until curl -fsS http://opensearch-dashboards:5601/api/status >/dev/null; do
  sleep 2
done
curl -fsS -X POST "http://opensearch-dashboards:5601/api/saved_objects/index-pattern/app-logs-demo?overwrite=true" \
  -H 'osd-xsrf: true' \
  -H 'Content-Type: application/json' \
  --data-binary '{"attributes":{"title":"app-logs-demo-*","timeFieldName":"@timestamp"}}' >/dev/null
curl -fsS -X POST "http://opensearch-dashboards:5601/api/saved_objects/config/3.7.0?overwrite=true" \
  -H 'osd-xsrf: true' \
  -H 'Content-Type: application/json' \
  --data-binary '{"attributes":{"defaultIndex":"app-logs-demo"}}' >/dev/null

echo "Seeded varied demo application logs and configured the app-logs-demo-* Dashboards data view."
