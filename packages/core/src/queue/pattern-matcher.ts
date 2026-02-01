/**
 * Queue Pattern Matcher
 *
 * Pattern matching for queue subscriptions.
 * Supports both AMQP-style and MQTT-style wildcards.
 *
 * Supported patterns:
 * - Exact match: 'orders.created' matches only 'orders.created'
 * - Single-level wildcard (*): 'orders.*' matches 'orders.created', 'orders.updated'
 * - Multi-level wildcard (#): 'events.#' matches 'events.user.created', 'events.order.shipped'
 * - Named parameters: 'orders.{orderId}' extracts orderId from matching messages
 *
 * Separator: '.' (dot) is used as the separator (like AMQP/MQTT)
 *
 * @example
 * ```typescript
 * // Single-level wildcard
 * matchQueuePattern('orders.*', 'orders.created')    // true
 * matchQueuePattern('orders.*', 'orders.created.new') // false
 *
 * // Multi-level wildcard
 * matchQueuePattern('events.#', 'events.user.created') // true
 * matchQueuePattern('events.#', 'events')              // true
 *
 * // Named parameters
 * matchQueuePattern('orders.{id}.status', 'orders.123.status')
 * // { matched: true, params: { id: '123' } }
 * ```
 */

/**
 * Pattern match result
 */
export interface QueuePatternMatch {
  matched: boolean;
  params: Record<string, string>;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a queue pattern into a regex and extract parameter names
 *
 * @param pattern - Pattern string with wildcards and/or parameters
 * @returns Object with regex and parameter names
 */
export function parseQueuePattern(pattern: string): {
  regex: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  let regexStr = '^';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '#') {
      // Multi-level wildcard: matches any number of segments (including zero)
      // # must be at the end or followed by separator
      if (i === pattern.length - 1) {
        regexStr += '.*';
      } else if (pattern[i + 1] === '.') {
        regexStr += '(?:[^.]+\\.)*';
        i++; // Skip the dot
      } else {
        // Invalid # position, treat as literal
        regexStr += escapeRegex(char);
      }
      i++;
    } else if (char === '*') {
      // Single-level wildcard: matches exactly one segment
      regexStr += '[^.]+';
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
        // Match one segment
        regexStr += '([^.]+)';
        i = endIndex + 1;
      }
    } else if (char === '.') {
      // Separator
      regexStr += '\\.';
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
 * Match a topic against a pattern
 *
 * @param pattern - Pattern string with wildcards and/or parameters
 * @param topic - Topic to match
 * @returns Match result with extracted parameters
 *
 * @example
 * ```typescript
 * matchQueuePattern('orders.*', 'orders.created')
 * // { matched: true, params: {} }
 *
 * matchQueuePattern('orders.{orderId}', 'orders.123')
 * // { matched: true, params: { orderId: '123' } }
 *
 * matchQueuePattern('events.#', 'events.user.created')
 * // { matched: true, params: {} }
 * ```
 */
export function matchQueuePattern(pattern: string, topic: string): QueuePatternMatch {
  // Exact match fast path
  if (pattern === topic) {
    return { matched: true, params: {} };
  }

  // Check if pattern has any special characters
  if (!pattern.includes('*') && !pattern.includes('#') && !pattern.includes('{')) {
    // No wildcards or parameters, must be exact match
    return { matched: false, params: {} };
  }

  const { regex, paramNames } = parseQueuePattern(pattern);
  const match = topic.match(regex);

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
 * Check if a pattern matches a topic (without extracting parameters)
 */
export function isQueuePatternMatch(pattern: string, topic: string): boolean {
  return matchQueuePattern(pattern, topic).matched;
}

/**
 * Create a pattern matcher function for a specific pattern
 * (pre-compiles the regex for better performance)
 *
 * @param pattern - Pattern string
 * @returns Function that matches topics against the pattern
 */
export function createQueuePatternMatcher(pattern: string): (topic: string) => QueuePatternMatch {
  // Exact match fast path
  if (!pattern.includes('*') && !pattern.includes('#') && !pattern.includes('{')) {
    return (topic: string) => ({
      matched: pattern === topic,
      params: {},
    });
  }

  const { regex, paramNames } = parseQueuePattern(pattern);

  return (topic: string): QueuePatternMatch => {
    // Exact match fast path
    if (pattern === topic) {
      return { matched: true, params: {} };
    }

    const match = topic.match(regex);

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
 */
export function isQueuePattern(value: string): boolean {
  return value.includes('*') || value.includes('#') || value.includes('{');
}

/**
 * Extract parameter names from a pattern
 */
export function getQueuePatternParams(pattern: string): string[] {
  const params: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(pattern)) !== null) {
    params.push(match[1]);
  }

  return params;
}

/**
 * Build a topic from a pattern and parameters
 */
export function buildFromQueuePattern(pattern: string, params: Record<string, string>): string {
  let result = pattern;

  // Replace parameters with values
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, value);
  }

  // Remove wildcards (they shouldn't be in built topics)
  result = result.replace(/[*#]/g, '');

  return result;
}

/**
 * Find all topics that match a pattern
 */
export function findMatchingTopics(pattern: string, topics: string[]): string[] {
  const matcher = createQueuePatternMatcher(pattern);

  return topics.filter((topic) => matcher(topic).matched);
}
