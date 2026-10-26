# syntax=docker/dockerfile:1
# API image for Render Free (ADR-0011). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t kelola-kasir-api .
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @kelola-kasir/api...
RUN pnpm --filter @kelola-kasir/api build
# Production node_modules only; dist/ is gitignored, so copy it explicitly.
RUN pnpm --filter @kelola-kasir/api deploy --prod --legacy /out \
  && rm -rf /out/dist && cp -r apps/api/dist /out/dist

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# Render Free has no pre-deploy command: apply migrations (idempotent, via DATABASE_URL_DIRECT)
# on every start, then hand PID 1 to the server so SIGTERM reaches it.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]
