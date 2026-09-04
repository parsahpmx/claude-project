import { AppSection, PageHeader } from '@/components/app/page-header';
import { CalendarView } from '@/components/app/calendar-view';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface CalendarResponse {
  from: string;
  to: string;
  events: {
    id: string; kind: string; title: string; date: string;
    startMinutes: number; durationMinutes: number; status: string; referenceId: string | null;
  }[];
}

export default async function CalendarPage() {
  // `today` comes from the API rather than the render process, so the server
  // pass and the client pass cannot disagree about which day is highlighted.
  const [data, health] = await Promise.all([
    apiFetch<CalendarResponse>('/v1/me/calendar'),
    apiFetch<{ today: string }>('/health'),
  ]);

  return (
    <AppSection>
      <PageHeader
        eyebrow="Calendar"
        title="YOUR SCHEDULE"
        lead="Training, recovery, meal prep and coach sessions in one view. Drag a session to move it — the plan follows."
      />
      <div className="mt-10">
        <CalendarView from={data.from} to={data.to} today={health.today} events={data.events} />
      </div>
    </AppSection>
  );
}
