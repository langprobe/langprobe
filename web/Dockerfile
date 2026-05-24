# Multi-stage build for Next.js standalone output (next.config.mjs: output:standalone).

FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile=false

FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/web/node_modules ./web/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY web ./web
COPY packages ./packages
RUN pnpm --filter @tracebility/web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=7090 \
    HOSTNAME=0.0.0.0
# Next standalone output is self-contained (server.js + minimal node_modules).
COPY --from=builder /repo/web/.next/standalone ./
COPY --from=builder /repo/web/.next/static ./web/.next/static
EXPOSE 7090
CMD ["node", "web/server.js"]
