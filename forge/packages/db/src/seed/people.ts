import type { CoachSpecialty } from '@forge/core';

/**
 * People in the demo dataset.
 *
 * These are fictional. The coaches carry real, checkable-sounding
 * certifications because a marketplace where credentials are vague is a
 * marketplace nobody pays $149 a month to use — but no real person, brand or
 * organisation is depicted.
 */

export interface SeedCoach {
  slug: string;
  firstName: string;
  lastName: string;
  email: string;
  headline: string;
  bio: string;
  philosophy: string;
  specialties: CoachSpecialty[];
  languages: string[];
  certifications: string[];
  yearsExperience: number;
  ratingTenths: number;
  reviewCount: number;
  clientCount: number;
  availableSlots: number;
  monthlyPriceCents: number;
  consultationPriceCents: number;
  sessionPriceCents: number;
  imageKey: string;
}

export const COACHES: SeedCoach[] = [
  {
    slug: 'maya-roberts', firstName: 'Maya', lastName: 'Roberts', email: 'maya.roberts@forge.fit',
    headline: 'Strength & Conditioning Coach',
    bio: 'Eight years coaching general population lifters through their first barbell block and out the other side. I work mostly with people who have tried training on their own, got results for a while, and then stalled — usually because nobody ever taught them how to progress.',
    philosophy: 'The plan you follow beats the plan that is theoretically optimal. I would rather give you four sessions you will actually do than five you will resent by week three. Technique first, load second, and everything filmed until the position is automatic.',
    specialties: ['strength', 'hypertrophy', 'mobility'],
    languages: ['English'],
    certifications: ['MSc Strength & Conditioning', 'NSCA-CSCS', 'Level 3 Personal Training'],
    yearsExperience: 8, ratingTenths: 49, reviewCount: 214, clientCount: 428,
    availableSlots: 3, monthlyPriceCents: 14900, consultationPriceCents: 0, sessionPriceCents: 8500,
    imageKey: 'coach-maya',
  },
  {
    slug: 'daniel-okafor', firstName: 'Daniel', lastName: 'Okafor', email: 'daniel.okafor@forge.fit',
    headline: 'Head of Performance',
    bio: 'Twelve years in performance, six of them with field-sport athletes and the rest with people who want to train like one without the schedule of one. I specialise in concurrent training — getting strong and getting conditioned without one blunting the other.',
    philosophy: 'Sequencing is most of the job. Power before strength before conditioning, hard days away from hard days, and honesty about what you can recover from. Autoregulation is not a buzzword; it is how a plan survives a bad month at work.',
    specialties: ['strength', 'sport-performance', 'endurance'],
    languages: ['English', 'Yoruba'],
    certifications: ['MSc Sport Science', 'UKSCA Accredited', 'Level 2 Weightlifting'],
    yearsExperience: 12, ratingTenths: 49, reviewCount: 168, clientCount: 312,
    availableSlots: 2, monthlyPriceCents: 17900, consultationPriceCents: 0, sessionPriceCents: 9500,
    imageKey: 'coach-daniel',
  },
  {
    slug: 'sofia-lindqvist', firstName: 'Sofia', lastName: 'Lindqvist', email: 'sofia.lindqvist@forge.fit',
    headline: 'Performance Nutritionist & Coach',
    bio: 'I coach the training and the eating together, because splitting them across two people is how both end up half-followed. Ten years of practice, most of it with people managing body composition alongside a job that does not care about their meal timing.',
    philosophy: 'Sustainable beats fast, every time. I will not write you a deficit you cannot hold for twelve weeks, and I will not ask you to weigh food forever. We build two or three habits that survive a holiday and then we stop changing things.',
    specialties: ['fat-loss', 'nutrition', 'mobility', 'pre-post-natal'],
    languages: ['English', 'Swedish'],
    certifications: ['MSc Nutrition', 'SENr Registered', 'Pre & Post-Natal Certified'],
    yearsExperience: 10, ratingTenths: 48, reviewCount: 296, clientCount: 501,
    availableSlots: 5, monthlyPriceCents: 15900, consultationPriceCents: 0, sessionPriceCents: 8000,
    imageKey: 'coach-sofia',
  },
  {
    slug: 'amara-diallo', firstName: 'Amara', lastName: 'Diallo', email: 'amara.diallo@forge.fit',
    headline: 'Endurance Coach',
    bio: 'Eleven years coaching runners from first 5K to first marathon. I came to it from the other direction — I was the lifter who could not run a mile — so I have unusual patience with people who find running miserable at the start.',
    philosophy: 'Volume is earned, never assumed. Ten percent a week, strength work that stays in the plan when the mileage climbs, and a long run that moves to the day you will actually do it. Most running injuries are scheduling failures.',
    specialties: ['endurance', 'return-to-training', 'sport-performance'],
    languages: ['English', 'French'],
    certifications: ['UESCA Endurance Coach', 'England Athletics Level 3', 'BSc Sport Science'],
    yearsExperience: 11, ratingTenths: 48, reviewCount: 141, clientCount: 260,
    availableSlots: 0, monthlyPriceCents: 16900, consultationPriceCents: 0, sessionPriceCents: 8500,
    imageKey: 'coach-amara',
  },
  {
    slug: 'ines-navarro', firstName: 'Inés', lastName: 'Navarro', email: 'ines.navarro@forge.fit',
    headline: 'Movement & Rehabilitation Coach',
    bio: 'Physiotherapy background, now coaching full time. I work with people coming back — from injury, from surgery, from a decade of not training — and with lifters whose positions are limiting their numbers.',
    philosophy: 'Range you cannot control is not range. Everything we gain gets loaded, tested and kept. I will always refer out when something is clinical rather than mechanical; knowing the edge of your scope is part of coaching.',
    specialties: ['mobility', 'return-to-training', 'strength'],
    languages: ['English', 'Spanish'],
    certifications: ['BSc Physiotherapy', 'HCPC Registered', 'Level 3 Personal Training'],
    yearsExperience: 9, ratingTenths: 49, reviewCount: 98, clientCount: 187,
    availableSlots: 4, monthlyPriceCents: 15900, consultationPriceCents: 0, sessionPriceCents: 8500,
    imageKey: 'coach-ines',
  },
  {
    slug: 'kenji-watanabe', firstName: 'Kenji', lastName: 'Watanabe', email: 'kenji.watanabe@forge.fit',
    headline: 'Hybrid Performance Coach',
    bio: 'Seven years coaching hybrid athletes — people chasing a heavy lift and a fast time in the same block. Most of my clients are competitive amateurs with full-time jobs and no interest in choosing.',
    philosophy: 'Two goals is fine. Two goals with no plan for how they interact is not. I build the week around interference: what blunts what, how far apart it needs to be, and what to cut first when the week collapses.',
    specialties: ['sport-performance', 'endurance', 'hypertrophy'],
    languages: ['English', 'Japanese'],
    certifications: ['NSCA-CSCS', 'BSc Kinesiology', 'Level 2 Weightlifting'],
    yearsExperience: 7, ratingTenths: 47, reviewCount: 76, clientCount: 143,
    availableSlots: 6, monthlyPriceCents: 14900, consultationPriceCents: 0, sessionPriceCents: 7500,
    imageKey: 'coach-kenji',
  },
];

export interface SeedMember {
  firstName: string;
  lastName: string;
  email: string;
  goal: string;
  experience: 'beginner' | 'intermediate' | 'advanced';
  daysPerWeek: number;
  sessionMinutes: number;
  equipment: string[];
  diet: string;
  heightCm: number;
  weightKg: number;
  sexAtBirth: 'female' | 'male' | 'prefer-not-to-say';
  ageRange: string;
  tier: 'forge' | 'forge-pro' | 'forge-coach';
  coachSlug: string | null;
  avatarKey: string;
}

/** The first member is the demo account every screenshot and doc refers to. */
export const MEMBERS: SeedMember[] = [
  {
    firstName: 'Alex', lastName: 'Mercer', email: 'alex@forge.fit',
    goal: 'build-muscle', experience: 'intermediate', daysPerWeek: 5, sessionMinutes: 60,
    equipment: ['barbell', 'dumbbells', 'bench', 'rack', 'kettlebell', 'cardio-equipment'],
    diet: 'high-protein', heightCm: 180, weightKg: 82, sexAtBirth: 'male', ageRange: '25-34',
    tier: 'forge-coach', coachSlug: 'maya-roberts', avatarKey: 'member-alex',
  },
  {
    firstName: 'Priya', lastName: 'Anand', email: 'priya@forge.fit',
    goal: 'improve-strength', experience: 'beginner', daysPerWeek: 4, sessionMinutes: 50,
    equipment: ['barbell', 'dumbbells', 'bench', 'rack'],
    diet: 'vegetarian', heightCm: 164, weightKg: 61, sexAtBirth: 'female', ageRange: '25-34',
    tier: 'forge-coach', coachSlug: 'sofia-lindqvist', avatarKey: 'member-priya',
  },
  {
    firstName: 'Marcus', lastName: 'Bell', email: 'marcus@forge.fit',
    goal: 'improve-endurance', experience: 'beginner', daysPerWeek: 4, sessionMinutes: 40,
    equipment: ['bodyweight'],
    diet: 'balanced', heightCm: 178, weightKg: 88, sexAtBirth: 'male', ageRange: '35-44',
    tier: 'forge-pro', coachSlug: 'amara-diallo', avatarKey: 'member-marcus',
  },
  {
    firstName: 'Lena', lastName: 'Fischer', email: 'lena@forge.fit',
    goal: 'build-healthy-habits', experience: 'beginner', daysPerWeek: 3, sessionMinutes: 30,
    equipment: ['bodyweight', 'resistance-bands'],
    diet: 'balanced', heightCm: 170, weightKg: 68, sexAtBirth: 'female', ageRange: '35-44',
    tier: 'forge', coachSlug: null, avatarKey: 'member-lena',
  },
  {
    firstName: 'Tom', lastName: 'Okonkwo', email: 'tom@forge.fit',
    goal: 'train-for-competition', experience: 'advanced', daysPerWeek: 5, sessionMinutes: 60,
    equipment: ['full-gym'],
    diet: 'balanced', heightCm: 185, weightKg: 91, sexAtBirth: 'male', ageRange: '25-34',
    tier: 'forge-coach', coachSlug: 'daniel-okafor', avatarKey: 'member-tom',
  },
  {
    firstName: 'Yara', lastName: 'Haddad', email: 'yara@forge.fit',
    goal: 'lose-body-fat', experience: 'intermediate', daysPerWeek: 4, sessionMinutes: 45,
    equipment: ['dumbbells', 'kettlebell', 'bodyweight'],
    diet: 'pescatarian', heightCm: 167, weightKg: 74, sexAtBirth: 'female', ageRange: '35-44',
    tier: 'forge-pro', coachSlug: null, avatarKey: 'member-yara',
  },
  {
    firstName: 'Sam', lastName: 'Whitfield', email: 'sam@forge.fit',
    goal: 'improve-mobility', experience: 'beginner', daysPerWeek: 5, sessionMinutes: 20,
    equipment: ['bodyweight'],
    diet: 'balanced', heightCm: 175, weightKg: 79, sexAtBirth: 'prefer-not-to-say', ageRange: '45-54',
    tier: 'forge', coachSlug: null, avatarKey: 'member-sam',
  },
  {
    firstName: 'Noor', lastName: 'Rahman', email: 'noor@forge.fit',
    goal: 'build-muscle', experience: 'intermediate', daysPerWeek: 4, sessionMinutes: 60,
    equipment: ['dumbbells', 'bench', 'resistance-bands'],
    diet: 'high-protein', heightCm: 172, weightKg: 70, sexAtBirth: 'female', ageRange: '18-24',
    tier: 'forge-pro', coachSlug: null, avatarKey: 'member-noor',
  },
];

export interface SeedProduct {
  slug: string; name: string; category: string; summary: string; description: string;
  priceCents: number; compareAtCents: number | null; financingMonths: number;
  ratingTenths: number; reviewCount: number; specs: Record<string, string>;
  compatiblePrograms: string[]; goals: string[]; warranty: string; shipping: string;
  imageKey: string;
}

export const PRODUCTS: SeedProduct[] = [
  {
    slug: 'adjustable-dumbbell-set', name: 'Adjustable Dumbbell Set', category: 'Weights',
    summary: '2.5–32.5kg a side in a single pair. Replaces fifteen pairs of fixed dumbbells.',
    description: 'A dial-adjust pair covering 2.5kg to 32.5kg in 2.5kg increments — the exact jump size FORGE progression uses, so the plan never asks for a weight you cannot make. Steel plates, nylon-reinforced housing, and a footprint under half a square metre with the tray.',
    priceCents: 74900, compareAtCents: 89900, financingMonths: 12,
    ratingTenths: 48, reviewCount: 1284,
    specs: { 'Weight range': '2.5–32.5 kg per dumbbell', Increment: '2.5 kg', Material: 'Cast steel with nylon housing', 'Tray dimensions': '78 × 42 × 24 cm', Weight: '68 kg (pair with tray)' },
    compatiblePrograms: ['muscle-builder', 'fat-loss-engine', 'functional-fitness', 'womens-strength', 'beginner-foundation'],
    goals: ['build-muscle', 'lose-body-fat', 'improve-strength'],
    warranty: '5-year mechanism, 2-year housing', shipping: 'Free delivery, 3–5 working days',
    imageKey: 'product-dumbbells',
  },
  {
    slug: 'olympic-barbell', name: 'Olympic Training Barbell', category: 'Weights',
    summary: '20kg, 190k PSI tensile, dual knurl marks for powerlifting and weightlifting.',
    description: 'A bar that will outlast the house. Bronze bushings, moderate knurl that does not shred your hands on high-rep sets, and both knurl marks so it works for a snatch and a bench press.',
    priceCents: 32900, compareAtCents: null, financingMonths: 6,
    ratingTenths: 49, reviewCount: 642,
    specs: { Weight: '20 kg', 'Tensile strength': '190,000 PSI', Shaft: '28.5 mm', Sleeves: 'Bronze bushing', Knurl: 'Dual marks, no centre knurl' },
    compatiblePrograms: ['muscle-builder', 'strength-foundation', 'womens-strength', 'athletic-performance', 'hybrid-athlete'],
    goals: ['improve-strength', 'build-muscle', 'train-for-competition'],
    warranty: 'Lifetime against bending under rated load', shipping: 'Free delivery, 5–7 working days',
    imageKey: 'product-barbell',
  },
  {
    slug: 'squat-rack', name: 'Compact Squat Rack', category: 'Benches & Racks',
    summary: 'Full-height rack with safeties and a pull-up bar, in a 1.2m footprint.',
    description: 'Designed for garages and spare rooms where a full cage will not fit. Laser-cut numbered uprights so you can find your position instantly, safeties rated to 300kg, and a knurled pull-up bar across the top.',
    priceCents: 59900, compareAtCents: 69900, financingMonths: 12,
    ratingTenths: 47, reviewCount: 388,
    specs: { Height: '215 cm', Footprint: '120 × 110 cm', Steel: '60 × 60 mm, 2.5 mm wall', 'Safety rating': '300 kg', Holes: '50 mm spacing, numbered' },
    compatiblePrograms: ['muscle-builder', 'strength-foundation', 'womens-strength', 'athletic-performance'],
    goals: ['improve-strength', 'build-muscle'],
    warranty: '10-year frame', shipping: 'Kerbside delivery, 7–10 working days',
    imageKey: 'product-rack',
  },
  {
    slug: 'adjustable-bench', name: 'Adjustable Bench', category: 'Benches & Racks',
    summary: 'Flat to 85°, no gap at incline, rated to 350kg.',
    description: 'The ladder-adjust design means no gap between pad and back rest at incline, which is the flaw that makes most home benches unusable for pressing. Firm pad, wide enough for stability, narrow enough for shoulder position.',
    priceCents: 27900, compareAtCents: null, financingMonths: 6,
    ratingTenths: 48, reviewCount: 517,
    specs: { Positions: 'Flat to 85° in 7 steps', 'Load rating': '350 kg', 'Pad width': '30 cm', 'Pad density': 'High-density foam, vinyl cover', Weight: '32 kg' },
    compatiblePrograms: ['muscle-builder', 'strength-foundation', 'womens-strength'],
    goals: ['build-muscle', 'improve-strength'],
    warranty: '5-year frame, 2-year upholstery', shipping: 'Free delivery, 3–5 working days',
    imageKey: 'product-bench',
  },
  {
    slug: 'kettlebell-set', name: 'Cast Iron Kettlebell Set', category: 'Weights',
    summary: '12kg, 16kg and 24kg — the three that cover swings, presses and carries.',
    description: 'Single-cast iron with a powder coat that holds chalk without tearing your hands. Handle diameter is consistent across the three so the transition between them does not change your grip.',
    priceCents: 24900, compareAtCents: 29900, financingMonths: 0,
    ratingTenths: 49, reviewCount: 431,
    specs: { Weights: '12 kg, 16 kg, 24 kg', Construction: 'Single-cast iron', Coating: 'Powder coat', 'Handle diameter': '35 mm', 'Handle width': '210 mm' },
    compatiblePrograms: ['fat-loss-engine', 'functional-fitness', 'bodyweight-strength'],
    goals: ['lose-body-fat', 'build-healthy-habits', 'improve-strength'],
    warranty: '10-year', shipping: 'Free delivery, 3–5 working days',
    imageKey: 'product-kettlebells',
  },
  {
    slug: 'rowing-machine', name: 'Air Rowing Machine', category: 'Cardio',
    summary: 'Air resistance, folding frame, and a monitor that talks to FORGE.',
    description: 'Ten-position damper, a performance monitor that streams stroke rate and split to the FORGE workout player over Bluetooth, and a frame that separates into two pieces for storage.',
    priceCents: 89900, compareAtCents: 99900, financingMonths: 24,
    ratingTenths: 48, reviewCount: 276,
    specs: { Resistance: 'Air, 10-position damper', Monitor: 'Bluetooth FTMS', 'Max user weight': '150 kg', Footprint: '244 × 61 cm', Storage: 'Separates into two parts' },
    compatiblePrograms: ['fat-loss-engine', 'hybrid-athlete', 'functional-fitness'],
    goals: ['improve-endurance', 'lose-body-fat'],
    warranty: '5-year frame, 2-year monitor', shipping: 'Free delivery, 7–10 working days',
    imageKey: 'product-rower',
  },
  {
    slug: 'resistance-band-set', name: 'Resistance Band Set', category: 'Accessories',
    summary: 'Five loops from 5kg to 55kg assistance, plus a door anchor.',
    description: 'Layered latex, not moulded, so they stretch further before they fail. The set covers pull-up assistance, band rows, pallof presses and warm-up work — the accessories a travel week needs.',
    priceCents: 5900, compareAtCents: null, financingMonths: 0,
    ratingTenths: 47, reviewCount: 1893,
    specs: { Bands: '5 loops', Range: '5–55 kg assistance', Material: 'Layered natural latex', Included: 'Door anchor, carry bag' },
    compatiblePrograms: ['bodyweight-strength', 'beginner-foundation', 'mobility-reset', 'womens-strength'],
    goals: ['build-healthy-habits', 'improve-mobility', 'improve-strength'],
    warranty: '1-year', shipping: 'Free delivery, 2–3 working days',
    imageKey: 'product-bands',
  },
  {
    slug: 'recovery-mat', name: 'Recovery & Mobility Mat', category: 'Recovery',
    summary: '8mm, 190cm long, with alignment markings for mobility work.',
    description: 'Long enough that a 190cm person is not hanging off the end during a supine sequence. Faint alignment lines make positional work checkable without a mirror.',
    priceCents: 7900, compareAtCents: null, financingMonths: 0,
    ratingTenths: 48, reviewCount: 724,
    specs: { Dimensions: '190 × 68 cm', Thickness: '8 mm', Material: 'TPE, closed cell', Weight: '1.4 kg' },
    compatiblePrograms: ['mobility-reset', 'bodyweight-strength', 'beginner-foundation'],
    goals: ['improve-mobility', 'build-healthy-habits'],
    warranty: '2-year', shipping: 'Free delivery, 2–3 working days',
    imageKey: 'product-mat',
  },
  {
    slug: 'massage-gun', name: 'Percussive Massage Device', category: 'Recovery',
    summary: 'Five speeds, four heads, and quiet enough to use while somebody is asleep.',
    description: 'Brushless motor at 42dB, six-hour battery, and a pressure sensor that tells you when you are leaning on it hard enough to matter. Four heads for different tissue depths.',
    priceCents: 18900, compareAtCents: 22900, financingMonths: 6,
    ratingTenths: 46, reviewCount: 512,
    specs: { Speeds: '5 (1750–2800 rpm)', Noise: '42 dB', Battery: '6 hours', Heads: '4', Weight: '0.9 kg' },
    compatiblePrograms: ['mobility-reset', 'marathon-performance', 'hybrid-athlete'],
    goals: ['improve-mobility', 'improve-endurance'],
    warranty: '2-year', shipping: 'Free delivery, 2–3 working days',
    imageKey: 'product-massage-gun',
  },
  {
    slug: 'home-gym-starter-bundle', name: 'Home Gym Starter Bundle', category: 'Bundles',
    summary: 'Adjustable dumbbells, bench, bands and mat. Everything Beginner Foundation asks for.',
    description: 'The four items that unlock the largest number of FORGE programmes for the smallest footprint. Buying the bundle saves £180 against the items separately, and every programme it unlocks is listed on the product page rather than implied.',
    priceCents: 99900, compareAtCents: 116600, financingMonths: 24,
    ratingTenths: 49, reviewCount: 341,
    specs: { Includes: 'Adjustable dumbbells, adjustable bench, band set, recovery mat', 'Space needed': '2 × 2 m', 'Programmes unlocked': '9 of 12' },
    compatiblePrograms: ['muscle-builder', 'fat-loss-engine', 'functional-fitness', 'womens-strength', 'beginner-foundation', 'bodyweight-strength', 'mobility-reset'],
    goals: ['build-muscle', 'lose-body-fat', 'build-healthy-habits', 'improve-strength'],
    warranty: 'As per individual items', shipping: 'Free delivery, 5–7 working days',
    imageKey: 'product-bundle',
  },
  {
    slug: 'strength-bundle', name: 'Barbell Strength Bundle', category: 'Bundles',
    summary: 'Rack, barbell, bench and 150kg of plates.',
    description: 'A complete barbell setup for Strength Foundation and Muscle Builder. Plates are calibrated rubber-coated so a 2.5kg jump is genuinely 2.5kg and your floor survives.',
    priceCents: 189900, compareAtCents: 214600, financingMonths: 24,
    ratingTenths: 49, reviewCount: 156,
    specs: { Includes: 'Squat rack, Olympic barbell, adjustable bench, 150 kg plates', 'Space needed': '2.5 × 2 m', 'Ceiling height': '2.3 m minimum' },
    compatiblePrograms: ['muscle-builder', 'strength-foundation', 'womens-strength', 'athletic-performance', 'hybrid-athlete'],
    goals: ['improve-strength', 'build-muscle', 'train-for-competition'],
    warranty: 'As per individual items', shipping: 'Kerbside delivery, 10–14 working days',
    imageKey: 'product-strength-bundle',
  },
  {
    slug: 'heart-rate-strap', name: 'Chest Heart Rate Strap', category: 'Accessories',
    summary: 'Bluetooth and ANT+, pairs directly with the FORGE workout player.',
    description: 'Chest straps remain more accurate than wrist optical during resistance training, where wrist flexion breaks the optical signal. This one pairs to the FORGE player and to your watch simultaneously.',
    priceCents: 7900, compareAtCents: null, financingMonths: 0,
    ratingTenths: 47, reviewCount: 964,
    specs: { Connectivity: 'Bluetooth LE + ANT+', Battery: '400 hours, CR2032', 'Water rating': 'IPX7', Strap: 'Washable, 60–90 cm' },
    compatiblePrograms: ['fat-loss-engine', 'hybrid-athlete', '5k-builder', 'marathon-performance'],
    goals: ['improve-endurance', 'lose-body-fat'],
    warranty: '2-year', shipping: 'Free delivery, 2–3 working days',
    imageKey: 'product-hr-strap',
  },
];
