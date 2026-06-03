import { AuthorizationRequestDto, AuthorizationStatus, RequestType } from '@open-supervisor/shared-types';
import { AuthorizationRequest } from './authorization-request.entity';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeBaseDto(overrides: Partial<AuthorizationRequestDto> = {}): AuthorizationRequestDto {
  return {
    store_id: 'store-001',
    pos_id: 'pos-01',
    correlation_id: 'corr-xyz',
    type: RequestType.DISCOUNT,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makePriceChangeDto(overrides: Partial<AuthorizationRequestDto> = {}): AuthorizationRequestDto {
  return makeBaseDto({
    type: RequestType.PRICE_CHANGE,
    product_id: 'prod-abc',
    original_price: 1000,
    requested_price: 600,
    ...overrides,
  });
}

// ─── scenarios ────────────────────────────────────────────────────────────────

describe('AuthorizationRequest.fromDto()', () => {
  describe('Mapeo de campos base (todos los tipos)', () => {
    it('mapea store_id, pos_id, correlation_id y type correctamente', () => {
      const dto = makeBaseDto({ type: RequestType.DISCOUNT });
      const entity = AuthorizationRequest.fromDto(dto);

      expect(entity.storeId).toBe(dto.store_id);
      expect(entity.posId).toBe(dto.pos_id);
      expect(entity.correlationId).toBe(dto.correlation_id);
      expect(entity.type).toBe(RequestType.DISCOUNT);
    });

    it('inicia con status PENDING', () => {
      const entity = AuthorizationRequest.fromDto(makeBaseDto());
      expect(entity.status).toBe(AuthorizationStatus.PENDING);
    });
  });

  describe('PRICE_CHANGE — mapeo de campos de precio', () => {
    it('mapea product_id al campo productId de la entidad', () => {
      const dto = makePriceChangeDto({ product_id: 'prod-xyz' });
      const entity = AuthorizationRequest.fromDto(dto);

      expect(entity.productId).toBe('prod-xyz');
    });

    it('mapea original_price al campo originalPrice de la entidad', () => {
      const dto = makePriceChangeDto({ original_price: 999 });
      const entity = AuthorizationRequest.fromDto(dto);

      expect(entity.originalPrice).toBe(999);
    });

    it('mapea requested_price al campo requestedPrice de la entidad', () => {
      const dto = makePriceChangeDto({ requested_price: 500 });
      const entity = AuthorizationRequest.fromDto(dto);

      expect(entity.requestedPrice).toBe(500);
    });
  });

  describe('DISCOUNT — campos de precio quedan undefined', () => {
    it('productId es undefined para DISCOUNT', () => {
      const dto = makeBaseDto({ type: RequestType.DISCOUNT });
      const entity = AuthorizationRequest.fromDto(dto);

      expect(entity.productId).toBeUndefined();
    });

    it('originalPrice es undefined para DISCOUNT', () => {
      const dto = makeBaseDto({ type: RequestType.DISCOUNT });
      const entity = AuthorizationRequest.fromDto(dto);

      expect(entity.originalPrice).toBeUndefined();
    });

    it('requestedPrice es undefined para DISCOUNT', () => {
      const dto = makeBaseDto({ type: RequestType.DISCOUNT });
      const entity = AuthorizationRequest.fromDto(dto);

      expect(entity.requestedPrice).toBeUndefined();
    });
  });

  describe('Otros tipos existentes — campos de precio quedan undefined (no regresión)', () => {
    it.each([
      [RequestType.CANCEL],
      [RequestType.SUSPEND],
      [RequestType.EMPLOYEE_BENEFIT],
    ])('%s no tiene campos de precio', (type) => {
      const dto = makeBaseDto({ type });
      const entity = AuthorizationRequest.fromDto(dto);

      expect(entity.productId).toBeUndefined();
      expect(entity.originalPrice).toBeUndefined();
      expect(entity.requestedPrice).toBeUndefined();
    });
  });
});
