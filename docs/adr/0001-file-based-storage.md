# ADR-0001 — File-based storage: markdown primary, JSON fallback

**Status:** accepted · 2026-06-10
**Resolves:** C2 (storage model), supersedes the localStorage-first plan in
[08-task-breakdown.md](../08-task-breakdown.md) WS-E.

## Decision

All PM state lives as **files inside the repo being managed**, under a
`.luxpms/` directory. No database, no server, fully offline.

- **Markdown (.md with YAML frontmatter) is the primary format** — anything a
  human would read or edit by hand: cards, pipeline/type definitions
  (system prompts are prose!), workspaces, inbox items.
- **JSON is the fallback format** — purely structural state with no
  human-reading value: UI state, folder groupings, archived sets, ref
  counters (`state.json`).

Exact layout: [09-file-format.md](../09-file-format.md).

## Why

1. **The repo is the database.** Open any GitHub repo with Stagepipe and its
   PM state travels with the code — versioned, diffable, branchable,
   reviewable in PRs like everything else.
2. **Git is the sync layer.** Pull/push replaces a sync protocol; merge
   conflicts in markdown are human-resolvable. GitHub repo permissions
   replace authentication entirely (ADR-0002).
3. **Agent-native.** Agents (Claude Code etc.) already read and write
   markdown files in repos — the PM state is directly legible and editable
   by the same agents that do the work. No API needed for an agent to move a
   card: it edits frontmatter.
4. **Obsidian/editor friendly.** Cards open in any editor; checklists are
   GitHub-flavored task lists that render everywhere.

## Consequences

- Serialization must round-trip losslessly (unit-tested) and tolerate
  hand-edits (unknown frontmatter keys preserved, missing keys defaulted).
- Concurrent writers (user + agent) are resolved by git, not by us — last
  write wins within a session; the app re-reads on focus/poll.
- Settings (theme/font/accent) stay in localStorage — they're per-user
  preferences, not project state, and don't belong in the repo.
- Deep conveyor run-state (streaming buffers, transient statuses) is **not**
  persisted in v1; durable facts (stage, progress, times, checklists,
  prompts edits) are.
