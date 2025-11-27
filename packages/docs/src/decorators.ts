import { defineMetadata, getMetadata } from '@onebun/core';

/**
 * Metadata key for API operation information
 */
const API_OPERATION_METADATA = 'onebun:apiOperation';

/**
 * Metadata key for API tags
 */
const API_TAGS_METADATA = 'onebun:apiTags';

/**
 * Decorator for API operation metadata
 * @param options - Operation metadata (summary, description, tags)
 *
 * @example
 * ```typescript
 * @Get('/users')
 * @ApiOperation({ summary: 'Get all users', tags: ['Users'] })
 * async getUsers(): Promise<User[]> {
 *   return users;
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function ApiOperation(options: {
  summary?: string;
  description?: string;
  tags?: string[];
}): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    defineMetadata(API_OPERATION_METADATA, options, target, propertyKey);
  };
}

/**
 * Decorator for API tags
 * Can be used on controller class or method
 *
 * @param tags - Array of tags
 *
 * @example
 * ```typescript
 * @Controller('/users')
 * @ApiTags('Users')
 * export class UserController {
 *   // ...
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function ApiTags(...tags: string[]): ClassDecorator & MethodDecorator {
  return (target: object | Function, propertyKey?: string | symbol) => {
    if (propertyKey !== undefined) {
      // Method decorator
      const existingTags: string[] =
        getMetadata(API_TAGS_METADATA, target, propertyKey) || [];
      defineMetadata(
        API_TAGS_METADATA,
        [...existingTags, ...tags],
        target,
        propertyKey,
      );
    } else {
      // Class decorator
      const existingTags: string[] = getMetadata(API_TAGS_METADATA, target) || [];
      defineMetadata(API_TAGS_METADATA, [...existingTags, ...tags], target);
    }
  };
}

/**
 * Get API operation metadata for a method
 */
export function getApiOperationMetadata(
  target: object,
  propertyKey: string | symbol,
): { summary?: string; description?: string; tags?: string[] } | undefined {
  return getMetadata(API_OPERATION_METADATA, target, propertyKey);
}

/**
 * Get API tags for a class or method
 */
export function getApiTagsMetadata(
  target: object | Function,
  propertyKey?: string | symbol,
): string[] | undefined {
  if (propertyKey !== undefined) {
    return getMetadata(API_TAGS_METADATA, target, propertyKey);
  }

  return getMetadata(API_TAGS_METADATA, target);
}
