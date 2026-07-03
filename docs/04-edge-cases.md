# Stagepipe — Edge-Case Register

Each edge case: scenario, expected behavior, current handling.
Handling legend: ✅ handled (verified or explicitly coded) · 🟡 believed
handled, unverified · ❓ unknown/needs investigation · ❌ known unhandled.

## 1. State & persistence

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-ST-01 | Saved settings reference a builder-made type that no longer exists after reload | Fall back to the **first registered type**, no crash | 🟡 guarded, but falls back to hardcoded `"video"` (`D.MODES[t.mode] ? t.mode : "video"`) — genericity leak, fix with P1-13 |
| EC-ST-02 | Corrupt JSON in `localStorage["stagepipe-tweaks"]` | Ignore, use defaults | ✅ try/catch in `useTweaks` |
| EC-ST-03 | localStorage unavailable (private mode / quota) | App works, settings just don't persist | ✅ try/catch on write |
| EC-ST-04 | Reload mid-generation / mid-auto-run | All transient run state resets (in-memory by design) | 🟡 nothing persisted, so trivially "handled" — revisit with FR-ENG-2 |
| EC-ST-05 | Saved settings contain unknown keys / missing new keys | Merge over defaults; unknown keys harmless | ✅ `{ ...defaults, ...saved }` |
| EC-ST-06 | Two tabs open simultaneously | Independent in-memory state; last writer wins on settings | 🟡 acceptable for prototype; conflict strategy needed with FR-ENG-2 |

## 2. Conveyor & generation

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-GEN-01 | Approve clicked at the **final** stage | Pipeline completes; no "next stage" deref | 🟡 |
| EC-GEN-02 | Regenerate clicked **while already streaming** | Ignore or restart cleanly; no interleaved output | ❓ |
| EC-GEN-03 | Switching stages / closing card mid-stream | Timers cleaned up; no setState-on-unmounted warnings | ❓ (no warnings seen in sweep, not targeted) |
| EC-GEN-04 | Run pipeline when **all** stages supervised | Pauses immediately at first unapproved stage | 🟡 |
| EC-GEN-05 | Run pipeline when all stages automated and one has `failFirst` | Halts at failure despite Automate (gates are real) | ✅ design-verified in chat3 |
| EC-GEN-06 | Stop pressed mid-auto-run | Run halts; current stage keeps its state | 🟡 |
| EC-GEN-07 | Regenerating stage 1 (no predecessor) | Input step shows the capture/seed inputs; no null prev | 🟡 |
| EC-GEN-08 | Outdated cascade on a card with later stages **queued** (not approved) | Only approved/stale stages flip; queued stay queued | ✅ per runner logic |
| EC-GEN-09 | "Keep as-is" on a stale stage, then regenerate upstream again | Stage flips stale again (staleness re-derived) | ❓ |
| EC-GEN-10 | Approve a stage whose system prompt was edited | Edited prompt persists for future regenerates of that stage | 🟡 |
| EC-GEN-11 | Tab away during streaming (background-timer throttling) | Stream finishes, just slower | ✅ observed during design verification (chat3) |
| EC-GEN-12 | Stage with empty/missing `preview` (builder-made type with no demo text) | Generic preview fallback, no blank panel | 🟡 generic fallback exists (`previewFor`) |
| EC-GEN-13 | Card already in last stage opened fresh | Stepper shows all prior approved; belt on last stage | 🟡 (seeded released card exercises this) |

## 3. Files & diffs

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-DIF-01 | Card with zero completed stages | Empty state, never an empty diff table | ✅ explicit empty state |
| EC-DIF-02 | Regenerate task twice in a row | Baseline rolls forward each run; run # increments; diff = run N vs N−1 | ✅ design-verified |
| EC-DIF-03 | Very long lines in Split view | Columns wrap; no horizontal overflow hiding the right column | ✅ fixed in design (chat5) |
| EC-DIF-04 | File deleted/renamed between stages | Not modeled (stages add/modify only) | ❌ not modeled — fine for sim; revisit with FR-ENG-4 |
| EC-DIF-05 | Value-only artifacts (branch, build.ok) | Listed under "also produced", never as file diffs | ✅ |
| EC-DIF-06 | Builder-made type's files in diff views | Generic doc artifacts per stage; engine doesn't assume the Dev showcase | 🟡 |
| EC-DIF-07 | Mutation produces a tiny/no-op edit occasionally | Acceptable (documented design caveat) | ✅ documented |
| EC-DIF-08 | Per-stage Changes tab while stage is Running | Shows pre-run state or streaming placeholder, no crash | ❓ |

## 4. Board & cards

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-BRD-01 | Drop card on its own column | No-op, no "updated" churn | ✅ explicit guard in `moveCard` |
| EC-BRD-02 | Empty composer submit | No empty-titled card (trim/ignore) | ❓ |
| EC-BRD-03 | Very long card title | Wraps/truncates without breaking layout | ❓ |
| EC-BRD-04 | Rapid repeated card creation | Unique ids/refs (`Date.now`-based) — collisions possible same-ms | ❓ check id scheme under burst |
| EC-BRD-05 | Empty workspace board | All columns render with composer affordances; "0 <plural> in pipeline" | ✅ design-verified |
| EC-BRD-06 | Drag canceled (Esc / drop outside) | No move, no highlight residue | ❓ |
| EC-BRD-07 | Card moved to a stage column, then opened | Conveyor's notion of "current stage" matches the column | ❓ — board stage and conveyor state are separately tracked; verify consistency |

## 5. Subtasks & recursion

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-SUB-01 | Subtask with no children opened | Own conveyor; empty subtask tree section | 🟡 |
| EC-SUB-02 | Subtask of a subtask (depth ≥3) | Same recursion works (extraCards map) | 🟡 |
| EC-SUB-03 | Breadcrumb from a synthesized subtask card | Workspace crumb still navigates back correctly | ❓ |
| EC-SUB-04 | Recursion floor | No guidance/limit on breakdown depth ("fractal busywork" critique) | ❌ open product question |
| EC-SUB-05 | Same subtask opened twice | Reuses the synthesized card, doesn't duplicate | 🟡 keyed by node id |

## 6. Workspaces, folders, archive

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-WS-01 | Archive the only visible workspace | Sensible fallback (empty board or blocked action) | ❓ |
| EC-WS-02 | Folder drops to 1 member | Auto-dissolves | ✅ |
| EC-WS-03 | Drag a workspace onto a folder | Adds as member | ✅ |
| EC-WS-04 | Drag a folder onto a workspace/folder | Nested folders presumably unsupported — should no-op | ❓ |
| EC-WS-05 | Archive a workspace inside a folder | Removed from folder + archived; folder dissolves if <2 | ❓ |
| EC-WS-06 | New workspace name collision / empty name | De-dupe or allow; empty rejected | ❓ |
| EC-WS-07 | Custom pipeline workspace then type default edited | Forked workspaces keep their copy; inheriting ones see the change | 🟡 by `resolveStages` design |
| EC-WS-08 | Inbox promote into an **archived** workspace | Picker should exclude archived | ❓ |

## 7. Stage Manager

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-SM-01 | Delete the first stage / the only remaining stage | Chain relinks; deleting below 1 stage blocked | ❓ |
| EC-SM-02 | Insert before first node (on Capture wire) | New first stage reads capture inputs | 🟡 |
| EC-SM-03 | Stage with zero outputs | Next stage's READS empty — belt input step empty state | ❓ |
| EC-SM-04 | Import a stage whose artifact names collide with existing outputs | Both kept (names not unique-keyed?) | ❓ |
| EC-SM-05 | Edits while a card of that workspace is open | Conveyor re-resolves stages on next render (key on mode+channel) | 🟡 App keys StageFlow; CardDetail re-render path unverified |
| EC-SM-06 | Renaming a stage that cards currently sit in | Cards keep stage id, only label changes | 🟡 ids stable through rename |
| EC-SM-07 | Deleting a stage that has cards in it | Cards orphaned? Should reassign or warn | ❌ unhandled — needs a rule |
| EC-SM-08 | Zoom extremes | Layout/pan stay usable | ❓ |

## 8. Type Builder

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-BLD-01 | Type id collision with existing (incl. built-ins) | De-duped/suffixed id (`existing` check present) | 🟡 |
| EC-BLD-02 | One-stage type | Seed card logic uses `min(1, len-1)`; board renders single column | ✅ guarded |
| EC-BLD-03 | Zero-stage type | Create blocked | ❓ |
| EC-BLD-04 | Empty type name | Blocked or default name | ❓ |
| EC-BLD-05 | Builder type with duplicate stage names | Allowed (ids distinct) — chain still correct | 🟡 |

## 9. Inbox

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-INB-01 | Promote the last item | Empty state; badge clears | 🟡 |
| EC-INB-02 | All tabs empty for a type | Friendly empty state | ❓ |
| EC-INB-03 | Promote into a workspace with a **custom** pipeline | Card lands in *that workspace's* first stage (not type default) | ✅ uses `stagesFor(mode, ch)` |
| EC-INB-04 | Cross-type promote while a card detail is open | View resets to target board cleanly | 🟡 |

## 10. TUI

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-TUI-01 | Keyboard listeners after exit to GUI | Removed (no ghost hotkeys) | 🟡 cleanup in effects |
| EC-TUI-02 | Typing in a TUI input vs global hotkeys | Hotkeys suppressed while editing | ❓ |
| EC-TUI-03 | TUI on a narrow window | Columns overflow with scroll, not broken chrome | ❓ |
| EC-TUI-04 | Rail with the densest pipeline (seed max: 8 stages; user-built can exceed) | Max 2 lines (explicit requirement) — verify with 10+ stage custom types | 🟡 design-verified at 8; unverified beyond |
| EC-TUI-05 | TUI opened while GUI had a runtime type active | TUI sees registered runtime types | 🟡 reads same TYPES registry |

## 11. Theming & layout

| ID | Scenario | Expected | Handling |
|---|---|---|---|
| EC-THM-01 | Theme toggle while in TUI/builder (scoped palettes) | Builder host carries data-theme; TUI has own palette | 🟡 |
| EC-THM-02 | Density compact × card style minimal × smallest font | No clipped labels (historic wrap bugs were fixed case-by-case) | ❓ regression-prone area |
| EC-THM-03 | Window < ~1100px wide (no responsive design yet) | Currently overflows/squeezes — mobile/responsive is dropped/backlog | ❌ known |
| EC-THM-04 | Long workspace/stage/artifact names | nowrap/ellipsis safeguards exist in known hotspots | 🟡 |
| EC-THM-05 | Google Fonts unreachable (offline) | Falls back to system-ui stack | ✅ font stacks include fallbacks |
| EC-THM-06 | Accent color with poor contrast in light mode | Tokens don't auto-adjust | ❌ accessibility backlog |

## 12. Cross-cutting product edge cases (open questions)

| ID | Question | Status |
|---|---|---|
| EC-X-01 | What happens to in-flight generation when its stage is edited in Stage Manager? | Undefined — needs a rule |
| EC-X-02 | Should board drag-move of a card re-sync the conveyor's active stage (and vice versa)? | Undefined — two sources of truth today (see EC-BRD-07) |
| EC-X-03 | Can a stage read outputs from a non-adjacent earlier stage? (Schema allows explicit `inputs`; builder UI exposes it; belt copy says "previous stage only") | Inconsistent copy vs capability — decide and align |
| EC-X-04 | Recursion floor / breakdown guidance (when to stop splitting) | Open (devil's-advocate critique) |
| EC-X-05 | Multi-party approval (brand/legal) on one gate | Not modeled; Slice 3 |
| EC-X-06 | Sales back-transitions (deal moves backward) — currently the belt is one-way | Not modeled; Slice 3 |
| EC-X-07 | Concurrent auto-runs on two cards of the same workspace | Untested; per-card state should isolate | 🟡 |
