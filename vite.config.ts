import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const commitCount = (() => { try { return execFileSync("git", ["rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "0"; } })();

export default defineConfig({
  base: process.env.VITE_BASE ?? "/Owlbear_Board/",
  define: { __APP_VERSION__: JSON.stringify(`0.2.${commitCount}`) },
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
