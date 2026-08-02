# This Dockerfile belongs only to the non-routable Rhythm browser executor.
# The approved Node buildpack supplies the corporate system trust. Chromium and
# certutil are installed only from the buildpack's approved corporate RHEL repos.
ARG HYDRA_GO_BUILDPACK=artifactory.aexp.com/paas-registry/buildpacks/rhel-go-1-builder:1.x.latest
ARG HYDRA_NODE_BUILDPACK=artifactory.aexp.com/paas-registry/buildpacks/rhel-nodejs-24-builder:latest
ARG HYDRA_BROWSER_BUILDPACK=artifactory.aexp.com/paas-registry/buildpacks/rhel-nodejs-24-builder:latest

FROM ${HYDRA_GO_BUILDPACK} AS go-build
WORKDIR /src/services/api
COPY services/api/go.mod services/api/go.sum ./
RUN go mod download
COPY services/api ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-api ./cmd/api

FROM ${HYDRA_NODE_BUILDPACK} AS browser-dependencies
WORKDIR /src/services/browser-agent
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY services/browser-agent/package.json services/browser-agent/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM ${HYDRA_BROWSER_BUILDPACK} AS runtime
WORKDIR /opt/rhythm
USER 0
RUN if command -v dnf >/dev/null 2>&1; then \
      dnf install -y chromium nss-tools && dnf clean all; \
    elif command -v microdnf >/dev/null 2>&1; then \
      microdnf install -y chromium nss-tools && microdnf clean all; \
    else \
      echo "The approved Hydra browser buildpack must provide dnf or microdnf" >&2; exit 1; \
    fi
COPY deploy/hydra/launcher.mjs deploy/hydra/launcher.mjs
COPY --from=go-build /out/rhythm-api /opt/rhythm/bin/rhythm-api
COPY --from=browser-dependencies /src/services/browser-agent/node_modules ./services/browser-agent/node_modules
COPY services/browser-agent/server.mjs services/browser-agent/artifact-transfer.mjs ./services/browser-agent/
RUN mkdir -p /opt/rhythm/home /opt/rhythm/tmp \
    && chgrp -R 0 /opt/rhythm \
    && chmod -R g=u /opt/rhythm
ENV NODE_ENV=production \
    NODE_USE_SYSTEM_CA=1 \
    HOME=/opt/rhythm/home \
    TMPDIR=/opt/rhythm/tmp \
    RHYTHM_ENVIRONMENT=production \
    RHYTHM_SERVICE_ROLE=browser-executor \
    RHYTHM_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    RHYTHM_CHROMIUM_DISABLE_DEV_SHM_USAGE=false
EXPOSE 8080
USER 1001
ENTRYPOINT ["node", "deploy/hydra/launcher.mjs"]
