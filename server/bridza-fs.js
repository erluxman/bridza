// bridza-fs.js — Vite dev-server plugin: the project file bridge.
//
// Thin wrapper that mounts the transport-agnostic bridge (server/bridge.js) onto
// Vite's dev server. The packaged desktop app mounts the same bridge onto its
// own http server (electron/main.js). One source of truth for /api/bridza/*.
//
// Bridza is a local client for any folder/repo (ADR-0002): open a folder, and
// if it has (or gets) a `.bridza/` that data is loaded and edited (ADR-0001).

import { handleApi, handleUpgrade } from "./bridge.js";

export default function bridzaFs() {
  return {
    name: "bridza-fs",
    configureServer(server) {
      // interactive PTY over WebSocket (vite's HMR upgrade handles the rest)
      server.httpServer && server.httpServer.on("upgrade", handleUpgrade);
      // /api/bridza/* — fall through to Vite for everything else
      server.middlewares.use(async (req, res, next) => {
        if (!(await handleApi(req, res))) next();
      });
    },
  };
}
