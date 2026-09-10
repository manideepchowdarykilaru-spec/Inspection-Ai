/** @type {import('tailwindcss').Config} */
export default {
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '../shared/**/*.ts'],
  },
  theme: {
    extend: {
      colors: {
        // LMPC palette: the sidebar and dark surfaces are a warm brown drawn from
        // the logo; brand and accent are its gold, so what used to be blue is yellow.
        navy: {
          50: '#FBF7EE', 100: '#F5EBD3', 200: '#E9D5A6', 300: '#D9B96F',
          400: '#B8913B', 500: '#8E6A1C', 600: '#6E4E0F', 700: '#563C0B',
          800: '#3F2B08', 900: '#2E1F06', 950: '#1C1304',
        },
        brand: {
          50: '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D',
          400: '#F6C21B', 500: '#EAB308', 600: '#CA9A04', 700: '#A47B02',
          800: '#7A5A00', 900: '#5A4200',
        },
        accent: { 400: '#F6C21B', 500: '#EAB308', 600: '#CA9A04' },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        elevated: '0 4px 6px -2px rgb(15 23 42 / 0.05), 0 12px 24px -6px rgb(15 23 42 / 0.12)',
        panel: '0 20px 45px -20px rgb(11 37 69 / 0.35)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right': { '0%': { opacity: '0', transform: 'translateX(16px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        'scan-sweep': { '0%': { top: '0%' }, '100%': { top: '100%' } },
        'pulse-ring': { '0%': { transform: 'scale(0.9)', opacity: '0.7' }, '100%': { transform: 'scale(1.4)', opacity: '0' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        'fade-up': 'fade-up 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.25s ease-out',
        'scan-sweep': 'scan-sweep 1.8s ease-in-out infinite alternate',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
