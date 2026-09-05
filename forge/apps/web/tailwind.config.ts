import type { Config } from 'tailwindcss';

/**
 * FORGE design tokens.
 *
 * The palette is deliberately narrow: an editorial near-black, a warm
 * off-white, four greys and exactly one accent. A single accent is what makes
 * "this is the thing to press" legible on every screen without a legend, and
 * it is why the product does not look like a dashboard template.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0B0B0C',
          900: '#0B0B0C',
          800: '#121214',
          700: '#1A1A1D',
          600: '#242429',
          500: '#31313A',
        },
        bone: {
          DEFAULT: '#F5F2ED',
          100: '#FBFAF8',
          200: '#F5F2ED',
          300: '#E7E2DA',
          400: '#D2CCC2',
        },
        // Secondary text, not decoration. Every value here clears 4.5:1 against
        // the ground it is used on — smoke-500 on the bone family, smoke-400 on
        // the ink family — so secondary copy is never merely dimmer, it stays
        // readable. Opacity is not an accessible substitute for these.
        smoke: {
          400: '#9C9CA4',
          500: '#5C5C64',
          600: '#47474E',
        },
        // One accent, three jobs. 500 is the brand red and is used for graphics,
        // display type and focus rings, where 3:1 is the bar. 600 is the only
        // one allowed under small text — as a surface it clears 4.5:1 with
        // bone-100 on top, and as text it clears 4.5:1 on the bone family.
        // 400 is the dark-surface variant, since 600 goes muddy on ink.
        ember: {
          DEFAULT: '#E8462B',
          400: '#FF6A4D',
          500: '#E8462B',
          600: '#C4351E',
          700: '#A32A15',
        },
        // Status colours are never the only signal — every state also carries
        // an icon or a word. See docs/ACCESSIBILITY.md.
        signal: {
          good: '#3FA96B',
          warn: '#D99A2B',
          bad: '#D9453B',
          info: '#4A82C4',
          // The same four hues darkened until they clear 4.5:1 as text on both
          // bone-100 and their own tinted badge grounds. The bright values above
          // stay for dots, bars and chart fills, which only owe 3:1.
          'good-ink': '#2A7449',
          'warn-ink': '#7D5813',
          'bad-ink': '#A32F27',
          'info-ink': '#33598A',
          // And lightened for text on ink. A badge tints its own ground with its
          // own hue, which costs about a quarter point: signal-bad reaches only
          // 4.07:1 on a bad-tinted ink-800. These clear 4.5:1 on ink-800,
          // ink-900 and both tints.
          'good-on-ink': '#4FBF7D',
          'warn-on-ink': '#E5AC45',
          'bad-on-ink': '#E8635A',
          'info-on-ink': '#6199D6',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Impact', 'Haettenschweiler', 'Arial Narrow Bold', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        'display-xl': ['clamp(2.75rem, 11vw, 9.5rem)', { lineHeight: '0.86', letterSpacing: '-0.03em', fontWeight: '800' }],
        'display-lg': ['clamp(2.25rem, 7vw, 6rem)', { lineHeight: '0.9', letterSpacing: '-0.025em', fontWeight: '800' }],
        'display-md': ['clamp(1.75rem, 4.5vw, 3.5rem)', { lineHeight: '0.95', letterSpacing: '-0.02em', fontWeight: '800' }],
        'display-sm': ['clamp(1.5rem, 3vw, 2.25rem)', { lineHeight: '1.02', letterSpacing: '-0.015em', fontWeight: '700' }],
        eyebrow: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.18em', fontWeight: '600' }],
      },
      borderRadius: {
        card: '14px',
        pill: '999px',
      },
      boxShadow: {
        // Restrained: two shadows, both low-contrast. Elevation is communicated
        // by border and background before it is communicated by shadow.
        card: '0 1px 2px rgba(11,11,12,0.04), 0 8px 24px -12px rgba(11,11,12,0.18)',
        lift: '0 2px 4px rgba(11,11,12,0.06), 0 18px 40px -18px rgba(11,11,12,0.28)',
      },
      transitionTimingFunction: {
        forge: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'sweep-in': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.92)', opacity: '0.7' },
          '70%': { transform: 'scale(1.12)', opacity: '0' },
          '100%': { transform: 'scale(1.12)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'sweep-in': 'sweep-in 0.9s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.22, 1, 0.36, 1) infinite',
      },
      maxWidth: {
        shell: '1440px',
        prose: '68ch',
      },
    },
  },
  plugins: [],
} satisfies Config;
