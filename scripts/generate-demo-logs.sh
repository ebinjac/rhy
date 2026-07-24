#!/bin/sh
set -eu

until curl -fsS http://opensearch:9200/_cluster/health >/dev/null; do
  sleep 2
done

sequence=0
interval="${DEMO_LOG_INTERVAL_SECONDS:-10}"

while true; do
  sequence=$((sequence + 1))
  scenario=$((sequence % 12))
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  today="$(date -u +%Y.%m.%d)"
  id="live-$(date -u +%s)-${sequence}"
  index="app-logs-demo-commerce-${today}"

  case "${scenario}" in
    0) payload='"service":"sample-web-app","endpoint":"/api/orders","http.method":"GET","statusCode":200,"responseTimeMs":112,"log.level":"INFO","message":"Orders returned successfully","event.category":"web","event.outcome":"success","tags":["live","baseline"]' ;;
    1) payload='"service":"sample-web-app","endpoint":"/api/orders","http.method":"POST","statusCode":500,"responseTimeMs":730,"log.level":"ERROR","message":"Order creation failed","event.category":"web","event.outcome":"failure","error.type":"OrderProcessingException","error.code":"ORDER_CREATE_FAILED","tags":["live","server-error"]' ;;
    2) payload='"service":"checkout-api","endpoint":"/api/checkout","http.method":"POST","statusCode":200,"responseTimeMs":286,"log.level":"INFO","message":"Checkout completed","event.category":"web","event.outcome":"success","dependency.name":"payments-api","dependency.duration_ms":165,"tags":["live","checkout"]' ;;
    3) payload='"service":"payments-api","endpoint":"/api/payments/authorize","http.method":"POST","statusCode":504,"responseTimeMs":4800,"log.level":"ERROR","message":"Payment processor timed out","event.category":"dependency","event.outcome":"failure","error.type":"DependencyTimeout","error.code":"PROCESSOR_TIMEOUT","dependency.name":"demo-bank","retryCount":2,"tags":["live","timeout","latency-spike"]' ;;
    4) payload='"service":"inventory-worker","endpoint":"queue:inventory-reservations","statusCode":200,"responseTimeMs":76,"log.level":"INFO","message":"Inventory reservation processed","event.category":"queue","event.outcome":"success","queue.depth":8,"tags":["live","worker"]' ;;
    5) payload='"service":"inventory-worker","endpoint":"queue:inventory-reservations","statusCode":409,"responseTimeMs":590,"log.level":"WARN","message":"Inventory reservation will be retried","event.category":"queue","event.outcome":"failure","error.type":"OptimisticLockException","queue.depth":96,"retryCount":3,"tags":["live","queue-pressure","retry"]' ;;
    6) index="app-logs-demo-orders-${today}"; payload='"service":"orders-api","endpoint":"/internal/orders/search","http.method":"GET","statusCode":200,"responseTimeMs":2450,"log.level":"WARN","message":"Order search exceeded latency objective","event.category":"database","event.outcome":"success","dependency.name":"postgres-orders","dependency.duration_ms":2310,"tags":["live","slow-query"]' ;;
    7) index="app-logs-demo-orders-${today}"; payload='"service":"orders-api","endpoint":"/internal/orders/42","http.method":"GET","statusCode":200,"responseTimeMs":61,"log.level":"INFO","message":"Order loaded","event.category":"web","event.outcome":"success","tags":["live","orders"]' ;;
    8) index="app-logs-demo-identity-${today}"; payload='"service":"identity-api","endpoint":"/api/login","http.method":"POST","statusCode":401,"responseTimeMs":79,"log.level":"WARN","message":"Authentication failed","event.category":"authentication","event.outcome":"failure","error.type":"AuthenticationFailure","error.code":"BAD_CREDENTIALS","tags":["live","security"]' ;;
    9) index="app-logs-demo-identity-${today}"; payload='"service":"identity-api","endpoint":"/api/login","http.method":"POST","statusCode":200,"responseTimeMs":168,"log.level":"INFO","message":"User authenticated","event.category":"authentication","event.outcome":"success","tags":["live","auth"]' ;;
    10) payload='"service":"sample-web-app","endpoint":"/health/ready","http.method":"GET","statusCode":200,"responseTimeMs":8,"log.level":"DEBUG","message":"Readiness probe passed","event.category":"availability","event.outcome":"success","tags":["live","healthcheck"]' ;;
    11) payload='"service":"sample-web-app","statusCode":200,"responseTimeMs":0,"log.level":"INFO","message":"Deployment heartbeat","event.category":"deployment","event.outcome":"success","deployment.version":"2026.07.22.1","tags":["live","deployment"]' ;;
  esac

  trace="trace-live-$(date -u +%s)-${sequence}"
  curl -fsS -X POST "http://opensearch:9200/${index}/_doc/${id}?refresh=false" \
    -H 'Content-Type: application/json' \
    --data-binary "{\"@timestamp\":\"${timestamp}\",\"application\":\"Demo Storefront\",\"carId\":\"CAR-DEMO-1001\",\"environment\":\"local\",\"trace.id\":\"${trace}\",\"request.id\":\"req-live-${sequence}\",\"duration_ms\":$(printf '%s' "${payload}" | sed -n 's/.*\"responseTimeMs\":\([0-9]*\).*/\1/p'),${payload}}" >/dev/null

  sleep "${interval}"
done
