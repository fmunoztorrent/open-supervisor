import { AuthorizationStatus } from '../enums/authorization-status.enum';
import { RejectionReason } from '../enums/rejection-reason.enum';
import { RequestType } from '../enums/request-type.enum';

export interface AuthorizationResponseDto {
  store_id: string;
  pos_id: string;
  correlation_id: string;
  status: AuthorizationStatus;
  resolved_by: string;
  resolved_at: string;
  rejection_reason?: RejectionReason | string;
  type?: RequestType;
}
