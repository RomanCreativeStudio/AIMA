# Production image for the AIMA backend (Phase 3.1).
#
# Multi-stage so the shipped image carries only production dependencies and
# compiled JS — no TypeScript, no dev tooling, no source maps for the AI
# provider SDK's transitive deps. Built from the repo root because this is an
# npm workspaces monorepo (backend depends on the sibling @aima/ai-engine
# workspace package) — `docker build .` must run with this file as context.

FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY ai-engine/package.json ai-engine/package.json
COPY backend/package.json backend/package.json
RUN npm ci
COPY ai-engine ai-engine
COPY backend backend
RUN npm run build

FROM node:22-slim AS production
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY ai-engine/package.json ai-engine/package.json
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev
COPY --from=build /repo/ai-engine/dist ai-engine/dist
COPY --from=build /repo/backend/dist backend/dist
COPY database database

# Run as the non-root `node` user node:22-slim already ships (EPIC-005
# Sprint 5.4) — least privilege inside the container, not a defense against
# any specific known exploit. Ownership must be reassigned after the COPY
# steps above, which run as root by default.
RUN chown -R node:node /repo
USER node

EXPOSE 4000
WORKDIR /repo/backend

# Reuses the same GET /health the app already serves for monitoring (Phase
# 3.1) rather than a separate mechanism — no curl/wget install needed since
# node:22 has global fetch. --start-period gives the app time to run its
# startup sequence (capability sync, provider construction) before the first
# check counts against it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
