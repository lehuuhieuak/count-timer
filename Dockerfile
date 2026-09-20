FROM node:24.20.0-alpine AS base

WORKDIR /app

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder

COPY next.config.ts tsconfig.json next-env.d.ts eslint.config.mjs ./
COPY src ./src
COPY db ./db
COPY scripts ./scripts
RUN mkdir -p public
RUN npm run build

FROM deps AS production-deps

RUN npm prune --omit=dev

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=production-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
