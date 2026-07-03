# Stagepipe — Demo Fixtures (seed data, NOT requirements)

Everything in this file is **replaceable sample content** that ships with the
prototype so the product demos well. None of it is a product requirement:
Stagepipe is a generic tool — templates, stages, workspaces, cards, prompts,
and agents are all user-editable data (see FR-CORE-1/4/6 in
[02-prd.md](02-prd.md)). Tests may pin these values only as *fixtures*, and
must be updated when seed data changes.

## Starter templates as currently seeded

| Template | Stages (count) | Stage list | Workspaces (3 each, demo) |
|---|---|---|---|
| Video | 8 | Idea → Research → Outline + Theme → Script → Timing → Expression → Scene + Visuals → Render + Publish | Learning Machine, AI WTF, Coding Lab |
| Dev | 6 | Backlog → Planning → In Dev → Review → QA → Released | Lazy Launcher, Pipeline Tool, WTF AI App |
| Marketing | 7 | Brief → Audience + Angle → Channel Plan → Copy + Creative → Schedule → Launch → Measure | WTF AI Launch, Lazy Launcher GTM, Coding Lab Growth |
| Sales | 6 | Lead → Qualify → Discovery → Proposal → Negotiation → Closed | Lazy Launcher Pro, Enterprise, Partnerships |
| Research | 7 | Question → Sources → Read & Extract → Synthesize → Draft → Review → Publish | Agentic RAG, Launcher Market, User Interviews |

Per-template label sets (also data): noun/plural, sidebar label
(Channels/Projects/Brands/Pipelines/Workspaces), work-surface name
(Studio/Code/Assets/Notes/Report), cost label (token cost/compute/ad
spend/deal value), flag label (Whisper flags/failing tests/review flags/risks),
branch label (cuts/branches/assets/threads), icon, accent.

## Demo gate labels (examples)

"Hook validated", "Sources fact-checked", "Theme locked", "Runtime on target",
"Render approved" (Video); "Triaged + prioritised", "Spec approved",
"Build green" (Dev); "Brand check + Budget" (Marketing); "Legal sign-off +
Quote" (Sales). Gates are free-text per stage.

## Demo system prompts (examples)

- Dev / In Dev: "Implement STRICTLY from spec.md and acceptance.md … never
  re-read the original ticket."
- Video / Script: "Write a spoken-word script FROM THE OUTLINE ONLY."
- Sales / Proposal: "Generate the proposal and quote FROM THE DISCOVERY NOTES
  ONLY — never the raw lead form."

## Demo automation defaults

Each template marks some stages `auto: true` as its "routine" preset (e.g. the
Dev seed marks Backlog/QA/Released). The **Automate routine** button applies
whatever the template's data says — the specific stages are seed content.

## Demo failure flavors (`failFirst`)

One per template: timeout, refusal, failing checks, low confidence.

## Demo agents list

Claude Code, Claude (Sonnet 4.5), GPT-4o, Cursor, Aider, Codex CLI — a static
picker list today; becomes configuration with real integrations (FR-ENG-3).

## Hero cards & file content

- Dev hero card `#LZ-204 "Drag-and-drop launcher grid"` with real
  TS/TSX/JSON file fixtures (DragLayer.tsx, useReorder.ts, grid.json,
  Tile.tsx) used by the diff-engine showcase.
- One fully-detailed hero card per template; other seed cards are lighter.
- Inbox seed items (ideas/bugs/features with severities, reporters, votes).
- Sidebar footer user "erluxman" — placeholder until FR-ENG-5 (auth).

## Known engine-genericity violations (code debt, tracked as P1-13)

The engine mostly honors "types are pure data", with these exceptions found in
code review (2026-06-10):

1. `PMS_DATA.modeIds` is a static array; `registerType` does not append to it.
   The GUI App works around it with local `typeOrder` state; the TUI seeds its
   tabs from `modeIds` only, so runtime-built types may not appear there.
2. `App.jsx` falls back to the hardcoded id `"video"` when the saved mode is
   stale — should be "first registered type".
3. `makeCard` contains a `mode === "video"` special case for the demo cost
   field — engine code branching on a template id.
4. A card-builder helper defaults to `"video"` (`makeBase("video", …)`) — demo
   fixture builder, acceptable, but should live with fixtures.
