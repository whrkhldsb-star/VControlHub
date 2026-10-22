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

# Platform backup and restore run pg_dump / psql. Debian's own client is
# PostgreSQL 15, which refuses to dump the 16 server of docker-compose.yml,
# so the matching client comes from the PostgreSQL project's repository.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      docker.io \
      openssh-client \
      openssl \
      sshpass \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
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
# Platform backup and restore entrypoints (src/lib/backup/platform-runner.ts).
COPY --from=builder /app/deploy/backup.sh ./deploy/backup.sh
COPY --from=builder /app/scripts/backup.mjs /app/scripts/restore.mjs /app/scripts/restore-db.sh /app/scripts/restore-files.sh /app/scripts/restore-full.sh ./scripts/
COPY --from=builder /app/scripts/lib/backup-common.mjs ./scripts/lib/backup-common.mjs

RUN chmod +x ./docker-entrypoint.sh && mkdir -p storage tmp uploads downloads backups logs file-versions

EXPOSE 3000 3001

CMD ["./docker-entrypoint.sh"]
