/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        tg: {
          bg: '#0e1621',
          sidebar: '#17212b',
          hover: '#202b36',
          active: '#2b5278',
          mine: '#2b5278',
          mineSelected: '#2b5278',
          theirs: '#182533',
          input: '#242f3d',
          accent: '#64b5ef',
          green: '#4dcd5e',
        },
      },
    },
  },
  plugins: [],
}
