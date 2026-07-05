# Contributing to Bridza

Thanks for your interest! Bridza is a small project — issues, bug reports, and
PRs are all welcome.

## Getting set up

Requires **Node ≥ 25** (pinned in [`.nvmrc`](.nvmrc)) and **pnpm**.

```bash
git clone https://github.com/erluxman/bridza.git
cd bridza
pnpm install
pnpm dev            # web app at http://localhost:5173  (the app lives at /app)
pnpm desktop        # or: build the UI + launch the Electron app
```

## Project layout

| Path | What |
|------|------|
| `src/` | React UI — landing (`pages/`), the app (`app/`), download page |
| `server/` | The bridge: `bridge.js` (shared API), `bridza-run.js` (git model + stage runner), `bridza-store.js` (`.bridza/` on-disk format) |
| `electron/` | Desktop entry — loopback server + window |
| `docs/` | Product vision, PRD, test cases, edge cases, roadmap, desktop notes |
| `e2e/` | Playwright tests that drive the real app |

The bridge is transport-agnostic and shared by dev + desktop — see
[`docs/10-desktop-app.md`](docs/10-desktop-app.md).

## Before you open a PR

```bash
pnpm lint
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright (drives the app against a temp git repo)
```

- Keep changes **small and focused** — it's what the product is about.
- Match the surrounding code's style (comment density, naming, idioms).
- Add or update tests for behavior changes.
- Never commit secrets. Local deploys use `wrangler login`; CI uses GitHub secrets.

## Reporting bugs

Open an [issue](https://github.com/erluxman/bridza/issues) with:

- OS + version, and whether you're on the desktop app or `pnpm dev`
- Steps to reproduce, expected vs. actual
- Any error text (quoted exactly) from the app or terminal

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
