import { Injectable } from '@nestjs/common';
import { AuthorizationRequest } from '../../domain/entities/authorization-request.entity';
import { IAuthorizationRepository } from '../../domain/ports/authorization-repository.port';

@Injectable()
export class InMemoryAuthorizationRepository implements IAuthorizationRepository {
  private readonly store = new Map<string, AuthorizationRequest>();

  async save(request: AuthorizationRequest): Promise<void> {
    this.store.set(request.id, request);
  }

  async findById(id: string): Promise<AuthorizationRequest | null> {
    return this.store.get(id) ?? null;
  }

  async findByCorrelationId(correlationId: string): Promise<AuthorizationRequest | null> {
    for (const request of this.store.values()) {
      if (request.correlationId === correlationId) return request;
    }
    return null;
  }

  async findPendingByStore(storeId: string): Promise<AuthorizationRequest[]> {
    return [...this.store.values()].filter(
      (r) => r.storeId === storeId && r.isPending(),
    );
  }
}
