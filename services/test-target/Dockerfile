FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache curl openssl

COPY package.json ./
COPY server.mjs ./
COPY scripts ./scripts
COPY certs ./certs

# Regenerate certs at build time if missing (keeps image self-contained).
RUN if [ ! -f certs/server.pem ]; then node scripts/generate-certs.mjs; fi

ENV PORT=8080
ENV HTTPS_PORT=8443

EXPOSE 8080 8443

HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
