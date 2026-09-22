// main.js — Bridza desktop (Electron) entry.
//
// The packaged app IS the local bridge. It starts a loopback http server that
// serves the built UI (dist/) AND mounts the same /api/bridza/* + PTY bridge the
// Vite dev server uses (server/bridge.js), then points a BrowserWindow at it.
// No `pnpm dev`, no cloud round-trip: real fs + git access to the user's repos.

import { app, BrowserWindow, dialog, shell } from "electron";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// GUI apps launched from Finder/Explorer inherit a minimal PATH — git, node,
// claude, opencode etc. live in dirs the login shell adds but a GUI launch does
// not. Prepend the usual suspects so the bridge can find its tools.
function fixPath() {
  const extra = process.platform === "win32"
    ? []
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
       path.join(process.env.HOME || "", ".local/bin"),
       path.join(process.env.HOME || "", ".cargo/bin")];
  const have = new Set((process.env.PATH || "").split(path.delimiter));
  const merged = [...extra.filter((d) => d && !have.has(d)), ...(process.env.PATH || "").split(path.delimiter)];
  process.env.PATH = merged.filter(Boolean).join(path.delimiter);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json",
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname.includes("..")) { res.statusCode = 400; return void res.end("bad path"); }
  let file = path.join(DIST, pathname);
  // SPA: /app, /download, deep links -> index.html (Vite emits a single page).
  if (!path.extname(file) || !fs.existsSync(file)) file = path.join(DIST, "index.html");
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return void res.end("not found"); }
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(buf);
  });
}

// Start the loopback bridge+static server, resolve its actual URL.
async function startServer() {
  const { handleApi, handleUpgrade, setPickFolder } = await import("../server/bridge.js");
  // Electron has a real native folder picker on every platform (including
  // Windows, where the shell-based picker has none).
  setPickFolder(async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, { title: "Open project folder — Aira", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    return { path: r.filePaths[0] };
  });

  const server = http.createServer(async (req, res) => {
    try { if (await handleApi(req, res)) return; } catch (e) { res.statusCode = 500; return void res.end(String(e)); }
    serveStatic(req, res);
  });
  server.on("upgrade", handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function createWindow() {
  const base = await startServer();
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: "Aira",
    backgroundColor: "#0b0b0f",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Open external links (docs, github) in the real browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url); return { action: "deny" };
  });
  win.loadURL(`${base}/app`);
}

fixPath();

app.whenReady().then(createWindow);
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
