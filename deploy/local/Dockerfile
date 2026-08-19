FROM golang:1.26-alpine AS go-build
WORKDIR /src/services/api
COPY services/api/go.mod services/api/go.sum ./
RUN go mod download
COPY services/api ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-migrate ./cmd/migrate \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-script-runner ./cmd/script-runner

FROM node:24-alpine AS web-dependencies
WORKDIR /src
COPY package.json package-lock.json tsconfig.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --no-audit --no-fund

FROM web-dependencies AS web-build
COPY apps/web apps/web
COPY packages/ui packages/ui
RUN npm run build --workspace web

FROM node:24-alpine AS production-dependencies
WORKDIR /src
COPY package.json package-lock.json tsconfig.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime-base
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /opt/rhythm
COPY deploy/hydra/launcher.mjs deploy/hydra/launcher.mjs
COPY --from=go-build /out/rhythm-api /out/rhythm-migrate /out/rhythm-script-runner /opt/rhythm/bin/
RUN mkdir -p /opt/rhythm/home /opt/rhythm/tmp && chown -R node:node /opt/rhythm
ENV NODE_ENV=production HOME=/opt/rhythm/home TMPDIR=/opt/rhythm/tmp RHYTHM_RUNTIME_ENV_FILE=/dev/null
EXPOSE 8080
USER node
ENTRYPOINT ["node", "deploy/hydra/launcher.mjs"]

FROM runtime-base AS frontdoor
COPY --from=production-dependencies --chown=node:node /src/node_modules ./node_modules
COPY --from=web-build --chown=node:node /src/apps/web/dist ./apps/web/dist
COPY --from=web-build --chown=node:node /src/apps/web/server.mjs ./apps/web/server.mjs
COPY --from=web-build --chown=node:node /src/apps/web/package.json ./apps/web/package.json
COPY --from=web-build --chown=node:node /src/packages/ui ./packages/ui
COPY --from=web-build --chown=node:node /src/package.json ./package.json
ENV RHYTHM_SERVICE_ROLE=frontdoor

FROM runtime-base AS control
ENV RHYTHM_SERVICE_ROLE=control

FROM runtime-base AS api-executor
ENV RHYTHM_SERVICE_ROLE=api-executor

FROM node:24-bookworm AS browser-dependencies
WORKDIR /src/services/browser-agent
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY services/browser-agent/package.json services/browser-agent/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM mcr.microsoft.com/playwright:v1.62.0-noble AS browser-executor
USER root
WORKDIR /opt/rhythm
COPY deploy/hydra/launcher.mjs deploy/hydra/launcher.mjs
COPY --from=go-build /out/rhythm-api /opt/rhythm/bin/rhythm-api
COPY --from=browser-dependencies /src/services/browser-agent/node_modules ./services/browser-agent/node_modules
COPY services/browser-agent/server.mjs services/browser-agent/artifact-transfer.mjs ./services/browser-agent/
RUN mkdir -p /opt/rhythm/home /opt/rhythm/tmp && chown -R pwuser:pwuser /opt/rhythm
ENV NODE_ENV=production HOME=/opt/rhythm/home TMPDIR=/opt/rhythm/tmp \
    RHYTHM_RUNTIME_ENV_FILE=/dev/null RHYTHM_SERVICE_ROLE=browser-executor
EXPOSE 8080
USER pwuser
ENTRYPOINT ["node", "deploy/hydra/launcher.mjs"]

# Presentation/small-installation profile. Hydra still sees one service and one
# port, while the launcher supervises the web, complete Go runtime, JavaScript
# sandbox, and Chromium agent inside the container. The four specialized
# targets above remain the production scale-out path.
FROM browser-executor AS standalone
COPY --from=production-dependencies --chown=pwuser:pwuser /src/node_modules ./node_modules
COPY --from=web-build --chown=pwuser:pwuser /src/apps/web/dist ./apps/web/dist
COPY --from=web-build --chown=pwuser:pwuser /src/apps/web/server.mjs ./apps/web/server.mjs
COPY --from=web-build --chown=pwuser:pwuser /src/apps/web/package.json ./apps/web/package.json
COPY --from=web-build --chown=pwuser:pwuser /src/packages/ui ./packages/ui
COPY --from=web-build --chown=pwuser:pwuser /src/package.json ./package.json
COPY --from=go-build /out/rhythm-migrate /out/rhythm-script-runner /opt/rhythm/bin/
ENV RHYTHM_SERVICE_ROLE=standalone
