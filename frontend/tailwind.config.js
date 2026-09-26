/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17181B',
        paper: '#EDEFF1',
        surface: '#FFFFFF',
        rickshaw: {
          DEFAULT: '#C1432E',
          dark: '#9E3423',
        },
        transit: {
          DEFAULT: '#2B6B60',
          dark: '#1F4E46',
        },
        amber: '#C98A2C',
        line: '#D9D6CC',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
