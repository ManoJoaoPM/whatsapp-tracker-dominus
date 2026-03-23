/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        primary: {
          DEFAULT: '#ff6600',
          50: '#fff0e5',
          100: '#ffdccc',
          200: '#ffb399',
          300: '#ff8a66',
          400: '#ff6600',
          500: '#e65c00',
          600: '#cc5200',
          700: '#993d00',
          800: '#662900',
          900: '#331400',
        },
      }
    },
  },
  plugins: [],
};
