/**
 * SSE test helper — real HTTP/SSE client.
 * TEST INFRASTRUCTURE: direct use of `eventsource` package is intentional here.
 *
 * All hosts/ports read from env vars — no hardcoded literals.
 */
// eventsource uses `export =` (CommonJS-style). Must use `import =` syntax.
import EventSource = require('eventsource');
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';

/**
 * Opens an SSE connection to the BFF endpoint for the given storeId and waits
 * for an `authorization_request` event whose parsed body contains a
 * `correlation_id` (snake_case) matching the given value.
 *
 * Resolves with the parsed event data when the matching event arrives.
 * Rejects with "Timeout" error if timeoutMs elapses.
 *
 * IMPORTANT: matches on `correlation_id` (snake_case) — the wire format.
 */
export async function waitForSseEvent(
  storeId: string,
  correlationId: string,
  timeoutMs: number,
): Promise<AuthorizationRequestDto> {
  // Guard: clamp to avoid TimeoutNegativeWarning
  const safeTimeoutMs = Math.max(1, timeoutMs);
  const bffUrl = process.env['BFF_URL'] ?? 'http://localhost:3000';
  const url = `${bffUrl}/stream/store/${storeId}`;

  return new Promise<AuthorizationRequestDto>((resolve, reject) => {
    let settled = false;

    const es = new EventSource(url);

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      es.close();
      reject(
        new Error(
          `Timeout: SSE event "authorization_request" with correlation_id="${correlationId}" not received within ${safeTimeoutMs}ms on ${url}`,
        ),
      );
    }, safeTimeoutMs);

    es.addEventListener('authorization_request', (event: MessageEvent) => {
      if (settled) return;
      if (!event.data) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'correlation_id' in parsed &&
        (parsed as Record<string, unknown>)['correlation_id'] === correlationId
      ) {
        settled = true;
        clearTimeout(timeoutHandle);
        es.close();
        resolve(parsed as AuthorizationRequestDto);
      }
    });

    es.onerror = () => {
      if (settled) return;
      // Do not settle on error — the service might not be up yet (RED phase),
      // let the timeout reject instead.
    };
  });
}

/**
 * Asserts that NO `authorization_request` event with the given correlation_id
 * appears on storeId's SSE stream within waitMs.
 *
 * Resolves (passes) if the event does NOT appear.
 * Rejects if the event DOES appear (indicates a channel cross-talk bug).
 */
export async function assertNoSseEvent(
  storeId: string,
  correlationId: string,
  waitMs: number,
): Promise<void> {
  // Guard: clamp to avoid TimeoutNegativeWarning
  const safeWaitMs = Math.max(1, waitMs);
  const bffUrl = process.env['BFF_URL'] ?? 'http://localhost:3000';
  const url = `${bffUrl}/stream/store/${storeId}`;

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const es = new EventSource(url);

    const waitHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      es.close();
      resolve(); // No event arrived — that is the expected outcome
    }, safeWaitMs);

    es.addEventListener('authorization_request', (event: MessageEvent) => {
      if (settled) return;
      if (!event.data) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'correlation_id' in parsed &&
        (parsed as Record<string, unknown>)['correlation_id'] === correlationId
      ) {
        settled = true;
        clearTimeout(waitHandle);
        es.close();
        reject(
          new Error(
            `Unexpected SSE event: authorization_request with correlation_id="${correlationId}" appeared on store "${storeId}" stream — channel cross-talk bug`,
          ),
        );
      }
    });

    es.onerror = () => {
      // Connection refused is expected in RED phase; let waitHandle expire
    };
  });
}
