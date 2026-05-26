import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/Owlbear_Board/",
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
