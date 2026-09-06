/**
 * Marketing copy in one place, so a claim is made once and every page that
 * repeats it stays in step. Nothing here describes a capability that is not in
 * the beta: features behind a flag say so.
 */
export const CAPABILITIES = [
  {
    slug: 'training',
    title: 'Structured training',
    lead: 'Programmes that progress because you did, not because a week rolled over.',
    points: [
      'Strength and running programmes with real phases and a progression model',
      'Sets, reps, load and RPE, with your history beside every lift',
      'A week view that shows what is scheduled, what you did, and what you moved',
    ],
    state: 'In the beta',
  },
  {
    slug: 'tracking',
    title: 'Activity tracking',
    lead: 'Runs, rides, walks and hikes — and the barbell work most trackers ignore.',
    points: [
      'Splits, climbing and heart rate on every recorded session',
      'Personal records per lift, from your heaviest qualifying set',
      'One history for endurance and strength, instead of two that never meet',
    ],
    state: 'In the beta',
  },
  {
    slug: 'maps',
    title: 'Routes and maps',
    lead: 'A map that gets the whole screen, and a route history that stays yours.',
    points: [
      'Your own recorded activities drawn on one personal map',
      'Saved routes with distance, climbing and an honest time estimate',
      'Route details always available as text, never map-only',
    ],
    state: 'In the beta',
  },
  {
    slug: 'progress',
    title: 'Progress you can interrogate',
    lead: 'Every number on the page can explain how it was worked out.',
    points: [
      'Load balance: this week against your recent average, with the formula shown',
      'Consistency measured only against sessions that have already come round',
      'Estimated one-rep max, and a blank where the estimate would be meaningless',
    ],
    state: 'In the beta',
  },
  {
    slug: 'community',
    title: 'Challenges and clubs',
    lead: 'Secondary to your training, and never sharing it without your say-so.',
    points: [
      'Challenges built on distance, sessions, minutes or climbing',
      'Clubs you join deliberately; private clubs are invisible to non-members',
      'No weight or body-composition competitions — the data model cannot express one',
    ],
    state: 'Optional in the beta',
  },
  {
    slug: 'coaching',
    title: 'Human coaching',
    lead: 'A coach who can see your training, once you let them.',
    points: [
      'Coach access is a separate consent, off by default',
      'Not open in this beta',
    ],
    state: 'After the beta',
  },
] as const;

export const PRIVACY_PROMISES = [
  ['Private by default', 'New accounts are followers-only, with routes private and activity starts and ends trimmed.'],
  ['Separate from your map', 'Raw GPS is stored where no sharing rule can reach it. Other people see a separate, sanitized line.'],
  ['Private zones', 'Draw a zone and anything inside it is removed from shared maps wherever it falls in the activity.'],
  ['Per-activity control', 'Visibility is a decision per activity, not one global switch you forget you set.'],
  ['Consent is granular', 'Coach access, analytics and future model training are four separate switches, all off to begin with.'],
] as const;
