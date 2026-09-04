'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';
import { TextArea } from '@/components/ui/forms';

export function CheckInResponse({ checkInId }: { checkInId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = String(form.get('response') ?? '').trim();
    if (response.length === 0) return;

    setPending(true);
    const result = await fetch(`/api/v1/coach/check-ins/${checkInId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response }),
    });
    setPending(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    }
  };

  if (!open) {
    return <Button size="sm" onClick={() => setOpen(true)}>Reply to Check-In</Button>;
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <TextArea
        label="Your response"
        name="response"
        required
        hint="Open with whatever they flagged. Say what changes and why."
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? 'Sending…' : 'Send Reply'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
