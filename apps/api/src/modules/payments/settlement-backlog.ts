import type { Database } from '@meter402/database';
import type { SettlementBacklog } from '../../routes/health.js';
import { countPendingSettlements, reconciliationBacklog } from './reconciliation.repository.js';

/**
 * The operator's view of settlement.
 *
 * One place that assembles it, so `/health/payments`, the alerting rules in
 * `docs/ALERTING.md`, and anything added later all read the same numbers.
 * Two implementations of "how many payments are we unsure about" would
 * eventually disagree, and the disagreement would surface during an incident.
 */
export async function settlementBacklog(db: Database): Promise<SettlementBacklog> {
  const [pendingSettlements, backlog] = await Promise.all([
    countPendingSettlements(db),
    reconciliationBacklog(db),
  ]);

  return {
    pendingSettlements,
    reconciliationBacklog: backlog.pending + backlog.inProgress,
    exhausted: backlog.exhausted,
    uncertainSettlements: backlog.uncertain,
    oldestUnresolvedAgeSeconds: backlog.oldestUnresolvedAgeSeconds,
  };
}
