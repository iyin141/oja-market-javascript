# syntax=docker/dockerfile:1
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @oja/api...
RUN pnpm --filter @oja/db build && pnpm --filter @oja/shared build && pnpm --filter @oja/payment-provider build && pnpm --filter @oja/api build

FROM build AS migrate
WORKDIR /repo/packages/db
CMD ["sh", "-c", "DATABASE_URL=$MIGRATE_DATABASE_URL pnpm exec prisma migrate deploy"]

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
USER node
EXPOSE 4100
CMD ["node", "apps/api/dist/main.js"]
