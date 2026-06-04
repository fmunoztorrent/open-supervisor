import { pgSchema, uuid, text, timestamp, integer, jsonb, pgEnum } from 'drizzle-orm/pg-core';

/**
 * Schema `auth` separado del `public`. Mantiene la cohesión de las tablas
 * del dominio de autorización y permite grant/revoke de permisos a nivel
 * de schema en producción.
 */
export const authSchema = pgSchema('auth');

export const outboxStatusEnum = pgEnum('outbox_status', ['PENDING', 'PUBLISHED']);

/**
 * Tabla de solicitudes de autorización. Replica la entidad `AuthorizationRequest`
 * del dominio. La fila es la representación persistida; la entidad se reconstruye
 * via `AuthorizationRequest.fromDto()` al leer.
 *
 * Ver packages/shared-types/src/dtos/authorization-request.dto.ts para el shape wire.
 */
export const authorizationRequests = authSchema.table('authorization_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: text('store_id').notNull(),
  posId: text('pos_id').notNull(),
  correlationId: text('correlation_id').notNull().unique(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  amount: integer('amount'),
  employeeId: text('employee_id'),
  productId: text('product_id'),
  originalPrice: integer('original_price'),
  requestedPrice: integer('requested_price'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tabla del outbox. Cada row es una publicación pendiente a Kafka. El emisor
 * (`OutboxPublisherService`) toma rows PENDING, las publica, y las marca
 * PUBLISHED. `SELECT ... FOR UPDATE SKIP LOCKED` permite múltiples workers.
 */
export const outbox = authSchema.table('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  correlationId: text('correlation_id').notNull(),
  topic: text('topic').notNull(),
  /** Payload JSON. Shape: AuthorizationResponseDto (snake_case). */
  payload: jsonb('payload').notNull(),
  status: outboxStatusEnum('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  /** Mensaje del último error si attempts > 0. */
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export type AuthorizationRequestRow = typeof authorizationRequests.$inferSelect;
export type AuthorizationRequestInsert = typeof authorizationRequests.$inferInsert;
export type OutboxRow = typeof outbox.$inferSelect;
export type OutboxInsert = typeof outbox.$inferInsert;
