import { fileURLToPath } from 'node:url';

/* Vite runs from the repository root, so Tailwind is pointed at its config explicitly. */
export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) },
    autoprefixer: {},
  },
};
