# Desktop app (Electron) — build, release, install

Bridza ships as a desktop app so users get the local bridge (real fs + git
access to their repos) without running `pnpm dev`. The same UI and the same
`server/*` bridge that power dev also power the packaged app.

## How it fits together

- **`server/bridge.js`** — transport-agnostic bridge: `handleApi(req,res)` +
  `handleUpgrade` (the PTY WebSocket). One source of truth for `/api/bridza/*`.
- **`server/bridza-fs.js`** — thin Vite plugin that mounts the bridge onto the
  dev server (browser dev).
- **`electron/main.js`** — the packaged app. Starts a loopback http server that
  serves the built `dist/` **and** mounts the same bridge, then points a
  `BrowserWindow` at `http://127.0.0.1:<port>/app`. Also:
  - **PATH fix** — GUI launches inherit a minimal PATH; we prepend
    `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin` so the
    bridge finds `git`, `claude`, `opencode`, etc.
  - **native folder picker** on every OS (overrides the shell picker, which has
    none on Windows).

## Build locally

```bash
pnpm desktop        # build web + run the app unpackaged (fastest iteration)
pnpm desktop:pack   # build + package an unpacked .app/.exe/AppImage into release/
pnpm desktop:dist   # build + full installers into release/ (no publish)
```

Config: [`electron-builder.yml`](../electron-builder.yml). Targets:

| OS      | Formats            | Arch          |
|---------|--------------------|---------------|
| macOS   | `.dmg` + `.zip`    | arm64 + x64   |
| Windows | `.exe` (NSIS)      | x64           |
| Linux   | `.AppImage` + `.deb` | x64         |

The `.zip` on macOS exists for the terminal installer (unzip `.app` straight
into `/Applications`).

## Release (hosting = GitHub Releases)

Installers are hosted on **GitHub Releases** of `erluxman/bridza`. Cutting a
release is tag-driven — [`.github/workflows/release.yml`](../.github/workflows/release.yml)
runs one builder per OS and publishes all artifacts to the release for the tag:

```bash
# bump version in package.json, then:
git tag v0.1.0
git push origin v0.1.0
```

The workflow uses the built-in `GITHUB_TOKEN` — no extra secrets. Artifacts are
named `Bridza-<version>-<os>-<arch>.<ext>` so the download page and installers
can match them.

## Install — two first-class paths

**UI:** the download page at `bridza.erluxman.dev/download`
([`src/pages/Download.tsx`](../src/pages/Download.tsx)) reads the latest release
from the GitHub API, detects the visitor's OS, and offers the right installer.

**Terminal:** one-liners served from `public/` (deployed to the site root):

```bash
# macOS + Linux
curl -fsSL https://bridza.erluxman.dev/install.sh | sh
```
```powershell
# Windows
irm https://bridza.erluxman.dev/install.ps1 | iex
```

Both scripts query the GitHub Releases API, pick the artifact for the host
OS/arch, and install it (macOS → `/Applications`, Linux → `~/.local/bin/bridza`,
Windows → silent NSIS).

## Not done yet (intentional)

- **Code signing / notarization** — builds are **unsigned**. macOS: right-click
  → Open (or the installer clears the quarantine flag). Windows: "More info →
  Run anyway". To sign later: add an Apple Developer cert + `CSC_LINK`/
  `CSC_KEY_PASSWORD` (mac) and a Windows cert, then drop `identity: null`.
- **App icon** — using the default Electron icon. Add `build/icon.icns`,
  `build/icon.ico`, `build/icon.png` to brand it.
- **Auto-update** — the GitHub publish provider already emits `latest*.yml`; wire
  `electron-updater` when wanted.
