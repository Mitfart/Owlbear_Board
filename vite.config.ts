import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const commitCount = (() => { try { return execFileSync("git", ["rev-list", "--count", "main"], { encoding: "utf8" }).trim(); } catch { return "0"; } })();

export default defineConfig({
  base: "/Owlbear_Board/",
  define: { __APP_VERSION__: JSON.stringify(`0.1.${commitCount}`) },
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
