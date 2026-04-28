import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#18212f",
        paper: "#f7f7f2",
        line: "#d8ddd2",
        accent: "#1f7a6d",
        warn: "#b45309",
        danger: "#b42318"
      },
      boxShadow: {
        panel: "0 1px 2px rgba(24, 33, 47, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
