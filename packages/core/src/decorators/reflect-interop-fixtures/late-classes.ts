/**
 * Classes decorated AFTER every step of a scenario, including any late metadata implementation.
 */
import { BaseService, Service } from '@onebun/core';

import { EarlyDep } from './early-classes';

/** A no-op property decorator: its only job is to make Bun emit `design:type` for the member. */
const tag = (_target: object, _propertyKey: string | symbol): void => undefined;

@Service()
export class LateConsumer extends BaseService {
  constructor(readonly dep: EarlyDep) {
    super();
  }
}

export class LateProps {
  @tag first!: string;
  @tag second!: number;
}
