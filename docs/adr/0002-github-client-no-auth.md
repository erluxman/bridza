# ADR-0002 — Stagepipe is a local GitHub client; no authentication

**Status:** accepted · 2026-06-10
**Resolves:** C9 (execution host) · drops J1/J2 (server store, auth) from
[08-task-breakdown.md](../08-task-breakdown.md).

## Decision

Stagepipe is a **local, single-user app that opens a repo directory** — think
"lazygit for project management". There is no account system, no server, no
auth:

- **Identity** = git identity (`user.name`/`user.email` on commits).
- **Access control** = filesystem + GitHub repo permissions. If you can clone
  it, you can manage it.
- **Collaboration** = branches, pushes, and PRs of `.luxpms/` files — the
  same way code collaborates.
- **Host** = the dev server now (Vite middleware exposes the repo to the
  browser UI); a `npx stagepipe <dir>` CLI wrapper later. No Electron unless
  the CLI proves insufficient.

## The agentic loop

The way changes happen is **agentic**: the human approves at gates (the
conveyor's whole design), and agents do the work — running locally with the
same file access the app has. An agent moving a card = editing one
frontmatter line. An agent completing a stage = writing artifact files +
updating the card. The local host is what lets us spawn agents (Claude Code
CLI etc.) and run `cmd.shell` later — a pure-browser app could not.

## Consequences

- WS-J shrinks: J1 (server store) and J2 (auth/roles) are **dropped**.
  Multi-party approval (J3) re-bases on git identities + PR review instead of
  roles.
- The H-track (git/terminal) gets dramatically simpler: we are already in the
  repo, on the user's machine, with their git credentials.
- Single-writer-per-checkout is the concurrency model; cross-machine
  conflicts are git merges.
