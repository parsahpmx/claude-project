'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { Button, Card } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';

interface Item {
  id: string; name: string; quantity: number; unit: string;
  section: string; recipeCount: number; checked: boolean;
}

const SECTION_ORDER = ['produce', 'protein', 'dairy', 'pantry', 'frozen', 'other'];
const SECTION_LABEL: Record<string, string> = {
  produce: 'Produce', protein: 'Protein', dairy: 'Dairy',
  pantry: 'Pantry', frozen: 'Frozen', other: 'Other',
};

export function ShoppingList({ weekStart, items }: { weekStart: string; items: Item[] }) {
  const router = useRouter();
  // Optimistic: a checkbox in a supermarket must respond before the network does.
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((item) => [item.id, item.checked])),
  );
  const [generating, setGenerating] = useState(false);

  const toggle = async (id: string) => {
    const next = !checked[id];
    setChecked((current) => ({ ...current, [id]: next }));
    await fetch(`/api/v1/me/nutrition/shopping-list/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checked: next }),
    });
  };

  const regenerate = async () => {
    setGenerating(true);
    await fetch('/api/v1/me/nutrition/shopping-list/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStart }),
    });
    setGenerating(false);
    router.refresh();
  };

  if (items.length === 0) {
    return (
      <EmptyState
        icon="⌸"
        title="No shopping list for this week"
        body="Plan your meals and FORGE merges every ingredient into one list, sorted the way a shop is laid out."
        action={<Button onClick={() => void regenerate()} disabled={generating}>Generate List</Button>}
      />
    );
  }

  const bySection = SECTION_ORDER.map((section) => ({
    section,
    items: items.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0);

  const remaining = items.filter((item) => !checked[item.id]).length;

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-900/10 p-5">
        <div>
          <p className="text-sm font-semibold">
            {remaining} of {items.length} items remaining
          </p>
          <p className="mt-0.5 text-xs text-muted">Week beginning {weekStart}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void regenerate()} disabled={generating}>
          {generating ? 'Rebuilding…' : 'Rebuild from meal plan'}
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3">
        {bySection.map((group) => (
          <section key={group.section} className="border-b border-r border-ink-900/8 p-5 last:border-r-0">
            <h3 className="eyebrow mb-4">{SECTION_LABEL[group.section] ?? group.section}</h3>
            <ul className="space-y-3">
              {group.items.map((item) => {
                const done = checked[item.id] ?? false;
                return (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => void toggle(item.id)}
                        className="mt-0.5 h-5 w-5 shrink-0 rounded-[4px] border-ink-900/25 accent-[#E8462B]"
                      />
                      <span className={clsx('flex-1', done && 'text-muted line-through')}>
                        {item.name}
                        <span className="ml-2 tabular-nums text-muted">
                          {formatQuantity(item.quantity)} {item.unit}
                        </span>
                        {item.recipeCount > 1 && (
                          <span className="block text-[0.6875rem] text-muted">
                            for {item.recipeCount} meals
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}
