# This Dockerfile belongs only to the routable Rhythm frontdoor Hydra service.
# Reconfirm both buildpacks in Hydra's live catalog before promotion.
ARG HYDRA_GO_BUILDPACK=artifactory.aexp.com/paas-registry/buildpacks/rhel-go-1-builder:1.x.latest
ARG HYDRA_NODE_BUILDPACK=artifactory.aexp.com/paas-registry/buildpacks/rhel-nodejs-24-builder:latest

FROM ${HYDRA_GO_BUILDPACK} AS go-build
WORKDIR /src/services/api
COPY services/api/go.mod services/api/go.sum ./
RUN go mod download
COPY services/api ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-script-runner ./cmd/script-runner

FROM ${HYDRA_NODE_BUILDPACK} AS web-build
WORKDIR /src
COPY package.json package-lock.json tsconfig.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --no-audit --no-fund
COPY apps/web apps/web
COPY packages/ui packages/ui
RUN npm run build --workspace web

FROM ${HYDRA_NODE_BUILDPACK} AS production-dependencies
WORKDIR /src
COPY package.json package-lock.json tsconfig.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --omit=dev --no-audit --no-fund

FROM ${HYDRA_NODE_BUILDPACK} AS runtime
WORKDIR /opt/rhythm
COPY deploy/hydra/launcher.mjs deploy/hydra/launcher.mjs
COPY --from=go-build /out/rhythm-api /out/rhythm-script-runner /opt/rhythm/bin/
COPY --from=production-dependencies /src/node_modules ./node_modules
COPY --from=web-build /src/apps/web/dist ./apps/web/dist
COPY --from=web-build /src/apps/web/server.mjs ./apps/web/server.mjs
COPY --from=web-build /src/apps/web/package.json ./apps/web/package.json
COPY --from=web-build /src/packages/ui ./packages/ui
COPY --from=web-build /src/package.json ./package.json
USER 0
RUN mkdir -p /opt/rhythm/home /opt/rhythm/tmp \
    && chgrp -R 0 /opt/rhythm \
    && chmod -R g=u /opt/rhythm
ENV NODE_ENV=production \
    NODE_USE_SYSTEM_CA=1 \
    HOME=/opt/rhythm/home \
    TMPDIR=/opt/rhythm/tmp \
    RHYTHM_ENVIRONMENT=production \
    RHYTHM_SERVICE_ROLE=frontdoor
EXPOSE 8080
USER 1001
ENTRYPOINT ["node", "deploy/hydra/launcher.mjs"]
