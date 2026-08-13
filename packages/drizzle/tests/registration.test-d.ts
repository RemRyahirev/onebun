/**
 * TYPE-LEVEL test. The gate is `bun run typecheck`, not `bun test`.
 *
 * A registration token identifies a configuration for the whole life of the process, so the
 * type has to keep out values that do not compare by identity. A number or an object literal
 * would type-check as "some key" and then never match the registration it was meant to name.
 *
 * The file is named `.test-d.ts` so `bun test` does not pick it up — it asserts by compiling.
 */

import type { RegistrationToken } from '@onebun/core';

import { DrizzleModule } from '../src/drizzle.module';
import { DatabaseType } from '../src/types';


const connection = { type: DatabaseType.SQLITE as const, options: { url: ':memory:' } };

// A symbol names a registration and cannot collide across packages.
declare const symbolToken: unique symbol;
DrizzleModule.forRoot({ connection, as: symbolToken });
DrizzleModule.forFeature(symbolToken);

// A string is accepted too — easier to read in an error message, shareable without an import.
DrizzleModule.forRoot({ connection, as: 'analytics-db' });
DrizzleModule.forFeature('analytics-db');

// @ts-expect-error a number is not a registration token
DrizzleModule.forRoot({ connection, as: 42 });

// @ts-expect-error an object is not a registration token
DrizzleModule.forRoot({ connection, as: { name: 'analytics' } });

// @ts-expect-error forFeature takes the same token type
DrizzleModule.forFeature(42);

// The exported alias is exactly the two accepted forms.
const asSymbol: RegistrationToken = symbolToken;
const asString: RegistrationToken = 'analytics-db';
void asSymbol;
void asString;
