import { Effect } from 'effect';

import { EnvLoadError, type EnvLoadOptions } from './types';

/**
 * Environment variables loader
 */
export class EnvLoader {
  /**
   * Load environment variables from various sources
   */
  static load(options: EnvLoadOptions = {}): Effect.Effect<Record<string, string>, EnvLoadError> {
    const { envFilePath = '.env', loadDotEnv = true, envOverridesDotEnv = true } = options;

    const loadDotEnvVars = loadDotEnv
      ? EnvLoader.loadDotEnvFile(envFilePath)
      : Effect.succeed({} as Record<string, string>);

    const processEnvVars = EnvLoader.loadProcessEnv();

    return loadDotEnvVars.pipe(
      Effect.map((dotEnvVars) => {
        if (envOverridesDotEnv) {
          // Process environment variables have priority
          return { ...dotEnvVars, ...processEnvVars };
        } else {
          // .env file has priority
          return { ...processEnvVars, ...dotEnvVars };
        }
      }),
    );
  }

  /**
   * Load variables from .env file
   */
  private static loadDotEnvFile(
    filePath: string,
  ): Effect.Effect<Record<string, string>, EnvLoadError> {
    return Effect.tryPromise({
      async try() {
        const file = Bun.file(filePath);
        const exists = await file.exists();

        if (!exists) {
          return {}; // File not found - not an error, just return empty object
        }

        const content = await file.text();

        return EnvLoader.parseDotEnvContent(content);
      },
      catch: (error) =>
        new EnvLoadError(
          filePath,
          `Failed to read .env file: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });
  }

  /**
   * Parse .env file content
   */
  private static parseDotEnvContent(content: string): Record<string, string> {
    const variables: Record<string, string> = {};
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Find equals sign
      const equalIndex = line.indexOf('=');
      if (equalIndex === -1) {
        continue; // Skip lines without equals sign
      }

      const key = line.slice(0, equalIndex).trim();
      let value = line.slice(equalIndex + 1).trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Process escape sequences
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");

      variables[key] = value;
    }

    return variables;
  }

  /**
   * Load variables from process.env
   */
  private static loadProcessEnv(): Record<string, string> {
    const variables: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        variables[key] = value;
      }
    }

    return variables;
  }

  /**
   * Check if .env file exists
   */
  static checkDotEnvExists(filePath: string = '.env'): Effect.Effect<boolean, never> {
    return Effect.promise(() => Bun.file(filePath).exists());
  }
}
