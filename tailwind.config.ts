import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      bg: '#0B0D10',
      panel: '#11151A',
      edge: '#232A33',
      txt: '#D7DEE7',
      dim: '#93A0B0',
      steel: '#5B8DB8',
      amber: '#C9922E',
      red: '#C4443F',
    },
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      fontSize: {
        base: '12px',
        leading: '16px',
      },
    },
  },
  corePlugins: { preflight: true },
  plugins: [],
} satisfies Config;
