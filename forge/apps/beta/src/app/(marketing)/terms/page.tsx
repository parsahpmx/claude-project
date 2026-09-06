export const metadata = {
  title: 'Terms',
  description: 'The terms that apply while FORGE is in open beta.',
};

export default function TermsPage() {
  return (
    <section className="shell py-16">
      <p className="eyebrow">Terms</p>
      <h1 className="mt-4 max-w-3xl text-display font-display text-bone-100 text-balance">
        Beta terms
      </h1>
      <div className="mt-8 max-w-prose space-y-5 text-body muted">
        <h2 className="text-section text-bone-100">This is beta software</h2>
        <p>
          Features may change or be removed. Data may be migrated. We aim not to lose
          anything, and we do not promise it.
        </p>

        <h2 className="text-section text-bone-100">Training is your responsibility</h2>
        <p>
          FORGE prescribes sessions and loads based on what you tell it and what you record.
          It is not a medical device and it does not know about your injuries. If something
          hurts, or you are returning from injury, talk to a qualified professional rather
          than to a training plan.
        </p>

        <h2 className="text-section text-bone-100">Your content</h2>
        <p>
          Your activities, routes and photos remain yours. Granting FORGE the right to store
          and display them back to you, and to the people you choose, is all we ask.
        </p>

        <h2 className="text-section text-bone-100">Acceptable use</h2>
        <p>
          Do not use FORGE to harass anyone, to scrape other people&rsquo;s activities, or to
          upload content you do not have the right to share.
        </p>

        <h2 className="text-section text-bone-100">Ending it</h2>
        <p>
          You can delete your account at any time. We can close accounts that break these
          terms, and will say why when we do.
        </p>
      </div>
    </section>
  );
}
