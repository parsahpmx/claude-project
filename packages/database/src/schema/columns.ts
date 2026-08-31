import { numeric, timestamp } from 'drizzle-orm/pg-core';

/**
 * Shared column builders.
 *
 * Centralised so that "how Meter402 stores money" and "how Meter402 stores
 * time" are each decided once rather than re-decided per table, which is how
 * a `float` amount or a naive timestamp eventually slips in.
 */

/** `timestamptz`, always. A naive timestamp is a bug waiting for a DST boundary. */
export function tsColumn(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

export const auditTimestamps = {
  createdAt: tsColumn('created_at').notNull().defaultNow(),
  updatedAt: tsColumn('updated_at').notNull().defaultNow(),
};

/**
 * A monetary amount as an integer count of minor units.
 *
 * `NUMERIC(78, 0)` holds a full uint256 (~1.16e77), so no on-chain amount can
 * overflow the column. Scale is zero because the value is already in minor
 * units — the decimal point lives in the asset's `decimals`, not in the
 * column.
 *
 * Never `float`, `real`, `double precision`, or Postgres `money` (which
 * carries a locale-dependent fractional precision). Drizzle returns `numeric`
 * as a string; the repository layer converts to `bigint` and never routes it
 * through `Number`.
 */
export function minorUnits(name: string) {
  return numeric(name, { precision: 78, scale: 0 });
}
