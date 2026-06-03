export class MinimumPriceViolationError extends Error {
  constructor(requestedPrice: number) {
    super(`Requested price ${requestedPrice} is below the minimum allowed price of 150`);
    this.name = 'MinimumPriceViolationError';
  }
}

export class InvalidPriceError extends Error {
  constructor() {
    super('original_price cannot be 0 (division by zero)');
    this.name = 'InvalidPriceError';
  }
}
