FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-migrate ./cmd/migrate \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-script-runner ./cmd/script-runner

FROM alpine:3.23

RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/rhythm-api /usr/local/bin/rhythm-api
COPY --from=build /out/rhythm-migrate /usr/local/bin/rhythm-migrate
COPY --from=build /out/rhythm-script-runner /usr/local/bin/rhythm-script-runner

USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/rhythm-api"]
