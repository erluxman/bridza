# Acceptance — task #123

## Landing page (`/`)

- [ ] Header shows the Aira mark + "Aira".
- [ ] Eyebrow pill reads "Jira for the AI era" (not "Coming soon").
- [ ] H1 reads "From ideas to impact." with "impact" in the blue→purple gradient.
- [ ] No waitlist form or `Waitlist` component anywhere on the page.
- [ ] "How it works" section present with the 3 steps (Plan / Track / Ship) from `reference/copy.md`.
- [ ] Feature grid shows the six Aira cards from `reference/copy.md`, replacing the old `FEATURES`.
- [ ] "Why Jira for the AI era" section and final CTA ("Ship work you can actually review.") present.
- [ ] Footer shows `© {year} Aira · a tool by erluxman` and the Atlassian/Jira trademark disclaimer line.
- [ ] Primary CTA label is OS-detected ("Download for macOS/Windows/Linux", fallback "Download") and links to `/download`.

## Download page (`/download`)

- [ ] H1 reads "Download Aira" with "Aira" in accent colour.
- [ ] Subhead matches `reference/copy.md`.
- [ ] Installers still resolve from the latest GitHub release (release-fetch/asset-matching logic unchanged).

## Theming

- [ ] In both light and dark themes, all colours trace to the tokens in `reference/tokens.md` (no leftover violet hexes in `src/index.css` or `src/app/bridza.css`).
- [ ] Body text on base background contrast ≥ 4.5:1 in both themes.
- [ ] Primary buttons use the brand gradient (`--color-accent` → `--color-accent-2`), white text, 8px radius.

## Desktop/web app shell

- [ ] Sidebar brand (`nav.jsx`) is the Aira mark + "Aira", `pulse` animation class retained.
- [ ] Onboarding heading reads "Aira"; hosted-preview note and import-tooltip say "Aira" not "Bridza".
- [ ] All 5 flagged strings in `flow.jsx` (export toast, mailto subject, mailto body, invalid-file error toast, import toast) say "Aira project" / "Aira stage flow".
- [ ] `NO_BRIDGE` banner in `client.js` says "Aira works on YOUR machine's repos..." while the `clone github.com/erluxman/bridza` command is unchanged.
- [ ] Electron window title and open-folder dialog title read "Aira".

## Meta / assets

- [ ] `index.html` title, description, og:title, og:description match `reference/copy.md`; apple-touch-icon link present.
- [ ] Favicon, apple-touch-icon, and OG image are the new Aira assets.
- [ ] Inter (400/500/600/700) and JetBrains Mono (400/500) actually load.

## Whole-system coverage

- [ ] The acceptance grep in `reference/strings-audit.md` ("Acceptance check for whole system coverage") returns zero unexplained hits.
- [ ] Nothing in bucket B/C (`.bridza/` paths, branch prefix, `com.erluxman.bridza`, storage key prefixes, `/api/bridza/*`, `format.js` merge prompt, install scripts, `CONTRIBUTING.md`/`DEPLOY.md`/file-format docs) was touched.

## Tests / build

- [ ] Visible-text assertions in `src/app/__tests__/` and `e2e/` updated to expect "Aira" where applicable.
- [ ] New test: landing page renders the hero H1 and no waitlist form.
- [ ] `pnpm lint && pnpm test && pnpm build` all pass.
- [ ] Landing bundle remains a separate chunk from the app bundle.
