/**
 * Fase RED — tests para scripts/inject-request.ts
 *
 * Runner: node --test con tsx como loader (no Jest).
 * Ejecutar: npx tsx --test scripts/inject-request.spec.ts
 *
 * Los tipos se importan directamente desde el source de shared-types
 * porque el dist/ puede no estar buildeado en un entorno limpio.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ─── Tipos importados desde source (no desde dist) ──────────────────────────
import type { AuthorizationRequestDto } from '../packages/shared-types/src/dtos/authorization-request.dto';
import { RequestType } from '../packages/shared-types/src/enums/request-type.enum';

// ─── Módulo a testear (no existe aún → los tests fallarán con MODULE_NOT_FOUND)
import type { ParsedArgs } from './inject-request';
import { parseArgs, buildDto, waitForSseEvent } from './inject-request';

// ─── Mock manual de EventSource ──────────────────────────────────────────────
// EventSource en Node.js no existe en el runtime — se crea un objeto mínimo
// que implementa addEventListener(type, handler) y close(), suficiente para
// que waitForSseEvent pueda registrar listeners y ser controlado desde el test.

type SseHandler = (event: { data: string | null }) => void;

interface MockEventSource {
  listeners: Map<string, SseHandler[]>;
  closed: boolean;
  addEventListener(type: string, handler: SseHandler): void;
  close(): void;
  /** Disparar un evento sintético desde el test */
  emit(type: string, data: string | null): void;
}

function createMockEventSource(): MockEventSource {
  const listeners: Map<string, SseHandler[]> = new Map();
  return {
    listeners,
    closed: false,
    addEventListener(type: string, handler: SseHandler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(handler);
    },
    close() {
      this.closed = true;
    },
    emit(type: string, data: string | null) {
      for (const h of listeners.get(type) ?? []) {
        h({ data });
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite: parseArgs
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  // Test 1 — campos básicos correctamente parseados
  it('retorna type, storeId, posId cuando se proveen --type, --store-id, --pos-id', () => {
    const result = parseArgs(['--type', 'DISCOUNT', '--store-id', 's1', '--pos-id', 'p1']);
    assert.equal(result.type, 'DISCOUNT');
    assert.equal(result.storeId, 's1');
    assert.equal(result.posId, 'p1');
  });

  // Test 2 — PRICE_CHANGE sin --product-id lanza error
  it('lanza error con mensaje que incluye "PRICE_CHANGE" cuando faltan campos requeridos del tipo', () => {
    assert.throws(
      () => parseArgs(['--type', 'PRICE_CHANGE']),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'debe ser un Error');
        assert.ok(
          err.message.includes('PRICE_CHANGE'),
          `mensaje debe incluir "PRICE_CHANGE", fue: "${err.message}"`,
        );
        return true;
      },
    );
  });

  // Test 3 — --original-price no numérico lanza error (no publica NaN)
  it('lanza error por precio no numérico cuando --original-price no es un número', () => {
    assert.throws(
      () =>
        parseArgs([
          '--type', 'PRICE_CHANGE',
          '--product-id', 'P42',
          '--original-price', 'abc',
          '--requested-price', '80',
        ]),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'debe ser un Error');
        // El mensaje debe indicar que el precio no es un número válido
        assert.ok(
          err.message.toLowerCase().includes('price') ||
          err.message.toLowerCase().includes('precio') ||
          err.message.toLowerCase().includes('numeric') ||
          err.message.toLowerCase().includes('número') ||
          err.message.toLowerCase().includes('number'),
          `mensaje debe mencionar precio/price/número/number, fue: "${err.message}"`,
        );
        return true;
      },
    );
  });

  // Test 4 — --correlation-id explícito se respeta, no se genera UUID nuevo
  it('respeta el --correlation-id explícito cuando se provee', () => {
    const result = parseArgs([
      '--type', 'DISCOUNT',
      '--store-id', 's1',
      '--pos-id', 'p1',
      '--correlation-id', 'my-id',
    ]);
    assert.equal(result.correlationId, 'my-id');
  });

  // Test 5 — tipo inválido lanza error
  it('lanza error por tipo desconocido cuando --type no es un RequestType válido', () => {
    assert.throws(
      () => parseArgs(['--type', 'INVALID']),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'debe ser un Error');
        return true;
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: buildDto
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDto', () => {
  // Test 6 — created_at es una fecha ISO 8601 válida terminada en Z
  it('incluye created_at como string ISO 8601 parseable terminado en "Z"', () => {
    const args: ParsedArgs = {
      type: RequestType.DISCOUNT,
      storeId: 'store-1',
      posId: 'pos-1',
    };
    const dto: AuthorizationRequestDto = buildDto(args);

    assert.ok(typeof dto.created_at === 'string', 'created_at debe ser string');
    assert.ok(
      dto.created_at.endsWith('Z'),
      `created_at debe terminar en "Z" (UTC), fue: "${dto.created_at}"`,
    );
    const parsed = new Date(dto.created_at);
    assert.ok(!isNaN(parsed.getTime()), `created_at no es parseable por new Date(): "${dto.created_at}"`);
  });

  // Test 7 — DISCOUNT sin --amount no incluye la clave amount (no serializa undefined)
  it('no incluye la clave "amount" en el DTO cuando no se proveyó --amount para DISCOUNT', () => {
    const args: ParsedArgs = {
      type: RequestType.DISCOUNT,
      storeId: 'store-1',
      posId: 'pos-1',
    };
    const dto: AuthorizationRequestDto = buildDto(args);

    // Verificar que la clave no existe en el objeto (no que sea undefined)
    assert.ok(
      !Object.prototype.hasOwnProperty.call(dto, 'amount'),
      'el DTO no debe tener la clave "amount" cuando no fue provista',
    );

    // Adicionalmente, al serializar a JSON no debe aparecer
    const json = JSON.stringify(dto);
    assert.ok(
      !json.includes('"amount"'),
      `"amount" no debe aparecer en el JSON serializado, JSON fue: ${json}`,
    );
  });

  // Test 8 — PRICE_CHANGE incluye product_id, original_price, requested_price
  it('incluye product_id, original_price y requested_price para PRICE_CHANGE', () => {
    const args: ParsedArgs = {
      type: RequestType.PRICE_CHANGE,
      storeId: 'store-1',
      posId: 'pos-1',
      productId: 'P42',
      originalPrice: 100,
      requestedPrice: 80,
    };
    const dto: AuthorizationRequestDto = buildDto(args);

    assert.equal(dto.product_id, 'P42');
    assert.equal(dto.original_price, 100);
    assert.equal(dto.requested_price, 80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: waitForSseEvent
// ─────────────────────────────────────────────────────────────────────────────

describe('waitForSseEvent', () => {
  // Test 9 — resuelve cuando llega evento authorization_request con correlation_id snake_case correcto
  it('resuelve cuando llega un evento "authorization_request" con correlation_id snake_case correcto', async () => {
    const mockEs = createMockEventSource();
    const correlationId = 'test-corr-id-9';

    const promise = waitForSseEvent(mockEs as unknown as EventSource, correlationId, 500);

    // Emitir el evento esperado con snake_case (formato real del DTO compartido)
    mockEs.emit('authorization_request', JSON.stringify({ correlation_id: correlationId }));

    // Debe resolver sin rechazar
    await assert.doesNotReject(promise);
  });

  // Test 10 — rechaza con error que incluye "Timeout" si no llega evento en timeoutMs
  it('rechaza con error que incluye "Timeout" si el evento no llega en el tiempo dado', async () => {
    const mockEs = createMockEventSource();
    const correlationId = 'test-corr-id-10';

    await assert.rejects(
      waitForSseEvent(mockEs as unknown as EventSource, correlationId, 50),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'debe ser un Error');
        assert.ok(
          err.message.includes('Timeout') || err.message.includes('timeout'),
          `mensaje debe incluir "Timeout", fue: "${err.message}"`,
        );
        return true;
      },
    );
  });

  // Test 11 — NO resuelve si el event.data tiene correlationId camelCase (regresión histórica)
  // El wire format del DTO es snake_case. Si el script aceptara camelCase
  // (versión vieja del código) sería un falso positivo en verificación SSE
  // porque el authorization-service NUNCA publica camelCase.
  it('NO resuelve si el evento lleva correlationId camelCase en el data JSON (debe ignorarlo)', async () => {
    const mockEs = createMockEventSource();
    const correlationId = 'test-corr-id-11';

    const promise = waitForSseEvent(mockEs as unknown as EventSource, correlationId, 80);

    // Emitir evento con camelCase — debe ser descartado (no es el wire real)
    mockEs.emit('authorization_request', JSON.stringify({ correlationId: correlationId }));

    // La promise debe rechazar por timeout, no resolver
    await assert.rejects(
      promise,
      (err: unknown) => {
        assert.ok(err instanceof Error, 'debe rechazar con Error');
        assert.ok(
          err.message.includes('Timeout') || err.message.includes('timeout'),
          `debe rechazar por timeout cuando solo llega camelCase, mensaje: "${(err as Error).message}"`,
        );
        return true;
      },
    );
  });

  // Test 12 — descarta eventos con correlation_id distinto (no resuelve antes de tiempo)
  it('descarta eventos con correlation_id distinto y no resuelve hasta recibir el correcto', async () => {
    const mockEs = createMockEventSource();
    const correlationId = 'expected-id';

    const promise = waitForSseEvent(mockEs as unknown as EventSource, correlationId, 500);

    // Emitir evento con correlation_id incorrecto — debe ser descartado
    mockEs.emit('authorization_request', JSON.stringify({ correlation_id: 'wrong-id' }));

    // Emitir el correcto a continuación
    mockEs.emit('authorization_request', JSON.stringify({ correlation_id: 'expected-id' }));

    // Debe resolver (el evento correcto llegó después del descartado)
    await assert.doesNotReject(promise);
  });

  // Test 13 — cierra el EventSource al resolver
  it('cierra el EventSource (llama a close()) cuando resuelve correctamente', async () => {
    const mockEs = createMockEventSource();
    const correlationId = 'test-corr-id-13-resolve';

    const promise = waitForSseEvent(mockEs as unknown as EventSource, correlationId, 500);
    mockEs.emit('authorization_request', JSON.stringify({ correlation_id: correlationId }));
    await promise;

    assert.ok(mockEs.closed, 'eventSource.close() debe haber sido llamado al resolver');
  });

  // Test 13b — cierra el EventSource al producirse timeout
  it('cierra el EventSource (llama a close()) cuando se produce el timeout', async () => {
    const mockEs = createMockEventSource();
    const correlationId = 'test-corr-id-13-timeout';

    await assert.rejects(
      waitForSseEvent(mockEs as unknown as EventSource, correlationId, 50),
    );

    assert.ok(mockEs.closed, 'eventSource.close() debe haber sido llamado al timeout');
  });
});
