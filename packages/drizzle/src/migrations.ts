import { spawnSync } from 'bun';

/**
 * Generate migrations using drizzle-kit
 * 
 * This function generates migration files based on Drizzle table schemas defined
 * using pgTable() or sqliteTable(). The schemas should be exported from schema files
 * specified in schemaPath.
 * 
 * @param options - Migration generation options:
 *   - schemaPath: Path or paths to schema files containing pgTable/sqliteTable definitions
 *   - migrationsFolder: Output folder for migration files
 *   - dialect: Database dialect (sqlite or postgresql)
 * 
 * @example
 * ```typescript
 * // schema/users.ts
 * import { pgTable, serial, text } from 'drizzle-orm/pg-core';
 * export const users = pgTable('users', { ... });
 * 
 * // Generate migrations
 * await generateMigrations({
 *   schemaPath: './src/schema',
 *   migrationsFolder: './drizzle',
 *   dialect: 'postgresql',
 * });
 * ```
 */
export async function generateMigrations(options?: {
  schemaPath?: string | string[];
  migrationsFolder?: string;
  dialect?: 'sqlite' | 'postgresql';
}): Promise<void> {
  const schemaPath = options?.schemaPath ?? './src/schema';
  const migrationsFolder = options?.migrationsFolder ?? './drizzle';
  const dialect = options?.dialect ?? 'sqlite';
  
  const schemaPaths = Array.isArray(schemaPath) ? schemaPath : [schemaPath];
  
  // Create drizzle.config.ts temporarily if needed
  const configContent = `import type { Config } from 'drizzle-kit';

export default {
  schema: ${JSON.stringify(schemaPaths)},
  out: ${JSON.stringify(migrationsFolder)},
  dialect: ${JSON.stringify(dialect)},
} satisfies Config;
`;
  
  try {
    // Write config to temp file
    await Bun.write('./drizzle.config.temp.ts', configContent);
    
    // Run drizzle-kit generate
    const result = spawnSync(['bunx', 'drizzle-kit', 'generate', '--config=drizzle.config.temp.ts'], {
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    
    if (result.exitCode !== 0) {
      throw new Error(`drizzle-kit generate failed with exit code ${result.exitCode}`);
    }
  } catch (error) {
    throw new Error(`Failed to generate migrations: ${error}`);
  } finally {
    // Clean up temp config file
    await Bun.file('./drizzle.config.temp.ts').delete();
  }
}

/**
 * Push schema changes to database directly (without migrations)
 * 
 * This function applies schema changes directly to the database without creating
 * migration files. Useful for development, but not recommended for production.
 * 
 * @param options - Schema push options:
 *   - schemaPath: Path(s) to schema files containing pgTable/sqliteTable definitions
 *   - dialect: Database dialect ('sqlite' or 'postgresql')
 *   - connectionString: Database connection string
 * 
 * @example
 * ```typescript
 * await pushSchema({
 *   schemaPath: './src/schema',
 *   dialect: 'postgresql',
 *   connectionString: 'postgresql://user:pass@localhost/db',
 * });
 * ```
 */
export async function pushSchema(options?: {
  schemaPath?: string | string[];
  dialect?: 'sqlite' | 'postgresql';
  connectionString?: string;
}): Promise<void> {
  const schemaPath = options?.schemaPath ?? './src/schema';
  const dialect = options?.dialect ?? 'sqlite';
  
  const schemaPaths = Array.isArray(schemaPath) ? schemaPath : [schemaPath];
  
  const configContent = `import type { Config } from 'drizzle-kit';

export default {
  schema: ${JSON.stringify(schemaPaths)},
  dialect: ${JSON.stringify(dialect)},
  dbCredentials: {
    url: ${JSON.stringify(options?.connectionString ?? process.env.DB_URL ?? ':memory:')},
  },
} satisfies Config;
`;
  
  try {
    await Bun.write('./drizzle.config.temp.ts', configContent);
    
    const args = dialect === 'sqlite' 
      ? ['bunx', 'drizzle-kit', 'push:sqlite', '--config=drizzle.config.temp.ts']
      : ['bunx', 'drizzle-kit', 'push:pg', '--config=drizzle.config.temp.ts'];
    
    const result = spawnSync(args, {
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    
    if (result.exitCode !== 0) {
      throw new Error(`drizzle-kit push failed with exit code ${result.exitCode}`);
    }
  } catch (error) {
    throw new Error(`Failed to push schema: ${error}`);
  } finally {
    // Clean up temp config file
    await Bun.file('./drizzle.config.temp.ts').delete();
  }
}
