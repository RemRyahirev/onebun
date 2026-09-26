/**
 * Classes decorated BEFORE a late metadata implementation arrives. Imported by the scenario
 * runner at the point its step list says, never statically.
 */
import {
  BaseController,
  BaseService,
  Controller,
  Get,
  Service,
} from '@onebun/core';

/** A no-op property decorator: its only job is to make Bun emit `design:type` for the member. */
const tag = (_target: object, _propertyKey: string | symbol): void => undefined;

@Service()
export class EarlyDep extends BaseService {}

@Service()
export class EarlyConsumer extends BaseService {
  constructor(readonly dep: EarlyDep) {
    super();
  }
}

@Controller('/early')
export class EarlyController extends BaseController {
  constructor(private readonly consumer: EarlyConsumer) {
    super();
  }

  @Get('/')
  ping(): { resolved: boolean } {
    return { resolved: this.consumer.dep instanceof EarlyDep };
  }
}

/** Two members of different types on ONE target: a store that ignores the key collapses them. */
export class EarlyProps {
  @tag first!: string;
  @tag second!: number;
}

@Service()
export class Parent extends BaseService {
  constructor(readonly dep: EarlyDep) {
    super();
  }
}

/** Declares no constructor, so it has no `design:paramtypes` of its own — only its parent does. */
@Service()
export class Child extends Parent {}
