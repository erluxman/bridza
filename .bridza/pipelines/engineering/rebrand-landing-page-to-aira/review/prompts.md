# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-22T19:15:56.299Z · run 1 · claude

Task: Rebrand landing page, download page and app shell from Bridza to Aira

**Why.** Task #122 (design-brand) renamed the product **Bridza → Aira** and positioned it as *"Jira for the AI era."* Brand assets, palette, type and the exact copy are finished. This ticket applies them everywhere a user can see the name "Bridza": the landing site, the download page, and the running desktop/web app itself (sidebar, onboarding, toasts, dialogs, window title, error banners) — not just the marketing pages. Nothing about how the product works changes; this is strings, colours and assets only.

**This is a whole-system rebrand, not a landing-page reskin.** Section 6 below lists every user-visible location, including ones outside the landing page (toast messages in `flow.jsx`, the no-bridge error banner in `client.js`, an onboarding tooltip) that are easy to miss with a nav.jsx-only pass. Use `reference/strings-audit.md`'s grep to confirm nothing is left before calling this done.

**Source of truth — copied into this task folder already, no need to open the PDF:**
- `reference/copy.md` — every exact string to ship (landing, download, in-app, meta), verbatim, extracted from the brand guidelines.
- `reference/tokens.md` — colour tokens, gradient, type scale, button specs, ready to paste into `src/index.css`.
- `reference/strings-audit.md` — full repo-wide grep of every "Bridza" occurrence, bucketed into in-scope / out-of-scope-with-reason, plus the acceptance grep.

**Original brand deliverables (for images/logos and full context, not required reading for build):**
- Brand guidelines PDF: `.bridza/pipelines/design-brand/00000122-rebrand-jira-to-aira-for-project/brand/brand-guidelines.pdf` (HTML source next to it).
- Asset index: `.bridza/pipelines/design-brand/00000122-rebrand-jira-to-aira-for-project/brand/README.md`
- Logos: `.bridza/pipelines/design-brand/00000122-rebrand-jira-to-aira-for-project/brand/logos/` (SVG masters + `png/` exports)
- Positioning: `.bridza/pipelines/design-brand/00000122-rebrand-jira-to-aira-for-project/brand-positioning/outputs/positioning.md`
- Reference board: `.bridza/pipelines/design-brand/00000122-rebrand-jira-to-aira-for-project/brand/reference/aira-brand-board.png`

## Scope

### 1. Assets into the repo
| From (task folder `brand/logos/`) | To |
|---|---|
| `favicon.svg` | `public/favicon.svg` (replace) |
| `png/favicon-180.png` | `public/apple-touch-icon.png` + `<link rel="apple-touch-icon">` in `index.html` |
| `aira-mark.svg` | inline as the `<Logo/>` component in `src/pages/App.tsx` (keep it inline SVG so it scales; gradient ids must be unique per instance or hoisted once) |
| `aira-mark.svg` | sidebar brand in `src/app/features/nav.jsx` line ~48, replacing the text `⎇ Bridza`. Keep the `pulse` animation class on the mark. |
| `png/aira-app-icon-1024.png` | `build/icon.png` (electron-builder derives .icns / .ico) |
| compose OG image 1200×630 (Dark Navy, mark + wordmark, "From ideas to impact.", "Jira for the AI era") | `public/og.png` |

### 2. Colour tokens — `src/index.css`
Replace the violet values inside `@theme` and `:root[data-theme="light"]` with the Aira palette. Token names are unchanged so no component edits are needed. Add two new tokens.

```css
/* dark (default) */
--color-ink: #F8FAFC;  --color-ink-dim: #94A3B8;  --color-ink-faint: #64748B;
--color-base: #0B1120; --color-surface: #111A2E;  --color-line: #1E293B;
--color-accent: #4F7BFF; --color-accent-2: #8B5CF6; --color-accent-soft: #1E2A5A;
--color-on-accent: #FFFFFF; --color-success: #06D6A0;

/* light */
--color-ink: #0B1120;  --color-ink-dim: #475569;  --color-ink-faint: #94A3B8;
--color-base: #FFFFFF; --color-surface: #F8FAFC;  --color-line: #E2E8F0;
--color-accent: #4F7BFF; --color-accent-2: #8B5CF6; --color-accent-soft: #DBE4FF;
--color-on-accent: #FFFFFF; --color-success: #06D6A0;
```
Update the `.bg-aura` radial to mix `--color-accent` → `--color-accent-2`. Update the header comment ("Bridza — violet accent…"). Check `src/app/bridza.css` for any hard-coded `#a78bfa` / `#7c5cf0` and route them through the tokens.

Primary buttons use the brand gradient: `background: linear-gradient(90deg, var(--color-accent), var(--color-accent-2))`, white text, radius 8px.

### 3. Landing page — `src/pages/App.tsx` + `src/data/content.ts`
Copy is **verbatim from PDF section 10**. Summary:
- Header: `[mark] Aira` · links: Download · Open the app · GitHub · by erluxman ↗ · theme toggle.
- Hero: eyebrow pill **"Jira for the AI era"** (replaces "Coming soon") · H1 **"From ideas to impact."** with *impact* in gradient text (`bg-clip-text`) · subhead *"Aira is project management for the AI era. Agents do the work in small, git-backed stages. You approve every handoff."* · primary CTA **"Download for macOS"** (OS-detected label: Windows / Linux / fallback "Download", reuse `detectOS()` from `Download.tsx`, move it to `src/lib/os.ts`) → `/download` · secondary **"Open the app"** → `/app` · line under CTAs *"macOS · Windows · Linux · Free and open source (MIT)"* · rhythm strip **Plan · Track · Ship**.
- **Remove the waitlist form** (it is a placeholder that never posted anywhere) and the `Waitlist` component.
- New section "How it works": title *"One task. Small stages. Real gates."* + 3 steps (Plan / Track / Ship) — text in PDF §10.
- Feature grid: replace `FEATURES` in `src/data/content.ts` with the six cards in PDF §10 (Stages are pure functions · Git is the database · Human gate by default · See where time and money go · Bring your own AI CLI · On your machine).
- Section "Why Jira for the AI era" (one paragraph, PDF §10).
- Final CTA: *"Ship work you can actually review."* / *"Free, open source, runs on macOS, Windows and Linux."* / button **Download Aira**.
- Footer: `© {year} Aira · a tool by erluxman` + links GitHub · GitCrystal · erluxman.dev + the line *"Jira is a trademark of Atlassian Pty Ltd. Aira is not affiliated with or endorsed by Atlassian."* in `text-ink-faint`.

### 4. Download page — `src/pages/Download.tsx`
- Header brand → mark + "Aira". H1 → **"Download Aira"** ("Aira" in accent). Subhead → *"Project management for the AI era, running on your machine, on your repos. Install with a click, or one line in the terminal."*
- Keep all release-fetching logic and asset matching exactly as is (assets are still named `Bridza-*` until the build rename, see out-of-scope).

### 5. `index.html` meta
```html
<title>Aira — Jira for the AI era</title>
<meta name="description" content="Aira is project management for the AI era. AI agents do the work in small, git-backed stages and you approve every handoff. Free, open source, runs on your machine.">
<meta property="og:title" content="Aira — Jira for the AI era">
<meta property="og:description" content="From ideas to impact. Agents do the work in small git-backed stages. You approve every handoff.">
<meta property="og:image" content="https://bridza.erluxman.dev/og.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```
Load fonts: Inter 400/500/600/700 + JetBrains Mono 400/500 (Google Fonts link, or self-host under `public/fonts/`). `--font-sans` / `--font-mono` already point at them.

### 6. Visible product strings (the whole running app, not just the shell)
Full list with exact line refs is `reference/strings-audit.md` (bucket A) — treat it as the checklist. Summary:
- `src/app/features/nav.jsx:48` — sidebar brand `⎇ Bridza` → mark + `Aira`, keep `pulse` class.
- `src/app/features/onboarding.jsx` — `<h2>Bridza</h2>` heading (line 42), hosted-preview note (line 47), import-button tooltip "...any Bridza project" (line 230). Onboarding tagline becomes *"Small stages. Real gates. Git as truth."*
- `src/app/features/flow.jsx` — **5 separate user-visible strings**: the "flow exported" toast (line 70), the mailto subject and body when sharing a stage flow (lines 74-75), the "not a Bridza stage-flow or pipeline file" error toast (line 93), and the "＋ New pipeline" import toast (line 101). All say "Bridza project" / "Bridza stage flow" → "Aira project" / "Aira stage flow".
- `src/app/api/client.js:8` — the `NO_BRIDGE` banner shown on the hosted preview: rename only the product-name word ("Bridza works on YOUR machine's repos...") → "Aira works..."; **keep** the `clone github.com/erluxman/bridza` command as-is (repo isn't renamed).
- `electron/main.js` — window title (line 78) and open-folder dialog title (line 59): "Bridza" → "Aira".
- `README.md` (title, hero line, "Why" heading; keep repo URLs).

Do **not** touch code identifiers, comments that name modules, `.bridza/` paths, `bridza/<pipeline>/<task>` branch prefix, `com.erluxman.bridza`, `productName`, localStorage/sessionStorage key prefixes (`bridza.*`, `bridza-*`), the `/api/bridza/*` route, or the merge-readiness prompt text in `src/app/lib/format.js`. Full rationale for each exclusion is in `reference/strings-audit.md` bucket B/C — read it before assuming something is missing scope vs. deliberately excluded.

### 7. Tests
- Update assertions that check visible text: grep `Bridza` in `src/app/__tests__/` and `e2e/`; only change strings that are rendered UI text.
- Add a test that the landing page renders the hero H1 and no waitlist form.
- `pnpm test` and `pnpm lint` green; `pnpm build` succeeds; landing bundle stays a separate chunk from the app (see `src/main.tsx` comment).

## Out of scope (separate tickets)
- Renaming the package, `appId`, `productName`, `artifactName`, GitHub repo, install scripts (`public/install.sh`, `install.ps1` match `Bridza-*` asset names), Cloudflare project or domain (`bridza.erluxman.dev`). These break installers and links; do them together later.
- Renaming `.bridza/` folder or `bridza/<pipeline>/<task>` branch prefix (breaking data migration).
- Trademark clearance on "Aira" (flagged in positioning.md §5, decision for the requester).

## Acceptance criteria
- Given the landing page at `/`, when it loads, then the header shows the Aira mark + "Aira", the eyebrow reads "Jira for the AI era", the H1 reads "From ideas to impact." with "impact" in the blue→purple gradient, and no waitlist form exists.
- Given `/download`, then the H1 reads "Download Aira" and installers still resolve from the latest GitHub release.
- Given light and dark themes, then all colours come from the tokens in §2 and contrast for body text on base ≥ 4.5:1.
- Given the desktop app, then the sidebar brand is the Aira mark + "Aira", the window title is "Aira", the onboarding heading is "Aira", and every toast/tooltip/error banner in `flow.jsx`, `onboarding.jsx` and `client.js` says "Aira project" / "Aira stage flow" / "Aira works on YOUR machine's repos" (not "Bridza").
- Given the acceptance grep in `reference/strings-audit.md` ("Acceptance check for whole system coverage"), then it returns zero unexplained hits.
- `pnpm lint && pnpm test && pnpm build` pass.

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

