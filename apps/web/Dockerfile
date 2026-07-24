FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json tsconfig.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci

COPY apps/web apps/web
COPY packages/ui packages/ui

EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "web", "--", "--host", "0.0.0.0"]
