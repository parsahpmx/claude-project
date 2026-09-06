import type { Config } from 'tailwindcss';

/**
 * FORGE Web design tokens.
 *
 * Dark-first. The product is a instrument you read in a gym or on a phone in
 * daylight, and it sits on top of map tiles for a good part of its life, so the
 * ground is ink and the accent has to survive being drawn over terrain.
 *
 * On the accent: FORGE's previous accent was a red-orange close enough to a
 * well-known competitor's to read as borrowed. This one is a signal lime. It
 * clears 13.5:1 against ink as text AND as a surface with ink text on top, it
 * reads clearly over the greens, greys and blues of a map, and nobody will
 * mistake it for anyone else's brand.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Grounds
        ink: {
          DEFAULT: '#0B0B0C',
          900: '#0B0B0C',  // page
          800: '#141417',  // raised card
          700: '#1C1C21',  // hover / input
          600: '#26262C',  // border on dark
        },
        bone: {
          DEFAULT: '#F4F2ED',
          100: '#FBFAF7',
          200: '#F4F2ED',
          300: '#E6E2DA',
        },
        // Secondary text. Real colours, never opacity — 7.2:1 on ink-900.
        smoke: {
          400: '#9C9CA4',
          500: '#5A5A62',  // for the rare light surface
        },
        // The single accent.
        signal: {
          DEFAULT: '#B8E62E',
          400: '#CDF060',
          500: '#B8E62E',
          600: '#96BE1E',
          // For the rare light surface, where lime on bone would be unreadable.
          ink: '#4A6209',
        },
        // Status. Never the only carrier of meaning.
        state: {
          good: '#4ADE80',
          warn: '#FBBF24',
          bad:  '#F87171',
          info: '#7DD3FC',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // One scale, used everywhere. §11.
        hero:      ['clamp(2.5rem, 6vw, 5rem)',    { lineHeight: '0.95', letterSpacing: '-0.03em', fontWeight: '700' }],
        display:   ['clamp(2rem, 4vw, 3.25rem)',   { lineHeight: '1.0',  letterSpacing: '-0.025em', fontWeight: '700' }],
        'page-title': ['clamp(1.5rem, 2.5vw, 2rem)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '650' }],
        'section':  ['1.125rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        'card-title': ['0.9375rem', { lineHeight: '1.35', fontWeight: '600' }],
        body:      ['0.9375rem', { lineHeight: '1.6' }],
        secondary: ['0.8125rem', { lineHeight: '1.5' }],
        caption:   ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.08em' }],
        'metric-xl': ['clamp(2.25rem, 4vw, 3rem)', { lineHeight: '1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'metric-l':  ['1.75rem', { lineHeight: '1', letterSpacing: '-0.015em', fontWeight: '650' }],
        button:    ['0.8125rem', { lineHeight: '1', letterSpacing: '0.04em', fontWeight: '600' }],
      },
      borderRadius: { card: '12px', pill: '999px', control: '8px' },
      maxWidth: { shell: '1440px', content: '1160px', prose: '68ch' },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.30)',
        lift: '0 12px 32px rgb(0 0 0 / 0.40)',
        // Map overlays sit on imagery, so they need a real edge.
        overlay: '0 4px 24px rgb(0 0 0 / 0.55)',
      },
      transitionTimingFunction: { forge: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      screens: { xs: '390px', sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1440px' },
    },
  },
  plugins: [],
} satisfies Config;
