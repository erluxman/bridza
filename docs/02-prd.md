# Stagepipe — Product Requirements Document (PRD)

Every requirement has an ID (`FR-<AREA>-<n>`), acceptance criteria, and a
status. Status legend:

- ✅ **Implemented** — built and verified in the current app
- 🔮 **Simulated** — built with high-fidelity fake data/behavior; the real
  integration (LLM, git, terminal, backend) is future work
- 🟡 **Partial** — some acceptance criteria unmet
- 🎨 **Decorative** — visible in the UI but intentionally non-functional
- ❌ **Not built**
- 🗑️ **Dropped** — existed in an earlier design iteration, absent from the
  final prototype and the implementation

Cross-references: test cases in [03-test-cases.md](03-test-cases.md), edge
cases in [04-edge-cases.md](04-edge-cases.md), gaps and sequencing in
[05-backlog-and-roadmap.md](05-backlog-and-roadmap.md).

**Fixture rule:** Stagepipe is a generic tool. Requirements below describe the
engine and its behaviors; any specific stage names, workspace names, counts, or
prompt texts mentioned are *current seed data* for illustration only and live
authoritatively in [06-demo-fixtures.md](06-demo-fixtures.md). Never treat
demo content as spec.

---

## 1. CORE — Generic pipeline engine & built-in types

**FR-CORE-1 — One generic type engine.** ✅
A pipeline *type* is pure data with a single schema:
`{ id, label, icon, tagline, noun, plural, sidebar, work, outputKind,
costLabel, flagIcon, flagLabel, branchLabel, typeName, accent, stages[],
channels[], cards[] }`. No per-type code branches; the only things that differ
between types are the stages, the files each stage writes, the commands each
stage runs, and a small set of configurable labels.
*AC:* adding a type object makes it fully functional across board, conveyor,
diff, Stage Manager, inbox, TUI with zero code changes.

**FR-CORE-2 — Stage schema.** ✅
Every stage carries: `id, name, hint, sys` (system prompt), `cmd {llm,
shell[]}`, `outputs [Artifact{name,type,note}]`, `inputs` (defaults to the
previous stage's outputs when null), `auto` (automation default), `gate`
(acceptance gate label), `preview/previewRev` (demo output), `failFirst`
(optional simulated first-run failure).

**FR-CORE-3 — Pure-function I/O chaining.** ✅
A stage's inputs are exactly the previous stage's outputs (unless explicitly
overridden in the stage config). Visible in the conveyor's Input step, the
Stage Manager's READS section, and the diff view's `in · X → stage → out · Y`
chain.

**FR-CORE-4 — Starter templates, not hardcoded modes.** ✅
The product ships with **editable starter templates** — currently Video, Dev,
Marketing, Sales, Research — defined entirely as data through the same schema
any user-built type uses. Their specific stage lists, stage counts, workspace
names, gates, prompts, and sample cards are **seed content, not requirements**
— catalogued in [06-demo-fixtures.md](06-demo-fixtures.md) and replaceable
without touching engine code.
*AC:* editing or replacing a template's data changes the product everywhere
(board, conveyor, diff, Stage Manager, inbox, TUI) with no code change; a
template is indistinguishable from a builder-made type at runtime.

**FR-CORE-5 — No artificial scale limits.** ✅ (extremes untested — see
EC-BLD-02/03)
The engine supports an arbitrary number of types, stages per type, workspaces
per type, and cards per workspace. The UI degrades gracefully at the extremes
(board columns scroll horizontally; the TUI stage rail wraps; a one-stage
pipeline is valid).

**FR-CORE-6 — Engine code never branches on a template id.** 🟡
No `if (type === "video")`-style logic in engine or UI code; all per-type
variation flows through the type's data (labels, outputKind, stages).
*Known violations (code debt, P1-13):* static `modeIds` list that
`registerType` doesn't extend (TUI tabs seed from it, so runtime types may be
missing there); App's stale-mode fallback hardcodes `"video"` instead of
"first registered type"; a `mode === "video"` cost special-case in `makeCard`.
Full list in [06-demo-fixtures.md](06-demo-fixtures.md).

**FR-CORE-7 — Per-stage system prompts are real and stage-specific.** ✅
Every stage carries its own working system prompt as data (demo prompt texts
are fixtures — examples in [06-demo-fixtures.md](06-demo-fixtures.md)).

**FR-CORE-8 — Runtime type registry.** ✅ (in-session)
`registerType` adds a builder-made type to the live registry at runtime; it
appears in the type switcher, sidebar, and tweaks (TUI gap noted under
FR-CORE-6). *Known limitation:* not persisted — a reload drops runtime types
(see FR-ENG-2).

---

## 2. NAV — Navigation, topbar, breadcrumbs

**FR-NAV-1 — Three navigation axes.** ✅
Type (video/dev/marketing/sales/research/custom…) × workspace (channel/project/
brand/pipeline) × view (board / inbox / stage-flow / card detail / builder).

**FR-NAV-2 — Breadcrumb format.** ✅
`<TypeLabel + type icon> › <Workspace name + glyph> › #<ref> <Task title>` —
**no stage, no status** in the breadcrumb (explicit user requirement, chat1).
Inbox view shows `… › Inbox`; Stage Manager shows `… › Stage Manager`.
Workspace crumb click returns to its board.

**FR-NAV-3 — Type switcher dropdown** ✅ in the topbar listing all live types
(built-in + runtime) plus a **"New type…"** entry that opens the Type Builder.

**FR-NAV-4 — GUI | TUI segmented control** ✅ in the topbar; switches the whole
chrome (FR-TUI-*).

**FR-NAV-5 — Search (⌘K), Filter, Group-by-stage, notification bell, user
menu.** 🎨 Decorative by design decision; flagged in design review as
"wire or hide" (backlog).

---

## 3. WS — Workspaces (channels/projects/brands/pipelines)

**FR-WS-1 — Workspace list per type** ✅ in the sidebar under a per-type label
(Channels/Projects/Brands/Pipelines/Workspaces), each with glyph, name,
handle/kind line, and color.

**FR-WS-2 — Create workspace.** ✅
"+ New <noun>" composer at the sidebar footer (label adapts per type). Creating
lands on a fresh empty board with all stage columns ready and zero items, shows
a toast.

**FR-WS-3 — Archive / hide workspace.** ✅
Hover action archives; archived workspaces collect in a collapsible
"Archived (n)" section; restore via eye button. Archiving the active workspace
auto-switches to the next visible one.

**FR-WS-4 — Drag workspaces into folders.** ✅
Dragging one workspace onto another forms an iOS-style icon folder (2×2 mini
glyph thumbnail + "N workspaces" count). Click expands members inline; drop
more to add; per-member "move out"; folder auto-dissolves below 2 members;
folder name inline-editable.

**FR-WS-5 — Workspace-specific pipelines.** ✅
Each workspace inherits its type's default stages until customized; the first
Stage-Manager edit forks a private copy (badge flips "inherits <Type> default"
→ "CUSTOM PIPELINE", Reset appears). Board, conveyor, mobile-less GUI, and TUI
all resolve stages per `(type, workspace)` via `resolveStages`.

**FR-WS-6 — Per-type folder/archive state isolation.** ✅ Folders and archived
sets are kept per type.

---

## 4. BRD — Kanban board

**FR-BRD-1 — Stage columns** ✅ — one column per resolved stage, header with
stage name, count, hint line, and a "+" quick-add.

**FR-BRD-2 — Cards** ✅ — type tag (Feature/Bug/Campaign/Deal/…), `#ref`,
title, branch/asset ref in mono, progress bar + %, meta row (time, tests,
subtask/flag counts per type), updated-ago. Two card styles: detailed /
minimal (FR-SET-5).

**FR-BRD-3 — Inline card composer.** ✅
"New <noun>" button and column "+" open an inline composer that creates a real
card in that stage; the card pops in with a flash highlight (~1.7s), counts
update, composer stays open for rapid entry.

**FR-BRD-4 — Drag-and-drop between columns.** ✅
HTML5 drag; drop target column highlights; card's stage updates and
"updated: just now"; counts update. Dropping on the same column is a no-op.

**FR-BRD-5 — Card flash on external creation** ✅ (promote from inbox, voice →
board in earlier design) — board scrolls to/flashes the new card and a toast
confirms ("Added to <Stage> → <ref>").

**FR-BRD-6 — Board header** ✅ — workspace glyph + name, handle · "N <plural>
in pipeline", New-task button.

**FR-BRD-7 — Drag-reparent subtasks in the tree.** ❌ Not built (explicitly
listed as remaining in chat2).

---

## 5. DET — Card detail (conveyor host)

**FR-DET-1 — Header block** ✅ — type chip, `#ref`, title, resolution badge
(**Breaks down** ⌄ / **Implementation**), description line ("Each stage hands
the next a complete contract — In Dev never re-reads the original ticket, only
the spec.").

**FR-DET-2 — Session/tracking bar.** ✅🔮
Live auto-tracked clock attributed to the **active stage** ("25:16 · In Dev
stage · auto-tracked"), agent chip (e.g. Claude Code), **Open external
editor** affordance (pauses tracking when leaving the app — simulated).

**FR-DET-3 — Work-mode tabs: Plan / Code / Agent.** ✅🔮
- **Plan** — the conveyor console (FR-GEN-*) with Flow/Changes sub-tabs.
- **Code** (label = type's `work`: Studio/Code/Assets/Notes/Report) — the
  cumulative file diff (FR-DIF-7).
- **Agent** — terminal-style transcript with a configurable agent picker
  (demo list in [06-demo-fixtures.md](06-demo-fixtures.md)) and exchange
  count. Tailored demo transcripts exist for two templates; the rest use a
  generic fallback (known cosmetic gap).

**FR-DET-4 — Right rail.** ✅🔮
Overall % ring · time tracked · cost (per-type label: $compute/token cost/ad
spend/deal value) · flag count (failing tests/Whisper flags/review flags/risks)
· branch count (branches/cuts/assets/threads).

**FR-DET-5 — Time by stage breakdown.** ✅
Bar per stage, live dot + ticking bar on the active stage, peak stage
highlighted amber with callout "<Stage> is the biggest sink — N% of tracked
time. Optimize here first." Ticket total = sum of stages.

**FR-DET-6 — AI activity log.** ✅🔮
Per-stage entries: agent name, what it did, exchanges, minutes, cost.

**FR-DET-7 — Acceptance gate panel** ✅ — driven by the active stage's `gate`
(e.g. "Build green", "Brand check passed", "Legal sign-off + Quote").

**FR-DET-8 — Subtask tree.** ✅
Nested subtasks with kind icons (breakdown/implementation), own `#ref`s,
branches, progress. **Clickable** — opens the subtask as its own card with its
own conveyor, session, and stepper (true recursion). Children carried via the
node's `children`.

**FR-DET-9 — Rail advance button mirrors the belt.** ✅
Label adapts to conveyor state: *Generate stage → Approve & pass on → Next
stage → Re-run outdated → Retry stage*. (The "one primary action" cleanup —
demoting one of the two — remains an open UX item.)

**FR-DET-10 — Checklist per stage with tickable items.** ✅ (per-card
`checklist[stageId]`, toggled from the detail view; feeds progress.)

**FR-DET-11 — New/empty cards open gracefully** ✅ — empty checklist and AI
log handled.

---

## 6. GEN — Conveyor: generation, gates, automation, staleness

**FR-GEN-1 — Stage stepper.** ✅
All stages as chips with per-stage status — **Approved ✓ / Review ◆ / Running ◌
/ Outdated ▲ / Queued ·** — plus per-stage tracked time. Click any stage to
inspect it (approved stages stay revisitable).

**FR-GEN-2 — Four-step belt per stage.** ✅
1. **Input** — previous stage's output artifacts, read-only, labeled
   "inherited from <Stage>" / "the only thing this stage sees".
2. **System prompt** — hidden behind a 🔒 **Confirm to edit** gate; confirming
   reveals an editable textarea with a "changes behaviour for every run"
   warning.
3. **Your prompt** — empty textarea for overrides/details + **Attach files**
   (adds removable chips).
4. **Output** — Generate → streaming → output files + preview → approve.

**FR-GEN-3 — Commands strip.** ✅
Each stage displays the `llm` call and `sh` commands it runs on generate.

**FR-GEN-4 — Streaming generation.** ✅🔮
Output streams word-by-word with a live cursor; stage shows **Running /
Generating…** during the stream.

**FR-GEN-5 — Approve & pass on.** ✅
"Looks good — complete & pass to <next stage>" locks the output, marks the
stage Approved, advances the belt; the next stage's Input is exactly this
stage's outputs. At the final stage, approval completes the pipeline.

**FR-GEN-6 — Regenerate / Tweak & regenerate / Looks wrong.** ✅
Regenerate re-runs the active stage (storing the previous output for diff);
"Tweak & regenerate" jumps to the prompt; "Looks wrong" provides the rejection
path on good-looking output.

**FR-GEN-7 — Supervised | Automate per stage.** ✅
Segmented switch on every stage; default **Supervised**. An **Automation bar**
summarizes "N of M stages run autonomously" with **Automate routine** (applies
whichever stages the type's data marks `auto` — a per-template setting, not a
hardcoded list) and **All supervised** reset.

**FR-GEN-8 — Run pipeline (auto-run with real gates).** ✅
Runs the belt stage-by-stage: auto-advances through Automated stages, **stops
at the next Supervised stage** with an "Approve & continue" gate; live banner +
Stop. No blanket auto-approve.

**FR-GEN-9 — Failure / retry states.** ✅🔮
A stage's first fresh run can fail (typed errors: timeout, refusal, failing
checks, low confidence — one flavor per type via `failFirst`). Failure **halts
the run even on an Automated stage**, flips the rail action to *Retry stage*,
and offers **Retry** and **Edit prompt & retry**. Second attempt succeeds
(simulated).

**FR-GEN-10 — Outdated cascade.** ✅
Re-generating an earlier stage flips every downstream Approved/stale stage to
**Outdated** (amber ▲) with a warning banner, a **Re-run outdated** bulk
action, and per-stage "Re-run with the new input" / "Keep as-is" choices.

**FR-GEN-11 — Stage output diff (old↔new).** ✅
Re-running a stage stores the prior output and reveals a word-level diff
toggle (insertions/deletions highlighted) so the cascade is actionable.

**FR-GEN-12 — Flow / Changes tabs on the console.** ✅
*Flow* = the belt. *Changes* = only the **active stage's** file changes
(FR-DIF-6), synced to the stepper, with hint text pointing to the work tab for
the cumulative view.

---

## 7. DIF — File-change engine (real diffs)

**FR-DIF-1 — Real file contents per stage.** ✅🔮
Stages produce actual file content appropriate to the type's `outputKind` —
code (TS/TSX/JSON) for code types, Markdown/JSON/text for doc types (the
specific showcase files are fixtures — [06-demo-fixtures.md](06-demo-fixtures.md)).
Content flows down the pipeline: a creating stage adds files (ADDED); later
stages *modify the same files* (MODIFIED).

**FR-DIF-2 — True diff algorithm.** ✅
LCS line diff + intraline word-level highlights; per-file +/− counts; Unified
and Split views (split columns wrap, no overflow).

**FR-DIF-3 — Regenerate mutates content.** ✅🔮
Believable random edits (rename a variable, bump a number, insert/remove a
line, edit a string); previous output becomes the new baseline; run #
increments; "Re-run diff" shows exactly what changed. Upstream regenerates
cascade downstream as stale re-flows.

**FR-DIF-4 — Minimal change per stage.** ✅ *(core promise)*
Each stage touches one focused primary artifact; secondary outputs are listed
as "also produced" values, not file diffs.

**FR-DIF-5 — Completion gating.** ✅ *(core promise)*
Only stages that have actually produced output contribute files. A card at
stage 3 shows 3 files; at stage 1, 1 file. Header: "N files changed · N of M
stages done". Empty state before any stage completes: "Nothing to review yet —
each stage adds one small, focused change." Regenerate is scoped to completed
stages — counts never balloon.

**FR-DIF-6 — Per-stage view (Changes tab beside the flow).** ✅
Shows **only the active stage's files**, with `in · <prev> → <stage> → out ·
<next>` header and **Regenerate stage**. Never inflates as the belt advances.

**FR-DIF-7 — Cumulative view (work tab / "Studio").** ✅
All files changed up to the current stage across all completed stages, with
**Regenerate task**. Per-stage and cumulative read the same evolving content
and stay consistent.

**FR-DIF-8 — Flow rail (full-width diff view).** ✅
Stage chips with live file counts and +/− stats across the pipeline; values
(non-file artifacts: branch refs, build.ok, etc.) listed separately.

---

## 8. SM — Stage Manager (n8n-style flow editor)

**FR-SM-1 — Node canvas.** ✅
`Capture → stage → … → Delivered` as connected nodes on a dotted canvas with
output→input ports, handoff-labeled edges, zoom (% control) + pan.

**FR-SM-2 — Node anatomy.** ✅
READS (exactly the previous stage's outputs, or "from <node #>"), system-prompt
excerpt, command line (`claude -p …` style), WRITES (editable artifact name +
type selector + remove, "+ output"), "+N reference docs", footer: Edit ·
Changes (live +/− stats) · duplicate · delete. Inline rename. AUTO badge on
automated stages, REVIEW on supervised.

**FR-SM-3 — Reference documents bar.** ✅
Project/meta docs (project-brief.md, dev-goals.md, <ws>.context) "available to
every stage as context"; add/remove.

**FR-SM-4 — Dynamic add / insert / delete with auto-relink.** ✅
"Add stage" appends; "+" on any wire inserts a node there and the chain
re-links (new node reads its predecessor's outputs; successor reads the new
node's outputs); delete re-links around the removed node.

**FR-SM-5 — Inspector (slide-over) with Flow / Code changes tabs.** ✅
Flow: name, description, system prompt, LLM + terminal commands, automation,
acceptance gate. Code changes: that single stage's real diff (embedded
FilesDiff with in→stage→out chips and per-stage Regenerate).

**FR-SM-6 — Workspace-specific pipelines + import/duplicate/reset.** ✅
Header badge "inherits <Type> default" → "CUSTOM PIPELINE" on first edit, with
Reset. **Import stage** modal lists every stage from every type and every
customized workspace (with their output files) — one click copies it in.
Duplicate clones a stage in place.

**FR-SM-7 — Edits write to the live type/workspace** ✅ so board, conveyor,
and TUI stay in sync. (In-session only — FR-ENG-2.)

---

## 9. BLD — Type Builder

**FR-BLD-1 — Full-screen builder** ✅ reachable from the type switcher's
"New type…"; template-seeded and configurable from the first keystroke.

**FR-BLD-2 — Identity panel** ✅ — type name, noun, icon, accent, labels;
pipeline map preview.

**FR-BLD-3 — Stage rail + editor.** ✅
Reorder/add/remove stages; per stage: name + description, system prompt,
LLM + terminal commands, output files with types, **inputs relationship**
(which prior outputs feed in), automation default, acceptance gate.

**FR-BLD-4 — Create → live type.** ✅
Registers the type, seeds it with two sample cards ("Your first <noun>",
"Example <noun> in progress" @35%), creates its first workspace, switches to
its board, shows toast "Created type · <label>". Cancel returns to the board.

**FR-BLD-5 — Research-style demo viability** ✅ — a created type is fully
working: own board, stages, conveyor, Stage Manager, TUI presence.

---

## 10. INB — Triage inbox

**FR-INB-1 — Tabbed triage surface.** ✅
**All / Ideas / Bugs / Features** tabs across all types; per-type item lists
(inbox badge in sidebar shows count for the current type).

**FR-INB-2 — Item anatomy.** ✅
Kind chip (idea/bug/feature), text, meta row — bugs carry **severity badges** +
reporter; features carry **vote counts**; source (voice/text) where relevant.

**FR-INB-3 — Promote with workspace picker.** ✅
"→ Backlog" opens **"Send to which workspace?"** listing the type's workspaces
with the item's origin tagged *suggested* (no auto-routing). Promotion creates
a real card in that workspace's **first stage** (bug items become type Bug),
removes the inbox item, decrements the badge, switches board/workspace, flashes
the card, and toasts "Added to <Stage> → <ref>".

**FR-INB-4 — Cross-type promote** ✅ — promoting an item whose `mode` differs
from the current type switches type first.

---

## 11. TUI — Terminal interface

**FR-TUI-1 — Toggle + chrome.** ✅
GUI|TUI control swaps the entire shell. Terminal window with traffic-light
dots, `stagepipe — ~/pipelines/<type> — zsh` titlebar, flow tabs (one tab per
registered type, active bracketed, plus `+ new` — runtime-type gap noted under
FR-CORE-6), sidebar (views + workspaces), vim/lazygit-style status bar with
live keybindings, ◂ GUI exit.

**FR-TUI-2 — TUI board.** ✅
Stage columns with `┤ Stage n ├` headers, ASCII progress bars, type tags, focus
cursor; create (`+ new` / `n`), move card across stages (`<` `>`), full
arrow/hjkl navigation.

**FR-TUI-3 — TUI conveyor detail.** ✅
**Horizontal** pipeline rail — wrapping stage chips with arrows, max ~2 lines
even for 8 stages, status label only on active/running/outdated stages
(`✓ approved · ◆ review · ◌ running · ▲ outdated · · queued`); active-stage
belt (input → system → prompt → output) with streaming generation; `[g]`
generate / `[a]` approve; click-to-jump on chips.

**FR-TUI-4 — TUI outdated cascade** ✅ — amber ▲ downstream, warning banner,
`re-run [R]`.

**FR-TUI-5 — TUI inbox** ✅ — tabbed triage, `→ backlog` promote, status-bar
toast.

**FR-TUI-6 — TUI recursive subtasks** ✅ — a subtask opens its own pipeline.

**FR-TUI-7 — TUI stage-flow + builder ASCII panels** ✅ (`pms-tui-edit`).

**FR-TUI-8 — Self-contained state.** ✅
TUI clones PMS_DATA so GUI state is never touched; shares the `useConveyor`
engine and the same data definitions.

**FR-TUI-9 — TUI scope exclusions (by design):** voice capture and
attach-files live only in the GUI.

---

## 12. SET — Settings, theming, tweaks

**FR-SET-1 — Settings panel.** ✅
Floating panel (draggable, viewport-clamped) opened by a launcher button
(bottom-right). Sections: Workflow (pipeline type, dark theme), Density & type
(density, font), Look (accent, card style), Jump to (board / stage flow /
inbox).

**FR-SET-2 — Light/dark theme** ✅ via `data-theme` on `<html>`; full token
system in CSS variables; TUI and builder have scoped palettes.

**FR-SET-3 — Density: compact / comfortable.** ✅

**FR-SET-4 — Font family** ✅ — Instrument Sans (default), Plus Jakarta Sans,
IBM Plex Sans, Space Grotesk; JetBrains Mono for code/TUI.

**FR-SET-5 — Accent color (5 options) + card style detailed/minimal.** ✅

**FR-SET-6 — Persistence.** ✅ (implementation addition)
Settings persist to `localStorage["stagepipe-tweaks"]`; corrupt/missing data
falls back to defaults; a saved mode pointing at a vanished runtime type falls
back to Video.

---

## 13. TRK — Time & AI tracking

**FR-TRK-1 — Per-stage time attribution.** ✅
The live clock runs against the **active stage** and follows stage switches.
Each stage shows its own time in the stepper and the belt header ("9m 03s on
this stage").

**FR-TRK-2 — Bottleneck visibility.** ✅
"Time by stage" rail chart, live tick, amber peak, "optimize here first"
callout; ticket total = Σ stage times.

**FR-TRK-3 — Pause on leaving the app.** 🔮 "Open external editor" affordance
exists; real focus/blur detection not wired.

**FR-TRK-4 — Per-stage AI usage** (agent, exchanges, minutes, cost). ✅🔮

**FR-TRK-5 — Cross-ticket rollup** ("QA eats 40% everywhere"). ❌

**FR-TRK-6 — Estimates vs actuals per stage.** ❌

**FR-TRK-7 — Outcome metrics per type** (velocity, win rate, ROAS, publish
cadence) replacing token-vanity metrics. ❌ (Slice 3.)

---

## 14. MOB — Mobile & voice capture *(dropped from final design)*

The v1/v2 design (chat1–2) included a phone-frame mobile view — single-column
stage-filtered list, functional type/workspace switching, hold-to-talk voice
capture whose transcript could "Send to board" (creating a real card) or "Keep
in Inbox". During the chat4 generic-engine rewrite these surfaces were edited,
but the **final exported prototype does not load any mobile module**, and the
implementation matches the final prototype.

**FR-MOB-1 — Mobile single-column view.** 🗑️ Dropped from final design.
**FR-MOB-2 — Voice capture → board/inbox.** 🗑️ Dropped from final design.
**FR-MOB-3 — Phone-styled card detail.** ❌ (was a known gap even in v2).
*(Responsive behavior of the desktop GUI on small screens: untested/not a
requirement yet — see backlog.)*

---

## 15. ENG — Engineering / non-functional (implementation phase)

**FR-ENG-1 — Tech stack.** ✅ Vite + React 18, ES modules (no Babel-standalone,
no window globals), CSS custom-property token system, Google Fonts.

**FR-ENG-2 — Persistence of user data.** ❌
Cards, runtime types, workspace pipelines, folders/archive state, inbox are
in-memory and reset on reload (prototype-faithful). Settings only (FR-SET-6)
persist. A storage layer (localStorage first, backend later) is the top
engineering gap.

**FR-ENG-3 — Real LLM integration.** ❌ (all generation simulated; see
FR-GEN-4/9, FR-DIF-3).

**FR-ENG-4 — Real file-system/git/terminal integration.** ❌ (branches, diffs,
shell commands simulated).

**FR-ENG-5 — Multi-user / auth / collaboration.** ❌ (single local user
"erluxman" hardcoded in sidebar footer).

**FR-ENG-6 — Automated test suite.** ❌ — no unit/e2e tests yet; manual
verification only (see 03-test-cases.md for the manual suite to automate).

**FR-ENG-7 — Accessibility.** 🟡
Known gaps from design review: status encoded mostly in color, thin GUI
keyboard support (TUI is better), 11–12px type in places. Non-color status
pass is backlog (Slice 2).

**FR-ENG-8 — Production build.** ✅ `npm run build` passes; ~360 KB JS,
~120 KB CSS (pre-gzip).

**FR-ENG-9 — Clean console.** ✅ zero errors/warnings across all exercised
surfaces.
