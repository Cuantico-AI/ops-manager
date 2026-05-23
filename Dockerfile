FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && mkdir -p dist/agents/qa-review dist/agents/client-checkin \
  && cp src/agents/qa-review/prompt.md dist/agents/qa-review/prompt.md \
  && cp src/agents/client-checkin/prompt.md dist/agents/client-checkin/prompt.md

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S ops && adduser -S ops -u 1001 -G ops
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
USER ops
EXPOSE 3100
CMD ["node", "dist/server.js"]
