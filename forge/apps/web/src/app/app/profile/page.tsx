import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, ButtonLink } from '@/components/ui/primitives';
import { Status } from '@/components/ui/feedback';
import { ProfileForm } from '@/components/app/profile-form';
import { apiFetch } from '@/lib/api';
import { formatCents, formatDateLabel } from '@/lib/format';
import type { MemberProfile, Subscription } from '@/lib/types';

export const metadata = { title: 'Profile' };

export const dynamic = 'force-dynamic';

interface ProfileResponse {
  user: {
    id: string; email: string; firstName: string; lastName: string;
    timezone: string; unitSystem: string; locale: string; marketingOptIn: boolean;
  } | null;
  profile: MemberProfile | null;
  devices: { id: string; provider: string; status: string; permissions: string[]; lastSyncedAt: string | null }[];
}

interface BillingResponse {
  subscription: Subscription | null;
  plan: { name: string; tagline: string; features: string[] } | null;
  entitlements: string[];
  invoices: { id: string; description: string; amountCents: number; status: string; issuedOn: string }[];
  paymentMethods: { id: string; brand: string | null; last4: string | null; expiryMonth: number | null; expiryYear: number | null; isDefault: boolean }[];
}

const PROVIDER_LABEL: Record<string, string> = {
  'apple-health': 'Apple Health',
  'apple-watch': 'Apple Watch',
  garmin: 'Garmin',
  whoop: 'WHOOP',
  fitbit: 'Fitbit',
  'google-health-connect': 'Google Health Connect',
  oura: 'Oura',
  strava: 'Strava',
};

const SECTIONS = [
  'Personal details', 'My goals', 'Training preferences', 'Nutrition preferences',
  'My equipment', 'Wearables', 'Notifications', 'Language', 'Privacy',
  'Billing', 'Subscription', 'Downloads', 'Security',
];

export default async function ProfilePage() {
  const [profile, billing] = await Promise.all([
    apiFetch<ProfileResponse>('/v1/me/profile'),
    apiFetch<BillingResponse>('/v1/me/billing'),
  ]);

  return (
    <AppSection>
      <PageHeader
        eyebrow="Profile"
        title="YOUR ACCOUNT"
        lead="Everything FORGE knows about you, and everything it does with it."
      />

      <nav aria-label="Profile sections" className="mt-6 flex flex-wrap gap-2">
        {SECTIONS.map((label) => (
          <a
            key={label}
            href={`#${label.toLowerCase().replace(/\s/g, '-')}`}
            className="min-h-[36px] rounded-pill border border-ink-900/12 px-3.5 text-xs leading-[34px] transition-colors hover:border-ink-900/40"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section id="personal-details" className="scroll-mt-24">
            <Card>
              <p className="eyebrow mb-6">Personal details, goals and preferences</p>
              {profile.user && profile.profile ? (
                <ProfileForm user={profile.user} profile={profile.profile} />
              ) : (
                <p className="text-sm text-muted">Complete the assessment to set up your profile.</p>
              )}
            </Card>
          </section>

          <section id="my-equipment" className="scroll-mt-24">
            <Card>
              <p className="eyebrow mb-4">My equipment</p>
              <p className="text-sm leading-relaxed text-muted">
                We only recommend workouts you can actually perform with your setup. Change this and your plan
                re-checks every session in the block.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {(profile.profile?.equipment ?? []).map((item) => (
                  <Chip key={item} tone="accent">
                    <span aria-hidden>✓</span> {item.replace(/-/g, ' ')}
                  </Chip>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted">Edit your equipment in the form above.</p>
            </Card>
          </section>

          <section id="wearables" className="scroll-mt-24">
            <Card padded={false}>
              <div className="border-b border-ink-900/10 p-6">
                <p className="eyebrow">Wearables</p>
                <p className="mt-2 text-sm text-muted">
                  Connected devices supply sleep, HRV, resting heart rate and steps. FORGE reads only what each
                  permission below allows.
                </p>
              </div>
              <ul className="divide-y divide-ink-900/8">
                {profile.devices.map((device) => (
                  <li key={device.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div>
                      <p className="font-medium">{PROVIDER_LABEL[device.provider] ?? device.provider}</p>
                      {device.permissions.length > 0 ? (
                        <p className="mt-1 text-xs text-muted">
                          Reads: {device.permissions.map((p) => p.replace(/-/g, ' ')).join(', ')}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted">No data permissions granted</p>
                      )}
                      {device.lastSyncedAt && (
                        <p className="mt-0.5 text-xs text-muted">
                          Last sync {formatDateLabel(device.lastSyncedAt.slice(0, 10))}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Status status={device.status as 'connected' | 'not-connected' | 'syncing'} />
                      <Link
                        href="/app/settings"
                        className="text-xs font-semibold uppercase tracking-[0.08em] text-accent"
                      >
                        {device.status === 'connected' ? 'Manage' : 'Connect'}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </div>

        <div className="space-y-6">
          <section id="subscription" className="scroll-mt-24">
            <Card tone="dark">
              <p className="eyebrow mb-3">Subscription</p>
              {billing.subscription && billing.plan ? (
                <>
                  <p className="display text-2xl leading-none text-bone-100">{billing.plan.name}</p>
                  <p className="mt-2 text-sm text-bone-200/60">{billing.plan.tagline}</p>
                  <dl className="mt-6 space-y-3 text-sm">
                    <Row label="Status" value={billing.subscription.status} />
                    <Row label="Billing" value={billing.subscription.billingInterval} />
                    <Row label="Price" value={`${formatCents(billing.subscription.priceCents)} / ${billing.subscription.billingInterval === 'yearly' ? 'year' : 'month'}`} />
                    <Row label="Renews" value={formatDateLabel(billing.subscription.currentPeriodEndsOn)} />
                  </dl>
                  {billing.subscription.cancelAtPeriodEnd && (
                    <p className="mt-5 rounded-[8px] border border-signal-warn/25 bg-signal-warn/[0.08] p-3 text-xs">
                      Cancelling at the end of this period. You keep full access until{' '}
                      {formatDateLabel(billing.subscription.currentPeriodEndsOn)}.
                    </p>
                  )}
                  <div className="mt-6 flex flex-col gap-2">
                    <ButtonLink href="/pricing" variant="inverse" size="sm" block>Change Plan</ButtonLink>
                  </div>
                </>
              ) : (
                <p className="text-sm text-bone-200/65">No active subscription.</p>
              )}
            </Card>
          </section>

          <section id="billing" className="scroll-mt-24">
            <Card>
              <p className="eyebrow mb-4">Payment method</p>
              {billing.paymentMethods.length === 0 ? (
                <p className="text-sm text-muted">No payment method on file.</p>
              ) : (
                <ul className="space-y-3">
                  {billing.paymentMethods.map((method) => (
                    <li key={method.id} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        {method.brand} ···· {method.last4}
                        {method.isDefault && <Chip size="sm">Default</Chip>}
                      </span>
                      <span className="text-xs tabular-nums text-muted">
                        {String(method.expiryMonth).padStart(2, '0')}/{method.expiryYear}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="rule my-6" />

              <p className="eyebrow mb-4">Invoices</p>
              <ul className="space-y-3">
                {billing.invoices.slice(0, 6).map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{invoice.description}</p>
                      <p className="text-xs text-muted">{formatDateLabel(invoice.issuedOn)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular-nums">{formatCents(invoice.amountCents)}</span>
                      <Status status="paid" />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          <section id="privacy" className="scroll-mt-24">
            <Card>
              <p className="eyebrow mb-4">Privacy, downloads and security</p>
              <ul className="space-y-3 text-sm">
                {[
                  ['Download my data', 'Every workout, meal and measurement as JSON.'],
                  ['Manage notifications', 'Email and push, per category.'],
                  ['Change password', 'Requires your current password.'],
                  ['Delete my account', 'Permanent, after a 30-day grace period.'],
                ].map(([title, body]) => (
                  <li key={title}>
                    <Link
                      href="/app/settings"
                      className="block rounded-[8px] border border-ink-900/10 p-4 transition-colors hover:border-ink-900/30"
                    >
                      <span className="font-medium">{title}</span>
                      <span className="mt-0.5 block text-xs text-muted">{body}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </div>
      </div>
    </AppSection>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="capitalize text-muted">{label}</dt>
      <dd className="capitalize">{value}</dd>
    </div>
  );
}
