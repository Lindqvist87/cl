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
        ink: "#171717",
        muted: "#6B7280",
        paper: "#FAFAF8",
        "paper-alt": "#FAFAF7",
        surface: "#FFFFFF",
        line: "#E7E2DA",
        accent: "#E85D9E",
        "accent-dark": "#D9468D",
        success: "#15803D",
        warn: "#b45309",
        danger: "#DC2626",
        info: "#2563EB"
      },
      boxShadow: {
        panel: "0 10px 30px rgba(23, 23, 23, 0.05)",
        active: "0 20px 60px rgba(23, 23, 23, 0.08), 0 0 0 1px rgba(232, 93, 158, 0.16), 0 0 34px rgba(232, 93, 158, 0.12)",
        button: "0 10px 24px rgba(232, 93, 158, 0.22)"
      }
    }
  },
  plugins: []
};

export default config;
