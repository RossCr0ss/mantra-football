import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pitch: {
          green: '#1a472a',
          light: '#2d6a4f',
        },
      },
    },
  },
  plugins: [],
};

export default config;
