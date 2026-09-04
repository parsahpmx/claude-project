import { createDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';
import { seedDatabase } from './seed.js';

/**
 * `pnpm db:seed` — migrate, then load the demo dataset.
 *
 * Safe to run repeatedly against a fresh PGlite directory. Against a database
 * that already has data it will fail on the unique indexes rather than
 * silently double-seeding, which is the failure mode you want.
 */
const handle = await createDatabase();
console.log(`[forge] database driver: ${handle.driver}${handle.dataDir ? ` (${handle.dataDir})` : ''}`);

await runMigrations(handle);
console.log('[forge] migrations applied');

const result = await seedDatabase(handle);
await handle.close();

console.log('[forge] seed complete');
console.table({
  users: result.users,
  coaches: result.coaches,
  plans: result.plans,
  workouts: result.workouts,
  'set logs': result.setLogs,
  recipes: result.recipes,
  products: result.products,
  posts: result.posts,
});
console.log(`[forge] demo login: ${result.demoLogin.email} / ${result.demoLogin.password}`);
