import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      // Dark ops palette. The second group keeps the semantic names used by
      // the newer mission-editor surfaces pointed at the same values.
      bg: '#0B0D10',
      panel: '#11151A',
      edge: '#232A33',
      txt: '#D7DEE7',
      dim: '#93A0B0',
      steel: '#5B8DB8',
      amber: '#C9922E',
      red: '#C4443F',
      data: '#5E9C9A',
      paper: '#0B0D10',
      sheet: '#11151A',
      ink: '#D7DEE7',
      'ink-2': '#B6C2D0',
      'ink-3': '#93A0B0',
      rule: '#232A33',
      'rule-strong': '#3A4552',
      route: '#5B8DB8',
      'active-track': '#5B8DB8',
      airport: '#5B8DB8',
      ok: '#5B8DB8',
      caution: '#C9922E',
      critical: '#C4443F',
    },
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        condensed: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      fontSize: {
        base: ['12px', '16px'],
      },
    },
  },
  corePlugins: { preflight: true },
  plugins: [],
} satisfies Config;
