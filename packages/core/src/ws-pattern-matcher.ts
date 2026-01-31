/**
 * WebSocket Pattern Matcher
 *
 * Provides pattern matching for WebSocket events and room names.
 * Supports wildcards (*) and named parameters ({paramName}).
 *
 * @example
 * // Wildcard patterns
 * matchPattern('chat:*', 'chat:general')         // { matched: true, params: {} }
 * matchPattern('user:*:action', 'user:123:action') // { matched: true, params: {} }
 *
 * // Parameter patterns
 * matchPattern('chat:{roomId}', 'chat:general')  // { matched: true, params: { roomId: 'general' } }
 * matchPattern('user:{id}:message', 'user:123:message') // { matched: true, params: { id: '123' } }
 *
 * // Combined patterns
 * matchPattern('service:{service}:*', 'service:auth:login') // { matched: true, params: { service: 'auth' } }
 */

import type { PatternMatch } from './ws.types';

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a pattern into a regex and extract parameter names
 *
 * @param pattern - Pattern string with wildcards and/or parameters
 * @returns Object with regex and parameter names
 */
export function parsePattern(pattern: string): {
  regex: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  let regexStr = '^';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      // Wildcard: matches any characters except the separator
      regexStr += '[^:]*';
      i++;
    } else if (char === '{') {
      // Named parameter: {paramName}
      const endIndex = pattern.indexOf('}', i);
      if (endIndex === -1) {
        // Invalid pattern, treat as literal
        regexStr += escapeRegex(char);
        i++;
      } else {
        const paramName = pattern.substring(i + 1, endIndex);
        paramNames.push(paramName);
        // Match any characters except the separator
        regexStr += '([^:]+)';
        i = endIndex + 1;
      }
    } else if (char === ':') {
      // Separator
      regexStr += ':';
      i++;
    } else {
      // Literal character
      regexStr += escapeRegex(char);
      i++;
    }
  }

  regexStr += '$';

  return {
    regex: new RegExp(regexStr),
    paramNames,
  };
}

/**
 * Match a value against a pattern
 *
 * @param pattern - Pattern string with wildcards and/or parameters
 * @param value - Value to match
 * @returns Match result with extracted parameters
 *
 * @example
 * matchPattern('chat:*', 'chat:general')
 * // Returns: { matched: true, params: {} }
 *
 * matchPattern('chat:{roomId}:message', 'chat:general:message')
 * // Returns: { matched: true, params: { roomId: 'general' } }
 *
 * matchPattern('chat:private', 'chat:public')
 * // Returns: { matched: false, params: {} }
 */
export function matchPattern(pattern: string, value: string): PatternMatch {
  // Exact match fast path
  if (pattern === value) {
    return { matched: true, params: {} };
  }

  // Check if pattern has any special characters
  if (!pattern.includes('*') && !pattern.includes('{')) {
    // No wildcards or parameters, must be exact match
    return { matched: false, params: {} };
  }

  const { regex, paramNames } = parsePattern(pattern);
  const match = value.match(regex);

  if (!match) {
    return { matched: false, params: {} };
  }

  // Extract parameters
  const params: Record<string, string> = {};
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]] = match[i + 1];
  }

  return { matched: true, params };
}

/**
 * Check if a pattern matches a value (without extracting parameters)
 *
 * @param pattern - Pattern string
 * @param value - Value to match
 * @returns Whether the pattern matches
 */
export function isPatternMatch(pattern: string, value: string): boolean {
  return matchPattern(pattern, value).matched;
}

/**
 * Find all values that match a pattern
 *
 * @param pattern - Pattern string
 * @param values - Array of values to check
 * @returns Array of matching values
 */
export function findMatchingValues(pattern: string, values: string[]): string[] {
  return values.filter((value) => isPatternMatch(pattern, value));
}

/**
 * Create a pattern matcher function for a specific pattern
 *
 * @param pattern - Pattern string
 * @returns Function that matches values against the pattern
 *
 * @example
 * const matcher = createPatternMatcher('chat:{roomId}:message');
 * matcher('chat:general:message') // { matched: true, params: { roomId: 'general' } }
 * matcher('chat:private:action')  // { matched: false, params: {} }
 */
export function createPatternMatcher(pattern: string): (value: string) => PatternMatch {
  const { regex, paramNames } = parsePattern(pattern);

  return (value: string): PatternMatch => {
    // Exact match fast path
    if (pattern === value) {
      return { matched: true, params: {} };
    }

    const match = value.match(regex);

    if (!match) {
      return { matched: false, params: {} };
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < paramNames.length; i++) {
      params[paramNames[i]] = match[i + 1];
    }

    return { matched: true, params };
  };
}

/**
 * Check if a string is a pattern (contains wildcards or parameters)
 *
 * @param value - String to check
 * @returns Whether the string is a pattern
 */
export function isPattern(value: string): boolean {
  return value.includes('*') || value.includes('{');
}

/**
 * Extract parameter names from a pattern
 *
 * @param pattern - Pattern string
 * @returns Array of parameter names
 *
 * @example
 * getPatternParams('chat:{roomId}:user:{userId}')
 * // Returns: ['roomId', 'userId']
 */
export function getPatternParams(pattern: string): string[] {
  const params: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(pattern)) !== null) {
    params.push(match[1]);
  }

  return params;
}

/**
 * Build a value from a pattern and parameters
 *
 * @param pattern - Pattern string
 * @param params - Parameter values
 * @returns Built value string
 *
 * @example
 * buildFromPattern('chat:{roomId}:message', { roomId: 'general' })
 * // Returns: 'chat:general:message'
 */
export function buildFromPattern(pattern: string, params: Record<string, string>): string {
  let result = pattern;

  // Replace wildcards with empty string (or you could throw an error)
  result = result.replace(/\*/g, '');

  // Replace parameters with values
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, value);
  }

  return result;
}
