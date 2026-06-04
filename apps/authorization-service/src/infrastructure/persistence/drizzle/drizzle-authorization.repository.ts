import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DrizzleDb, DRIZZLE } from './drizzle.provider';
import { authorizationRequests, AuthorizationRequestRow, AuthorizationRequestInsert } from './schema';
import { AuthorizationRequest } from '../../../domain/entities/authorization-request.entity';
import { IAuthorizationRepository } from '../../../domain/ports/authorization-repository.port';
import { RequestType, AuthorizationStatus } from '@open-supervisor/shared-types';

function toInsert(entity: AuthorizationRequest): AuthorizationRequestInsert {
  return {
    id: entity.id,
    storeId: entity.storeId,
    posId: entity.posId,
    correlationId: entity.correlationId,
    type: entity.type,
    status: entity.status,
    amount: entity.amount ?? null,
    employeeId: entity.employeeId ?? null,
    productId: entity.productId ?? null,
    originalPrice: entity.originalPrice ?? null,
    requestedPrice: entity.requestedPrice ?? null,
    resolvedBy: entity.resolvedBy ?? null,
    resolvedAt: entity.resolvedAt ?? null,
    createdAt: entity.createdAt,
  };
}

function toEntity(row: AuthorizationRequestRow): AuthorizationRequest {
  return AuthorizationRequest.fromRow({
    id: row.id,
    storeId: row.storeId,
    posId: row.posId,
    correlationId: row.correlationId,
    type: row.type,
    status: row.status,
    amount: row.amount,
    employeeId: row.employeeId,
    productId: row.productId,
    originalPrice: row.originalPrice,
    requestedPrice: row.requestedPrice,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  });
}

@Injectable()
export class DrizzleAuthorizationRepository implements IAuthorizationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async save(request: AuthorizationRequest): Promise<void> {
    const row = toInsert(request);
    await this.db
      .insert(authorizationRequests)
      .values(row)
      .onConflictDoUpdate({
        target: authorizationRequests.id,
        set: {
          storeId: row.storeId,
          posId: row.posId,
          correlationId: row.correlationId,
          type: row.type,
          status: row.status,
          amount: row.amount,
          employeeId: row.employeeId,
          productId: row.productId,
          originalPrice: row.originalPrice,
          requestedPrice: row.requestedPrice,
          resolvedBy: row.resolvedBy,
          resolvedAt: row.resolvedAt,
        },
      });
  }

  async findById(id: string): Promise<AuthorizationRequest | null> {
    const rows = await this.db
      .select()
      .from(authorizationRequests)
      .where(eq(authorizationRequests.id, id))
      .limit(1);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findByCorrelationId(correlationId: string): Promise<AuthorizationRequest | null> {
    const rows = await this.db
      .select()
      .from(authorizationRequests)
      .where(eq(authorizationRequests.correlationId, correlationId))
      .limit(1);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findPendingByStore(storeId: string): Promise<AuthorizationRequest[]> {
    const rows = await this.db
      .select()
      .from(authorizationRequests)
      .where(
        and(
          eq(authorizationRequests.storeId, storeId),
          eq(authorizationRequests.status, AuthorizationStatus.PENDING),
        ),
      );
    return rows.map(toEntity);
  }
}
