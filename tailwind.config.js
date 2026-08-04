/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#145231',
        },
        secondary: {
          50: '#faf9f6',
          100: '#f3f1ed',
          200: '#e8e3da',
          300: '#d4cac1',
          400: '#b5a89e',
          500: '#9b8f85',
          600: '#7a6f67',
          700: '#5f564f',
          800: '#3a3530',
          900: '#1a1815',
        },
        accent: {
          yellow: '#fbbf24',
          neon: '#e2ff00',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
