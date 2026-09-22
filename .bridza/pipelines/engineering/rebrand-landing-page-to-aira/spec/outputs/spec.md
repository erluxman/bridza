# Spec — Rebrand the whole system from Bridza to Aira

Task #123 · pipeline `engineering` · flow `feature`

## What

Apply the finished Aira brand (task #122: name, palette, copy) everywhere a user can see the product name or its violet accent — landing page, download page, and the running desktop/web app shell (sidebar, onboarding, toasts, dialogs, window title, error banners). Strings, colours and a handful of image assets only; no behaviour changes.

## Why

Task #122 renamed the product Bridza → Aira and positioned it as "Jira for the AI era." Brand assets, palette and exact copy already exist in this task folder. A nav-only pass would miss toasts in `flow.jsx`, the no-bridge banner in `client.js`, and the onboarding tooltip — all user-visible "Bridza" strings outside the landing page. This is a whole-system rebrand, not a landing-page reskin.

## Source of truth (already copied into this task folder)

- `reference/copy.md` — every exact string to ship, verbatim.
- `reference/tokens.md` — colour tokens, gradient, type scale, button specs.
- `reference/strings-audit.md` — full repo grep of every "Bridza" occurrence, bucketed in-scope / out-of-scope, plus the acceptance grep.

## Scope

1. **Assets** — favicon, apple-touch-icon, inline `<Logo/>` mark (`App.tsx`), sidebar mark (`nav.jsx`), electron app icon, OG image. Table of exact source→destination paths in `context.md` §1.
2. **Colour tokens** (`src/index.css`) — replace the violet `@theme` / light-theme values with the Aira palette from `reference/tokens.md`; token *names* are unchanged so components don't need edits. Add two new tokens (`--color-accent-2`, `--color-success`). Sweep `src/app/bridza.css` for hard-coded violet hexes.
3. **Landing page** (`src/pages/App.tsx`, `src/data/content.ts`) — header, hero, new "How it works" section, feature grid, "Why Jira for the AI era" section, final CTA, footer — copy verbatim from `reference/copy.md`. Remove the waitlist form/component (placeholder, never posted anywhere).
4. **Download page** (`src/pages/Download.tsx`) — header brand, H1, subhead. Release-fetching/asset-matching logic untouched (assets are still named `Bridza-*` until the out-of-scope build rename).
5. **`index.html` meta** — title, description, og:title/description, apple-touch-icon link, font loading (Inter + JetBrains Mono weights per `reference/tokens.md`).
6. **Running app strings** — `nav.jsx` sidebar brand, `onboarding.jsx` heading/note/tooltip, five toast/mailto strings in `flow.jsx`, the `NO_BRIDGE` banner product-name word in `client.js`, electron window title + open-dialog title, `README.md` title/hero/"Why" heading. Exact line refs and old→new strings are in `reference/strings-audit.md` bucket A — treat it as the checklist.
7. **Tests** — update assertions on visible text (`src/app/__tests__/`, `e2e/`); add a test asserting the landing hero renders and no waitlist form exists.

## Out of scope

- Renaming the package/`appId`/`productName`/`artifactName`, GitHub repo, install scripts, Cloudflare project/domain (`bridza.erluxman.dev`) — breaks installers and links, tracked separately.
- Renaming `.bridza/` folder, the `bridza/<pipeline>/<task>` branch prefix, `localStorage`/`sessionStorage` key prefixes, the `/api/bridza/*` route, `com.erluxman.bridza`, or the merge-readiness prompt text in `format.js` — breaks data migration / client-server contract / existing user state.
- Developer/deploy docs (`CONTRIBUTING.md`, `DEPLOY.md`, `docs/09-file-format.md`, `docs/10-desktop-app.md`) — still describe the actually-named `bridza` repo/package/domain; would go wrong the moment they say "Aira."
- Trademark clearance on "Aira" — flagged for the requester, not an engineering task.

Full rationale for every exclusion: `reference/strings-audit.md` buckets B/C.

## Touch points (expected)

`src/index.css`, `src/app/bridza.css`, `src/pages/App.tsx`, `src/pages/Download.tsx`, `src/data/content.ts`, `src/lib/os.ts` (new — `detectOS()` moved out of `Download.tsx`), `src/app/features/nav.jsx`, `src/app/features/onboarding.jsx`, `src/app/features/flow.jsx`, `src/app/api/client.js`, `electron/main.js`, `index.html`, `public/favicon.svg`, `public/apple-touch-icon.png`, `public/og.png`, `build/icon.png`, `README.md`, `src/app/__tests__/`, `e2e/`.
