import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, hasDatabase, type Harness } from '../test-support/harness.js';
import { createUncertainSettlement } from '../test-support/uncertainty.js';

/**
 * `/health/payments`, the operator's view of settlement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The endpoint answers a different question from `/ready`, and the difference
 * is the reason it exists: a facilitator outage degrades payments but must not
 * pull the task out of load-balancer rotation and take the dashboard down with
 * it.
 *
 * Phase 3.5 adds the settlement backlog to it, because "is the facilitator
 * up" turned out to be the less important question. The one that matters is
 * how many payments are currently in a state where money may have moved
 * without a service being delivered — and how long the oldest has been there.
 * ─────────────────────────────────────────────────────────────────────────
 */

interface Backlog {
  pendingSettlements: number;
  reconciliationBacklog: number;
  exhausted: number;
  uncertainSettlements: number;
  oldestUnresolvedAgeSeconds: number | null;
}

describe.skipIf(!hasDatabase)('/health/payments', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  async function read(): Promise<Record<string, unknown>> {
    const response = await harness.app.inject({ method: 'GET', url: '/health/payments' });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('reports settlement as available when the facilitator is healthy', async () => {
    const body = await read();
    expect(body['settlement']).toBe('available');
    expect((body['dependencies'] as Record<string, boolean>)['facilitator']).toBe(true);
  });

  it('reports degraded rather than failing when the facilitator is down', async () => {
    harness.facilitator!.healthy = false;
    try {
      const body = await read();

      // Degraded, not an error: the endpoint has to keep answering.
      expect(body['settlement']).toBe('degraded');
      expect((body['dependencies'] as Record<string, boolean>)['facilitator']).toBe(false);
    } finally {
      harness.facilitator!.healthy = true;
    }
  });

  it('carries the settlement backlog an operator would alert on', async () => {
    const backlog = (await read())['backlog'] as Backlog;

    for (const field of [
      'pendingSettlements',
      'reconciliationBacklog',
      'exhausted',
      'uncertainSettlements',
    ] as const) {
      expect(typeof backlog[field]).toBe('number');
      expect(backlog[field]).toBeGreaterThanOrEqual(0);
    }

    // Null when nothing is outstanding, a number of seconds when something is.
    expect(
      backlog.oldestUnresolvedAgeSeconds === null ||
        typeof backlog.oldestUnresolvedAgeSeconds === 'number',
    ).toBe(true);
  });

  it('counts an uncertain settlement once it exists', async () => {
    const before = ((await read())['backlog'] as Backlog).uncertainSettlements;

    // A settle call that never comes back is the uncertainty this counts.
    await createUncertainSettlement(harness, `health${Date.now()}`);

    const after = ((await read())['backlog'] as Backlog).uncertainSettlements;
    expect(after).toBe(before + 1);

    const backlog = (await read())['backlog'] as Backlog;
    expect(backlog.reconciliationBacklog).toBeGreaterThanOrEqual(1);
    expect(backlog.oldestUnresolvedAgeSeconds).not.toBeNull();
  });

  it('exposes no merchant, payer, or payment identifiers', async () => {
    /*
     * This endpoint is operational and is routinely scraped, dashboarded, and
     * pasted into incident channels. It carries volumes and ages only —
     * whose payments make up the backlog is not an operator's question, and
     * an address or a payment id leaking through here would end up somewhere
     * nobody chose to put it.
     */
    const serialised = JSON.stringify(await read());

    expect(serialised).not.toMatch(/0x[0-9a-fA-F]{40}/); // addresses
    expect(serialised).not.toMatch(/0x[0-9a-fA-F]{64}/); // hashes, nonces
    expect(serialised).not.toMatch(/\b(preq|pay|rcpt|org|proj|key)_[0-9A-HJKMNP-TV-Z]{26}\b/i);
  });

  it('still answers when the backlog query fails', async () => {
    /*
     * The backlog needs the database; the facilitator and RPC verdicts do not.
     * Losing one part of the answer must not cost the rest of it — this
     * endpoint is read during exactly the incidents that break one dependency
     * at a time.
     */
    const { registerPaymentHealthRoute } = await import('./health.js');
    const { default: Fastify } = await import('fastify');

    const app = Fastify();
    registerPaymentHealthRoute(app, {
      settlementEnabled: true,
      enabledNetworks: ['eip155:84532'],
      probes: { facilitator: async () => true },
      metrics: () => ({}),
      backlog: async () => {
        throw new Error('database unreachable');
      },
    });

    const response = await app.inject({ method: 'GET', url: '/health/payments' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.backlog).toEqual({ unavailable: true });
    // The parts that did not depend on the database survived.
    expect(body.dependencies.facilitator).toBe(true);
    expect(body.settlement).toBe('available');

    await app.close();
  });
});
