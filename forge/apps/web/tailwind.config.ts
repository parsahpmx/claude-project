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
        smoke: {
          400: '#8A8A93',
          500: '#6E6E77',
          600: '#54545C',
        },
        ember: {
          DEFAULT: '#E8462B',
          400: '#FF6A4D',
          500: '#E8462B',
          600: '#C4351E',
        },
        // Status colours are never the only signal — every state also carries
        // an icon or a word. See docs/ACCESSIBILITY.md.
        signal: {
          good: '#3FA96B',
          warn: '#D99A2B',
          bad: '#D9453B',
          info: '#4A82C4',
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
