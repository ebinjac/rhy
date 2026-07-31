FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs artifact-transfer.mjs ./

ENV NODE_ENV=production
ENV RHYTHM_BROWSER_AGENT_ADDR=0.0.0.0
ENV RHYTHM_BROWSER_AGENT_PORT=8091
ENV RHYTHM_BROWSER_AGENT_IMAGE_VERSION=playwright-1.62.0-noble

USER pwuser
EXPOSE 8091
CMD ["node", "server.mjs"]
