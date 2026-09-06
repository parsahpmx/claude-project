export const metadata = {
  title: 'About',
  description: 'What FORGE is for, and who it is built for.',
};

export default function AboutPage() {
  return (
    <section className="shell py-16">
      <p className="eyebrow">About</p>
      <h1 className="mt-4 max-w-3xl text-display font-display text-bone-100 text-balance">
        Built for the athlete who does both
      </h1>
      <div className="mt-8 max-w-prose space-y-5 text-body muted">
        <p>
          Most training tools pick a side. Endurance platforms treat the gym as a session type with
          a duration and nothing else. Lifting apps have no idea what a long run costs you. If you
          do both, you end up keeping two histories that never meet, and neither of them can tell
          you whether this week was too much.
        </p>
        <p>
          FORGE keeps one. A run and a squat session both produce load, both land in the same week,
          and both count toward the same picture of whether you are building or overreaching.
        </p>
        <p>
          It is early. This is an open beta, which means some of what you would expect from a
          finished product is deliberately not here yet — and the Features page says which parts,
          rather than leaving you to find the edges yourself.
        </p>
        <h2 className="pt-4 text-section text-bone-100">On privacy</h2>
        <p>
          A training log is a record of where you are and when, several times a week. We treat it
          that way. Accounts start closed, activity starts and ends are trimmed before anyone else
          sees a map, and the raw GPS trace is stored somewhere no sharing rule can reach. You can
          read the specifics on the privacy page.
        </p>
      </div>
    </section>
  );
}
