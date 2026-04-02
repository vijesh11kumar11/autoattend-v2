/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary:   { DEFAULT: '#1a237e', light: '#283593', dark: '#0d174f' },
        secondary: { DEFAULT: '#3b82f6', light: '#60a5fa', dark: '#2563eb' },
        success:   '#16a34a',
        warning:   '#d97706',
        danger:    '#dc2626',
        surface:   '#f8fafc',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
