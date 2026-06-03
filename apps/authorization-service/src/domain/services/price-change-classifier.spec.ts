import {
  PriceChangeClassifier,
  PriceChangeClassification,
  MinimumPriceViolationError,
  InvalidPriceError,
} from './price-change-classifier';

// ─── helper ──────────────────────────────────────────────────────────────────

function classify(originalPrice: number, requestedPrice: number): PriceChangeClassification {
  return PriceChangeClassifier.classify(originalPrice, requestedPrice);
}

// ─── scenarios ────────────────────────────────────────────────────────────────

describe('PriceChangeClassifier', () => {
  describe('Igualdad de precios — retorna EQUAL antes de validar el mínimo', () => {
    it('retorna EQUAL cuando requested_price === original_price', () => {
      expect(classify(1000, 1000)).toBe('EQUAL');
    });

    it('retorna EQUAL con precio igual por debajo del mínimo (no lanza MinimumPriceViolationError)', () => {
      // El orden de validación en el dominio es: igualdad primero → mínimo después.
      // Si los precios son iguales, sale sin validar el mínimo.
      expect(classify(100, 100)).toBe('EQUAL');
    });
  });

  describe('Guardia de precio mínimo (MIN_PRICE = 150)', () => {
    it('lanza MinimumPriceViolationError cuando requested_price = 149', () => {
      expect(() => classify(1000, 149)).toThrow(MinimumPriceViolationError);
    });

    it('lanza MinimumPriceViolationError cuando requested_price = 1 (bien por debajo del mínimo)', () => {
      expect(() => classify(1000, 1)).toThrow(MinimumPriceViolationError);
    });

    it('NO lanza cuando requested_price = 150 (exactamente en el límite)', () => {
      expect(() => classify(1000, 150)).not.toThrow();
    });
  });

  describe('Regla del 50 %', () => {
    it('retorna WITHIN_LIMIT cuando la diferencia es ≤ 50 % (1000→600, diferencia 40 %)', () => {
      expect(classify(1000, 600)).toBe('WITHIN_LIMIT');
    });

    it('retorna EXCEEDS_LIMIT cuando la diferencia es > 50 % (1000→400, diferencia 60 %)', () => {
      expect(classify(1000, 400)).toBe('EXCEEDS_LIMIT');
    });

    it('retorna WITHIN_LIMIT cuando requested_price=150, original_price=200 (25 % diferencia)', () => {
      expect(classify(200, 150)).toBe('WITHIN_LIMIT');
    });

    it('retorna EXCEEDS_LIMIT cuando requested_price=150, original_price=1000 (85 % diferencia)', () => {
      expect(classify(1000, 150)).toBe('EXCEEDS_LIMIT');
    });

    it('retorna WITHIN_LIMIT cuando la diferencia es exactamente 50 %', () => {
      // 1000 → 500: |1000-500|/1000 = 0.50 → es ≤ 50 %, debe ser WITHIN_LIMIT
      expect(classify(1000, 500)).toBe('WITHIN_LIMIT');
    });
  });

  describe('Guardia de división por cero — original_price === 0', () => {
    it('lanza InvalidPriceError cuando original_price === 0', () => {
      expect(() => classify(0, 500)).toThrow(InvalidPriceError);
    });
  });
});
