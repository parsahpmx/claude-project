import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Stat } from '@/components/ui/primitives';
import { Status } from '@/components/ui/feedback';
import { apiFetch } from '@/lib/api';
import { formatCents } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Analytics {
  activeClients: number;
  revenueCents: number;
  series: { weekStart: string; sessions: number }[];
}

interface Clients {
  clients: {
    member: { id: string; firstName: string; lastName: string };
    startedOn: string;
  }[];
}

const PLATFORM_FEE = 0.15;

export default async function CoachPaymentsPage() {
  const [analytics, clients] = await Promise.all([
    apiFetch<Analytics>('/v1/coach/analytics'),
    apiFetch<Clients>('/v1/coach/clients'),
  ]);

  const gross = analytics.revenueCents;
  const fee = Math.round(gross * PLATFORM_FEE);
  const net = gross - fee;
  const perClient = clients.clients.length > 0 ? Math.round(gross / clients.clients.length) : 0;

  return (
    <AppSection>
      <PageHeader
        eyebrow="Payments"
        title="EARNINGS"
        lead="Gross, platform fee and net — itemised per client. Payouts land every Friday."
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><Stat label="Gross monthly" value={formatCents(gross)} hint={`${clients.clients.length} clients`} /></Card>
        <Card><Stat label="Platform fee" value={formatCents(fee)} hint="15%" /></Card>
        <Card><Stat label="Net monthly" value={formatCents(net)} hint="Paid weekly" /></Card>
        <Card><Stat label="Per client" value={formatCents(perClient)} hint="Average" /></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card padded={false}>
          <div className="border-b border-ink-900/10 p-5">
            <p className="eyebrow">Recurring subscriptions</p>
          </div>
          <ul className="divide-y divide-ink-900/8">
            {clients.clients.map((client) => (
              <li key={client.member.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-bone-100"
                  >
                    {client.member.firstName.charAt(0)}{client.member.lastName.charAt(0)}
                  </span>
                  <div>
                    <p className="font-medium">{client.member.firstName} {client.member.lastName}</p>
                    <p className="mt-0.5 text-xs opacity-50">Client since {client.startedOn}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="tabular-nums">{formatCents(perClient)}</span>
                  <Status status="paid" />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card>
            <p className="eyebrow mb-4">Next payout</p>
            <p className="display text-display-sm tabular-nums">{formatCents(Math.round(net / 4))}</p>
            <p className="mt-2 text-sm opacity-60">Friday, weekly cycle</p>
            <div className="rule my-5" />
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="opacity-55">Method</dt>
                <dd>Bank transfer</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="opacity-55">Account</dt>
                <dd>···· 4417</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="opacity-55">Currency</dt>
                <dd>USD</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <p className="eyebrow mb-4">How the fee works</p>
            <ul className="space-y-3 text-sm">
              {[
                ['15% platform fee', 'Covers payments, hosting, the client app and support. No monthly charge.'],
                ['No fee on consultations', 'Free consultations stay free — they are how members choose you.'],
                ['Weekly payouts', 'Every Friday, for everything settled that week.'],
              ].map(([title, body]) => (
                <li key={title} className="border-b border-ink-900/8 pb-3 last:border-0">
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-xs opacity-60">{body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs opacity-45">
              Payment processing is not connected in this prototype — the earnings model and its arithmetic are.
            </p>
          </Card>
        </div>
      </div>
    </AppSection>
  );
}
