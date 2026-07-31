FROM node:24-alpine AS dependencies

WORKDIR /app
COPY package.json package-lock.json tsconfig.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci

FROM dependencies AS build
COPY apps/web apps/web
COPY packages/ui packages/ui

RUN npm run build --workspace web

FROM node:24-alpine AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json tsconfig.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/server.mjs ./apps/web/server.mjs
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/packages/ui ./packages/ui
COPY --from=build /app/package.json ./package.json

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.mjs"]
