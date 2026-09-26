/**
 * An undecorated guard with its own constructor, extending a decorated base guard.
 *
 * The base has `design:paramtypes` `[TokenStore, AuditLog]`; the subclass declares
 * `(audit: AuditLog)` and emits nothing, having no decorator. Reading paramtypes through a
 * prototype walk hands it the BASE's array, positionally: a `TokenStore` in its `audit` slot, and
 * the route still answers 200 — a silent wrong-object injection (measured in onebun-FB-33's review).
 */
import type { HttpGuard } from '@onebun/core';
import {
  BaseController,
  BaseService,
  Controller,
  Get,
  Service,
  UseGuards,
} from '@onebun/core';

@Service()
export class TokenStore extends BaseService {
  check(): boolean {
    return true;
  }
}

@Service()
export class AuditLog extends BaseService {}

@Service()
export class BaseAuthGuard implements HttpGuard {
  constructor(protected readonly tokens: TokenStore, protected readonly audit: AuditLog) {}

  canActivate(): boolean {
    return this.tokens.check();
  }
}

export class AuditingGuard extends BaseAuthGuard {
  /** What each construction received for `audit`, by constructor name. */
  static readonly received: string[] = [];

  constructor(audit: AuditLog) {
    super(new TokenStore(), audit);
    AuditingGuard.received.push(audit === undefined ? 'undefined' : (audit as object).constructor.name);
  }
}

@Controller('/guarded')
export class GuardedController extends BaseController {
  @Get('/')
  @UseGuards(AuditingGuard)
  ping(): { ok: boolean } {
    return { ok: true };
  }
}
