import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Bridza's project bridge: dev-server middleware giving the app UI real
// fs + git access to local repos. Dev-only by nature — the deployed site
// serves the same UI, which detects the missing bridge and says "run locally".
import bridzaFs from "./server/bridza-fs.js";

export default defineConfig({
  plugins: [react(), tailwindcss(), bridzaFs()],
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,jsx}"], // unit tests; e2e/ is Playwright
  },
});
