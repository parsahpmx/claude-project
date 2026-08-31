import type { Database } from '@meter402/database';

/**
 * Anything that can run a query: the connection pool, or a transaction.
 *
 * Repository functions take this rather than `Database` so the same function
 * works inside and outside a transaction. That matters because several Phase 1
 * invariants — organization creation with its OWNER membership, the last-owner
 * check, API key rotation — are only correct when every read and write in them
 * runs in one transaction.
 *
 * Structural rather than nominal: Drizzle's transaction object is a different
 * class from the database handle but exposes the same query builders.
 */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
