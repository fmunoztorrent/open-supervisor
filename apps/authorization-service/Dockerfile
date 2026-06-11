# apps/authorization-service/Dockerfile
# Multi-stage build for authorization-service
# Dependencies: @open-supervisor/shared-types, @open-supervisor/shared-messaging
# Port: 3001
#
# Build context: repo root (.)
# Usage: docker build -f apps/authorization-service/Dockerfile -t open-supervisor/authorization-service .

# =============================================================================
# Stage 1: Build — install all deps, compile shared packages + service
# =============================================================================
FROM node:24-alpine AS build

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app

# Copy workspace configuration files (layer caching: rarely changes)
COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy package manifests for shared packages
COPY packages/shared-types/package.json packages/shared-types/tsconfig.json packages/shared-types/
COPY packages/shared-messaging/package.json packages/shared-messaging/tsconfig.json packages/shared-messaging/

# Copy package manifest and build config for this service
COPY apps/authorization-service/package.json \
     apps/authorization-service/tsconfig.json \
     apps/authorization-service/tsconfig.build.json \
     apps/authorization-service/nest-cli.json \
     apps/authorization-service/

# Install all dependencies (dev + prod) — cached unless package.json changes
RUN pnpm install --frozen-lockfile

# Copy full source code for shared packages
COPY packages/shared-types/src/ packages/shared-types/src/
COPY packages/shared-messaging/src/ packages/shared-messaging/src/

# Compile shared packages (must be built before service)
RUN pnpm --filter @open-supervisor/shared-types build
RUN pnpm --filter @open-supervisor/shared-messaging build

# Copy service source code and build
COPY apps/authorization-service/src/ apps/authorization-service/src/
RUN pnpm --filter @open-supervisor/authorization-service build

# =============================================================================
# Stage 2: Production — minimal image with only dist + production node_modules
# =============================================================================
FROM node:24-alpine AS production

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app

# Copy workspace configuration files
COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy package manifests for workspace dependencies
COPY packages/shared-types/package.json packages/shared-types/tsconfig.json packages/shared-types/
COPY packages/shared-messaging/package.json packages/shared-messaging/tsconfig.json packages/shared-messaging/
COPY apps/authorization-service/package.json \
     apps/authorization-service/nest-cli.json \
     apps/authorization-service/

# Copy compiled dist from build stage (so pnpm deploy picks them up)
COPY --from=build /app/packages/shared-types/dist/ /app/packages/shared-types/dist/
COPY --from=build /app/packages/shared-messaging/dist/ /app/packages/shared-messaging/dist/
COPY --from=build /app/apps/authorization-service/dist/ /app/apps/authorization-service/dist/

# Deploy production dependencies only
# pnpm deploy --prod resolves workspace:* as flat copies (no symlinks)
RUN pnpm --filter @open-supervisor/authorization-service deploy --prod --legacy /app/prod \
    && rm -rf /root/.local/share/pnpm/store /root/.npm /root/.cache /tmp/* /opt/yarn*

# Ensure dist files are present in the deployed directory
# (pnpm deploy copies source files, but dist/ is gitignored and may not exist in source)
COPY --from=build /app/packages/shared-types/dist/ /app/prod/node_modules/@open-supervisor/shared-types/dist/
COPY --from=build /app/packages/shared-messaging/dist/ /app/prod/node_modules/@open-supervisor/shared-messaging/dist/
COPY --from=build /app/apps/authorization-service/dist/ /app/prod/dist/

WORKDIR /app/prod

EXPOSE 3001

CMD ["node", "dist/main.js"]
