'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';
import { TextArea, Select } from '@/components/ui/forms';

export function CoachNoteForm({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = String(form.get('body') ?? '').trim();
    if (body.length === 0) return;

    setPending(true);
    const response = await fetch(`/api/v1/coach/clients/${memberId}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, visibility: String(form.get('visibility') ?? 'private') }),
    });
    setPending(false);
    if (response.ok) {
      (event.target as HTMLFormElement).reset();
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <TextArea label="Add a note" name="body" required />
      <Select
        label="Visibility"
        name="visibility"
        defaultValue="private"
        options={[
          { value: 'private', label: 'Private — only you' },
          { value: 'shared', label: 'Shared — visible to the client' },
        ]}
      />
      <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save Note'}</Button>
    </form>
  );
}
