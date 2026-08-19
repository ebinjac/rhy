# API Test Lab coverage matrix

| Capability | Fixture endpoints | Automated coverage |
|---|---|---|
| Availability and discovery | `/health`, `/ready`, `/version`, `/scenarios`, `/openapi.json` | Unit + Compose health |
| Request methods and echo | `/api/echo`, `/api/method`, `/api/query`, `/api/headers` | Unit + executor integration |
| Basic, bearer, API key | `/auth/basic`, `/auth/bearer`, `/auth/api-key*` | Unit |
| HMAC-SHA256 | `/auth/hmac` | Unit + executor integration + JS fixture |
| MAC authorization | `/auth/mac` | Unit + executor integration + JS fixture |
| Application token chain | `/auth/application-token`, `/protected/keysets` | Unit + executor integration |
| JWT HS256 and RS256 | `/auth/jwt/token`, `/auth/jwt/protected`, `/auth/jwt/public-key` | Unit |
| Cookies and sessions | `/cookies/*` | Unit + executor integration |
| Status and timeout behavior | `/status/{code}`, `/delay*`, `/latency/random` | Unit + executor integration |
| Redirect behavior | `/redirect/{count}`, `/redirect/loop` | Unit |
| JSON and malformed data | `/response/json*`, `/response/malformed-json` | Unit |
| Text, XML, regex and binary | `/response/text`, `/response/xml`, `/response/regex`, `/response/binary` | Unit + executor integration |
| Large and streaming bodies | `/response/large/{size}`, `/stream` | Unit |
| Uploads and encoding | `/upload`, `/form`, `/compression/*` | Unit |
| Body validation | `/validate/json`, `/validate/dynamic-body`, `/validation/schema` | Unit + JS fixture |
| Correlation and nonces | `/trace/correlation`, `/trace/nonce` | Unit + JS fixture |
| Stateful workflow | `/workflow/*`, `/chain/*` | Unit + JS fixture |
| Retry and rate limits | `/unstable/{successAfter}`, `/rate-limit`, `/chaos/random-error` | Unit + executor integration |
| Extractors | `/extract/json`, `/extract/header`, `/extract/cookie`, `/extract/regex`, `/extract/xml`, `/extract/protected` | Unit + executor integration |
| TLS | ports 9443, 9444, 9445, 9446; `/tls`, `/mtls`, `/certificates` | Unit + Compose smoke |
| Proxy | port 9081 forward/CONNECT | Compose smoke |
| CORS and Unicode | `/cors/*`, `/response/unicode` | Unit |
| Metrics and reset | `/metrics/test-lab`, `/admin/reset` | Unit |
| Concurrency safety | all stateful handlers | `go test -race ./...` |
| Production guard | process startup | Unit |

The public OpenAPI document and Postman collection are contract fixtures. CI starts
the real container and then runs the tagged Rhythm executor suite against it.
