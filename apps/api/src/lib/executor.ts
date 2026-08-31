import type { QueryExecutor } from '@meter402/database';

/**
 * Anything that can run a query: the connection pool, or a transaction.
 *
 * Repository functions take this rather than `Database` so the same function
 * works inside and outside a transaction. That matters because several
 * invariants — organization creation with its OWNER membership, the last-owner
 * check, API key rotation, and every payment write — are only correct when
 * each read and write in them runs in one transaction.
 *
 * Defined in @meter402/database beside the handle it is derived from, and
 * re-exported here under the name the API app has always used for it.
 */
export type Executor = QueryExecutor;
