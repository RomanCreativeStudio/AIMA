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

EXPOSE 4000
WORKDIR /repo/backend
CMD ["node", "dist/index.js"]
