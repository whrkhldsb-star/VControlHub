# ── Stage 1: Dependencies ──────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY scripts/patch-minimatch-legacy.mjs ./scripts/patch-minimatch-legacy.mjs
RUN npm ci --no-audit --no-fund && npm cache clean --force

# ── Stage 2: Build ────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY . .
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:1/vcontrolhub_build
ENV VCONTROLHUB_DEPLOY_BUILD=1
RUN npx prisma generate && npm run build && npm run build:runtime \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force && rm -rf .next/cache

# ── Stage 3: Production ───────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_HOST=0.0.0.0
ENV PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      docker.io \
      openssh-client \
      openssl \
      sshpass \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/dist/next.config.mjs ./next.config.mjs
COPY --from=builder /app/docs/route-catalog.json ./docs/route-catalog.json
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder /app/scripts/check-ssh-gateway.mjs ./scripts/check-ssh-gateway.mjs

RUN chmod +x ./docker-entrypoint.sh && mkdir -p storage tmp uploads downloads backups logs

EXPOSE 3000 3001

CMD ["./docker-entrypoint.sh"]
