/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: 'rgb(var(--color-brand-primary) / <alpha-value>)',
          hover: 'rgb(var(--color-brand-hover) / <alpha-value>)',
          medium: 'rgb(var(--color-brand-medium) / <alpha-value>)',
          pacific: 'rgb(var(--color-brand-pacific) / <alpha-value>)',
          sky: 'rgb(var(--color-brand-sky) / <alpha-value>)',
          navy: 'rgb(var(--color-brand-navy) / <alpha-value>)',
          dark: 'rgb(var(--color-brand-dark) / <alpha-value>)',
          subcard: 'rgb(var(--color-brand-subcard) / <alpha-value>)',
        },
        kpmg: {
          blue: 'rgb(var(--color-brand-primary) / <alpha-value>)',
          hover: 'rgb(var(--color-brand-hover) / <alpha-value>)',
          navy: 'rgb(var(--color-brand-navy) / <alpha-value>)',
          medium: 'rgb(var(--color-brand-medium) / <alpha-value>)',
          pacific: 'rgb(var(--color-brand-pacific) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
