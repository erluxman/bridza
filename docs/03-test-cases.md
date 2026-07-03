# Stagepipe — Test Cases

Manual test suite (to be automated later — FR-ENG-6). IDs map to PRD
requirements ([02-prd.md](02-prd.md)). Status: ✅ verified in the current
implementation (2026-06-10 browser pass) · ⬜ written, not yet executed ·
🚫 blocked (requirement not built / dropped).

Conventions: "fresh app" = dev server, cleared localStorage, desktop viewport
(≥1280px), dark theme default.

---

## A. Engine & types (FR-CORE)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-CORE-01 | Every registered type loads | Switch type dropdown through **all** registered types (seed templates + any runtime types) | For each type, board renders one column per stage defined in that type's data (counts for current seed: [06-demo-fixtures.md](06-demo-fixtures.md)); no console errors | ✅ (seed templates) |
| TC-CORE-02 | Per-type labels are data-driven | For each type check sidebar section label, card noun, work-tab label, cost label, flag label, branch label | Each label matches that type's data fields (`sidebar`/`noun`/`work`/`costLabel`/`flagLabel`/`branchLabel`) — never a hardcoded string | ⬜ |
| TC-CORE-03 | I/O chaining default | Open any card, inspect stage N's Input step | Lists exactly stage N−1's outputs as defined in the type's data | ✅ |
| TC-CORE-04 | Stage-specific system prompts | Confirm-to-edit the system prompt on two different stages of two types | Each shows that stage's own `sys` text from data; no two stages share a generic prompt | ⬜ |
| TC-CORE-05 | Runtime type registration | Create a type in the builder | Appears in type dropdown, tweaks "Pipeline type", TUI flow tabs | ✅ (dropdown) ⬜ (TUI tab — expected to FAIL until P1-13: static `modeIds`) |
| TC-CORE-06 | Template edits propagate | Edit a seed template's stage in Stage Manager (type default, not workspace fork) | Board columns, conveyor, and TUI for inheriting workspaces all reflect the edit — proving templates aren't hardcoded | ⬜ |
| TC-CORE-07 | One-stage and many-stage pipelines | Build a 1-stage type and a 12-stage type | Both fully functional: board scrolls horizontally; TUI rail wraps; conveyor/diff/SM all work | ⬜ |

## B. Navigation (FR-NAV)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-NAV-01 | Breadcrumb format on card | Open a card | `<TypeIcon Type> › <Workspace> › #REF Title`; no stage/status text | ✅ |
| TC-NAV-02 | Crumb navigation | Click workspace crumb from card detail; click type crumb from inbox | Returns to board / board view | ⬜ |
| TC-NAV-03 | Inbox & Stage Manager crumbs | Open each view | `… › Inbox`, `… › Stage Manager` | ✅ (SM) ⬜ (Inbox) |
| TC-NAV-04 | New type entry | Type dropdown → "New type…" | Full-screen builder opens; Cancel returns to board | ✅ |
| TC-NAV-05 | Decorative chrome inert | Click search/filter/group/bell/avatar | Nothing breaks (no errors) | ⬜ |

## C. Workspaces (FR-WS)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-WS-01 | Create workspace | Sidebar "+ New <noun>" on any type, name "Test WS", confirm | Empty board with one column per stage of that type, "0 <plural> in pipeline", toast, sidebar entry with glyph | ⬜ |
| TC-WS-02 | Per-type noun on composer | Check button label in each type | New channel/project/brand/pipeline/workspace | ⬜ |
| TC-WS-03 | Archive + restore | Hover workspace → archive; expand "Archived (n)"; restore | Moves to archived section; restore returns it | ⬜ |
| TC-WS-04 | Archive active workspace | Archive the currently selected workspace | Selection auto-switches to next visible workspace; board updates | ⬜ |
| TC-WS-05 | Drag to folder | Drag workspace A onto workspace B | Folder forms: 2×2 thumbnail, "2 workspaces"; click expands members | ⬜ |
| TC-WS-06 | Folder add / move out / dissolve | Drop C onto folder; "move out" twice | 3 members → 2 → folder dissolves at 1, members return to list | ⬜ |
| TC-WS-07 | Folder rename | Click folder name, edit inline | New name sticks | ⬜ |
| TC-WS-08 | Pipeline fork per workspace | In Stage Manager edit a stage for workspace A only | A shows CUSTOM PIPELINE; workspace B board/conveyor still uses type default | ⬜ |
| TC-WS-09 | Pipeline reset | After fork, click Reset | Badge back to "inherits default"; stages revert | ⬜ |

## D. Board (FR-BRD)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-BRD-01 | Composer creates card | "New task" → type title → submit | Card appears in stage with flash; column count +1; pipeline total +1; composer stays open | ⬜ |
| TC-BRD-02 | Column + quick add | Click "+" on a non-first column | Composer opens for that stage; card lands there | ⬜ |
| TC-BRD-03 | Drag card across columns | Drag a Backlog card to Planning | Target highlights on hover; card moves; counts update; "updated just now" | ⬜ |
| TC-BRD-04 | Drag to same column | Drop card on its own column | No state change | ⬜ |
| TC-BRD-05 | Card meta per type | Compare a Dev card vs Sales card | Dev: tests/branch; Sales: value/threads etc. | ⬜ |
| TC-BRD-06 | Card style variants | Tweaks → card style minimal/detailed | Cards re-render accordingly | ⬜ |
| TC-BRD-07 | New card opens cleanly | Create card → open it | Detail renders; empty checklist/AI log don't error | ⬜ |

## E. Card detail & conveyor (FR-DET, FR-GEN)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-DET-01 | Full detail renders | Open the richest seed card (current fixture: Dev hero `#LZ-204`) | Header, session bar, Plan/work/Agent tabs, stepper, belt, rail stats, time-by-stage, AI activity, gate, subtasks | ✅ |
| TC-DET-02 | Stepper statuses + times | Inspect stepper on a mid-pipeline card | Approved/Review/Queued labels + per-stage times; active stage highlighted | ✅ |
| TC-DET-03 | Revisit approved stage | Click an Approved chip | Its belt opens read-only with produced output inspectable | ⬜ |
| TC-GEN-01 | Input step is read-only inherited | Stage N belt step 1 | Previous stage's artifacts; read-only label | ✅ |
| TC-GEN-02 | System prompt gate | Click "Confirm to edit" | Warning shown; textarea editable afterwards | ⬜ |
| TC-GEN-03 | User prompt + attach | Type into Your prompt; Attach files ×2; remove one | Chips add/remove correctly | ⬜ |
| TC-GEN-04 | Generate streams | Click Generate on a queued stage | Status Running; text streams word-by-word with cursor; ends "ready · review" | ✅ (via Regenerate) |
| TC-GEN-05 | Approve advances belt | Click "Looks good — complete & pass to <next>" | Stage → Approved; next stage active; its Input = this stage's outputs; next stage timer starts | ✅ |
| TC-GEN-06 | Approve at final stage | Approve the last stage | Pipeline completes; no crash; progress 100% | ⬜ |
| TC-GEN-07 | Supervised\|Automate switch | Toggle a stage to Automate | Badge flips REVIEW→AUTO; automation bar count updates | ⬜ |
| TC-GEN-08 | Automate routine preset | Click "Automate routine" on any type | Exactly the stages marked `auto` in that type's data flip to Auto; bar reads "k of M autonomous" matching the data | ⬜ |
| TC-GEN-09 | Run pipeline pauses at gate | Set stage k Automate, k+1 Supervised; Run pipeline | Auto-approves k, **stops** at k+1 with "Approve & continue" | ⬜ |
| TC-GEN-10 | Approve & continue | Click it at the paused gate | Run resumes through next automated stages | ⬜ |
| TC-GEN-11 | Failure halts automated run | Run a pipeline whose next fresh stage has failFirst, stage set to Automate | Typed error panel; run halts; rail = "Retry stage" | ⬜ |
| TC-GEN-12 | Retry succeeds | Click Retry after failure | Second run completes to ready | ⬜ |
| TC-GEN-13 | Edit prompt & retry | Use the alternate failure action | Prompt focused; regenerate works | ⬜ |
| TC-GEN-14 | Outdated cascade | On a fully-approved card, regenerate stage 2 | Stages 3+ flip Outdated (amber ▲); banner "N stages outdated" + Re-run outdated | ⬜ |
| TC-GEN-15 | Re-run outdated / keep as-is | Use both affordances on stale stages | Re-run regenerates with new input; keep-as-is clears flag | ⬜ |
| TC-GEN-16 | Old↔new output diff | After a regenerate, open View diff | Word-level insertions/deletions highlighted | ⬜ |
| TC-GEN-17 | Commands strip | Inspect belt | Shows stage's `llm` call + shell commands | ✅ (Stage Manager nodes) ⬜ (belt) |
| TC-GEN-18 | Rail button mirrors belt | Watch rail label across states | Generate stage → Approve & pass on → Next stage; Re-run outdated when stale; Retry on failure | ⬜ |
| TC-DET-04 | Subtask recursion | Click a subtask row | Opens as own card (#REF.n) with own conveyor/session; breadcrumb updates | ⬜ |
| TC-DET-05 | Checklist toggle | Tick/untick checklist items | Persists in card state; progress reflects | ⬜ |
| TC-TRK-01 | Live per-stage clock | Watch session bar 10s | Clock ticks; names active stage; stepper time for that stage ticks in sync | ✅ |
| TC-TRK-02 | Clock follows stage switch | Switch active stage | Session bar renames; new stage's time accrues; old stops | ⬜ |
| TC-TRK-03 | Bottleneck callout | Open time-by-stage rail | Peak stage amber + "biggest sink — N% … Optimize here first"; total = Σ stages | ✅ |
| TC-TRK-04 | Live % recalculation | Let clock run on active stage | Bars and % update live | ⬜ |

## F. File-change engine (FR-DIF)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-DIF-01 | Per-stage Changes tab | Card detail → Changes | Only active stage's files; `in·X → stage → out·Y`; Regenerate stage | ✅ |
| TC-DIF-02 | Real code content | Inspect the creating stage's files on a code-type card (current fixture: Dev/In Dev) | Real file content matching the type's `outputKind`, ADDED badges, "created by <stage> from <prev>'s output" | ✅ |
| TC-DIF-03 | Cross-stage modification story | Open a later stage of a card whose earlier stage created files | The same files, now MODIFIED, with true line+word diffs | ⬜ |
| TC-DIF-04 | Cumulative work tab | Open Code/Studio tab | "N files changed · k of M stages done"; union of completed stages' files | ⬜ |
| TC-DIF-05 | Completion gating | Open a stage-1 card vs stage-3 card | 1 file vs 3 files; queued stages contribute nothing | ⬜ |
| TC-DIF-06 | Empty state | Card with no completed stage → Changes | "Nothing to review yet — each stage adds one small, focused change." | ⬜ |
| TC-DIF-07 | Regenerate task (cumulative) | In work tab click Regenerate task | All completed-stage files flip MODIFIED; re-run diff visible; count unchanged | ⬜ |
| TC-DIF-08 | Regenerate stage (per-stage) | In Changes tab regenerate | Only that stage's files mutate; run # increments | ⬜ |
| TC-DIF-09 | Unified/Split toggle | Switch both views | Split = two wrapped columns, no overflow/hidden text | ⬜ |
| TC-DIF-10 | Per-file +/− and badges | Check file list | Counts match diff; A/M badges correct; values under "also produced" | ✅ (visual) |
| TC-DIF-11 | Belt advance grows cumulative by one stage | Approve a stage, recheck work tab | Exactly the newly completed stage's artifact joins; "k+1 of M stages done" | ⬜ |

## G. Stage Manager (FR-SM)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-SM-01 | Canvas renders | Nav → Stage flow | Capture + stage nodes, labeled edges, reference-docs bar, zoom %, Add stage, Import stage | ✅ |
| TC-SM-02 | READS = predecessor WRITES | Inspect adjacent nodes | Node N's READS list exactly node N−1's WRITES | ✅ (visual) |
| TC-SM-03 | Insert on wire + auto-relink | Click "+" on a wire | New node inserted; reads predecessor's outputs; successor reads "from <new>" | ⬜ |
| TC-SM-04 | Append / delete / rename | Add stage; delete a middle node; inline-rename | Chain stays linked; no orphan edges | ⬜ |
| TC-SM-05 | Edit outputs on node | Rename an artifact, change its type, add/remove output | Downstream READS update; conveyor Input step matches | ⬜ |
| TC-SM-06 | Inspector Flow tab | Edit name/sys/commands/automation/gate | Saved to live stage; conveyor reflects (e.g. AUTO badge) | ⬜ |
| TC-SM-07 | Inspector Code-changes tab | Open Changes on a node | Embedded single-stage diff with regenerate | ✅ (button+stats visible) ⬜ (full) |
| TC-SM-08 | Reference docs add/remove | Add a doc; remove one | Bar updates; node "+N reference docs" counts update | ⬜ |
| TC-SM-09 | Duplicate stage | Click copy on a node | Clone inserted after, "-copy" naming, chain relinked | ⬜ |
| TC-SM-10 | Import stage | Import modal → pick any stage from a different type/workspace | Stage appended with its outputs; badge flips CUSTOM PIPELINE | ⬜ |
| TC-SM-11 | Zoom + pan | Use zoom control, drag canvas | Scales/pans smoothly; nodes clickable at all zooms | ⬜ |
| TC-SM-12 | Mutations propagate | After SM edits, open board/conveyor/TUI for that workspace | All read the customized stages | ⬜ |

## H. Type Builder (FR-BLD)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-BLD-01 | Builder opens seeded | "New type…" | Template stages prefilled; pipeline map; identity panel | ✅ |
| TC-BLD-02 | Full stage editing | Add/remove/reorder stages; edit prompt/commands/outputs/inputs/automation/gate | Pipeline map updates live | ⬜ |
| TC-BLD-03 | Create registers type | Name "Research Plus" → Create | Lands on its board with 2 seed cards; type in switcher; toast | ⬜ |
| TC-BLD-04 | Created type end-to-end | Open seed card; run a stage; open SM; open TUI | Conveyor, diff, SM, TUI all work for the new type | ⬜ |
| TC-BLD-05 | Cancel | Cancel from builder | Returns to previous board; no type created | ✅ |

## I. Inbox (FR-INB)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-INB-01 | Tabs filter | Click All/Ideas/Bugs/Features | List filters; counts right | ⬜ |
| TC-INB-02 | Bug/feature meta | Inspect items | Bug severity badge + reporter; feature votes | ✅ (visual) |
| TC-INB-03 | Promote with picker | "→ Backlog" → choose non-suggested workspace | Card in that workspace's first stage; item removed; badge −1; board jump + flash + toast | ⬜ |
| TC-INB-04 | Bug promotes as Bug type | Promote a bug item | Card carries Bug type chip | ⬜ |
| TC-INB-05 | Sidebar badge scoped to type | Compare badge across types | Counts only that type's items | ⬜ |

## J. TUI (FR-TUI)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-TUI-01 | Toggle round-trip | GUI→TUI→GUI | Full chrome swap both ways; GUI state preserved | ✅ |
| TC-TUI-02 | Board nav + actions | hjkl/arrows; `n` new; `<`/`>` move stage | Cursor moves; card created; stage moves | ⬜ |
| TC-TUI-03 | Flow tabs | Click each flow tab incl. research | Board re-renders per type | ⬜ |
| TC-TUI-04 | Conveyor: rail ≤2 lines | Open a card of the densest registered type (current seed max: 8 stages) | Horizontal chips wrap to max 2 lines; status label only on active/abnormal | ⬜ |
| TC-TUI-05 | `[g]`/`[a]` + streaming | Generate then approve via keys | Streaming output; rail status updates | ⬜ |
| TC-TUI-06 | Outdated cascade in TUI | Regenerate upstream on approved card | Amber ▲ downstream; banner `re-run [R]` | ⬜ |
| TC-TUI-07 | Inbox promote | `→ backlog` an item | Card lands in Backlog with flash; status-bar toast; count −1 | ⬜ |
| TC-TUI-08 | Subtask recursion | Open a subtask | Own pipeline opens | ⬜ |
| TC-TUI-09 | GUI isolation | Mutate cards in TUI, exit | GUI board unchanged (TUI state is cloned) | ⬜ |

## K. Settings (FR-SET)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-SET-01 | Launcher + panel | Click launcher; close; reopen | Panel opens with all sections; launcher returns on close | ✅ |
| TC-SET-02 | Dark/light | Toggle theme | Whole app re-themes; `data-theme` flips | ✅ |
| TC-SET-03 | Density/font/accent/card style | Change each | Visual change applies app-wide immediately | ⬜ |
| TC-SET-04 | Jump-to buttons | Board / Stage flow / Idea inbox | Views switch | ⬜ |
| TC-SET-05 | Persistence | Change settings → reload | All restored from localStorage | ✅ |
| TC-SET-06 | Panel drag + clamp | Drag panel near viewport edge; resize window | Stays within viewport | ⬜ |

## L. Engineering (FR-ENG)

| ID | Test | Steps | Expected | Status |
|---|---|---|---|---|
| TC-ENG-01 | Production build | `npm run build` | Exits 0 | ✅ |
| TC-ENG-02 | Clean console sweep | Visit every surface (board/detail/diff/SM/builder/inbox/TUI, all 5 types) | Zero console errors/warnings | ✅ |
| TC-ENG-03 | Cold start fresh profile | Clear storage → load | Default settings applied (current defaults: dev template, dark); first workspace's board renders | ✅ |
