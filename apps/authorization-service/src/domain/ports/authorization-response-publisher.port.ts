import { AuthorizationRequestDto, RejectionReason } from '@open-supervisor/shared-types';

export const AUTHORIZATION_RESPONSE_PUBLISHER = 'AUTHORIZATION_RESPONSE_PUBLISHER';

export interface IAuthorizationResponsePublisher {
  reject(dto: AuthorizationRequestDto, reason: RejectionReason): Promise<void>;
}
