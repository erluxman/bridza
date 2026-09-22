# Whole-system "Bridza" string audit (2026-09-23)

Full grep of `bridza`/`Bridza` across the repo (excluding `.bridza/` pipeline data itself, which is the tool's own database and never renamed). Every hit below is bucketed. **Rebrand = everything in bucket A.** Buckets B/C explain why something is *not* touched here, so the build stage doesn't have to re-derive that judgment call.

Re-run before starting build, scope may have drifted: `grep -rniE "bridza" src public electron index.html package.json electron-builder.yml docs CONTRIBUTING.md DEPLOY.md README.md 2>/dev/null | grep -v node_modules`

## Bucket A — user-visible text, IN SCOPE (rename to Aira / rewrite)

**Landing + download (`src/pages/App.tsx`, `src/pages/Download.tsx`, `src/data/content.ts`)** — see `reference/copy.md` for exact new strings.

**Desktop app UI — beyond nav/onboarding, do not miss these:**
- `src/app/features/nav.jsx:48` — sidebar brand `⎇ Bridza` → mark + `Aira`, keep `pulse` class.
- `src/app/features/onboarding.jsx:42` — `<h2>Bridza</h2>` → `Aira`.
- `src/app/features/onboarding.jsx:47` — hosted-preview note: "...Bridza runs on *your* machine..." → "...Aira runs on *your* machine...".
- `src/app/features/onboarding.jsx:230` — import-button tooltip: `"Import a whole pipeline from a .json file exported by any Bridza project"` → `"...any Aira project"`.
- `src/app/features/onboarding.jsx:279` — copy mentions `bridza/{pipeline.id}/…` branch — this is the **branch prefix**, bucket B, leave as-is (only the prose around it, if any, is bucket A — check current wording doesn't rename the branch example itself).
- `src/app/features/flow.jsx:70` — toast: `"flow exported — import it from any Bridza project's Stage flows screen"` → `"...any Aira project's..."`.
- `src/app/features/flow.jsx:74` — mailto subject: `"Bridza stage flow: " + name` → `"Aira stage flow: " + name`.
- `src/app/features/flow.jsx:75` — mailto body: `"...import it from Bridza → Stage flows → Import flow."` → `"...Aira → Stage flows..."`.
- `src/app/features/flow.jsx:93` — error toast: `"not a Bridza stage-flow or pipeline file"` → `"not an Aira stage-flow or pipeline file"`.
- `src/app/features/flow.jsx:101` — toast: `"...import it from "＋ New pipeline" in any Bridza project"` → `"...any Aira project"`.
- `src/app/api/client.js:8` — `NO_BRIDGE` banner shown when the web preview has no local bridge: `"Bridza works on YOUR machine's repos — clone github.com/erluxman/bridza, run \`pnpm install && pnpm dev\`, then open http://app.localhost:5173"`. Rename the product name only: `"Aira works on YOUR machine's repos — clone github.com/erluxman/bridza, run..."`. **Keep the repo URL/clone command as `bridza`** (bucket B — repo isn't renamed).

**Electron shell:**
- `electron/main.js:59` — open-dialog title `"Open project folder — Bridza"` → `"...— Aira"`.
- `electron/main.js:78` — `title: "Bridza"` (window title) → `"Aira"`.

**Meta / SEO:**
- `index.html:23` — `<title>Bridza — AI automation flow management</title>` → `<title>Aira — Jira for the AI era</title>` (note: current copy is generic "AI automation flow management", not the Jira-era framing — use the copy.md version, don't just swap the word).
- `index.html:26,28,34` — meta description / og:title / og:url — update per `reference/copy.md`.

**Top-level docs:**
- `README.md` — title, hero line, "Why" heading (already flagged in context.md §6).

## Bucket B — code identifiers / infra, OUT OF SCOPE for this ticket (tracked separately)
Renaming these breaks installers, deep links, CI, or the `.bridza/` data format migration. Do not touch:
- `package.json` (`name`, `homepage`, repo urls, `deploy` script `--project-name=bridza`)
- `electron-builder.yml` (`appId: com.erluxman.bridza`, `productName: Bridza`, `repo: bridza`)
- `public/install.sh`, `public/install.ps1` — text here (`Bridza.app`, `bridza` binary name) matches the *actual installed artifact name*, which is still `Bridza-*` until the `electron-builder.yml`/package rename ships. Changing the script text without changing the artifact name would make the installer lie.
- Branch prefix `bridza/<pipeline>/<task>` (`src/app/features/board.jsx:200`, `onboarding.jsx:279`, and the `.bridza/` on-disk format itself)
- `.bridza/` folder name, `com.erluxman.bridza`, `localStorage`/`sessionStorage` keys prefixed `bridza.`/`bridza-` (`src/app/lib/format.js`, `settings.js`, and the many `localStorage.getItem("bridza...")` call sites in `flow.jsx`, `plan.jsx`, `task.jsx`, `views.jsx`) — changing these silently drops every existing user's saved UI state.
- API route `/api/bridza/*` (`client.js`, `term.jsx`, server files) — changing breaks the client/server contract in one PR; do together with a versioned route change if ever done.
- `src/app/lib/format.js:41` — merge-readiness prompt text sent to AI agents ("on finalize Bridza merges this task's branch...") — internal system-prompt text describing the tool's own git mechanics, not brand copy.
- `git blame`/commit-subject cleanup regex in `task.jsx:365` (`replace(/^bridza\(...\)/`) — matches the commit convention, not a rename target.

## Bucket C — deferred, flag only (don't change; not this ticket)
Developer/deploy docs mention "Bridza" as the product name throughout: `CONTRIBUTING.md`, `DEPLOY.md`, `docs/09-file-format.md`, `docs/10-desktop-app.md`. These describe the actual repo/package/domain, which are still named `bridza` (bucket B). Rewriting the prose to say "Aira" while the repo, package and domain stay "bridza" would make these docs actively wrong. Revisit together with the package/domain rename ticket.

## Acceptance check for "whole system" coverage
After the build stage, this must return **zero** hits outside bucket B/C paths:
```
grep -rniE "bridza" src/pages src/app/features src/app/api electron/main.js index.html README.md \
  | grep -v "bridza/{" | grep -v "bridza\." | grep -v "bridza-" \
  | grep -v "api/bridza" | grep -v "com.erluxman.bridza" | grep -v "github.com/erluxman/bridza"
```
Any remaining hit is either a missed bucket-A string (fix it) or needs a bucket-B/C annotation added above.
