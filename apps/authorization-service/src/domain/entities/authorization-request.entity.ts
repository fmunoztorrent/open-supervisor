import { AuthorizationRequestDto, AuthorizationStatus, RequestType } from '@open-supervisor/shared-types';
import { v4 as uuidv4 } from 'uuid';

export class AuthorizationRequest {
  readonly id: string;
  readonly storeId: string;
  readonly posId: string;
  readonly correlationId: string;
  readonly type: RequestType;
  readonly amount?: number;
  readonly employeeId?: string;
  readonly productId?: string;
  readonly originalPrice?: number;
  readonly requestedPrice?: number;
  readonly createdAt: Date;

  private _status: AuthorizationStatus;
  private _resolvedBy?: string;
  private _resolvedAt?: Date;

  private constructor(props: {
    id: string;
    storeId: string;
    posId: string;
    correlationId: string;
    type: RequestType;
    amount?: number;
    employeeId?: string;
    productId?: string;
    originalPrice?: number;
    requestedPrice?: number;
    createdAt: Date;
    status: AuthorizationStatus;
  }) {
    this.id = props.id;
    this.storeId = props.storeId;
    this.posId = props.posId;
    this.correlationId = props.correlationId;
    this.type = props.type;
    this.amount = props.amount;
    this.employeeId = props.employeeId;
    this.productId = props.productId;
    this.originalPrice = props.originalPrice;
    this.requestedPrice = props.requestedPrice;
    this.createdAt = props.createdAt;
    this._status = props.status;
  }

  static fromDto(dto: AuthorizationRequestDto): AuthorizationRequest {
    const isPriceChange = dto.type === RequestType.PRICE_CHANGE;
    return new AuthorizationRequest({
      id: uuidv4(),
      storeId: dto.store_id,
      posId: dto.pos_id,
      correlationId: dto.correlation_id,
      type: dto.type,
      amount: dto.amount,
      employeeId: dto.employee_id,
      productId: isPriceChange ? dto.product_id : undefined,
      originalPrice: isPriceChange ? dto.original_price : undefined,
      requestedPrice: isPriceChange ? dto.requested_price : undefined,
      createdAt: new Date(dto.created_at),
      status: AuthorizationStatus.PENDING,
    });
  }

  /**
   * Reconstruye la entidad desde una fila de Postgres. Usado por los
   * adapters de Drizzle para mapear row → entidad del dominio.
   */
  static fromRow(row: {
    id: string;
    storeId: string;
    posId: string;
    correlationId: string;
    type: string;
    status: string;
    amount: number | null;
    employeeId: string | null;
    productId: string | null;
    originalPrice: number | null;
    requestedPrice: number | null;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
  }): AuthorizationRequest {
    const entity = new AuthorizationRequest({
      id: row.id,
      storeId: row.storeId,
      posId: row.posId,
      correlationId: row.correlationId,
      type: row.type as RequestType,
      amount: row.amount ?? undefined,
      employeeId: row.employeeId ?? undefined,
      productId: row.productId ?? undefined,
      originalPrice: row.originalPrice ?? undefined,
      requestedPrice: row.requestedPrice ?? undefined,
      createdAt: row.createdAt,
      status: row.status as AuthorizationStatus,
    });
    if (row.resolvedBy) {
      entity._resolvedBy = row.resolvedBy;
    }
    if (row.resolvedAt) {
      entity._resolvedAt = row.resolvedAt;
    }
    return entity;
  }

  get status(): AuthorizationStatus {
    return this._status;
  }

  get resolvedBy(): string | undefined {
    return this._resolvedBy;
  }

  get resolvedAt(): Date | undefined {
    return this._resolvedAt;
  }

  approve(supervisorId: string): void {
    this.assertPending();
    this._status = AuthorizationStatus.APPROVED;
    this._resolvedBy = supervisorId;
    this._resolvedAt = new Date();
  }

  reject(supervisorId: string): void {
    this.assertPending();
    this._status = AuthorizationStatus.REJECTED;
    this._resolvedBy = supervisorId;
    this._resolvedAt = new Date();
  }

  isPending(): boolean {
    return this._status === AuthorizationStatus.PENDING;
  }

  private assertPending(): void {
    if (this._status !== AuthorizationStatus.PENDING) {
      throw new Error(`Authorization ${this.id} is already ${this._status}`);
    }
  }
}
