import { Service, BaseService } from '@onebun/core';

// Service implementation with @Service decorator
@Service()
export class CounterService extends BaseService {
  private value = 0;
  private totalOperations = 0;

  getValue(): number {
    return this.value;
  }

  getTotalOperations(): number {
    return this.totalOperations;
  }

  increment(amount: number = 1): number {
    this.value += amount;
    this.totalOperations++;
    return this.value;
  }

  decrement(amount: number = 1): number {
    this.value -= amount;
    this.totalOperations++;
    return this.value;
  }

  reset(): void {
    this.value = 0;
    this.totalOperations++;
  }
}
