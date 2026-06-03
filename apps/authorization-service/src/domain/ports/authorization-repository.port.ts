import { AuthorizationRequest } from '../entities/authorization-request.entity';

export const AUTHORIZATION_REPOSITORY = 'AUTHORIZATION_REPOSITORY';

export interface IAuthorizationRepository {
  save(request: AuthorizationRequest): Promise<void>;
  findById(id: string): Promise<AuthorizationRequest | null>;
  findPendingByStore(storeId: string): Promise<AuthorizationRequest[]>;
}
