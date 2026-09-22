# Copy — verbatim (extracted from brand-guidelines §10, no PDF parsing needed)

Do not paraphrase. Source: `.bridza/pipelines/design-brand/00000122-rebrand-jira-to-aira-for-project/brand/brand-guidelines.pdf` / `.html` §10.

## Header (`src/pages/App.tsx`)
- Brand: `[mark] Aira`
- Nav links: `Download` · `Open the app` · `GitHub` · `by erluxman ↗` · theme toggle

## Hero
- Eyebrow pill: `Jira for the AI era`
- H1: `From ideas to impact.` ("impact" gets the gradient text class)
- Subhead: `Aira is project management for the AI era. Agents do the work in small, git-backed stages. You approve every handoff.`
- Primary CTA: `Download for macOS` (OS-detected: "Download for Windows" / "Download for Linux"; fallback "Download") → `/download`
- Secondary CTA: `Open the app` → `/app`
- Under CTAs: `macOS · Windows · Linux · Free and open source (MIT)`
- Rhythm strip: `Plan · Track · Ship`

## Section: How it works (replaces "Coming soon" + waitlist)
- Section title: `One task. Small stages. Real gates.`
- Step 1 · Plan — **Describe the task.** Drop an idea in the inbox. Aira gives it a ref, a branch and a pipeline: engineering, brand, video, research, or one you define.
- Step 2 · Track — **Agents run each stage.** Every stage reads only the previous stage's outputs, runs your AI CLI under its own prompt, and commits one small diff.
- Step 3 · Ship — **You approve every handoff.** Review the diff, flip Automate when you trust a stage, and finalize to merge into main.

## Section: Feature grid (replaces `FEATURES` in `src/data/content.ts`)
| Title | Body |
|---|---|
| Stages are pure functions | A stage's input is only the previous stage's outputs, never the whole brief. Every review is one focused diff. |
| Git is the database | Each task is a branch and a worktree. Runs commit as they go. Your working tree and HEAD are never touched. |
| Human gate by default | Every stage waits for you until you flip Automate. Failures halt even automated stages. |
| See where time and money go | Time, agent, model and cost are tracked per stage, so the bottleneck is visible. |
| Bring your own AI CLI | Runs Claude Code, opencode, or any tool on your PATH. Swap models without rewiring. |
| On your machine | Aira is a desktop app that drives git and your local CLIs. Nothing leaves your repo. |

## Section: Why "Jira for the AI era"
Tickets are still tickets. The difference is who does the work and how a human signs off on it. Aira borrows what Jira taught everyone: tasks, boards, stages, refs and a branch per task. It changes the assignee. An agent does the work in stages you can review, and you gate every handoff.

## Final CTA
- Title: `Ship work you can actually review.`
- Body: `Free, open source, runs on macOS, Windows and Linux.`
- CTA: `Download Aira`

## Footer
`© {year} Aira · a tool by erluxman | GitHub · GitCrystal · erluxman.dev`
Plus, in `text-ink-faint`: `Jira is a trademark of Atlassian Pty Ltd. Aira is not affiliated with or endorsed by Atlassian.`

## Download page (`src/pages/Download.tsx`)
- Pill: `Desktop app` (or the release tag)
- H1: `Download Aira` ("Aira" in accent)
- Subhead: `Project management for the AI era, running on your machine, on your repos. Install with a click, or one line in the terminal.`

## Meta / SEO (`index.html`)
```html
<title>Aira — Jira for the AI era</title>
<meta name="description" content="Aira is project management for the AI era. AI agents do the work in small, git-backed stages and you approve every handoff. Free, open source, runs on your machine.">
<meta property="og:title" content="Aira — Jira for the AI era">
<meta property="og:description" content="From ideas to impact. Agents do the work in small git-backed stages. You approve every handoff.">
<meta property="og:image" content="https://bridza.erluxman.dev/og.png">
```
(Note: `og:image` URL host stays `bridza.erluxman.dev` — domain rename is out of scope, see context.md §Out of scope.)

## In-app product line (onboarding, empty states)
`Small stages. Real gates. Git as truth.`

## Vocabulary — use / avoid
| Use | Instead of |
|---|---|
| stage, handoff, gate | step, phase, checkpoint, approval flow |
| task, board, pipeline | ticket, kanban, workflow (except when explicitly explaining Jira parity) |
| agent, AI CLI | bot, copilot, assistant (except "AI Assistant" nav label if one is ever added) |
| approve, review, sign off | validate, confirm, accept |
| on your machine, in git | locally, offline, secure |

**Don't:** "Revolutionary", "magic", "10x", "autonomous" without a gate in the same sentence. Imply the AI ships releases on its own. Feature-parity language against Jira (integrations, permissions, SSO). Exclamation marks, emoji in product copy, hype adjectives.

## Important: real app nav labels are unchanged
Brand-board mockups (§9) show a generic PM app with nav "Home / Projects / AI Assistant / Issues / Reports / Settings" — **that is reference imagery only**. Aira's real app keeps its real nav: **Board / Pipelines / Tasks / Plan / Settings** (see `src/app/features/nav.jsx`, `flow.jsx`, `plan.jsx`, `task.jsx`). Apply the visual treatment (colors, type, spacing), never the mockup's labels.
