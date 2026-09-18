import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Bridza's project bridge: dev-server middleware giving the app UI real
// fs + git access to local repos. Dev-only by nature — the deployed site
// serves the same UI, which detects the missing bridge and says "run locally".
import bridzaFs from "./server/bridza-fs.js";

export default defineConfig({
  plugins: [react(), tailwindcss(), bridzaFs()],
  // The bridge (above) writes task/pipeline/inbox state straight to
  // <opened-project>/.bridza/**. When the opened project IS this repo
  // (dogfooding), that directory sits inside Vite's own watched root — and
  // since those JSON files aren't part of the module graph, Vite's default
  // reaction to their changing is a full client page reload, wiping all UI
  // state on every single mutation. Exclude it so the bridge can write freely.
  server: { watch: { ignored: ["**/.bridza/**"] } },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,jsx}"], // unit tests; e2e/ is Playwright
  },
});
