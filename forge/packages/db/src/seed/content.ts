/**
 * Editorial seed content.
 *
 * Every recipe, article, product and recovery session below is written as
 * finished copy. There is no Lorem Ipsum anywhere in FORGE: placeholder text
 * hides exactly the problems — a heading that does not fit, a card that needs
 * three lines, a claim nobody wants to sign off — that you build a prototype
 * to find.
 */

export interface SeedIngredient {
  name: string;
  quantity: number;
  unit: string;
  section: 'produce' | 'protein' | 'dairy' | 'pantry' | 'frozen' | 'other';
}

export interface SeedRecipe {
  slug: string;
  name: string;
  summary: string;
  slot: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: 'easy' | 'moderate' | 'advanced';
  servings: number;
  tags: string[];
  instructions: string[];
  ingredients: SeedIngredient[];
  imageKey: string;
}

export const RECIPES: SeedRecipe[] = [
  {
    slug: 'steak-and-sweet-potato-hash', name: 'Steak & Sweet Potato Hash',
    summary: 'A post-training plate built around 48g of protein and enough carbohydrate to refill what the session used.',
    slot: 'dinner', calories: 640, protein: 48, carbs: 52, fat: 24, fibre: 8,
    prepMinutes: 10, cookMinutes: 20, difficulty: 'easy', servings: 2,
    tags: ['high-protein', 'gluten-free', 'dairy-free'],
    instructions: [
      'Dice the sweet potato into 2cm cubes and roast at 200°C for 20 minutes until the edges catch.',
      'Season the steak generously and rest it at room temperature while the potato roasts.',
      'Sear the steak 3 minutes a side for medium-rare, then rest it for 5 minutes before slicing against the grain.',
      'Wilt the spinach in the steak pan with the garlic, scraping up everything left behind.',
      'Combine, finish with olive oil and flaked salt, and serve immediately.',
    ],
    ingredients: [
      { name: 'Sirloin steak', quantity: 300, unit: 'g', section: 'protein' },
      { name: 'Sweet potato', quantity: 400, unit: 'g', section: 'produce' },
      { name: 'Baby spinach', quantity: 100, unit: 'g', section: 'produce' },
      { name: 'Garlic cloves', quantity: 2, unit: 'clove', section: 'produce' },
      { name: 'Olive oil', quantity: 2, unit: 'tbsp', section: 'pantry' },
    ],
    imageKey: 'steak-hash',
  },
  {
    slug: 'high-protein-overnight-oats', name: 'High-Protein Overnight Oats',
    summary: 'Assembled in four minutes the night before. 34g of protein waiting for you at 6am.',
    slot: 'breakfast', calories: 480, protein: 34, carbs: 58, fat: 12, fibre: 10,
    prepMinutes: 5, cookMinutes: 0, difficulty: 'easy', servings: 1,
    tags: ['high-protein', 'vegetarian'],
    instructions: [
      'Combine the oats, milk, yoghurt and protein powder in a jar and stir until no dry pockets remain.',
      'Fold through the berries and chia seeds.',
      'Refrigerate overnight, at least six hours.',
      'Top with almond butter in the morning and eat straight from the jar.',
    ],
    ingredients: [
      { name: 'Rolled oats', quantity: 80, unit: 'g', section: 'pantry' },
      { name: 'Greek yoghurt', quantity: 150, unit: 'g', section: 'dairy' },
      { name: 'Semi-skimmed milk', quantity: 120, unit: 'ml', section: 'dairy' },
      { name: 'Whey protein powder', quantity: 25, unit: 'g', section: 'pantry' },
      { name: 'Mixed berries', quantity: 100, unit: 'g', section: 'frozen' },
      { name: 'Chia seeds', quantity: 1, unit: 'tbsp', section: 'pantry' },
      { name: 'Almond butter', quantity: 1, unit: 'tbsp', section: 'pantry' },
    ],
    imageKey: 'overnight-oats',
  },
  {
    slug: 'chicken-rice-bowl', name: 'Coriander Chicken Rice Bowl',
    summary: 'The meal-prep default: five minutes to assemble, 52g of protein, holds in the fridge for three days.',
    slot: 'lunch', calories: 620, protein: 52, carbs: 64, fat: 16, fibre: 7,
    prepMinutes: 15, cookMinutes: 15, difficulty: 'easy', servings: 2,
    tags: ['high-protein', 'gluten-free', 'dairy-free'],
    instructions: [
      'Marinate the chicken in lime, coriander stalks, cumin and olive oil for as long as you have.',
      'Cook the rice with a pinch of salt and a bay leaf.',
      'Grill the chicken 6 minutes a side until the juices run clear, then rest and slice.',
      'Build the bowl: rice, chicken, black beans, avocado, coriander leaves and a squeeze of lime.',
    ],
    ingredients: [
      { name: 'Chicken breast', quantity: 400, unit: 'g', section: 'protein' },
      { name: 'Basmati rice', quantity: 150, unit: 'g', section: 'pantry' },
      { name: 'Black beans', quantity: 240, unit: 'g', section: 'pantry' },
      { name: 'Avocado', quantity: 1, unit: 'whole', section: 'produce' },
      { name: 'Fresh coriander', quantity: 1, unit: 'bunch', section: 'produce' },
      { name: 'Limes', quantity: 2, unit: 'whole', section: 'produce' },
    ],
    imageKey: 'chicken-bowl',
  },
  {
    slug: 'salmon-greens-quinoa', name: 'Salmon, Greens & Quinoa',
    summary: 'Omega-3s, 40g of protein and enough fibre to keep the afternoon steady.',
    slot: 'dinner', calories: 580, protein: 40, carbs: 44, fat: 26, fibre: 9,
    prepMinutes: 10, cookMinutes: 18, difficulty: 'easy', servings: 2,
    tags: ['pescatarian', 'gluten-free', 'dairy-free', 'high-protein'],
    instructions: [
      'Rinse the quinoa and simmer in twice its volume of stock for 15 minutes.',
      'Roast the salmon skin-side up at 200°C for 12 minutes.',
      'Blanch the broccoli and green beans for 3 minutes, then shock in cold water to hold the colour.',
      'Dress everything with lemon, olive oil and plenty of black pepper.',
    ],
    ingredients: [
      { name: 'Salmon fillet', quantity: 300, unit: 'g', section: 'protein' },
      { name: 'Quinoa', quantity: 120, unit: 'g', section: 'pantry' },
      { name: 'Tenderstem broccoli', quantity: 200, unit: 'g', section: 'produce' },
      { name: 'Green beans', quantity: 150, unit: 'g', section: 'produce' },
      { name: 'Lemon', quantity: 1, unit: 'whole', section: 'produce' },
      { name: 'Vegetable stock', quantity: 400, unit: 'ml', section: 'pantry' },
    ],
    imageKey: 'salmon-quinoa',
  },
  {
    slug: 'lentil-walnut-ragu', name: 'Lentil & Walnut Ragù',
    summary: 'A vegan ragù with 26g of protein a serving that genuinely holds its own against the meat version.',
    slot: 'dinner', calories: 560, protein: 26, carbs: 72, fat: 18, fibre: 16,
    prepMinutes: 15, cookMinutes: 35, difficulty: 'moderate', servings: 4,
    tags: ['vegan', 'vegetarian', 'dairy-free'],
    instructions: [
      'Build a soffritto with onion, carrot and celery over a low heat for 12 minutes — do not rush this part.',
      'Add the tomato purée and cook it out for two minutes until it darkens.',
      'Add the lentils, chopped tomatoes, walnuts and stock. Simmer 25 minutes.',
      'Season hard at the end with salt, black pepper and a splash of red wine vinegar.',
      'Serve over wholewheat pasta.',
    ],
    ingredients: [
      { name: 'Green lentils', quantity: 250, unit: 'g', section: 'pantry' },
      { name: 'Chopped tomatoes', quantity: 800, unit: 'g', section: 'pantry' },
      { name: 'Walnuts', quantity: 80, unit: 'g', section: 'pantry' },
      { name: 'Onion', quantity: 1, unit: 'whole', section: 'produce' },
      { name: 'Carrot', quantity: 2, unit: 'whole', section: 'produce' },
      { name: 'Celery', quantity: 2, unit: 'stick', section: 'produce' },
      { name: 'Wholewheat pasta', quantity: 400, unit: 'g', section: 'pantry' },
    ],
    imageKey: 'lentil-ragu',
  },
  {
    slug: 'cottage-cheese-toast', name: 'Whipped Cottage Cheese Toast',
    summary: 'Thirty seconds of blending turns cottage cheese into something you will actually look forward to.',
    slot: 'breakfast', calories: 420, protein: 32, carbs: 40, fat: 14, fibre: 6,
    prepMinutes: 5, cookMinutes: 3, difficulty: 'easy', servings: 1,
    tags: ['vegetarian', 'high-protein'],
    instructions: [
      'Blend the cottage cheese with a pinch of salt until completely smooth — about 30 seconds.',
      'Toast the sourdough hard.',
      'Spread thickly, top with sliced tomato, chilli flakes and olive oil.',
    ],
    ingredients: [
      { name: 'Cottage cheese', quantity: 200, unit: 'g', section: 'dairy' },
      { name: 'Sourdough bread', quantity: 2, unit: 'slice', section: 'pantry' },
      { name: 'Tomatoes', quantity: 2, unit: 'whole', section: 'produce' },
      { name: 'Chilli flakes', quantity: 1, unit: 'tsp', section: 'pantry' },
    ],
    imageKey: 'cottage-toast',
  },
  {
    slug: 'tofu-peanut-noodles', name: 'Crispy Tofu Peanut Noodles',
    summary: 'Vegan, 28g of protein, and on the table in twenty minutes.',
    slot: 'lunch', calories: 610, protein: 28, carbs: 68, fat: 24, fibre: 9,
    prepMinutes: 12, cookMinutes: 12, difficulty: 'moderate', servings: 2,
    tags: ['vegan', 'vegetarian', 'dairy-free'],
    instructions: [
      'Press the tofu for ten minutes, cube it, toss in cornflour and fry until every side is golden.',
      'Whisk peanut butter, soy sauce, lime juice, maple syrup and hot water into a pourable sauce.',
      'Cook the noodles, then toss with the sauce, tofu, spring onion and cucumber.',
    ],
    ingredients: [
      { name: 'Firm tofu', quantity: 400, unit: 'g', section: 'protein' },
      { name: 'Rice noodles', quantity: 200, unit: 'g', section: 'pantry' },
      { name: 'Peanut butter', quantity: 3, unit: 'tbsp', section: 'pantry' },
      { name: 'Soy sauce', quantity: 2, unit: 'tbsp', section: 'pantry' },
      { name: 'Spring onions', quantity: 4, unit: 'whole', section: 'produce' },
      { name: 'Cucumber', quantity: 1, unit: 'whole', section: 'produce' },
    ],
    imageKey: 'tofu-noodles',
  },
  {
    slug: 'protein-yoghurt-bark', name: 'Frozen Protein Yoghurt Bark',
    summary: 'Make a tray on Sunday, snap off a piece whenever the 4pm craving lands.',
    slot: 'snack', calories: 210, protein: 18, carbs: 20, fat: 7, fibre: 3,
    prepMinutes: 8, cookMinutes: 0, difficulty: 'easy', servings: 6,
    tags: ['vegetarian', 'high-protein', 'gluten-free'],
    instructions: [
      'Stir the protein powder through the yoghurt until fully dissolved.',
      'Spread 1cm thick on a lined tray.',
      'Scatter berries and dark chocolate, then freeze for four hours.',
      'Snap into pieces and keep frozen.',
    ],
    ingredients: [
      { name: 'Greek yoghurt', quantity: 500, unit: 'g', section: 'dairy' },
      { name: 'Whey protein powder', quantity: 40, unit: 'g', section: 'pantry' },
      { name: 'Mixed berries', quantity: 150, unit: 'g', section: 'frozen' },
      { name: 'Dark chocolate', quantity: 40, unit: 'g', section: 'pantry' },
    ],
    imageKey: 'yoghurt-bark',
  },
  {
    slug: 'turkey-chilli', name: 'Smoked Turkey Chilli',
    summary: 'Batch-cook six portions in forty minutes. Better on day two.',
    slot: 'dinner', calories: 520, protein: 45, carbs: 48, fat: 14, fibre: 14,
    prepMinutes: 12, cookMinutes: 40, difficulty: 'easy', servings: 6,
    tags: ['high-protein', 'gluten-free', 'dairy-free'],
    instructions: [
      'Brown the turkey mince hard in batches — crowding the pan steams it.',
      'Soften onion and pepper, then add smoked paprika, cumin and chipotle and cook for a minute.',
      'Return the turkey with tomatoes, beans and stock. Simmer 30 minutes uncovered.',
      'Finish with lime and fresh coriander.',
    ],
    ingredients: [
      { name: 'Turkey mince', quantity: 750, unit: 'g', section: 'protein' },
      { name: 'Kidney beans', quantity: 400, unit: 'g', section: 'pantry' },
      { name: 'Chopped tomatoes', quantity: 800, unit: 'g', section: 'pantry' },
      { name: 'Red pepper', quantity: 2, unit: 'whole', section: 'produce' },
      { name: 'Onion', quantity: 1, unit: 'whole', section: 'produce' },
      { name: 'Smoked paprika', quantity: 2, unit: 'tsp', section: 'pantry' },
    ],
    imageKey: 'turkey-chilli',
  },
  {
    slug: 'egg-avocado-rye', name: 'Soft Eggs on Rye',
    summary: 'Six minutes, 26g of protein, and it holds you until lunch.',
    slot: 'breakfast', calories: 440, protein: 26, carbs: 34, fat: 22, fibre: 8,
    prepMinutes: 3, cookMinutes: 6, difficulty: 'easy', servings: 1,
    tags: ['vegetarian', 'high-protein', 'dairy-free'],
    instructions: [
      'Boil the eggs for exactly six and a half minutes, then straight into ice water.',
      'Toast the rye and mash the avocado onto it with lemon and salt.',
      'Halve the eggs over the top, season with pepper and chilli.',
    ],
    ingredients: [
      { name: 'Eggs', quantity: 3, unit: 'whole', section: 'protein' },
      { name: 'Rye bread', quantity: 2, unit: 'slice', section: 'pantry' },
      { name: 'Avocado', quantity: 1, unit: 'whole', section: 'produce' },
      { name: 'Lemon', quantity: 1, unit: 'whole', section: 'produce' },
    ],
    imageKey: 'eggs-rye',
  },
  {
    slug: 'chickpea-shakshuka', name: 'Chickpea Shakshuka',
    summary: 'One pan, vegetarian, and the kind of thing you make for people.',
    slot: 'lunch', calories: 490, protein: 24, carbs: 52, fat: 20, fibre: 15,
    prepMinutes: 8, cookMinutes: 22, difficulty: 'easy', servings: 2,
    tags: ['vegetarian', 'gluten-free'],
    instructions: [
      'Soften onion and pepper, then add cumin, paprika and garlic for one minute.',
      'Add tomatoes and chickpeas, simmer 12 minutes until thickened.',
      'Make four wells, crack in the eggs, cover and cook 6 minutes for soft yolks.',
      'Scatter feta and parsley to serve.',
    ],
    ingredients: [
      { name: 'Chickpeas', quantity: 400, unit: 'g', section: 'pantry' },
      { name: 'Chopped tomatoes', quantity: 400, unit: 'g', section: 'pantry' },
      { name: 'Eggs', quantity: 4, unit: 'whole', section: 'protein' },
      { name: 'Feta', quantity: 80, unit: 'g', section: 'dairy' },
      { name: 'Red pepper', quantity: 1, unit: 'whole', section: 'produce' },
      { name: 'Flat-leaf parsley', quantity: 1, unit: 'bunch', section: 'produce' },
    ],
    imageKey: 'shakshuka',
  },
  {
    slug: 'recovery-smoothie', name: 'Post-Session Recovery Smoothie',
    summary: '32g of protein and 45g of carbohydrate, drinkable within ten minutes of racking the bar.',
    slot: 'snack', calories: 380, protein: 32, carbs: 45, fat: 8, fibre: 6,
    prepMinutes: 3, cookMinutes: 0, difficulty: 'easy', servings: 1,
    tags: ['high-protein', 'vegetarian', 'gluten-free'],
    instructions: [
      'Blend everything with 250ml of cold water and a handful of ice for 45 seconds.',
      'Drink within ten minutes of finishing your session.',
    ],
    ingredients: [
      { name: 'Whey protein powder', quantity: 35, unit: 'g', section: 'pantry' },
      { name: 'Banana', quantity: 1, unit: 'whole', section: 'produce' },
      { name: 'Frozen mango', quantity: 100, unit: 'g', section: 'frozen' },
      { name: 'Oat milk', quantity: 200, unit: 'ml', section: 'dairy' },
      { name: 'Baby spinach', quantity: 40, unit: 'g', section: 'produce' },
    ],
    imageKey: 'recovery-smoothie',
  },
];

export interface SeedRecovery {
  slug: string; name: string; category: string; minutes: number;
  level: 'beginner' | 'intermediate' | 'advanced'; description: string;
  coachSlug: string | null; imageKey: string;
}

export const RECOVERY_SESSIONS: SeedRecovery[] = [
  { slug: '10-min-full-body-mobility', name: '10-Min Full Body Mobility', category: 'Mobility', minutes: 10, level: 'beginner', description: 'A daily reset covering hips, thoracic spine and shoulders. The one to do when you only have ten minutes.', coachSlug: 'sofia-lindqvist', imageKey: 'mobility-full' },
  { slug: 'pre-sleep-breathwork', name: 'Pre-Sleep Breathwork', category: 'Breathwork', minutes: 8, level: 'beginner', description: 'Extended exhale breathing to shift you out of sympathetic drive. Do it in bed with the lights off.', coachSlug: 'sofia-lindqvist', imageKey: 'breathwork-sleep' },
  { slug: 'hip-mobility', name: 'Hip Mobility', category: 'Mobility', minutes: 12, level: 'beginner', description: 'Targeted hip work for anyone whose squat depth is limited by position rather than strength.', coachSlug: 'maya-roberts', imageKey: 'mobility-hips' },
  { slug: 'post-run-recovery', name: 'Post-Run Recovery', category: 'Stretching', minutes: 12, level: 'beginner', description: 'Calves, hamstrings and hip flexors, in the order that matters after a long run.', coachSlug: 'amara-diallo', imageKey: 'recovery-run' },
  { slug: 'desk-reset', name: 'Desk Reset', category: 'Mobility', minutes: 6, level: 'beginner', description: 'Six minutes to undo four hours of sitting. No mat, no changing, do it beside your desk.', coachSlug: 'sofia-lindqvist', imageKey: 'desk-reset' },
  { slug: 'guided-meditation', name: 'Guided Meditation', category: 'Meditation', minutes: 15, level: 'beginner', description: 'A body-scan practice for the evening after a hard session, when your head will not switch off.', coachSlug: null, imageKey: 'meditation' },
  { slug: 'thoracic-opener', name: 'Thoracic Opener', category: 'Mobility', minutes: 9, level: 'intermediate', description: 'Upper-back rotation and extension work that makes overhead pressing feel like a different lift.', coachSlug: 'daniel-okafor', imageKey: 'thoracic' },
  { slug: 'deep-sleep-wind-down', name: 'Deep Sleep Wind-Down', category: 'Sleep', minutes: 20, level: 'beginner', description: 'A full pre-sleep protocol: light, temperature, breathing and a short body scan.', coachSlug: null, imageKey: 'sleep' },
  { slug: 'lower-body-flush', name: 'Lower Body Flush', category: 'Recovery Sessions', minutes: 14, level: 'beginner', description: 'Low-intensity movement and stretching for the day after heavy squats or deadlifts.', coachSlug: 'daniel-okafor', imageKey: 'lower-flush' },
  { slug: 'box-breathing-reset', name: 'Box Breathing Reset', category: 'Breathwork', minutes: 5, level: 'beginner', description: 'Four-count breathing to bring your heart rate down between meetings, or before a heavy top set.', coachSlug: null, imageKey: 'box-breathing' },
];

export interface SeedArticle {
  slug: string; title: string; category: string; excerpt: string; body: string;
  authorName: string; authorRole: string; readMinutes: number; featured: boolean;
  imageKey: string; publishedOn: string;
}

export const ARTICLES: SeedArticle[] = [
  {
    slug: 'progressive-overload-is-not-adding-weight',
    title: 'Progressive Overload Is Not Just Adding Weight',
    category: 'Training',
    excerpt: 'Load is the most obvious lever and the least available one. Four others move faster and break less.',
    body: 'Most people meet a plateau within eight weeks of starting, and almost all of them meet it because they only know one way to progress: put more on the bar.\n\nLoad is one of five variables. The other four — reps, sets, range of motion and tempo — are available every session, including the sessions where load is not.\n\nAdding a rep at the same load is progress. Adding a set is progress. Taking a squat two inches deeper is progress. Slowing a three-second eccentric to five is progress, and it is often the one that fixes the technique problem that stalled the load in the first place.\n\nFORGE programmes cycle these deliberately. Double progression takes reps to the top of a range before load moves at all, which is why your prescription sometimes reads "same weight, one more rep" — that is the plan working, not the plan stalling.',
    authorName: 'Maya Roberts', authorRole: 'Strength & Conditioning Coach', readMinutes: 6, featured: true,
    imageKey: 'article-overload', publishedOn: '2026-08-11',
  },
  {
    slug: 'how-much-protein',
    title: 'How Much Protein Do You Actually Need?',
    category: 'Nutrition',
    excerpt: 'The honest answer is a range, and most people are at the bottom of it without meaning to be.',
    body: 'The research converges on 1.6–2.2 g per kilogram of bodyweight per day for anyone training for strength or muscle. Below 1.6 you leave adaptation on the table. Above 2.2 the returns flatten hard.\n\nThat range widens in a deficit. When calories are low, protein does double duty — it drives adaptation and it protects the lean mass you already have — which is why FORGE raises the target to 2.2 g/kg on a fat-loss goal rather than lowering it.\n\nDistribution matters less than people think, but not zero. Four meals of 40g beats one meal of 160g, mostly because the second is unpleasant enough that you will stop doing it.\n\nPlant-forward diets need roughly 10% more to account for digestibility and amino acid profile. FORGE applies that automatically when you set a vegan or vegetarian preference.',
    authorName: 'Sofia Lindqvist', authorRole: 'Performance Nutritionist', readMinutes: 7, featured: true,
    imageKey: 'article-protein', publishedOn: '2026-08-04',
  },
  {
    slug: 'reading-your-readiness-score',
    title: 'What Your Readiness Score Is Actually Telling You',
    category: 'Recovery',
    excerpt: 'A number between 0 and 100 is only useful if you know which input moved and what to do about it.',
    body: 'Readiness in FORGE is a weighted blend of sleep, heart rate variability, resting heart rate and what you told us about soreness and stress. Each is scored against your own rolling baseline, not a population average.\n\nThat last part is what makes it usable. A resting heart rate of 58 means nothing on its own. A resting heart rate of 58 when yours has been 51 for a month means something specific.\n\nWhen the score drops, open the breakdown rather than the number. If sleep is the weak input, the answer is not a lighter session — it is an earlier night. If HRV has fallen while sleep held, the answer usually is a lighter session.\n\nAnd when the score is low three days running, that is not a bad week. That is a plan asking to be adjusted, and it is exactly when a coach earns their fee.',
    authorName: 'Daniel Okafor', authorRole: 'Head of Performance', readMinutes: 5, featured: false,
    imageKey: 'article-readiness', publishedOn: '2026-07-28',
  },
  {
    slug: 'zone-2-is-not-a-personality',
    title: 'Zone 2 Is Not a Personality',
    category: 'Running',
    excerpt: 'Easy running works. It does not work better because you did more of it than everybody else.',
    body: 'The polarised model is well supported: roughly 80% of aerobic volume easy, 20% hard. It is also widely misread as "only ever run slowly".\n\nThe 20% is not optional. It is where the ceiling moves. Cut it out and you get a very durable athlete who cannot go fast.\n\nThe practical test for zone 2 is conversational: you can speak in full sentences. If you cannot, you are in zone 3, which is the least useful place to spend an hour — too hard to recover from, too easy to drive adaptation.\n\nFORGE running plans set that split for you. If you have a heart rate strap connected, the player will tell you when you have drifted.',
    authorName: 'Amara Diallo', authorRole: 'Endurance Coach', readMinutes: 6, featured: false,
    imageKey: 'article-zone2', publishedOn: '2026-07-19',
  },
  {
    slug: 'the-week-you-do-not-feel-like-it',
    title: 'The Week You Do Not Feel Like It',
    category: 'Mindset',
    excerpt: 'Consistency is not motivation. It is what you have built for the weeks motivation is absent.',
    body: 'Every twelve-week block contains at least one week where you do not want to do any of it. Planning for that week is the difference between a programme you finish and a programme you abandon in week seven.\n\nThree things work. First, lower the bar rather than skipping: a 20-minute session you completed beats a 60-minute session you did not. Second, keep the time slot even if you shorten the session — the habit lives in the calendar, not in the enthusiasm. Third, tell somebody. A coach, a training partner, or the community feed.\n\nFORGE builds the first one in. Every session can be rebuilt to 20 or 30 minutes and the main lift survives the cut, because that is the part that keeps the block intact.',
    authorName: 'Maya Roberts', authorRole: 'Strength & Conditioning Coach', readMinutes: 4, featured: false,
    imageKey: 'article-mindset', publishedOn: '2026-07-10',
  },
  {
    slug: 'why-your-squat-stalls',
    title: 'Why Your Squat Stalls at the Same Weight Every Time',
    category: 'Strength',
    excerpt: 'It is almost never your legs.',
    body: 'A squat that fails at the same load across three separate blocks is usually failing for a positional reason, not a strength one.\n\nThe three most common: ankles that will not let the knee travel forward, a thoracic spine that cannot hold the bar without the chest dropping, and a brace that is set at the top and lost at the bottom.\n\nEach has a test. Knee-to-wall for the ankle. A supine thoracic extension for the upper back. And for the brace: film a set from the side and watch your ribcage at the turnaround.\n\nFix the position and the load moves without you training harder. That is why FORGE mobility work is loaded and specific rather than a generic stretching routine bolted onto the end of the session.',
    authorName: 'Daniel Okafor', authorRole: 'Head of Performance', readMinutes: 8, featured: false,
    imageKey: 'article-squat', publishedOn: '2026-06-30',
  },
  {
    slug: 'what-the-evidence-says-about-soreness',
    title: 'What the Evidence Says About Soreness',
    category: 'Science',
    excerpt: 'Delayed onset muscle soreness is a poor proxy for a good session, and a worse one for progress.',
    body: 'Soreness correlates with novelty and eccentric load far more than with training quality. A movement you have not done in six months will make you sore whether or not it was the right thing to do.\n\nWhat that means practically: do not use soreness to judge a session, and do not chase it. The best training block you ever run will produce less soreness in week ten than it did in week one, because you adapted — which was the point.\n\nSoreness is worth logging, which is why FORGE asks. It feeds readiness as one input among five, weighted at 15%. It is a signal, not a verdict.',
    authorName: 'Sofia Lindqvist', authorRole: 'Performance Nutritionist', readMinutes: 5, featured: false,
    imageKey: 'article-soreness', publishedOn: '2026-06-21',
  },
];

export interface SeedStory {
  slug: string; memberName: string; headline: string; startingGoal: string;
  programSlug: string; programName: string; timePeriod: string; consistency: string;
  coachSlug: string | null; story: string; outcomes: string[]; imageKey: string;
}

export const SUCCESS_STORIES: SeedStory[] = [
  {
    slug: 'priya-first-pull-up', memberName: 'Priya',
    headline: 'From band-assisted rows to three strict pull-ups',
    startingGoal: 'Build upper-body strength after two years away from training',
    programSlug: 'womens-strength', programName: "Women's Strength",
    timePeriod: '16 weeks', consistency: '91% of scheduled sessions', coachSlug: 'sofia-lindqvist',
    story: 'I had never been able to do a pull-up and had quietly decided I never would. The plan did not start with pull-ups — it started with inverted rows and band work for six weeks, which felt like nothing was happening. Week nine I got one. Week sixteen I got three. What actually changed was that I stopped skipping the boring accessory work.',
    outcomes: [
      'Three strict pull-ups from a dead hang, up from zero',
      'Deadlift progressed from 40kg to 82.5kg across sixteen weeks',
      'Trained 58 of 64 scheduled sessions',
    ],
    imageKey: 'story-priya',
  },
  {
    slug: 'marcus-back-to-running', memberName: 'Marcus',
    headline: 'A 5K time trial after a year of not running at all',
    startingGoal: 'Rebuild aerobic fitness without aggravating an old knee issue',
    programSlug: '5k-builder', programName: '5K Builder',
    timePeriod: '8 weeks', consistency: '87% of scheduled sessions', coachSlug: 'amara-diallo',
    story: 'The runner-strength day was the part I would have skipped on my own, and it is the reason my knee held up. Amara moved my long run to Saturday mornings after I missed two Sundays in a row, which sounds trivial and fixed the whole problem.',
    outcomes: [
      'Ran 5K continuously for the first time in fourteen months',
      'Improved time trial by 3:41 between week 1 and week 8',
      'No knee flare-ups across the full block',
    ],
    imageKey: 'story-marcus',
  },
  {
    slug: 'lena-consistency', memberName: 'Lena',
    headline: 'Thirty-one weeks of training around a newborn',
    startingGoal: 'Rebuild a training habit that fits an unpredictable schedule',
    programSlug: 'bodyweight-strength', programName: 'Bodyweight Strength',
    timePeriod: '31 weeks', consistency: '74% of scheduled sessions', coachSlug: null,
    story: 'I stopped trying to have good weeks and started trying to have no zero weeks. The 20-minute rebuild button is the single feature that kept me here — I used it more often than the full session, and it still added up.',
    outcomes: [
      'Longest streak of 41 days without a full week off',
      'Progressed from knee push-ups to twelve full push-ups',
      'Trained in 28 of 31 weeks',
    ],
    imageKey: 'story-lena',
  },
  {
    slug: 'tom-hybrid', memberName: 'Tom',
    headline: 'A 140kg squat and a sub-23 5K in the same block',
    startingGoal: 'Stop choosing between lifting and running',
    programSlug: 'hybrid-athlete', programName: 'Hybrid Athlete',
    timePeriod: '12 weeks', consistency: '95% of scheduled sessions', coachSlug: 'daniel-okafor',
    story: 'I had done both badly for years by doing them on the same days. The sequencing in this plan is the whole trick — the hard run is never within 24 hours of the heavy squat, and everything got better immediately.',
    outcomes: [
      'Back squat from 122.5kg to 140kg',
      '5K from 24:52 to 22:48',
      'Held both improvements through a deload and a travel week',
    ],
    imageKey: 'story-tom',
  },
];
