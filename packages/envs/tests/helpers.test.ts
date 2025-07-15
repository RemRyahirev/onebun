import {
  describe,
  it,
  expect,
} from 'bun:test';
import { Effect } from 'effect';

import { Env } from '../src/helpers';
import { EnvValidationError } from '../src/types';

describe('Env helpers', () => {
  describe('Env.string', () => {
    it('should create string configuration with defaults', () => {
      const config = Env.string();
      expect(config.type).toBe('string');
      expect(config.separator).toBe(',');
    });

    it('should create string configuration with options', () => {
      const config = Env.string({
        env: 'CUSTOM_ENV',
        description: 'A custom string',
        default: 'default_value',
        required: true,
        sensitive: true,
        separator: '|',
      });

      expect(config.type).toBe('string');
      expect(config.env).toBe('CUSTOM_ENV');
      expect(config.description).toBe('A custom string');
      expect(config.default).toBe('default_value');
      expect(config.required).toBe(true);
      expect(config.sensitive).toBe(true);
      expect(config.separator).toBe('|');
    });

    it('should apply custom validation', async () => {
      const config = Env.string({
        validate(value: string) {
          if (value.length < 3) {
            return Effect.fail(new EnvValidationError('', value, 'too short'));
          }

          return Effect.succeed(value);
        },
      });

      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate('hi')))
          .rejects.toThrow('too short');
        
        const result = await Effect.runPromise(config.validate('hello'));
        expect(result).toBe('hello');
      }
    });
  });

  describe('Env.number', () => {
    it('should create number configuration with defaults', () => {
      const config = Env.number();
      expect(config.type).toBe('number');
    });

    it('should create number configuration with options', () => {
      const config = Env.number({
        env: 'PORT',
        description: 'Server port',
        default: 3000,
        required: true,
        sensitive: false,
        min: 1,
        max: 65535,
      });

      expect(config.type).toBe('number');
      expect(config.env).toBe('PORT');
      expect(config.description).toBe('Server port');
      expect(config.default).toBe(3000);
      expect(config.required).toBe(true);
      expect(config.sensitive).toBe(false);
    });

    it('should apply min validation', async () => {
      const config = Env.number({ min: 10 });
      
      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate(5)))
          .rejects.toThrow('Value must be >= 10');
        
        const result = await Effect.runPromise(config.validate(15));
        expect(result).toBe(15);
      }
    });

    it('should apply max validation', async () => {
      const config = Env.number({ max: 100 });
      
      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate(150)))
          .rejects.toThrow('Value must be <= 100');
        
        const result = await Effect.runPromise(config.validate(50));
        expect(result).toBe(50);
      }
    });

    it('should apply min and max validation', async () => {
      const config = Env.number({ min: 10, max: 100 });
      
      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate(5)))
          .rejects.toThrow('Value must be >= 10');
        
        expect(Effect.runPromise(config.validate(150)))
          .rejects.toThrow('Value must be <= 100');
        
        const result = await Effect.runPromise(config.validate(50));
        expect(result).toBe(50);
      }
    });

    it('should combine range validation with custom validation', async () => {
      const config = Env.number({
        min: 10,
        max: 100,
        validate(value: number) {
          if (value % 2 !== 0) {
            return Effect.fail(new EnvValidationError('', value, 'must be even'));
          }

          return Effect.succeed(value);
        },
      });

      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate(5)))
          .rejects.toThrow('Value must be >= 10');
        
        expect(Effect.runPromise(config.validate(15)))
          .rejects.toThrow('must be even');
        
        const result = await Effect.runPromise(config.validate(20));
        expect(result).toBe(20);
      }
    });
  });

  describe('Env.boolean', () => {
    it('should create boolean configuration with defaults', () => {
      const config = Env.boolean();
      expect(config.type).toBe('boolean');
    });

    it('should create boolean configuration with options', () => {
      const config = Env.boolean({
        env: 'DEBUG',
        description: 'Debug mode',
        default: false,
        required: true,
        sensitive: false,
      });

      expect(config.type).toBe('boolean');
      expect(config.env).toBe('DEBUG');
      expect(config.description).toBe('Debug mode');
      expect(config.default).toBe(false);
      expect(config.required).toBe(true);
      expect(config.sensitive).toBe(false);
    });

    it('should apply custom validation', async () => {
      const config = Env.boolean({
        validate(value: boolean) {
          if (value === false) {
            return Effect.fail(new EnvValidationError('', value, 'must be true'));
          }

          return Effect.succeed(value);
        },
      });

      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate(false)))
          .rejects.toThrow('must be true');
        
        const result = await Effect.runPromise(config.validate(true));
        expect(result).toBe(true);
      }
    });
  });

  describe('Env.array', () => {
    it('should create array configuration with defaults', () => {
      const config = Env.array();
      expect(config.type).toBe('array');
      expect(config.separator).toBe(',');
    });

    it('should create array configuration with options', () => {
      const config = Env.array({
        env: 'ALLOWED_HOSTS',
        description: 'Allowed hosts list',
        default: ['localhost'],
        required: true,
        sensitive: false,
        separator: ';',
        minLength: 1,
        maxLength: 10,
      });

      expect(config.type).toBe('array');
      expect(config.env).toBe('ALLOWED_HOSTS');
      expect(config.description).toBe('Allowed hosts list');
      expect(config.default).toEqual(['localhost']);
      expect(config.required).toBe(true);
      expect(config.sensitive).toBe(false);
      expect(config.separator).toBe(';');
    });

    it('should apply minLength validation', async () => {
      const config = Env.array({ minLength: 2 });
      
      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate(['single'])))
          .rejects.toThrow('Array must have at least 2 items');
        
        const result = await Effect.runPromise(config.validate(['one', 'two']));
        expect(result).toEqual(['one', 'two']);
      }
    });

    it('should apply maxLength validation', async () => {
      const config = Env.array({ maxLength: 2 });
      
      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate(['one', 'two', 'three'])))
          .rejects.toThrow('Array must have at most 2 items');
        
        const result = await Effect.runPromise(config.validate(['one', 'two']));
        expect(result).toEqual(['one', 'two']);
      }
    });

    it('should combine length validation with custom validation', async () => {
      const config = Env.array({
        minLength: 1,
        maxLength: 3,
        validate(value: string[]) {
          if (value.some(item => item.length < 2)) {
            return Effect.fail(new EnvValidationError('', value, 'all items must be at least 2 chars'));
          }

          return Effect.succeed(value);
        },
      });

      expect(config.validate).toBeDefined();
      if (config.validate) {
        expect(Effect.runPromise(config.validate([])))
          .rejects.toThrow('Array must have at least 1 items');
        
        expect(Effect.runPromise(config.validate(['a', 'bb'])))
          .rejects.toThrow('all items must be at least 2 chars');
        
        const result = await Effect.runPromise(config.validate(['aa', 'bb']));
        expect(result).toEqual(['aa', 'bb']);
      }
    });
  });

  describe('Env.regex', () => {
    it('should create regex validator', async () => {
      const validator = Env.regex(/^[a-z]+$/);
      
      expect(Effect.runPromise(validator('hello')))
        .resolves.toBe('hello');
      
      expect(Effect.runPromise(validator('Hello')))
        .rejects.toThrow('Value must match pattern /^[a-z]+$/');
    });

    it('should use custom error message', async () => {
      const validator = Env.regex(/^[a-z]+$/, 'Only lowercase letters allowed');
      
      expect(Effect.runPromise(validator('Hello')))
        .rejects.toThrow('Only lowercase letters allowed');
    });
  });

  describe('Env.oneOf', () => {
    it('should create oneOf validator', async () => {
      const validator = Env.oneOf(['dev', 'prod', 'test'] as const);
      
      expect(Effect.runPromise(validator('dev')))
        .resolves.toBe('dev');
      
      expect(Effect.runPromise(validator('invalid')))
        .rejects.toThrow('Value must be one of: dev, prod, test');
    });

    it('should use custom error message', async () => {
      const validator = Env.oneOf(['a', 'b'], 'Custom error message');
      
      expect(Effect.runPromise(validator('c')))
        .rejects.toThrow('Custom error message');
    });

    it('should maintain type safety', async () => {
      const validator = Env.oneOf(['dev', 'prod'] as const);
      const result = await Effect.runPromise(validator('dev'));
      // TypeScript should infer result as "dev" | "prod"
      expect(result).toBe('dev');
    });
  });

  describe('Env.url', () => {
    it('should validate valid URLs', async () => {
      const validator = Env.url();
      
      const validUrls = [
        'https://example.com',
        'http://localhost:3000',
        'ftp://files.example.com',
        'https://sub.domain.com/path?query=value#hash',
      ];

      for (const url of validUrls) {
        expect(Effect.runPromise(validator(url)))
          .resolves.toBe(url);
      }
    });

    it('should reject invalid URLs', async () => {
      const validator = Env.url();
      
      const invalidUrls = [
        'not-a-url',
        '://missing-protocol',
        "javascript:alert('xss')",
      ];

      for (const url of invalidUrls) {
        expect(Effect.runPromise(validator(url)))
          .rejects.toThrow('Value must be a valid URL');
      }
    });

    it('should use custom error message', async () => {
      const validator = Env.url('Invalid URL provided');
      
      expect(Effect.runPromise(validator('invalid')))
        .rejects.toThrow('Invalid URL provided');
    });
  });

  describe('Env.email', () => {
    it('should validate valid emails', async () => {
      const validator = Env.email();
      
      const validEmails = [
        'user@example.com',
        'test.email+tag@domain.co.uk',
        'user123@test-domain.org',
        'a@b.co',
      ];

      for (const email of validEmails) {
        expect(Effect.runPromise(validator(email)))
          .resolves.toBe(email);
      }
    });

    it('should reject invalid emails', async () => {
      const validator = Env.email();
      
      const invalidEmails = [
        'not-an-email',
        '@domain.com',
        'user@',
        'user@@domain.com',
        'user@domain',
        '',
        'user space@domain.com',
      ];

      for (const email of invalidEmails) {
        expect(Effect.runPromise(validator(email)))
          .rejects.toThrow('Value must be a valid email address');
      }
    });

    it('should use custom error message', async () => {
      const validator = Env.email('Please provide a valid email');
      
      expect(Effect.runPromise(validator('invalid')))
        .rejects.toThrow('Please provide a valid email');
    });
  });

  describe('Env.port', () => {
    it('should validate valid ports', async () => {
      const validator = Env.port();
      
      const validPorts = [1, 80, 443, 3000, 8080, 65535];

      for (const port of validPorts) {
        expect(Effect.runPromise(validator(port)))
          .resolves.toBe(port);
      }
    });

    it('should reject invalid ports', async () => {
      const validator = Env.port();
      
      const invalidPorts = [0, -1, 65536, 100000, 3.14, NaN, Infinity];

      for (const port of invalidPorts) {
        expect(Effect.runPromise(validator(port)))
          .rejects.toThrow('Port must be an integer between 1 and 65535');
      }
    });

    it('should use custom error message', async () => {
      const validator = Env.port('Invalid port number');
      
      expect(Effect.runPromise(validator(0)))
        .rejects.toThrow('Invalid port number');
    });
  });
}); 