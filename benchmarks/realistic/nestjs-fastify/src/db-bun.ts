import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

const DB_PATH = process.env.BENCH_DB_PATH || './bench.db';

const sqlite = new Database(DB_PATH);
sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA synchronous = NORMAL');

export const db = drizzle(sqlite);
