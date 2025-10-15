import { BaseController, Controller } from '@onebun/core';
import { CacheService } from '@onebun/cache';

@Controller('counter')
export class CounterController extends BaseController {
  constructor(
    private readonly cache: CacheService,
  ) {
    super();
  }

  async test() {
    const value = await this.cache.get('test');

    return this.success({
      message: 'Test',
      value: value,
    });
  }
}
