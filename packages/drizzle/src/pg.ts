/**
 * PostgreSQL schema builders re-exported from drizzle-orm/pg-core
 *
 * Usage:
 * ```typescript
 * import { pgTable, text, integer, timestamp, uuid } from '@onebun/drizzle/pg';
 * ```
 *
 * A bare re-export: this package adds no column types of its own. The one behaviour it does add
 * on the PostgreSQL path is the `json`/`jsonb` encoding fix, which lives in the encoders rather
 * than in a column type so it covers `drizzle-orm/pg-core` imports too.
 *
 * @see docs:api/drizzle.md
 */

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
