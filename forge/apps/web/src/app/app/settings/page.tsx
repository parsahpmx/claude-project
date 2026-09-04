import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card } from '@/components/ui/primitives';
import { DeviceManager } from '@/components/app/device-manager';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Device {
  id: string; provider: string; status: string; permissions: string[]; lastSyncedAt: string | null;
}

const NOTIFICATION_GROUPS = [
  ['Training', ['Session reminders', 'Plan changes', 'Rest day nudges']],
  ['Coaching', ['Coach replies', 'Check-in reminders', 'Session bookings']],
  ['Progress', ['Personal records', 'Weekly summary', 'Milestone reached']],
  ['Community', ['Replies to your posts', 'Challenge results']],
] as const;

export default async function SettingsPage() {
  const { devices } = await apiFetch<{ devices: Device[] }>('/v1/me/devices');

  return (
    <AppSection>
      <PageHeader
        eyebrow="Settings"
        title="WEARABLES & PREFERENCES"
        lead="What FORGE reads, what it sends you, and what happens to your data."
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <DeviceManager devices={devices} />

        <div className="space-y-6">
          <Card>
            <p className="eyebrow mb-5">Notifications</p>
            <div className="space-y-6">
              {NOTIFICATION_GROUPS.map(([group, items]) => (
                <div key={group}>
                  <p className="text-sm font-semibold">{group}</p>
                  <ul className="mt-3 space-y-2.5">
                    {items.map((item) => (
                      <li key={item} className="flex items-center justify-between gap-3 text-sm">
                        <span className="opacity-75">{item}</span>
                        <span aria-hidden className="h-5 w-9 rounded-pill bg-ember/80 p-0.5">
                          <span className="block h-4 w-4 translate-x-4 rounded-full bg-bone-100" />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs opacity-45">
              Notification delivery is not wired up in this prototype; the preferences model is.
            </p>
          </Card>

          <Card>
            <p className="eyebrow mb-4">Data and privacy</p>
            <ul className="space-y-3 text-sm">
              {[
                ['What we store', 'Your training, nutrition, recovery and coaching history — nothing else.'],
                ['What we never store', 'Card numbers. Payment details are held by the processor.'],
                ['Who can see your data', 'You, and the coach you choose. Nobody else, including other members.'],
                ['Leaving', 'Export everything as JSON, then delete your account. Deletion is permanent after 30 days.'],
              ].map(([title, body]) => (
                <li key={title} className="border-b border-ink-900/8 pb-3 last:border-0">
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-xs opacity-60">{body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppSection>
  );
}
