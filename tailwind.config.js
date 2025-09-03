/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}"
  ],
  // Add the NativeWind preset
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
}