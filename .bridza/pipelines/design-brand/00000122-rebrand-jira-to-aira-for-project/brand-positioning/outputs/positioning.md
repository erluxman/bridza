# Aira — Positioning

> Task #122 · design-brand / brand-positioning · 2026-09-21
> Method: April Dunford, *Obviously Awesome* (alternatives → attributes → value → customers → category → personality → promise).
> Rename: **Bridza → Aira**. Frame: **"Jira for the AI era."**

---

## 0. Inputs and assumptions

- **What the product is today (Bridza v0.2):** a local desktop app (macOS/Windows/Linux) where any project moves down a pipeline of small, reviewable stages. Each stage reads only the previous stage's outputs, runs an AI CLI (Claude Code, opencode, anything on PATH) under its own system prompt, and commits its artifacts to a per-task git branch. Every stage is human-gated by default; automation is opt-in per stage. Time, agent, and cost are tracked per stage.
- **Task intent:** rename to Aira and borrow Jira's category awareness so the product is instantly understood as "project management," while signalling "built for the AI era."
- **Palette image:** the brief references a palette image "provided with image path," but no path was given and no palette image exists in the repo. This stage does not depend on it. The current shipped palette (violet accent `#a78bfa` dark / `#7c5cf0` light on near-black `#0b0a12`) is noted here as the baseline for the visual stage. **Action for the requester: attach the palette image to the task folder before `brand-visual` runs.**
- **Specs `target-age` and `branding` were left blank** in the stage config. Filled below under Best-fit customers.

---

## 1. Competitive alternatives

*What would the best-fit customer do if Aira did not exist?*

| Alternative | What it gives them | Where it breaks for our customer |
|---|---|---|
| **Jira / Linear / Asana** (issue trackers) | Boards, tickets, status, assignees, reporting | The "assignee" is a human. There is no first-class way to hand a ticket to an AI agent, gate its output, or attribute cost per step. AI is a sidebar assistant, not the worker. |
| **AI coding agents run by hand** (Claude Code, opencode, Cursor, Codex in a terminal) | Real work gets done fast | One prompt → one 20-file diff. No stages, no per-step review, no record of what was tried. Every run starts from a blank context. |
| **Cloud agent platforms** (Devin, Codex cloud, Claude Code routines) | Autonomous, hosted, parallel | Code leaves the machine. You review the end result, not each step. Vendor-locked to one model. |
| **AI workflow builders** (n8n, Dify, Zapier AI, LangGraph) | Composable steps, automation | Built for API pipelines, not knowledge work on a repo. No git, no diff review, no human gate as the default posture. |
| **Docs + chat** (Notion AI, ChatGPT + copy/paste) | Cheap, flexible | Nothing is traceable. Artifacts live in chat history. Zero provenance, zero reuse. |
| **Scripts and Makefiles around a CLI** | Full control, local | Every team rebuilds the same orchestration. No UI, no board, no time tracking, no staleness detection. |

**The gap:** everything is either a tracker that doesn't do the work, or an agent that does the work but can't be tracked, gated, or trusted step by step.

---

## 2. Unique attributes

*What Aira has that the alternatives do not.*

1. **Stages are pure functions.** A stage's input is only the previous stage's named outputs. Never the original brief, never the whole repo. This is why each review is one small diff.
2. **Git is the database.** Every task is a branch and a worktree. Runs commit as they go. The timeline is the history. Your working tree and HEAD are never touched.
3. **Human gate by default, automation by opt-in.** Every stage is Supervised until you flip Automate. Failures halt even automated stages.
4. **Per-stage attribution.** Time, agent, model, and cost are measured per stage, not per ticket. The bottleneck is visible.
5. **Pipelines are data, not code.** Stages, prompts, outputs, gates, and shell commands are configuration you build in-product. Dev, video, brand, research, and sales are all the same engine.
6. **Bring your own AI CLI.** Claude Code, opencode, or any tool on PATH. Swap models without rewiring.
7. **Local-first.** The desktop app is the bridge. No cloud round-trip. Code never leaves the machine.
8. **Outdated propagation.** Change an earlier stage and downstream stages flip to Outdated with an exact diff and a re-run affordance.
9. **Recursive breakdown.** Any task resolves to either implementation or subtasks that run the same pipeline.
10. **It builds itself.** This positioning document was produced by an Aira pipeline running inside the Aira repo.

---

## 3. Value and proof

| Value (what the customer gets) | Enabled by | Proof |
|---|---|---|
| **AI output you can actually trust.** One small, focused diff per stage instead of a dump. | Pure-function stages, per-stage gate | Product thesis from the founding design sessions: "the promise of this product is to see very minimal change per stage so that a human reviewer can get it right." Visible in every task's conveyor and diff view. |
| **Nothing is lost, nothing is a mystery.** Every artifact has a source stage, a prompt, a commit. | Git as database, one task.json timeline per task | Repo dogfoods it: tasks #108, #110, #122 each have a branch, run records, and stage commits (`git log` on any `bridza/*` branch). |
| **Ship without surrendering your code.** | Local-first bridge | `server/bridge.js` is the single API surface, served on loopback for both dev and desktop. No hosted backend exists. |
| **See where the time and money go.** | Per-stage time, agent, cost tracking | `metadata.json` tracking block per stage: seconds, runs, tool, model. |
| **One tool for every kind of project.** | Pipelines as data | Shipped pipelines: engineering, design-brand. Templates: video, dev, marketing, sales, research. Adding a type is configuration, not a release. |
| **Never locked to one model vendor.** | BYO CLI | Task #122 itself was routed `tool: claude, model: fable` at the stage level, editable per run. |

---

## 4. Best-fit customers

**Primary (the wedge): the solo builder who already runs AI agents every day.**
- Developer, indie hacker, technical creator. Has a repo, has a terminal, has Claude Code or opencode installed.
- Runs 3+ agent sessions a day and has been burned by an unreviewable mega-diff.
- Also produces non-code work (videos, docs, launches, brand) and wants the same discipline there.
- Distrusts cloud agents with private code. Values git as truth.
- Target age band: roughly 22 to 45. Fills the blank `target-age` spec.

**Secondary: small technical teams (2 to 10) where the agent is a teammate.**
- Wants a Jira-like board, but half the tickets are executed by an agent and reviewed by a human.
- Needs to know which stage burns the budget and which stage needs a person.

**Signals that a prospect is a fit**
- Already pays for an AI coding tool.
- Says "I can't review what the agent did" or "I re-prompt from scratch every time."
- Keeps projects in git, including non-code projects.

**Not a fit (say no early)**
- Enterprise PMOs wanting Jira's permission model, SSO, and 200 integrations.
- Non-technical teams with no repo and no terminal.
- Anyone who wants a fully autonomous agent with no review step.

---

## 5. Market category

**Dunford choice: "big fish, small pond."**
Frame Aira inside the existing, well-understood category of **project management / issue tracking** (Jira's category), then own a sharply defined sub-segment:

> **Project management for work done by AI agents.**
> Tickets are still tickets. The difference is who does the work and how a human signs off on it.

**Why this and not the other two options**
- *Head-to-head with Jira/Linear:* lose. Atlassian and Linear win on integrations, permissions, and scale. We do not want that fight.
- *Create a new category ("agentic work orchestration"):* expensive and slow. Nobody searches for it yet.
- *Sub-segment of PM:* inherits Jira's decade of category education for free. "Jira for the AI era" is understood in one breath. Then the second breath is ours: "the assignee is an agent, and you gate every step."

**The category sentence**
> Aira is project management for the AI era: a board where AI agents do the work in small, git-backed stages and a human approves each handoff.

**What we borrow from Jira** (comprehension): tasks, boards, stages, refs (`#122`), branches per task.
**What we reject from Jira** (differentiation): ticket as a status field; work done elsewhere; AI as a sidebar; cloud only.

**Naming and legal note (read before launch).**
"Aira" is one letter from "Jira," in the same product category, paired with a slogan that names Jira. That is the strongest possible signal of intent to a trademark examiner or Atlassian's legal team. Comparative slogans that mention a competitor by name are generally permitted; a near-identical name in the same category is a separate and much larger risk (likelihood of confusion). "Aira" is also an existing brand in other categories (visual-interpreting service, wireless charging). **Recommendation:** treat "Jira for the AI era" as the *positioning frame* used in conversation, press, and comparison pages, not as the registered tagline, and get a trademark clearance opinion on the name before the visual stage locks a logo. The requester has chosen this direction; this document delivers it, and flags the risk once.

---

## 6. Brand personality

Aira is **the calm reviewer's tool**, not the hype-driven agent.

| Trait | Means | Does not mean |
|---|---|---|
| **Precise** | One diff, one stage, one decision at a time. Exact terms (stage, gate, artifact, branch). | Jargon for its own sake. |
| **Grounded** | Git is truth. Local machine. Nothing magic, everything inspectable. | Distrust of AI. We use it heavily. We just gate it. |
| **Quietly confident** | Shows the record instead of claiming the result. Product lets the timeline speak. | Loud "10x" claims, autonomous-agent bravado. |
| **Craft-first** | Made for people who care whether the work is right, not just done. | Elitist. Onboarding is one download or one line. |
| **Honest about control** | A control that looks real is real. Automation is an explicit switch. | Implying the AI ships releases on its own. |

**Tone anchors:** a senior reviewer who has read the diff. Short sentences. Nouns from git and boards. Never "revolutionary," "magic," or "autonomous" without a gate next to it.

**Name meaning to lean on:** *Aira* reads as "AI" + "era," and as "air" (light, clear, nothing hidden). Both fit the personality.

---

## 7. One-line promise

> **Aira: project management for the AI era. Agents do the work in small git-backed stages. You approve every handoff.**

Short form for the wordmark line:
> **Jira for the AI era.**

Shortest form (product, not marketing):
> **Small stages. Real gates. Git as truth.**

---

## 8. Handoff to next stages

- **brand-voice:** hero is the builder drowning in unreviewable AI output. Aira is the guide with a plan: pipeline → stage → gate → ship. Keep "Jira for the AI era" as the frame sentence, not the whole story.
- **brand-visual:** current baseline palette is violet on near-black (dark) and violet on white (light), see `src/index.css`. The brief's palette image is missing from the task folder. Obtain it before running. Logo must survive at favicon size and read as "Aira," not as a Jira derivative.
- **Open decision for the requester:** trademark clearance on "Aira" before any public asset ships.
