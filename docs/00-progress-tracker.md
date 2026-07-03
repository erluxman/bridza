# Stagepipe — Progress Tracker

Master checklist. One line per PRD requirement (details in
[02-prd.md](02-prd.md)). Update this file as work lands.

Legend: `[x]` implemented · `[s]` simulated (UI real, integration fake) ·
`[~]` partial · `[d]` decorative · `[ ]` not built · `[-]` dropped from design.

## Core engine & types
- [x] FR-CORE-1 One generic type engine (types are pure data)
- [x] FR-CORE-2 Full stage schema (sys/cmd/outputs/inputs/auto/gate/…)
- [x] FR-CORE-3 Pure-function I/O chaining (prev outputs = next inputs)
- [x] FR-CORE-4 Editable starter templates (seed content lives in [06-demo-fixtures.md](06-demo-fixtures.md), not spec)
- [x] FR-CORE-5 No artificial scale limits (types/stages/workspaces/cards; extremes untested)
- [x] FR-CORE-6 Engine never branches on a template id (fixed 2026-06-10: live `modeIds` getter, first-type fallback, cost → type data; unit-tested)
- [x] FR-CORE-7 Real per-stage system prompts (prompt texts are fixtures; persisted as markdown body)
- [x] FR-CORE-8 Runtime type registry (dynamic; persisted to `.luxpms/types/` when a repo is attached)

## Navigation
- [x] FR-NAV-1 Type × workspace × view axes
- [x] FR-NAV-2 Breadcrumb `Type › Workspace › #ref Task` (no status)
- [x] FR-NAV-3 Type switcher + "New type…"
- [x] FR-NAV-4 GUI | TUI toggle
- [d] FR-NAV-5 Search ⌘K / Filter / Group / bell / user menu (decorative → P1-6/P1-7)

## Workspaces
- [x] FR-WS-1 Per-type workspace lists with per-type nouns
- [x] FR-WS-2 Create workspace (empty board)
- [x] FR-WS-3 Archive / restore (auto-switch on archiving active)
- [x] FR-WS-4 Drag-to-folder (iOS-style, dissolve <2, rename)
- [x] FR-WS-5 Workspace-specific pipelines (inherit → fork → reset)
- [x] FR-WS-6 Per-type folder/archive isolation

## Board
- [x] FR-BRD-1 Stage columns with counts/hints
- [x] FR-BRD-2 Cards (tags, refs, branch, progress, per-type meta)
- [x] FR-BRD-3 Inline composer (+ flash, rapid entry)
- [x] FR-BRD-4 Drag-and-drop across columns
- [x] FR-BRD-5 Flash + toast on external card creation
- [x] FR-BRD-6 Board header
- [ ] FR-BRD-7 Drag-reparent subtasks in tree (P2-9)

## Card detail
- [x] FR-DET-1 Header (type, ref, resolution badge)
- [s] FR-DET-2 Session bar (live per-stage clock; external-editor pause simulated)
- [s] FR-DET-3 Plan / Code / Agent tabs (agent transcripts simulated; mkt/sales generic — P2-10)
- [s] FR-DET-4 Right rail stats (per-type cost/flag/branch labels)
- [x] FR-DET-5 Time-by-stage breakdown + bottleneck callout
- [s] FR-DET-6 AI activity log
- [x] FR-DET-7 Acceptance gate panel (per-stage gate)
- [x] FR-DET-8 Clickable recursive subtasks
- [x] FR-DET-9 Rail advance button mirrors belt (cleanup → P1-4)
- [x] FR-DET-10 Per-stage checklists
- [x] FR-DET-11 New/empty cards open gracefully

## Conveyor: generation & gates
- [x] FR-GEN-1 Stepper (approved/review/running/outdated/queued + time)
- [x] FR-GEN-2 Four-step belt (input / locked sys prompt / user prompt+attach / output)
- [x] FR-GEN-3 Commands strip (llm + shell)
- [s] FR-GEN-4 Streaming generation (simulated)
- [x] FR-GEN-5 Approve & pass on (advances belt, hands off outputs)
- [x] FR-GEN-6 Regenerate / Tweak & regenerate / Looks wrong
- [x] FR-GEN-7 Supervised | Automate per stage + automation bar + routine preset
- [x] FR-GEN-8 Run pipeline pauses at supervised gates
- [s] FR-GEN-9 Failure/retry (typed errors; halts automated runs)
- [x] FR-GEN-10 Outdated cascade (banner, re-run, keep-as-is)
- [x] FR-GEN-11 Old↔new output word diff
- [x] FR-GEN-12 Flow / Changes tabs on console

## File-change engine
- [s] FR-DIF-1 Real file contents flowing stage→stage
- [x] FR-DIF-2 LCS line + word diff, unified/split
- [s] FR-DIF-3 Regenerate mutates content (run #, baseline rolls)
- [x] FR-DIF-4 Minimal change per stage (one focused artifact)
- [x] FR-DIF-5 Completion gating ("N of M stages done", empty state)
- [x] FR-DIF-6 Per-stage view (Changes tab, never inflates)
- [x] FR-DIF-7 Cumulative view (work tab "Studio")
- [x] FR-DIF-8 Flow rail with per-stage +/− stats

## Stage Manager
- [x] FR-SM-1 Node canvas (ports, labeled edges, zoom/pan)
- [x] FR-SM-2 Node anatomy (READS/WRITES, prompt, cmd, badges)
- [x] FR-SM-3 Reference documents bar
- [x] FR-SM-4 Add / insert-on-wire / delete with auto-relink
- [x] FR-SM-5 Inspector tabs (Flow / Code changes)
- [x] FR-SM-6 Workspace badge + import + duplicate + reset
- [x] FR-SM-7 Edits write to live type (in-session — needs P0-1)

## Type Builder
- [x] FR-BLD-1 Full-screen, template-seeded
- [x] FR-BLD-2 Identity panel + pipeline map
- [x] FR-BLD-3 Stage rail + full stage editor
- [x] FR-BLD-4 Create → registered type + seed cards + board
- [x] FR-BLD-5 Created types fully functional end-to-end

## Inbox
- [x] FR-INB-1 All / Ideas / Bugs / Features tabs
- [x] FR-INB-2 Severity badges, reporters, votes
- [x] FR-INB-3 Promote with workspace picker (suggested tag)
- [x] FR-INB-4 Cross-type promote

## TUI
- [x] FR-TUI-1 Toggle + terminal chrome + status bar
- [x] FR-TUI-2 Board (ASCII bars, hjkl, n, < >)
- [x] FR-TUI-3 Conveyor (horizontal rail ≤2 lines, [g]/[a], streaming)
- [x] FR-TUI-4 Outdated cascade
- [x] FR-TUI-5 Inbox + promote
- [x] FR-TUI-6 Recursive subtasks
- [x] FR-TUI-7 TUI stage-flow + builder panels
- [x] FR-TUI-8 State isolation from GUI
- [x] FR-TUI-9 Scope exclusions documented (voice/attach GUI-only)

## Settings
- [x] FR-SET-1 Floating panel + launcher button
- [x] FR-SET-2 Light/dark token system
- [x] FR-SET-3 Density compact/comfortable
- [x] FR-SET-4 Font family (4)
- [x] FR-SET-5 Accent (5) + card style (2)
- [x] FR-SET-6 localStorage persistence + corruption/stale-mode guards

## Time & AI tracking
- [x] FR-TRK-1 Per-stage time attribution (live, follows active stage; **persisted 2026-06-11** to `.luxpms/time.json` in repo mode — flush on stage switch / 10s / close, hydrate on card open; demo mode stays in-memory fixture)
- [x] FR-TRK-2 Bottleneck visibility ("optimize here first")
- [s] FR-TRK-3 Pause on leaving app (affordance only)
- [s] FR-TRK-4 Per-stage AI usage (agent/exchanges/cost)
- [ ] FR-TRK-5 Cross-ticket rollup (P2-7)
- [ ] FR-TRK-6 Estimates vs actuals (P2-8)
- [ ] FR-TRK-7 Outcome metrics per type (P2-6)

## Mobile & voice
- [-] FR-MOB-1 Mobile single-column view (dropped from final design — P3-1)
- [-] FR-MOB-2 Voice capture → board/inbox (dropped — P3-1)
- [ ] FR-MOB-3 Phone-styled card detail (P3-3)

## Engineering
- [x] FR-ENG-1 Vite + React 18 ESM port (no globals/Babel)
- [~] FR-ENG-2 Persistence — **file-based, landed 2026-06-10** ([ADR-0001](adr/0001-file-based-storage.md)): markdown-primary `.luxpms/` tree in any folder. VS Code-style project menu (open folder via native picker, recents, close), per-project isolation, diff-aware saves that never touch an unedited folder, empty cold start + pipeline picker (only chosen templates are registered/written; one workspace named after the folder; monorepo = more workspaces). Remaining: conveyor run-state depth, file-watch live reload
- [~] FR-ENG-3 Real generation — **CLI tools landed 2026-06-11** ([ADR-0003](adr/0003-stage-execution-and-branch-model.md)): per-stage tool picker (Claude Code / opencode, `which`-detected), prompt assembled from the stage contract, streamed output in the belt. **Reply → stage output landed 2026-06-11**: the tool's reply becomes the belt's reviewable output, committed files feed the diff, run failures are typed (`unknown-tool/bad-ref/git/spawn/exit/shell`), and the exec run log persists across stage switches. Remaining: API tools (codex/openrouter)
- [~] FR-ENG-4 Real git integration — **branch model landed 2026-06-11** ([ADR-0003](adr/0003-stage-execution-and-branch-model.md)): issue → `luxpms/tasks/<ref>/base`; stage runs in worktree on `luxpms/tasks/<ref>/<stage>` branched from the previous stage's branch; commit only on success; belt shows diff vs previous branch (files + patch). **Re-run reset (fresh run), `cmd.shell` execution in the worktree, and worktree cleanup landed 2026-06-11.** Remaining: merge/PR flow
- [-] FR-ENG-5 Multi-user/auth — **dropped by design** ([ADR-0002](adr/0002-github-client-no-auth.md)): identity = git, access = repo permissions, collaboration = branches/PRs
- [~] FR-ENG-6 Automated tests — vitest harness live; **147 tests as of 2026-06-11**: unit (registry, ids, markdown round-trip, branch model, prompt assembly) + bridge integration (`bridge-run.test.js`: worktrees, commits, diffs, shell, fresh reset, cleanup against temp git repos with the stub tool) + prompt→diff e2e (`prompt-to-diff.test.js`: prompt-following fake opencode/claude binaries on PATH exercise the production arg contracts and prove the stage diff contains exactly the change the prompt asked for) + time store (`time-store.test.js`) + conveyor controller (`conveyor.test.jsx`: cascade, failure/retry, supervised gates) + TUI. Remaining: Playwright e2e (A6)
- [~] FR-ENG-7 Accessibility (non-color status, keyboard, type sizes — P1-3/P1-9)
- [x] FR-ENG-8 Production build green
- [x] FR-ENG-9 Clean console across all surfaces (incl. repo-attached mode)

---

**Rollup (104 requirement lines, excluding the 3 dropped):**
- Implemented `[x]`: **83**
- Simulated `[s]` (UI complete, real integration pending): **10**
- Partial `[~]`: **5** (FR-ENG-2/3/4/6/7)
- Decorative by decision `[d]`: **1** (FR-NAV-5)
- Not built `[ ]`: **5** (FR-BRD-7, FR-TRK-5/6/7, FR-MOB-3)

Detailed gaps and sequencing: [05-backlog-and-roadmap.md](05-backlog-and-roadmap.md).
