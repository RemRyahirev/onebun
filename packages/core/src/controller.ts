import { Context, Effect } from 'effect';

/**
 * Base controller class that can be extended to add common functionality
 */
export class Controller {
  /**
   * Check if request has JSON content type
   */
  protected isJson(req: Request): boolean {
    return req.headers.get('Content-Type')?.includes('application/json') ?? false;
  }

  /**
   * Parse JSON from request body
   */
  protected async parseJson<T = any>(req: Request): Promise<T> {
    return await req.json() as T;
  }

  /**
   * Create JSON response
   */
  protected json<T = any>(data: T, status: number = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Create text response
   */
  protected text(data: string, status: number = 200): Response {
    return new Response(data, {
      status,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }

  /**
   * Create error response
   */
  protected error(message: string, status: number = 500): Response {
    return this.json({ error: message }, status);
  }
} 