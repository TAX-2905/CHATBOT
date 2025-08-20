/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',          // <-- REQUIRED for the toggle to work
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: { extend: {} },
  plugins: [],
};
