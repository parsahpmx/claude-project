import type { Database, DatabaseHandle } from '@forge/db';
import type { Config } from '../config.js';

/** Everything a route handler needs, assembled once at boot. */
export interface AppContext {
  config: Config;
  handle: DatabaseHandle;
  db: Database;
  /** Injectable so tests can freeze time and assert on generated plans. */
  today: () => string;
}
