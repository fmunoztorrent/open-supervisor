/**
 * E2E Global Teardown — GREEN phase implementation
 *
 * Calls app.close() on every INestApplication stored by globalSetup.
 * This triggers OnModuleDestroy on every adapter:
 *   - KafkaConsumerAdapter / KafkaPublisherAdapter → consumer/producer disconnect
 *   - RedisPublisherAdapter → Redis quit
 *   - DrizzleModule → pg pool end
 *
 * Ensures Jest exits cleanly with no open handles.
 */

import { INestApplication } from '@nestjs/common';

export default async function globalTeardown(): Promise<void> {
  const isExternal = (global as unknown as Record<string, unknown>)['__E2E_EXTERNAL__'] as
    | boolean
    | undefined;

  if (isExternal) {
    console.log('[e2e:teardown] External services mode — skipping teardown (services not managed by harness)');
    return;
  }

  const apps = (global as unknown as Record<string, unknown>)['__E2E_APPS__'] as
    | INestApplication[]
    | undefined;

  if (!apps || apps.length === 0) {
    console.log('[e2e:teardown] No app handles found — skipping teardown');
    return;
  }

  console.log(`[e2e:teardown] Closing ${apps.length} service(s)...`);

  // Close in reverse boot order (bff → sse-server → auth-service)
  for (const app of [...apps].reverse()) {
    try {
      await app.close();
    } catch (err) {
      // Log but do not throw — we want all apps to attempt close
      console.warn('[e2e:teardown] Error closing app:', err);
    }
  }

  console.log('[e2e:teardown] All services closed');
}
