/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        wa: {
          teal: "#00a884",
          "teal-dark": "#008069",
          green: "#25d366",
          dark: "#111b21",
          "dark-panel": "#202c33",
          "dark-subtle": "#222e35",
          "dark-hover": "#2a3942",
          border: "#2a3942",
          muted: "#8696a0",
          bubble: "#005c4b",
        },
      },
    },
  },
  plugins: [],
};
