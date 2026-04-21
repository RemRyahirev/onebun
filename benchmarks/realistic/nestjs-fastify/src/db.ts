import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

const DB_PATH = process.env.BENCH_DB_PATH || './bench.db';

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');

export const db = drizzle(sqlite);
