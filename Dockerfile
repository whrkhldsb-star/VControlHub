# ── Stage 1: Dependencies ──────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && cp -R node_modules /prod_modules && npm ci

# ── Stage 2: Build ────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY . .
RUN npx prisma generate && npm run build && npm run build:runtime

# ── Stage 3: Production ───────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_HOST=0.0.0.0
ENV PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends     ca-certificates curl openssl sshpass openssh-client &&     rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=deps /prod_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh && mkdir -p storage tmp uploads downloads backups logs

EXPOSE 3000 3001

CMD ["./docker-entrypoint.sh"]
