import { RequestType } from '../enums/request-type.enum';

export interface AuthorizationRequestDto {
  store_id: string;
  pos_id: string;
  correlation_id: string;
  type: RequestType;
  amount?: number;
  employee_id?: string;
  created_at: string;
  product_id?: string;
  original_price?: number;
  requested_price?: number;
}
