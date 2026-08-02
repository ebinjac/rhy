# This Dockerfile belongs only to the non-routable Rhythm API executor service.
ARG HYDRA_GO_BUILDPACK=artifactory.aexp.com/paas-registry/buildpacks/rhel-go-1-builder:1.x.latest
ARG HYDRA_NODE_BUILDPACK=artifactory.aexp.com/paas-registry/buildpacks/rhel-nodejs-24-builder:latest

FROM ${HYDRA_GO_BUILDPACK} AS go-build
WORKDIR /src/services/api
COPY services/api/go.mod services/api/go.sum ./
RUN go mod download
COPY services/api ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rhythm-script-runner ./cmd/script-runner

FROM ${HYDRA_NODE_BUILDPACK} AS runtime
WORKDIR /opt/rhythm
COPY deploy/hydra/launcher.mjs deploy/hydra/launcher.mjs
COPY --from=go-build /out/rhythm-api /out/rhythm-script-runner /opt/rhythm/bin/
USER 0
RUN mkdir -p /opt/rhythm/home /opt/rhythm/tmp \
    && chgrp -R 0 /opt/rhythm \
    && chmod -R g=u /opt/rhythm
ENV NODE_ENV=production \
    NODE_USE_SYSTEM_CA=1 \
    HOME=/opt/rhythm/home \
    TMPDIR=/opt/rhythm/tmp \
    RHYTHM_ENVIRONMENT=production \
    RHYTHM_SERVICE_ROLE=api-executor
EXPOSE 8080
USER 1001
ENTRYPOINT ["node", "deploy/hydra/launcher.mjs"]
