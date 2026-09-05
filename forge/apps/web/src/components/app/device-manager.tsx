'use client';

import { useState } from 'react';
import { formatDateLabel } from '@/lib/format';
import { useRouter } from 'next/navigation';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { Status } from '@/components/ui/feedback';

interface Device {
  id: string; provider: string; status: string; permissions: string[]; lastSyncedAt: string | null;
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

const PERMISSIONS = ['workouts', 'heart-rate', 'sleep', 'steps'];

export function DeviceManager({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  const update = async (provider: string, status: string, permissions: string[]) => {
    setPending(provider);
    await fetch(`/api/v1/me/devices/${provider}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, permissions }),
    });
    setPending(null);
    router.refresh();
  };

  return (
    <Card padded={false}>
      <div className="border-b border-ink-900/10 p-6">
        <p className="eyebrow">Connected devices</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Each connection lists exactly what FORGE reads. Disconnecting drops the permissions and the sync
          marker together — we do not keep a stale record of access we no longer have.
        </p>
      </div>

      <ul className="divide-y divide-ink-900/8">
        {devices.map((device) => {
          const connected = device.status === 'connected' || device.status === 'syncing';
          return (
            <li key={device.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{PROVIDER_LABEL[device.provider] ?? device.provider}</p>
                  {device.lastSyncedAt && (
                    <p className="mt-0.5 text-xs text-muted">
                      Last sync {formatDateLabel(device.lastSyncedAt.slice(0, 10))}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Status status={device.status as 'connected' | 'not-connected' | 'syncing'} />
                  <Button
                    size="sm"
                    variant={connected ? 'ghost' : 'secondary'}
                    disabled={pending === device.provider}
                    onClick={() =>
                      void update(
                        device.provider,
                        connected ? 'not-connected' : 'connected',
                        connected ? [] : PERMISSIONS,
                      )
                    }
                  >
                    {pending === device.provider ? '…' : connected ? 'Disconnect' : 'Connect'}
                  </Button>
                </div>
              </div>

              {connected && (
                <div className="mt-4">
                  <p className="text-[0.625rem] uppercase tracking-[0.12em] text-muted">Data permissions</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {PERMISSIONS.map((permission) => (
                      <Chip
                        key={permission}
                        size="sm"
                        tone={device.permissions.includes(permission) ? 'good' : 'neutral'}
                      >
                        <span aria-hidden>{device.permissions.includes(permission) ? '✓' : '○'}</span>
                        {permission.replace(/-/g, ' ')}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
