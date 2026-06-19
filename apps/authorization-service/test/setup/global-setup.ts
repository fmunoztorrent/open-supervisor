/**
 * E2E Global Setup — GREEN phase implementation
 *
 * Boots 3 NestJS AppModules in-process:
 *   - authorization-service → port 3001 (AUTH_SERVICE_PORT env)
 *   - sse-server            → port 3002 (SSE_SERVER_PORT env)
 *   - bff                   → port 3000 (BFF_PORT env)
 *
 * LOCAL DEV MODE: If the ports are already in use (e.g. `make dev` is
 * running), the harness skips in-process boot and reuses the existing
 * processes.  Teardown is skipped for externally-managed services.
 *
 * CI MODE: Ports are free; full in-process boot is performed and
 * teardown calls app.close() on every handle.
 *
 * Applies DB migrations before bootstrapping services.
 * Implements a Kafka consumer-join barrier: does not return until
 * authorization-service-group has at least one member in Kafka.
 *
 * Stores app handles in global.__E2E_APPS__ for globalTeardown.
 * global.__E2E_EXTERNAL__ = true when using pre-existing processes (skip teardown).
 */

import { execSync } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import { Kafka, Admin } from 'kafkajs';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

// ── env defaults (all values overridable via environment) ──────────────────
function setEnvDefault(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

function applyEnvDefaults(): void {
  setEnvDefault('KAFKA_BROKERS', 'localhost:9092');
  setEnvDefault('REDIS_HOST', 'localhost');
  setEnvDefault('REDIS_PORT', '6379');
  setEnvDefault(
    'DATABASE_URL',
    'postgresql://open_supervisor:dev_password@localhost:5432/open_supervisor',
  );
  setEnvDefault('SSE_SERVER_URL', 'http://localhost:3002');
  setEnvDefault('AUTH_SERVICE_URL', 'http://localhost:3001');
  setEnvDefault('BFF_URL', 'http://localhost:3000');
  // BFF requires these at bootstrap (eager getOrThrow in AuthModule)
  setEnvDefault('KEYCLOAK_URL', 'http://localhost:8080');
  setEnvDefault('KEYCLOAK_REALM', 'open-supervisor');
  setEnvDefault('KEYCLOAK_CLIENT_ID', 'bff-client');
  setEnvDefault('KEYCLOAK_CLIENT_SECRET', 'dummy-secret');
  // Speed up outbox tick in tests
  setEnvDefault('OUTBOX_TICK_INTERVAL_MS', '250');
}

// ── Port probing ───────────────────────────────────────────────────────────
/**
 * Probes a port by attempting a TCP connect.
 * Works regardless of whether the listener binds on :: (IPv6) or 0.0.0.0 (IPv4).
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true); // connection succeeded → port in use
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false); // no listener
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false); // ECONNREFUSED → port free
    });
    socket.connect(port, '127.0.0.1');
  });
}

// ── DB migrations ──────────────────────────────────────────────────────────
function applyMigrations(): void {
  const authServiceRoot = path.resolve(__dirname, '../../');
  console.log('[e2e:setup] Applying DB migrations...');
  execSync('pnpm db:migrate', {
    cwd: authServiceRoot,
    stdio: 'pipe',
    env: { ...process.env },
  });
  console.log('[e2e:setup] Migrations complete');
}

// ── Kafka consumer-join barrier ────────────────────────────────────────────
const CONSUMER_GROUP = 'authorization-service-group';
const BARRIER_POLL_INTERVAL_MS = 500;
// 90s: long enough to survive Kafka ghost-session expiry (~30s) + consumer restart + rebalance
const BARRIER_TIMEOUT_MS = 90_000;

async function waitForConsumerJoin(): Promise<void> {
  const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'e2e-barrier-client', brokers, logLevel: 0 });
  const admin: Admin = kafka.admin();
  await admin.connect();

  const deadline = Date.now() + BARRIER_TIMEOUT_MS;
  let lastState = '';

  try {
    while (Date.now() < deadline) {
      const groups = await admin.describeGroups([CONSUMER_GROUP]);
      const group = groups.groups[0];
      const state = group?.state ?? 'Unknown';

      if (state !== lastState) {
        console.log(`[e2e:setup] Consumer group "${CONSUMER_GROUP}" state: ${state} (members: ${group?.members?.length ?? 0})`);
        lastState = state;
      }

      // Only proceed when group is STABLE with at least one member
      // (avoids passing on ghost members during PREPARING_REBALANCE)
      if (state === 'Stable' && group?.members && group.members.length > 0) {
        console.log(
          `[e2e:setup] Consumer group "${CONSUMER_GROUP}" STABLE with ${group.members.length} member(s) — barrier passed`,
        );
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, BARRIER_POLL_INTERVAL_MS));
    }
    throw new Error(
      `[e2e:setup] Timeout: consumer group "${CONSUMER_GROUP}" did not reach STABLE state after ${BARRIER_TIMEOUT_MS}ms`,
    );
  } finally {
    await admin.disconnect();
  }
}

// ── Bootstrap services ─────────────────────────────────────────────────────

async function bootAuthorizationService(): Promise<INestApplication> {
  // Import AppModule via relative path — do NOT import main.ts
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../src/app.module') as { AppModule: new () => unknown };
  const app = await NestFactory.create(AppModule as Parameters<typeof NestFactory.create>[0], {
    logger: false, // suppress NestJS boot logs in test output
  });
  const port = parseInt(process.env['AUTH_SERVICE_PORT'] ?? '3001', 10);
  await app.listen(port);
  console.log(`[e2e:setup] authorization-service listening on port ${port}`);
  return app;
}

async function bootSseServer(): Promise<INestApplication> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../../sse-server/src/app.module') as {
    AppModule: new () => unknown;
  };
  const app = await NestFactory.create(AppModule as Parameters<typeof NestFactory.create>[0], {
    logger: false,
  });
  const port = parseInt(process.env['SSE_SERVER_PORT'] ?? '3002', 10);
  await app.listen(port);
  console.log(`[e2e:setup] sse-server listening on port ${port}`);
  return app;
}

async function bootBff(): Promise<INestApplication> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../../bff/src/app.module') as {
    AppModule: new () => unknown;
  };
  const app = await NestFactory.create(AppModule as Parameters<typeof NestFactory.create>[0], {
    logger: false,
  });
  app.enableCors();
  const port = parseInt(process.env['BFF_PORT'] ?? '3000', 10);
  await app.listen(port);
  console.log(`[e2e:setup] bff listening on port ${port}`);
  return app;
}

// ── Global setup entrypoint ────────────────────────────────────────────────
export default async function globalSetup(): Promise<void> {
  applyEnvDefaults();
  applyMigrations();

  const authPort = parseInt(process.env['AUTH_SERVICE_PORT'] ?? '3001', 10);
  const ssePort = parseInt(process.env['SSE_SERVER_PORT'] ?? '3002', 10);
  const bffPort = parseInt(process.env['BFF_PORT'] ?? '3000', 10);

  const [authInUse, sseInUse, bffInUse] = await Promise.all([
    isPortInUse(authPort),
    isPortInUse(ssePort),
    isPortInUse(bffPort),
  ]);

  const allExternal = authInUse && sseInUse && bffInUse;
  const someExternal = authInUse || sseInUse || bffInUse;

  if (allExternal) {
    // LOCAL DEV: services already running — reuse them, skip teardown
    console.log(
      `[e2e:setup] Services already running on ports ${authPort}/${ssePort}/${bffPort} — using external processes (teardown skipped)`,
    );
    (global as unknown as Record<string, unknown>)['__E2E_APPS__'] = [];
    (global as unknown as Record<string, unknown>)['__E2E_EXTERNAL__'] = true;
    await waitForConsumerJoin();
    return;
  }

  if (someExternal) {
    // Partial state — ambiguous; fail with clear message
    const occupied = [
      authInUse ? authPort : null,
      sseInUse ? ssePort : null,
      bffInUse ? bffPort : null,
    ]
      .filter(Boolean)
      .join(', ');
    throw new Error(
      `[e2e:setup] Partial port conflict: ports ${occupied} are already in use. ` +
        `Either stop all services (make down) or ensure all are running (make dev).`,
    );
  }

  // CI / clean mode: boot all services in-process
  console.log(`[e2e:setup] Ports free — bootstrapping services in-process`);

  // Boot order: auth-service first (owns Kafka consumer), then sse-server, then bff
  const [authApp, sseApp, bffApp] = await Promise.all([
    bootAuthorizationService(),
    bootSseServer(),
    bootBff(),
  ]);

  // Barrier: ensure authorization-service consumer has joined its group
  // before any test publishes to auth.requests
  await waitForConsumerJoin();

  // Store handles for teardown
  (global as unknown as Record<string, unknown>)['__E2E_APPS__'] = [authApp, sseApp, bffApp];
  (global as unknown as Record<string, unknown>)['__E2E_EXTERNAL__'] = false;

  console.log('[e2e:setup] All services ready — running tests');
}
