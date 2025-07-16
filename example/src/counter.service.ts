import {
  Service,
  BaseService,
  Span,
} from '@onebun/core';

// Service implementation with @Service decorator
@Service()
export class CounterService extends BaseService {
  private value = 0;
  private totalOperations = 0;

  getValue(): number {
    this.logger.info('Getting counter value from service', 
      this.value, 
      { currentValue: this.value, operations: this.totalOperations },
      new Date(),
      ['array', 'of', 'strings'],
      true,
      null,
    );

    return this.value;
  }

  getTotalOperations(): number {
    return this.totalOperations;
  }

  increment(amount: number = 1): number {
    this.value += amount;
    this.totalOperations++;
    
    this.logger.debug('Counter incremented', 
      { previousValue: this.value - amount, newValue: this.value, amount },
      `Operation #${this.totalOperations}`,
    );
    
    return this.value;
  }

  decrement(amount: number = 1): number {
    this.value -= amount;
    this.totalOperations++;
    
    this.logger.warn('Counter decremented', 
      amount, 
      { negativeValue: this.value < 0 },
      this.value < 0 ? new Error('Counter went negative!') : null,
    );
    
    return this.value;
  }

  @Span('counter-reset')
  reset(): void {
    const previousValue = this.value;
    this.value = 0;
    this.totalOperations++;
    
    this.logger.info('Counter reset', {
      previousValue,
      newValue: this.value,
      resetTimestamp: new Date(),
      metadata: {
        source: 'counter-service',
        operation: 'reset',
        nested: {
          deep: {
            value: 'test',
          },
        },
      },
    });
  }
}
