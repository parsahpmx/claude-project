import type { ReactNode } from 'react';

/** The header every app screen opens with — one shape, forty screens. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-ink-900/10 pb-8 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className="display text-display-sm text-balance">{title}</h1>
        {lead && <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted">{lead}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function AppSection({ children }: { children: ReactNode }) {
  return <div className="px-5 py-8 sm:px-8 sm:py-10 lg:px-12">{children}</div>;
}
