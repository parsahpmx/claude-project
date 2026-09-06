import { PRIVACY_PROMISES } from '@/lib/marketing';
import { Card } from '@/components/ui/primitives';

export const metadata = {
  title: 'Privacy',
  description: 'What FORGE collects, what it shares, and the defaults that apply before you change anything.',
};

export default function PrivacyPage() {
  return (
    <section className="shell py-16">
      <p className="eyebrow">Privacy</p>
      <h1 className="mt-4 max-w-3xl text-display font-display text-bone-100 text-balance">
        What we collect and what we do with it
      </h1>
      <p className="mt-5 max-w-prose text-body muted">
        Plain description first; the formal policy follows it. If the two ever disagree,
        that is a bug and we want to hear about it.
      </p>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {PRIVACY_PROMISES.map(([title, body]) => (
          <Card key={title}>
            <h2 className="text-card-title text-bone-100">{title}</h2>
            <p className="mt-2 text-secondary muted">{body}</p>
          </Card>
        ))}
      </div>

      <div className="mt-14 max-w-prose space-y-5 text-body muted">
        <h2 className="text-section text-bone-100">Location data</h2>
        <p>
          Activities you record with GPS produce a route. FORGE stores the full trace so
          that your own distance, splits and personal map are accurate. That full trace is
          never shared. What other people can see is a separate line with the start and end
          removed and any private zones cut out.
        </p>

        <h2 className="text-section text-bone-100">Health data</h2>
        <p>
          Heart rate and effort are used to work out training load and to show it back to
          you. FORGE does not diagnose anything, and nothing in the product should be read
          as medical advice.
        </p>

        <h2 className="text-section text-bone-100">Who else sees it</h2>
        <p>
          Followers you approve, at the visibility you chose. A coach, only if you switch
          coach sharing on. Nobody else. Analytics and future model training are separate
          switches and both start off.
        </p>

        <h2 className="text-section text-bone-100">Deleting your account</h2>
        <p>
          You can request deletion from settings. Your profile, activities, routes, plans
          and goals are removed with the account rather than retained quietly.
        </p>

        <h2 className="text-section text-bone-100">Beta caveat</h2>
        <p>
          This is beta software running on a beta database. It is not the place for data
          you could not stand to lose, and we will say so plainly until it is.
        </p>
      </div>
    </section>
  );
}
