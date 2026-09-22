# Rebrand landing page, download page and app shell from Bridza to Aira

**Why.** Task #122 (design-brand) renamed the product **Bridza → Aira** and positioned it as *"Jira for the AI era."* Brand assets, palette, type and the exact landing-page copy are finished. This ticket applies them to the web surfaces and the visible app chrome. Nothing about how the product works changes.

**Source of truth (read first).**
- Brand guidelines PDF: `.bridza/pipelines/design-brand/00000122-rebrand-jira-to-aira-for-project/brand/brand-guidelines.pdf` (HTML source next to it). Section 5 = colour tokens, 6 = type, 10 = landing copy, 11 = where each asset goes.
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

### 6. Visible product strings (app shell)
Replace user-facing "Bridza" with "Aira" in: `src/app/features/nav.jsx` (brand), `src/app/features/onboarding.jsx` (heading, hosted-preview note, import tooltip), `electron/main.js` (window title, open-dialog title), `README.md` (title, hero line, "Why" heading; keep repo URLs). Onboarding tagline becomes *"Small stages. Real gates. Git as truth."*
Do **not** touch code identifiers, comments that name modules, `.bridza/` paths, `bridza/` branch prefix, `com.erluxman.bridza`, `productName`, localStorage keys, or API routes.

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
- Given the desktop app, then the sidebar brand is the Aira mark + "Aira", the window title is "Aira", and the onboarding heading is "Aira".
- Given `grep -rn "Bridza" src/pages src/app/features electron/main.js index.html`, then the only hits are code comments or identifiers, never rendered text.
- `pnpm lint && pnpm test && pnpm build` pass.
