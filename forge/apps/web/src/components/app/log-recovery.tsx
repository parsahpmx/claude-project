'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';

export function LogRecoveryButton({ slug, minutes }: { slug: string; minutes: number }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle');

  const log = async () => {
    setState('pending');
    const response = await fetch('/api/v1/me/recovery/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, minutes }),
    });
    setState(response.ok ? 'done' : 'idle');
    if (response.ok) router.refresh();
  };

  return (
    <Button size="sm" variant={state === 'done' ? 'ghost' : 'secondary'} onClick={() => void log()} disabled={state !== 'idle'}>
      {state === 'done' ? '✓ Logged' : state === 'pending' ? 'Logging…' : 'Start Session'}
    </Button>
  );
}
