import { AuthorizationRequest } from '../entities/authorization-request.entity';
import { AuthorizationStatus } from '@open-supervisor/shared-types';

export const AUTHORIZATION_REPOSITORY = 'AUTHORIZATION_REPOSITORY';

export interface IAuthorizationRepository {
  save(request: AuthorizationRequest): Promise<void>;
  findById(id: string): Promise<AuthorizationRequest | null>;
  /**
   * Busca por correlationId (el identificador externo generado por el POS).
   * El contrato del endpoint POST /authorization/:id/resolve usa correlationId
   * (ver spec mobile línea 88: "El :id del resolve corresponde al correlation_id").
   */
  findByCorrelationId(correlationId: string): Promise<AuthorizationRequest | null>;
  findPendingByStore(storeId: string): Promise<AuthorizationRequest[]>;
  findResolvedByStore(storeId: string, status?: AuthorizationStatus, supervisorId?: string): Promise<AuthorizationRequest[]>;
}
