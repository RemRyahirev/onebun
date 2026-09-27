/**
 * PostgreSQL schema builders re-exported from drizzle-orm/pg-core, plus the PostgreSQL-only
 * JSON value helpers for raw SQL.
 *
 * Usage:
 * ```typescript
 * import { pgTable, text, integer, timestamp, uuid } from '@onebun/drizzle/pg';
 * import { jsonbParam, jsonParam } from '@onebun/drizzle/pg';
 * ```
 *
 * The builders are a bare re-export: this package adds no column types of its own. The
 * `json`/`jsonb` encoding fix lives in the encoders rather than in a column type so it covers
 * `drizzle-orm/pg-core` imports too.
 *
 * `jsonbParam()`/`jsonParam()` are the one thing this subpath adds. They live here, not in the
 * package root, because the SQL they render (`$n::text::jsonb`) is PostgreSQL-specific.
 *
 * @see docs:api/drizzle.md
 */

// JSON values for raw SQL, without column metadata
export { jsonbParam, jsonParam } from './pg-json-param';

// Table and schema builders
export {
  pgTable,
  pgSchema,
  pgEnum,
  pgView,
  pgMaterializedView,
  pgSequence,
} from 'drizzle-orm/pg-core';

// Column types
export {
  bigint,
  bigserial,
  boolean,
  char,
  cidr,
  customType,
  date,
  doublePrecision,
  inet,
  integer,
  interval,
  json,
  jsonb,
  line,
  macaddr,
  macaddr8,
  numeric,
  point,
  real,
  serial,
  smallint,
  smallserial,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Constraints and indexes
export {
  check,
  foreignKey,
  index,
  primaryKey,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Types for type inference
export type {
  PgTable,
  PgColumn,
  PgEnum,
  PgTableWithColumns,
} from 'drizzle-orm/pg-core';
