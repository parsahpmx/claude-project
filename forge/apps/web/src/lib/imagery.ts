/**
 * Generated imagery.
 *
 * FORGE ships without a photography library, and a prototype that leans on
 * grey boxes reads as unfinished. Instead every image key deterministically
 * produces a layered, duotone, cinematic composition from its own characters:
 * the same key always renders the same image, different keys are visibly
 * different, and the palette stays inside the brand.
 *
 * When real photography exists, `Media` takes a `src` and this becomes the
 * fallback — the layout, aspect ratios and treatment do not change.
 */

export interface GeneratedImage {
  /** Layered CSS background, darkest first. */
  background: string;
  /** A hue rotation applied to the accent so cards in a grid differ. */
  accent: string;
  /** Descriptive alt text derived from the key, never "image". */
  tone: 'dark' | 'light';
}

const PALETTES: { base: [string, string]; accent: string; tone: 'dark' | 'light' }[] = [
  { base: ['#0B0B0C', '#241E1C'], accent: '#E8462B', tone: 'dark' },
  { base: ['#101014', '#1D2430'], accent: '#4A82C4', tone: 'dark' },
  { base: ['#0D0C0A', '#2A241A'], accent: '#D99A2B', tone: 'dark' },
  { base: ['#0A0F0C', '#18291F'], accent: '#3FA96B', tone: 'dark' },
  { base: ['#12100F', '#2E2320'], accent: '#FF6A4D', tone: 'dark' },
  { base: ['#E7E2DA', '#F5F2ED'], accent: '#E8462B', tone: 'light' },
];

function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function generateImage(key: string, variant: 'default' | 'light' = 'default'): GeneratedImage {
  const seed = hash(key);
  const palette = variant === 'light'
    ? PALETTES[PALETTES.length - 1]!
    : PALETTES[seed % (PALETTES.length - 1)]!;

  const angle = 20 + (seed % 8) * 15;
  const x1 = 12 + (seed % 60);
  const y1 = 10 + ((seed >> 3) % 55);
  const x2 = 55 + ((seed >> 6) % 40);
  const y2 = 45 + ((seed >> 9) % 45);
  const spread = 45 + ((seed >> 12) % 30);

  // Three layers: a soft accent bloom, a directional light sweep, and the base
  // gradient. Together they read as a lit subject rather than a flat fill.
  const background = [
    `radial-gradient(${spread}% ${spread + 15}% at ${x1}% ${y1}%, ${palette.accent}38 0%, transparent 68%)`,
    `radial-gradient(${spread + 10}% ${spread}% at ${x2}% ${y2}%, ${palette.base[1]}f0 0%, transparent 72%)`,
    `linear-gradient(${angle}deg, ${palette.base[0]} 0%, ${palette.base[1]} 58%, ${palette.base[0]} 100%)`,
  ].join(', ');

  return { background, accent: palette.accent, tone: palette.tone };
}

/** Human-readable alt text from an image key, for screen readers. */
export function describeImage(key: string, context?: string): string {
  const words = key.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return context ? `${context}: ${words}` : words;
}
