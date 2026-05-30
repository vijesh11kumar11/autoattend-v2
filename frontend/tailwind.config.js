/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary:   { DEFAULT: '#1a237e', light: '#283593', dark: '#0d174f' },
        secondary: { DEFAULT: '#f57c00', light: '#ff9800', dark: '#e65100' },
        success:   '#388e3c',
        warning:   '#f57c00',
        danger:    '#d32f2f',
        surface:   '#f5f5f5',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
