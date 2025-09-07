import {
  describe,
  it,
  expect,
} from 'bun:test';

import type { ErrorResponse } from './types.js';

import {
  createErrorResponse,
  createSuccessResponse,
  GatewayTimeoutError,
  HttpStatusCode,
  isErrorResponse,
  isSuccessResponse,
  OneBunBaseError,
  ServiceUnavailableError,
  BadGatewayError,
  InternalServerError,
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
  BadRequestError,
} from './types.js';

describe('types helpers', () => {
  it('createSuccessResponse returns standardized success object', () => {
    const res = createSuccessResponse({ a: 1 }, 'trace-1');
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ a: 1 });
    expect(res.traceId).toBe('trace-1');
    expect(isSuccessResponse(res)).toBe(true);
    expect(isErrorResponse(res)).toBe(false);
  });

  it('createErrorResponse returns standardized error object', () => {
    const res = createErrorResponse('ERR', 500, 'boom', 'trace-2', { x: 1 });
    expect(res.success).toBe(false);
    expect(res.error).toBe('ERR');
    expect(res.code).toBe(500);
    expect(res.message).toBe('boom');
    expect(res.traceId).toBe('trace-2');
    expect(res.details).toEqual({ x: 1 });
    expect(isErrorResponse(res)).toBe(true);
    expect(isSuccessResponse(res)).toBe(false);
  });

  it('isErrorResponse guards various shapes correctly', () => {
    expect(isErrorResponse(null)).toBe(false);
    expect(isErrorResponse({})).toBe(false);
    expect(isErrorResponse({ success: false, error: 'E', code: 400 } as ErrorResponse)).toBe(true);
    expect(isErrorResponse({ success: true, result: 1 })).toBe(false);
  });

  it('OneBunBaseError.fromErrorResponse maps codes to specific error classes', () => {
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.BAD_REQUEST })
        instanceof BadRequestError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.UNAUTHORIZED })
        instanceof UnauthorizedError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.FORBIDDEN })
        instanceof ForbiddenError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.NOT_FOUND })
        instanceof NotFoundError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.CONFLICT })
        instanceof ConflictError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.UNPROCESSABLE_ENTITY })
        instanceof ValidationError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.TOO_MANY_REQUESTS })
        instanceof ValidationError,
    ).toBe(false);
    // 429 -> TooManyRequestsError
    const tooMany = OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.TOO_MANY_REQUESTS });
    expect(tooMany.name).toBe('TooManyRequestsError');

    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.INTERNAL_SERVER_ERROR })
        instanceof InternalServerError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.BAD_GATEWAY })
        instanceof BadGatewayError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.SERVICE_UNAVAILABLE })
        instanceof ServiceUnavailableError,
    ).toBe(true);
    expect(
      OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: HttpStatusCode.GATEWAY_TIMEOUT })
        instanceof GatewayTimeoutError,
    ).toBe(true);
    // default -> InternalServerError
    const def = OneBunBaseError.fromErrorResponse({ success: false, error: 'e', code: 599 });
    expect(def instanceof InternalServerError).toBe(true);
  });

  it('OneBunBaseError.withContext creates error chain in details', () => {
    const base = new InternalServerError('E_BASE', { foo: 'bar' });
    const chained = base.withContext('CTX', { why: 'test' });
    expect(chained).toBeInstanceOf(InternalServerError);
    const errResp = chained.toErrorResponse();
    expect(errResp.originalError?.code).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    expect(errResp.originalError?.error).toBe('CTX');
  });
});
