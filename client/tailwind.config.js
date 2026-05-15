/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'brand-blue': '#627cd1',
        'custom-green': {
          light: '#dcfce7',
          DEFAULT: '#22c55e',
          dark: '#166534',
        },
      },
    },
  },
  plugins: [],
};
