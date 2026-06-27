# Multi-stage build for Next.js standalone output (next.config.mjs: output:standalone).

FROM node:20-bookworm-slim AS deps
RUN npm install -g pnpm@9.12.0
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
# --shamefully-hoist places real files (not symlinks to .pnpm store) under
# web/node_modules so the bundle is self-contained when copied into the runner.
RUN pnpm install --frozen-lockfile=false --shamefully-hoist

FROM node:20-bookworm-slim AS builder
RUN npm install -g pnpm@9.12.0
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/web/node_modules ./web/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY web ./web
RUN pnpm --filter @langprobe/web build

FROM node:20-bookworm-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=7090 \
    HOSTNAME=0.0.0.0
# Skip Next's standalone output (it bundles broken pnpm symlinks). Ship the
# whole monorepo node_modules + .pnpm store so the workspace symlinks under
# web/node_modules resolve at runtime.
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/web/package.json ./web/package.json
COPY --from=builder /repo/web/.next ./web/.next
COPY --from=builder /repo/web/node_modules ./web/node_modules
WORKDIR /repo/web
EXPOSE 7090
CMD ["node_modules/.bin/next", "start", "-p", "7090"]
