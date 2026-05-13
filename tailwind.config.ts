import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#0F3B3D",
        secondary: "#E8B86B",
        surface: "#F9F9FC",
        border: "#E2E8F0",
        muted: "#64748B",
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
      },
      backgroundColor: {
        surface: "#F9F9FC",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
