export interface PhysicalPresenceDispatchDto {
  store_id: string;
  pos_id: string;
  correlation_id: string;
  product_id: string;
  original_price: number;
  requested_price: number;
}
