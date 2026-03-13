/**
 * HTTP exception that carries a status code.
 *
 * Throw from route handlers, guards, or middleware to return
 * a specific HTTP status. The default exception filter converts
 * these into JSON responses with the matching status code.
 *
 * @example
 * ```typescript
 * throw new HttpException(404, 'User not found');
 * // → HTTP 404 { success: false, error: "User not found", ... }
 * ```
 */
export class HttpException extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpException';
  }
}
