'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';

export function JoinChallengeButton({ slug, joined }: { slug: string; joined: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    setPending(true);
    await fetch(`/api/v1/me/challenges/${slug}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visible: true }),
    });
    setPending(false);
    router.refresh();
  };

  return (
    <Button variant={joined ? 'ghost' : 'primary'} onClick={() => void toggle()} disabled={pending}>
      {pending ? '…' : joined ? 'Leave challenge' : 'Join challenge'}
    </Button>
  );
}
