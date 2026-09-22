# Review — Rebrand landing page, download page and app shell to Aira

Checked against `.bridza/pipelines/engineering/rebrand-landing-page-to-aira/spec/outputs/acceptance.md`
(task #123). Note: the file `acceptance.md` at repo root is a **stale leftover from an
unrelated, already-shipped task** (#112, "change the color of a tag" — finalized
2026-09-21, commit `2c3b425`); it is not this task's acceptance criteria and was
ignored for this review. Likewise `spec.md`, `fix.md`, `repro.md`, `draft/` at the
root belong to that old task and are untouched by this branch.

## Verdict: passes acceptance, one real gap, one polish nit

## Acceptance checklist

**Landing page**
- [x] Header: Aira mark + "Aira", nav = Download · Open the app · GitHub · by erluxman ↗ · theme toggle — verbatim to `copy.md`.
- [x] Eyebrow "Jira for the AI era", H1 "From ideas to impact." with "impact" gradient-clipped.
- [x] Waitlist form and component fully removed; `App.test.jsx` asserts no `<form>`/email input/"waitlist" text.
- [x] "How it works" (Plan/Track/Ship), feature grid (6 cards), "Why Jira for the AI era", final CTA — all verbatim to `copy.md`.
- [x] Footer: `© {year} Aira · a tool by erluxman`, GitHub · GitCrystal · erluxman.dev, Atlassian trademark line in `text-ink-faint`.
- [x] Primary CTA OS-detected via `detectOS()` (mac/win/linux/fallback), links `/download`.

**Download page**
- [x] H1 "Download Aira" (accent on "Aira"), subhead verbatim, release-fetch/asset-matching logic untouched.

**Theming**
- [x] All tokens match `tokens.md` exactly (dark + light), including new `--color-accent-2` / `--color-success`.
- [x] No leftover `#a78bfa`/`#7c5cf0` — confirmed by grep, zero hits in `src/`.
- [x] `.btn-gradient`: brand gradient, white text, 8px radius.
- [x] Contrast checked by hand (WCAG relative-luminance): `--color-ink-dim` on `--color-base` ≈ 7.6:1 light, ≈ 7.3:1 dark — both clear of the 4.5:1 floor.

**App shell**
- [x] `nav.jsx`: sidebar brand is `<Logo size={16}/> Aira`, `pulse` class still applied to the same element.
- [x] `onboarding.jsx`: heading, hosted-preview note, import tooltip, and the new tagline all match.
- [x] `flow.jsx`: all 5 flagged strings (export toast, mailto subject/body, invalid-file toast, import toast) updated.
- [x] `client.js`: `NO_BRIDGE` banner says "Aira works..." with the `bridza` clone command intentionally untouched.
- [x] `electron/main.js`: window title and open-folder dialog title both "Aira".

**Meta / assets**
- [x] `index.html` title/description/og:title/og:description/og:image + apple-touch-icon link match `copy.md`.
- [x] `favicon.svg`, `apple-touch-icon.png`, `build/icon.png` are byte-identical (`md5`) to the task's brand source files; `og.png` is 1200×630 as specified.
- [x] Inter + JetBrains Mono loaded via Google Fonts `<link>` at the required weights.

**Whole-system coverage**
- [x] Ran the acceptance grep from `reference/strings-audit.md` verbatim — zero unexplained hits. Every remaining "bridza" occurrence is bucket B (`.bridza/` paths, `bridza/<pipeline>/<task>` branch strings, commit-subject regex, repo URL).
- [x] No bucket B/C file was touched (`package.json`, `electron-builder.yml`, `public/install.*`, `CONTRIBUTING.md`, `DEPLOY.md`, `docs/09-file-format.md`, `docs/10-desktop-app.md`, `.bridza/` format, `/api/bridza/*`, `format.js` merge prompt) — confirmed against the build commit's file list.

**Tests / build**
- [x] `pnpm lint` — clean.
- [x] `pnpm build` — succeeds; `App-*.js`/`App-*.css` land in a separate chunk from `index-*.js` (the app shell entry), so the landing bundle stays split as required.
- [x] `pnpm test` — 340/340 passed (22 files), including the new `App.test.jsx` (hero H1 text, no waitlist form).
- [x] `git merge-tree` against `main` — no conflicts, clean fast-forward-mergeable diff. Task's own pipeline README correctly names the target branch/pipeline; nothing in the diff hardcodes the old "main" branch name.

## Gap

- **`docs/00-progress-tracker.md` and other root `docs/*.md` still say "Bridza" in prose** (not graded above since they're not in the acceptance grep's target paths) — this matches bucket C in `strings-audit.md` (deferred, flag only), so it's a deliberate, documented exclusion, not a miss. Flagging here only so it isn't mistaken for an oversight on the next pass.

## Over-engineering — nothing to delete

Scanned the diff for unused flexibility, reinvented stdlib, and one-caller abstractions:

- `src/components/Logo.tsx` has 3 real callers (`App.tsx` header, `Download.tsx` header, `nav.jsx` sidebar) at 2 distinct sizes — legitimate componentization, not premature.
- `src/lib/os.ts` has 2 callers (`App.tsx` Hero, `Download.tsx`) — exactly what the spec asked for by moving `detectOS()` out of `Download.tsx`; not overreach.
- No new config flags, no speculative props, no dead exports introduced.

**One nit, not a blocker:** `Logo.tsx` hand-rolls unique gradient-ID generation with a module-level `let uid = 0; uid++` incremented on every render call, to keep the two `<linearGradient>` ids collision-free across instances. React 19 (already a dependency here) ships `useId()` for exactly this — stable per-instance, no module-level mutable counter, no risk of the counter drifting across fast-refresh/hot-reload in dev. Suggest:

```diff
-let uid = 0;
-
 export default function Logo({ size = 22 }: { size?: number }) {
-  const id = uid++;
+  const id = useId();
   return (
```
(then reference `` `airaLeft-${id}` `` etc. as before). Small, but it's the stdlib tool for this exact job — worth the one-line swap.
