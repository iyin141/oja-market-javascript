# Oja Market web (Next.js). Build context = repo root.
# NEXT_BASE_PATH and NEXT_PUBLIC_API_URL are baked in at build time (Next inlines them).
FROM node:22-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@9.15.9
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false --filter @oja/web...
COPY apps/web apps/web
ARG NEXT_BASE_PATH=""
ARG NEXT_PUBLIC_API_URL="http://localhost:4100"
ARG NEXT_PUBLIC_MEDIA_BASE_URL=""
ENV NEXT_BASE_PATH=$NEXT_BASE_PATH NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_MEDIA_BASE_URL=$NEXT_PUBLIC_MEDIA_BASE_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @oja/web build

FROM node:22-slim
WORKDIR /app/apps/web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app /app
USER node
EXPOSE 3100
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3100"]
