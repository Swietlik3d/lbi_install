/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        display: [
          "Cabinet Grotesk",
          "Space Grotesk",
          "system-ui",
          "sans-serif",
        ],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 20px 70px rgb(20 28 38 / 0.12)",
        lift: "0 12px 36px rgb(20 28 38 / 0.16)",
      },
    },
  },
};
