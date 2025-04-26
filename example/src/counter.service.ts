import { Service, BaseService } from '@onebun/core';

// Service implementation with @Service decorator
@Service()
export class CounterService extends BaseService {
  private count = 0;

  increment(): number {
    return ++this.count;
  }

  getCount(): number {
    return this.count;
  }
}
