import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://bench:bench@localhost:5432/bench';

const pool = new pg.Pool({ connectionString: DATABASE_URL });
export const db = drizzle(pool);
