FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-api-test-lab ./cmd/server

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 rhythm \
    && adduser -S -D -H -u 10001 -G rhythm rhythm \
    && mkdir -p /certs \
    && chown -R rhythm:rhythm /certs

COPY --from=build /out/rhythm-api-test-lab /usr/local/bin/rhythm-api-test-lab
USER 10001:10001
ENV TEST_LAB_CERT_DIR=/certs
EXPOSE 9080 9081 9443 9444 9445 9446
HEALTHCHECK --interval=5s --timeout=2s --start-period=5s --retries=12 CMD wget -q -O /dev/null http://127.0.0.1:9080/health || exit 1
ENTRYPOINT ["/usr/local/bin/rhythm-api-test-lab"]
