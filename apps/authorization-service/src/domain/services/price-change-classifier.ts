import { MinimumPriceViolationError, InvalidPriceError } from '../exceptions/price-change.exceptions';

export { MinimumPriceViolationError, InvalidPriceError };

export type PriceChangeClassification = 'EQUAL' | 'WITHIN_LIMIT' | 'EXCEEDS_LIMIT';

const MIN_PRICE = 150;

export class PriceChangeClassifier {
  static classify(originalPrice: number, requestedPrice: number): PriceChangeClassification {
    // 1. Igualdad de precios — sale antes de validar el mínimo
    if (requestedPrice === originalPrice) {
      return 'EQUAL';
    }

    // 2. Guardia de división por cero
    if (originalPrice === 0) {
      throw new InvalidPriceError();
    }

    // 3. Precio mínimo
    if (requestedPrice < MIN_PRICE) {
      throw new MinimumPriceViolationError(requestedPrice);
    }

    // 4. Regla del 50 %
    const ratio = Math.abs(originalPrice - requestedPrice) / originalPrice;
    if (ratio > 0.50) {
      return 'EXCEEDS_LIMIT';
    }

    return 'WITHIN_LIMIT';
  }
}
