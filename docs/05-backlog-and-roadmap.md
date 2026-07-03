# Stagepipe — Backlog & Roadmap

> **2026-06-10 pivot:** Stagepipe is now a **local, file-based GitHub client**
> — markdown-primary storage in any repo's `.luxpms/` directory, no auth,
> changes made agentically. See [ADR-0001](adr/0001-file-based-storage.md),
> [ADR-0002](adr/0002-github-client-no-auth.md), [09-file-format.md](09-file-format.md).
> Resolved/changed below: **C2** = file-based (done), **C9** = local host via
> Vite bridge → CLI later (done), **P0-1** = shipped as the markdown store,
> **P0-2** = harness + bridge integration + conveyor tests live (Playwright e2e remains), **P1-13 + P0-5** = done,
> **P3-5 auth (J1/J2)** = dropped; J3 re-bases on git identity + PR review.

Everything known to be **not done**, in priority order, plus open product
decisions. Sources: the design sessions' own "what's left" lists (chat2), the
three-expert improvement plan (chat2→3), items dropped between design
iterations, and engineering gaps from the implementation pass.

## P0 — Make it a real app (engineering foundation)

| # | Item | Notes |
|---|---|---|
| P0-1 | **Persistence layer** for cards, runtime types, workspace pipelines, folders/archive, inbox | Today everything but settings resets on reload (FR-ENG-2). localStorage first; backend/API later. Design decision needed: schema versioning + migration. |
| P0-2 | **Automated test suite** | Codify [03-test-cases.md](03-test-cases.md); Vitest for engine (data, conveyor reducer, lineDiff/wordDiff, resolveStages) + Playwright for flows. The diff and conveyor engines are pure functions — start there. |
| P0-3 | **Real LLM integration** behind the generate step | The stage contract is already exactly a prompt assembly: system prompt + inherited artifacts + user prompt + attachments → artifacts. Wire to Claude API; keep the simulator as a demo/offline mode. |
| P0-4 | **Real file/git integration** for Dev type | Branch per card, real diffs, shell command execution (the `cmd.shell` field already exists). |
| P0-5 | ID generation hardening | `Date.now()`-based ids can collide under burst creation (EC-BRD-04). |

## P1 — Trust & provenance (design Slice 2 — not built)

| # | Item | Notes |
|---|---|---|
| P1-1 | **Always-inspectable brief drawer** | Read-only original brief/intent, one click from every stage. Counters the "pure function manufactures drift" critique without weakening the conveyor. |
| P1-2 | **Honest copy reframe** | Banners/microcopy sell "clean handoffs + full provenance", not "pure function/conveyor"; align the "never reads the original brief" copy with the brief drawer ("true-with-an-asterisk"). |
| P1-3 | **Non-color status pass** | Icons/shapes alongside color for approved/review/running/outdated/queued (accessibility; FR-ENG-7). |
| P1-4 | **One primary advance action** | Rail button now mirrors the belt, but the duplication is unexplained to users — pick one primary, demote the other to a labeled shortcut. |
| P1-5 | **Generation error UX completeness** | Failure exists (FR-GEN-9); add partial-output and "looks wrong" → structured feedback loop into the regenerate prompt. |

## P1 — UX hardening (from expert review)

| # | Item | Notes |
|---|---|---|
| P1-6 | **⌘K command palette** (real) | Natural home for new card / jump to workspace / switch type / GUI-TUI. Replaces decorative search. |
| P1-7 | **Wire or hide decorative chrome** | Filter, Group: Stage, bell, user menu (FR-NAV-5). Fake controls erode trust. |
| P1-8 | **First-run guided pipeline** | Walk one card through generate→approve once on first launch. |
| P1-9 | **GUI keyboard support** | Arrow/enter navigation on board & stepper (TUI already strong). |
| P1-10 | **Orientation cue when switching types** | Three nav axes (type × workspace × view) need a "where am I / what changed" signal. |
| P1-11 | **Board ↔ conveyor stage consistency** | Decide whether dragging a card to a column syncs conveyor state (EC-BRD-07 / EC-X-02). |
| P1-12 | **Stage-deletion rule for occupied stages** | Reassign or block when cards sit in a deleted stage (EC-SM-07). |
| P1-13 | **Fix engine-genericity violations** | The "types are pure data" rule has code-level leaks (full list in [06-demo-fixtures.md](06-demo-fixtures.md)): static `modeIds` that `registerType` doesn't extend (runtime types missing from TUI tabs), hardcoded `"video"` stale-mode fallback in App (should be first registered type), `mode === "video"` cost special-case in `makeCard`. Acceptance: deleting any seed template from the data file leaves the app fully functional. |

## P2 — Domain fit (design Slice 3 — not built)

| # | Item | Notes |
|---|---|---|
| P2-1 | **Feedback loops** | Measure → "start next cycle" (pre-filled next Brief); Closed-won → renewal/expansion; Released → next iteration. Marketing is a loop, not a line. |
| P2-2 | **Sales: back-transitions & stalled states** | Deals move backward/sideways; allow regress + stalled, multi-contact threads as first-class. Never imply AI auto-closes deals. |
| P2-3 | **Sales: weighted pipeline / forecast view** | Win rate, velocity, forecast — the metrics sales leaders actually want. |
| P2-4 | **Marketing: asset library** | Many-to-many reusable assets across campaigns/channels. |
| P2-5 | **Marketing: brand kit + multi-party approval** | Voice guardrails; brand/legal sign-off as a real multi-party gate (EC-X-05). |
| P2-6 | **Outcome metrics per type** | Velocity / win rate / ROAS / publish cadence replace token-vanity metrics (FR-TRK-7). |
| P2-7 | **Cross-ticket time rollup** | Aggregate stage times across a board → systemic bottleneck (FR-TRK-5). |
| P2-8 | **Estimates vs actuals per stage** | Bottleneck callout flags overruns (FR-TRK-6). |

## P2 — Feature depth (carried over from design "still left" lists)

| # | Item | Notes |
|---|---|---|
| P2-9 | **Drag-reparent subtasks** in the tree (FR-BRD-7) | Plan called for it; never built. |
| P2-10 | **Tailored agent terminals** for Marketing/Sales | Generic fallback today (FR-DET-3). |
| P2-11 | **Marketing/Sales board card depth** | One hero card each; rest are light. |
| P2-12 | **Recursion floor guidance** | "Break down vs implement" heuristic / depth nudge (EC-X-04). |
| P2-13 | **Non-adjacent inputs decision** | Schema/builder allow choosing which prior outputs feed a stage; belt copy says "previous stage only" — decide and align (EC-X-03). |
| P2-14 | **File rename/delete between stages** | Diff engine models add/modify only (EC-DIF-04). |
| P2-15 | **Per-file review actions** | Comment/approve at individual-file level (proposed at end of chat5). |
| P2-16 | **"Looks wrong → reopen previous stage"** wired to re-flow downstream diffs + time (proposed in chat5). |

## P3 — Dropped / deferred surfaces

| # | Item | Notes |
|---|---|---|
| P3-1 | **Mobile view + voice capture** (FR-MOB-1/2) | Existed in design v1–v2 (phone frame, type/workspace switching, hold-to-talk → Send to board / Keep in Inbox); absent from the final prototype. Decide: resurrect (the old `design_src/...project/pm/mobile.jsx` is reference) or design responsive web instead. |
| P3-2 | **Responsive layout** for the desktop GUI (<1100px currently degrades; EC-THM-03). |
| P3-3 | **Phone-styled card detail** (was a gap even in v2). |
| P3-4 | **TUI capture command** (voice-equivalent for terminal: a `capture` command line — floated in chat2). |
| P3-5 | **Multi-user / auth / roles** (FR-ENG-5) | Multi-party gates (P2-5) depend on at least role modeling. |

## Open product decisions (decide, don't build)

| # | Decision | Context |
|---|---|---|
| D-1 | **Pick a wedge** | Expert recommendation: creator/dev first, marketing/sales later — vs. launching all types as equals. |
| D-2 | **TUI positioning** | Power-user delighter vs. co-equal product surface (maintenance cost concern pre-PMF). |
| D-3 | **Auto-run trust posture** | Current: supervised default + per-stage automate + failure halts. Decide ceiling: should "all stages automate" ever be one click? |
| D-4 | **Metrics identity** | Cost/exchanges as engineering telemetry (hidden by default?) vs. user-facing — ties to P2-6. |
| D-5 | **Stage edit semantics during in-flight work** | EC-X-01. |
| D-6 | **Persistence model** | Local-first (CRDT-ready?) vs. server-first — affects P0-1 architecture. |

## Suggested sequencing

1. **P0-1 + P0-2** (persistence + tests) — everything else compounds on these.
2. **P1-1..P1-4** (provenance slice) — the highest-leverage design work, already specced.
3. **P0-3** (real LLM behind one type — Dev or Video per D-1) — the demo→product moment.
4. **P1-6..P1-11** (UX hardening) interleaved.
5. **P2** by chosen wedge; **P3** as demand shows.

## Review-loop deferrals (round 1, 2026-06-11)

| Item | Source | Why deferred |
|---|---|---|
| TUI snapshots GUI state at mount (desync until reopen) | UIUX-1 P2 | FR-TUI-8 isolation is by design; revisit with file-watch reload |
| Tweaks-panel segmented controls not keyboard-activatable | UIUX-1 P2 | design-tool scaffold; queue with P1-9 keyboard pass |
| Type Builder Cancel returns to Boards, not originating view | UIUX-1 P2 | one-line UX nit; queue with P1-10 orientation work |
| ~~Exec-panel run log clears when switching stage chips~~ | UIUX-2 P2 | **fixed 2026-06-11** — run log/meta/diff cached per card:stage, rehydrated on remount |
