# apps/sse-server/Dockerfile
# Multi-stage build for sse-server
# Dependencies: @open-supervisor/shared-messaging
# Port: 3002
#
# Build context: repo root (.)
# Usage: docker build -f apps/sse-server/Dockerfile -t open-supervisor/sse-server .

# =============================================================================
# Stage 1: Build — install all deps, compile shared packages + service
# =============================================================================
FROM node:24-alpine AS build

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app

# Copy workspace configuration files (layer caching: rarely changes)
COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy package manifests for shared packages
COPY packages/shared-messaging/package.json packages/shared-messaging/tsconfig.json packages/shared-messaging/

# Copy package manifest and build config for this service
# Note: sse-server does NOT have tsconfig.build.json — uses tsconfig.json
COPY apps/sse-server/package.json \
     apps/sse-server/tsconfig.json \
     apps/sse-server/nest-cli.json \
     apps/sse-server/

# Install all dependencies (dev + prod) — cached unless package.json changes
RUN pnpm install --frozen-lockfile

# Copy full source code for shared packages
COPY packages/shared-messaging/src/ packages/shared-messaging/src/

# Compile shared packages (must be built before service)
RUN pnpm --filter @open-supervisor/shared-messaging build

# Copy service source code and build
COPY apps/sse-server/src/ apps/sse-server/src/
RUN pnpm --filter @open-supervisor/sse-server build

# =============================================================================
# Stage 2: Production — minimal image with only dist + production node_modules
# =============================================================================
FROM node:24-alpine AS production

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app

# Copy workspace configuration files
COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy package manifests for workspace dependencies
COPY packages/shared-messaging/package.json packages/shared-messaging/tsconfig.json packages/shared-messaging/
COPY apps/sse-server/package.json \
     apps/sse-server/nest-cli.json \
     apps/sse-server/

# Copy compiled dist from build stage (so pnpm deploy picks them up)
COPY --from=build /app/packages/shared-messaging/dist/ /app/packages/shared-messaging/dist/
COPY --from=build /app/apps/sse-server/dist/ /app/apps/sse-server/dist/

# Deploy production dependencies only
# pnpm deploy --prod resolves workspace:* as flat copies (no symlinks)
RUN pnpm --filter @open-supervisor/sse-server deploy --prod --legacy /app/prod

# Ensure dist files are present in the deployed directory
COPY --from=build /app/packages/shared-messaging/dist/ /app/prod/node_modules/@open-supervisor/shared-messaging/dist/
COPY --from=build /app/apps/sse-server/dist/ /app/prod/dist/

WORKDIR /app/prod

EXPOSE 3002

CMD ["node", "dist/main.js"]
