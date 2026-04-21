import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://bench:bench@localhost:5432/bench';

const client = new SQL(DATABASE_URL);
export const db = drizzle(client);
