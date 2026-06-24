FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi
COPY tsconfig.json ./
COPY packages/contracts ./packages/contracts
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY src ./src
RUN npx prisma generate \
  && npm run build \
  && mkdir -p dist/agents/qa-review dist/agents/client-checkin dist/agents/prompt-ops \
  && cp src/agents/qa-review/prompt.md dist/agents/qa-review/prompt.md \
  && cp src/agents/client-checkin/prompt.md dist/agents/client-checkin/prompt.md \
  && cp src/agents/prompt-ops/prompt.md dist/agents/prompt-ops/prompt.md

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S ops && adduser -S ops -u 1001 -G ops
COPY package.json package-lock.json* ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
# Install only the backend (root) + the contracts workspace it imports — the
# dashboard is deployed separately as a static build, so its runtime deps
# (react, etc.) are kept out of the backend image. All workspace manifests are
# copied above so the lockfile validates.
RUN if [ -f package-lock.json ]; then \
    npm ci --omit=dev --ignore-scripts --workspace=@cuantico/contracts --include-workspace-root; \
  else \
    npm install --omit=dev --ignore-scripts --workspace=@cuantico/contracts --include-workspace-root; \
  fi && npm cache clean --force

COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated
COPY migrations ./migrations
USER ops
EXPOSE 3100
CMD ["node", "dist/server.js"]