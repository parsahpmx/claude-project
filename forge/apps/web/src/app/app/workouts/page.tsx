import { AppSection, PageHeader } from '@/components/app/page-header';
import { WorkoutDiscovery } from '@/components/marketing/workout-discovery';

export default function AppWorkoutsPage() {
  return (
    <AppSection>
      <PageHeader
        eyebrow="Explore"
        title="FIND A SESSION"
        lead="Filtered by the equipment on your profile — nothing you cannot run will appear."
      />
      <div className="mt-10">
        <WorkoutDiscovery />
      </div>
    </AppSection>
  );
}
