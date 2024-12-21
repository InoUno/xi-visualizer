import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3000,
  },
  build: {
    target: "esnext",
  },
  base: "/xi-visualizer",
  optimizeDeps: {
    exclude: ["solid-icons"], // To prevent "React is undefined" error
  },
});
