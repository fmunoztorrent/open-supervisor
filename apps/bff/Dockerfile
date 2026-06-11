# apps/bff/Dockerfile
# Multi-stage build for bff (Backend for Frontend)
# Dependencies: @open-supervisor/shared-types
# Port: 3000
#
# Build context: repo root (.)
# Usage: docker build -f apps/bff/Dockerfile -t open-supervisor/bff .

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

# Copy package manifest and build config for this service
# Note: bff does NOT have tsconfig.build.json — uses tsconfig.json
COPY apps/bff/package.json \
     apps/bff/tsconfig.json \
     apps/bff/nest-cli.json \
     apps/bff/

# Install all dependencies (dev + prod) — cached unless package.json changes
RUN pnpm install --frozen-lockfile

# Copy full source code for shared packages
COPY packages/shared-types/src/ packages/shared-types/src/

# Compile shared packages (must be built before service)
RUN pnpm --filter @open-supervisor/shared-types build

# Copy service source code and build
COPY apps/bff/src/ apps/bff/src/
RUN pnpm --filter @open-supervisor/bff build

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
COPY apps/bff/package.json \
     apps/bff/nest-cli.json \
     apps/bff/

# Copy compiled dist from build stage (so pnpm deploy picks them up)
COPY --from=build /app/packages/shared-types/dist/ /app/packages/shared-types/dist/
COPY --from=build /app/apps/bff/dist/ /app/apps/bff/dist/

# Deploy production dependencies only
# pnpm deploy --prod resolves workspace:* as flat copies (no symlinks)
RUN pnpm --filter @open-supervisor/bff deploy --prod --legacy /app/prod

# Ensure dist files are present in the deployed directory
COPY --from=build /app/packages/shared-types/dist/ /app/prod/node_modules/@open-supervisor/shared-types/dist/
COPY --from=build /app/apps/bff/dist/ /app/prod/dist/

WORKDIR /app/prod

EXPOSE 3000

CMD ["node", "dist/main.js"]
