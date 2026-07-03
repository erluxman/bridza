# Stagepipe — Product Vision & Planning

> Source of truth assembled from the five design sessions
> (`design_src/project-management/chats/chat1–5.md`), the final prototype, and
> the current implementation. Companion docs: [02-prd.md](02-prd.md),
> [03-test-cases.md](03-test-cases.md), [04-edge-cases.md](04-edge-cases.md),
> [05-backlog-and-roadmap.md](05-backlog-and-roadmap.md),
> [00-progress-tracker.md](00-progress-tracker.md).

## 1. One-line vision

**A conveyor belt for knowledge work.** Any kind of project — a YouTube video, a
software feature, an ad campaign, a sales deal, a research inquiry — moves down
a pipeline of stages, where each stage is a small, pure, reviewable machine:
it reads only the previous stage's outputs, runs an LLM (plus optional terminal
commands) under a stage-specific system prompt, and emits self-contained
artifacts for the next stage. A human approves each handoff — or marks easy
stages as automated.

## 2. Core thesis (the load-bearing ideas)

1. **Stages are pure functions.** A stage's input is *only* the previous
   stage's named output artifacts. Nothing reaches back to the original brief.
   This makes every handoff clean, every artifact traceable, and any single
   stage re-runnable in isolation.
2. **Minimal change per stage.** The promise of the product is that a human
   reviewer sees one small, focused change at each stage — never a 20-file
   dump. (User, chat5: "the promise of this product is to see very minimal
   change per stage so that human reviewer can get it right.")
3. **A stage is fully defined by data.** Preceding stage + outputs + system
   prompt + an editable user prompt (+ commands + automation + gate). Therefore
   *types* of work (video/dev/marketing/sales/research/…) are not code — they
   are configuration, and users can build new ones in-product.
4. **Recursive breakdown.** Every task ends in one of two resolutions:
   **Implementation** (a leaf — file changes on a branch) or **Breakdown**
   (metadata + subtasks, each of which runs the same pipeline). Tasks are
   broken down until they are small and easy. "That will be the beauty of this
   system." (User, chat1.)
5. **Human-in-the-loop by default, autonomous by opt-in.** Every stage defaults
   to Supervised. An "Automate" switch (set when designing the task) opts easy
   stages into auto-approval. Failures halt the run even on automated stages —
   gates are real, not decoration.
6. **The pipeline has memory.** Changing an earlier stage after later stages
   are done flips the downstream stages to **Outdated** (amber), with a diff of
   exactly what changed and a re-run affordance.
7. **Measure everything per stage, not per ticket.** Time, AI agent used,
   exchange counts, and cost are attributed to stages so the bottleneck is
   visible ("Research is the biggest sink — 54% of tracked time. Optimize here
   first.").

## 3. Positioning & differentiation

- The defensible story (per the marketing/sales expert review, chat2) is
  **clean handoffs with full provenance** — "the SDR→AE→CS baton never drops,
  and you can always see where every artifact came from" — not the mechanical
  "pure function" framing.
- Differentiators vs. generic PM tools: per-stage AI generation contracts,
  stage-level diffs and staleness, per-stage time/cost attribution,
  user-buildable pipeline types, and a full TUI for power users.

## 4. Personas (working set)

| Persona | Pipeline types | What they need |
|---|---|---|
| Solo creator/dev (primary wedge candidate) | Video, Dev | Recursive breakdown, agent integration, per-stage review, TUI |
| Marketing team | Marketing | Brand-safe generation, multi-party approval, asset reuse, ROAS |
| Sales team | Sales | Proposal generation from discovery notes, parallel threads, forecast |
| Researcher | Research | Source→extract→synthesize chain with provenance |
| Ops/PM "type designer" | All | Type Builder, Stage Manager, workspace-specific pipelines |

The expert review recommended **picking the creator/dev wedge first** and
expanding later; this is an open product decision (see backlog §Open
decisions).

## 5. Product principles

1. Never imply the AI closes deals / ships releases on its own — supervised is
   the default posture, automation is an explicit per-stage opt-in.
2. A control that looks real must be real (decorative chrome erodes trust —
   wire it or hide it).
3. Status must not be encoded in color alone (accessibility).
4. Same engine, divergent surfaces: per-type labels (noun, sidebar label,
   cost label, flag label, work-surface name) are configuration, not forks.
5. Everything reviewable is also revisitable: approved stages stay
   inspectable; diffs are always one click away.

## 6. Expert review summary (chat2 — three forked perspectives)

**UI/UX expert** — strongest idea is the four-step belt; risks: three
simultaneous navigation axes (type × workspace × view), two advance actions
with one mental model, no failure states (since fixed), no version diff (since
fixed), color-only status, 11–12px type, decorative chrome.

**Devil's advocate** — the pure-function constraint manufactures drift
(garbage-in, garbage-*forward*); creative/sales work loops rather than flows;
auto-run undermines the value prop (since fixed with real gates); infinite
recursion has no floor; token/cost metrics are vanity; two full UIs pre-PMF;
moat must be orchestration + provenance.

**Marketing & sales expert** — marketing is a loop (Measure must feed the next
Brief); assets are many-to-many (needs an asset library + brand kit +
multi-party approval); sales deals move backward/sideways and need parallel
threads, weighted pipeline, win rate, forecast; never imply auto-closing
deals.

**Design's response (chat3):** keep the conveyor; the cascade + diff +
inspectable brief *are* the product (provenance). Build sequence: Slice 1
(trust: diff, real gates, failure) — **shipped**; Slice 2 (provenance: brief
drawer, copy reframe, non-color status) — **not built**; Slice 3 (domain fit:
loops, sales/marketing depth, outcome metrics) — **not built**.

## 7. Scope of the current implementation

A faithful, fully client-side React implementation of the final prototype:
one generic pipeline engine shipping with editable starter templates
(currently video/dev/marketing/sales/research — all seed data, see
[06-demo-fixtures.md](06-demo-fixtures.md)), board, conveyor with
gates/failure/staleness/diffs, file-change engine, Stage Manager, Type
Builder, triage inbox, TUI, theming/settings. **No backend, no real LLM, no
real file system/git** — generation, diffs, agents, and metrics are
high-fidelity simulations. See [00-progress-tracker.md](00-progress-tracker.md)
for the per-requirement status.

**Documentation rule:** specific stage lists, workspace names, card counts,
and prompt texts are demo fixtures and live only in
[06-demo-fixtures.md](06-demo-fixtures.md) — requirements and tests must be
written against the generic engine, never against seed data.
