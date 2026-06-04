/**
 * scripts/inject-request.ts
 *
 * Script de desarrollo para inyectar solicitudes de autorización directamente en Kafka.
 * Permite disparar el flujo completo sin necesitar un POS ni un internal-server.
 *
 * Uso:
 *   pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1
 *   pnpm inject --type PRICE_CHANGE --product-id P42 --original-price 100 --requested-price 80
 *   pnpm inject --type DISCOUNT --verify
 */

import { AuthorizationRequestDto } from '../packages/shared-types/src/dtos/authorization-request.dto';
import { RequestType } from '../packages/shared-types/src/enums/request-type.enum';

// ─── ParsedArgs ──────────────────────────────────────────────────────────────

export interface ParsedArgs {
  type: RequestType;
  storeId: string;
  posId: string;
  correlationId?: string;
  amount?: number;
  employeeId?: string;
  productId?: string;
  originalPrice?: number;
  requestedPrice?: number;
  verify?: boolean;
  verbose?: boolean;
}

// ─── parseArgs ───────────────────────────────────────────────────────────────

const VALID_TYPES = new Set<string>(Object.values(RequestType));

export function parseArgs(argv: string[]): ParsedArgs {
  const args: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        // boolean flag
        args[key] = 'true';
      }
    }
  }

  const typeRaw = args['type'];
  if (!typeRaw || !VALID_TYPES.has(typeRaw)) {
    throw new Error(
      `--type inválido: "${typeRaw ?? ''}". Valores válidos: ${Object.values(RequestType).join(', ')}`,
    );
  }

  const type = typeRaw as RequestType;
  const storeId = args['store-id'] ?? 'store-1';
  const posId = args['pos-id'] ?? 'pos-1';
  const correlationId = args['correlation-id'];
  const verify = args['verify'] === 'true';
  const verbose = args['verbose'] === 'true';

  const result: ParsedArgs = { type, storeId, posId, verify, verbose };

  if (correlationId !== undefined) {
    result.correlationId = correlationId;
  }

  // Tipo-specific fields
  if (type === RequestType.PRICE_CHANGE) {
    const productId = args['product-id'];
    const originalPriceRaw = args['original-price'];
    const requestedPriceRaw = args['requested-price'];

    if (!productId || originalPriceRaw === undefined || requestedPriceRaw === undefined) {
      throw new Error(
        'PRICE_CHANGE requiere --product-id, --original-price y --requested-price',
      );
    }

    const originalPrice = parseFloat(originalPriceRaw);
    const requestedPrice = parseFloat(requestedPriceRaw);

    if (isNaN(originalPrice)) {
      throw new Error(
        `--original-price no es un número válido (price/number): "${originalPriceRaw}"`,
      );
    }
    if (isNaN(requestedPrice)) {
      throw new Error(
        `--requested-price no es un número válido (price/number): "${requestedPriceRaw}"`,
      );
    }

    result.productId = productId;
    result.originalPrice = originalPrice;
    result.requestedPrice = requestedPrice;
  }

  if (type === RequestType.DISCOUNT && args['amount'] !== undefined) {
    const amount = parseFloat(args['amount']);
    if (isNaN(amount)) {
      throw new Error(`--amount no es un número válido (number): "${args['amount']}"`);
    }
    result.amount = amount;
  }

  if (type === RequestType.EMPLOYEE_BENEFIT && args['employee-id'] !== undefined) {
    result.employeeId = args['employee-id'];
  }

  return result;
}

// ─── buildDto ────────────────────────────────────────────────────────────────

export function buildDto(args: ParsedArgs): AuthorizationRequestDto {
  // Use v4 UUID for correlation_id when not provided
  // We use a dynamic import-compatible approach: inline require with fallback
  let correlationId = args.correlationId;
  if (!correlationId) {
    // Generate a simple UUID v4 without external deps for the pure function
    // (In main() we use the uuid package; here we replicate to avoid async)
    correlationId = generateUuidV4();
  }

  const dto: AuthorizationRequestDto = {
    store_id: args.storeId,
    pos_id: args.posId,
    correlation_id: correlationId,
    type: args.type,
    created_at: new Date().toISOString(),
  };

  // Only add optional fields if they are present (avoid undefined keys in JSON)
  if (args.amount !== undefined) {
    dto.amount = args.amount;
  }
  if (args.employeeId !== undefined) {
    dto.employee_id = args.employeeId;
  }
  if (args.productId !== undefined) {
    dto.product_id = args.productId;
  }
  if (args.originalPrice !== undefined) {
    dto.original_price = args.originalPrice;
  }
  if (args.requestedPrice !== undefined) {
    dto.requested_price = args.requestedPrice;
  }

  return dto;
}

/**
 * Minimal UUID v4 generator (RFC 4122) without external dependencies.
 * Used in buildDto so it remains a pure synchronous function testable without mocking.
 */
function generateUuidV4(): string {
  const bytes = new Uint8Array(16);
  // Use crypto.getRandomValues if available (Node 19+), else fallback
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    const nodeCrypto = require('crypto') as typeof import('crypto');
    const buf = nodeCrypto.randomBytes(16);
    bytes.set(buf);
  }
  // Set version 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Set variant bits
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// ─── waitForSseEvent ─────────────────────────────────────────────────────────

/**
 * Waits for an SSE event of type "authorization_request" whose parsed JSON
 * contains a `correlationId` (camelCase) that matches the given correlationId.
 *
 * Resolves when the matching event arrives.
 * Rejects with an error containing "Timeout" if timeoutMs elapses first.
 * Always calls eventSource.close() on both resolve and reject.
 */
export function waitForSseEvent(
  eventSource: EventSource,
  correlationId: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      eventSource.close();
      reject(new Error(`Timeout: solicitud no recibida en SSE tras ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (event: Event) => {
      if (settled) return;

      const sseEvent = event as MessageEvent;
      const data: string | null = sseEvent.data ?? null;

      if (data == null) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }

      // Must use camelCase correlationId — NOT snake_case correlation_id
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'correlationId' in parsed &&
        (parsed as Record<string, unknown>)['correlationId'] === correlationId
      ) {
        settled = true;
        clearTimeout(timeoutHandle);
        eventSource.close();
        resolve();
      }
    };

    eventSource.addEventListener('authorization_request', handler as EventListener);
  });
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load .env if present
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch {
    // dotenv not available — skip
  }

  const argv = process.argv.slice(2);

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  const kafkaBrokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');
  const bffUrl = process.env['BFF_URL'] ?? 'http://localhost:3000';

  if (args.verbose) {
    console.log('Configuración activa:');
    console.log(`  KAFKA_BROKERS: ${kafkaBrokers.join(',')}`);
    console.log(`  BFF_URL: ${bffUrl}`);
    console.log(`  type: ${args.type}`);
    console.log(`  storeId: ${args.storeId}`);
    console.log(`  posId: ${args.posId}`);
  }

  // Import uuid for main (production)
  let uuidV4: () => string;
  try {
    const uuidMod = await import('uuid');
    uuidV4 = uuidMod.v4;
  } catch {
    uuidV4 = generateUuidV4;
  }

  // Build DTO — override correlationId with uuid if not provided
  const dto = buildDto({
    ...args,
    correlationId: args.correlationId ?? uuidV4(),
  });

  console.log('\nPayload:');
  console.log(JSON.stringify(dto, null, 2));

  // If --verify, set up SSE listener BEFORE publishing to Kafka
  let verifyPromise: Promise<void> | null = null;
  if (args.verify) {
    const sseUrl = `${bffUrl}/stream/store/${args.storeId}`;
    console.log(`\nVerificando llegada en SSE: ${sseUrl}`);

    let EsClass: typeof EventSource;
    try {
      const esMod = await import('eventsource');
      EsClass = esMod.default as unknown as typeof EventSource;
    } catch {
      EsClass = EventSource;
    }

    const es = new EsClass(sseUrl) as EventSource;
    verifyPromise = waitForSseEvent(es, dto.correlation_id, 10_000);
  }

  // Publish to Kafka
  const { Kafka } = await import('kafkajs');
  const kafka = new Kafka({
    clientId: 'inject-script',
    brokers: kafkaBrokers,
  });

  const producer = kafka.producer();

  try {
    await producer.connect();
    await producer.send({
      topic: 'auth.requests',
      messages: [{ value: JSON.stringify(dto) }],
    });
    await producer.disconnect();
    console.log('\n✓ Publicado en auth.requests');
  } catch (err) {
    console.error(`\nError al conectar con Kafka (${kafkaBrokers.join(',')}): ${(err as Error).message}`);
    process.exit(1);
  }

  // Wait for SSE verification if requested
  if (verifyPromise) {
    const startMs = Date.now();
    try {
      await verifyPromise;
      const latencyMs = Date.now() - startMs;
      console.log(`✓ Verificado: solicitud recibida en SSE (latencia: ${latencyMs}ms)`);
    } catch {
      console.error('✗ Timeout: solicitud no recibida en SSE');
      process.exit(1);
    }
  }
}

// ─── Guard de ejecución ───────────────────────────────────────────────────────

// tsx runs scripts under CommonJS; require.main === module is true when invoked directly
if (require.main === module) {
  main().catch((err) => {
    console.error(`Error inesperado: ${(err as Error).message}`);
    process.exit(1);
  });
}
