# Codebase Atlas — system design diagrams + AI copilot

One ticket, one step at a time. Tick each box when that step ships. Step 1 comes first (every other step plugs into it); steps 8 and 9 need step 7.

## To-do

- [ ] 1. Atlas shell + file map lens (~8h)
- [ ] 2. Atlas lens: module dependency graph (~10h)
- [ ] 3. Atlas lens: runtime container diagram (C4-style) (~8h)
- [ ] 4. Atlas lens: request flow / sequence map (~7h)
- [ ] 5. Atlas lens: git history, churn & co-change (~10h)
- [ ] 6. Atlas lens: docs, ADRs & code links (~6h)
- [ ] 7. Ask AI about the selected part of the diagram (~10h)
- [ ] 8. Atlas AI chat thread with two-way citations (~8h)
- [ ] 9. AI-written architecture overview & area briefs (~6h)
- [ ] 10. Export a lens as SVG / PNG / Mermaid (~5h)
- [ ] 11. Incremental scan cache + ignore settings (~6h)

---

## Step 1. Atlas shell + file map lens

### What
Add a new top-level destination — **Atlas** — next to `🗺 Plan` in the sidebar
(`src/app/features/nav.jsx`, wired in `src/app/App.jsx` the same way `planActive`
/ `onPlan` is), and ship its first working lens: a **file map** of the opened
repo.

Server side, add `server/bridza-atlas.js` with a repo scan and expose it as
`GET /api/bridza/atlas/scan` in `server/bridge.js` (+ `getAtlas` in
`src/app/api/client.js`). The scan walks the project's working dir, honours
`.gitignore` and skips `node_modules`/`dist`/binaries, and returns a flat
inventory: `{ path, dir, name, ext, lang, bytes, loc, mtime }` plus directory
rollups.

The lens itself lives in `src/app/features/atlas.jsx`: a nested treemap where
box area = LOC, colour = language, hover = full path + size, click = select the
node (selection is shared state so later lenses and the AI panel can read it),
double-click = open the file via the existing `openEditor`/file endpoints. A
breadcrumb lets the user zoom into a directory and back out.

This slice is the Atlas skeleton: one destination, one scan API, one lens, one
selection model. Every other Atlas sub-task plugs into these seams.

### Why
The repo is ~8k lines spread across four hosts (SPA in `src/`, HTTP+pty server
in `server/`, Electron in `electron/`, shared domain in `core/`), and nothing in
the app shows that shape. A newcomer — human or agent — has to grep. A file map
answers "what is big, what is where, what language" in one screen and gives the
rest of the Atlas a place to live. It is deliberately the smallest lens that is
useful on its own: it needs no parsing, only a directory walk.

### Acceptance criteria
- Given a project folder is open, when the user clicks **Atlas** in the sidebar,
  the Atlas view renders and the sidebar entry shows as active; clicking Plan or
  a pipeline leaves Atlas and returns to the previous behaviour unchanged.
- `GET /api/bridza/atlas/scan` returns `{ files: [...], dirs: [...], totals: { files, loc, bytes } }`
  for the request's project dir; ignored paths (`.gitignore` entries,
  `node_modules`, `dist`, lockfiles, binaries) are absent from `files`.
- LOC is counted for text files only; binaries report `loc: 0` and are sized by
  bytes.
- The treemap renders one box per file nested under its directory, area
  proportional to LOC, coloured by language, with a legend; the 5 largest files
  are readable without zooming on a 1280px-wide window.
- Clicking a box selects it (visible selection ring) and exposes the selection —
  `{ kind: "file" | "dir", path }` — through the Atlas view's shared selection
  state; clicking empty canvas clears it.
- Double-clicking a file box opens that file in the user's editor via the
  existing open/file API — no new file-open mechanism is introduced.
- Breadcrumb zoom: clicking a directory box drills in, the breadcrumb shows the
  path, clicking a crumb zooms back out.
- A scan of this repo completes in under 2s and the view stays interactive
  (no blocking spinner over the whole window) while it loads.
- Unit tests in `src/app/__tests__/` cover the scan (ignore rules, LOC counting,
  directory rollups) against a temp fixture tree, and the treemap's
  area/selection logic; they run under the existing `pnpm test` and spawn no
  agent and no real repo scan of the user's machine.

---

## Step 2. Atlas lens: module dependency graph

### What
Add a second Atlas lens: the **import graph**. Extend `server/bridza-atlas.js`
with an import extractor (static `import` / `export … from` / dynamic
`import()` / `require()`) for `.js/.jsx/.ts/.tsx`, resolve specifiers to files
in the repo (extension and `index.*` resolution, tsconfig paths if present),
and classify unresolved ones as external packages. Expose it on the existing
scan endpoint as `GET /api/bridza/atlas/scan?graph=imports` returning
`{ nodes: [{ id, path, lang, loc }], edges: [{ from, to, kind }], externals: [{ name, importers }] }`.

Render it as a node-link diagram in `src/app/features/atlas.jsx`, reusing the
primitives the app already has — `CanvasNode` from `src/app/lib/canvas.jsx` for
drag/resize, `layoutNodes`/`LAYOUTS` from `src/app/lib/layout.js` for the layout
presets, and the localStorage override pattern (`useCanvasOverrides`) so manual
positions persist per repo. Nodes group by top-level area (`src/app`, `server`,
`core`, `electron`, `e2e`). Give it a depth control: collapse to directory-level
nodes or expand to file-level, and a "focus" mode that shows only a selected
node's direct importers and imports.

Also surface two things people actually ask for: **cycles** (highlighted in a
distinct colour, listed in a side panel) and **orphans** (files nobody imports).

### Why
A file map tells you where code is; it does not tell you what depends on what.
The coupling in this repo is the thing that is hard to hold in your head —
`core/domain.js`, `server/bridza-store.js` and `server/bridza-run.js` are
imported from many places, and the SPA's `features/` modules share `lib/`
helpers. Seeing that as a graph, with cycles called out, is what makes "why does
touching this break that" answerable without a grep safari.

### Acceptance criteria
- `GET /api/bridza/atlas/scan?graph=imports` returns nodes for every scanned
  source file and one edge per resolved import; the same edge is not duplicated
  when a module imports two symbols from one file.
- Specifier resolution handles relative paths with and without extension,
  directory `index.*`, and `.js` specifiers that resolve to `.ts`/`.tsx`
  sources; anything unresolved is reported under `externals`, never as a
  dangling edge.
- Dynamic `import()` and `require()` edges are included and tagged
  `kind: "dynamic"` / `kind: "require"`, rendered with a distinct edge style.
- The graph renders with the existing layout presets, nodes are draggable, and
  manual positions survive a reload (per-repo localStorage key), with a reset
  control — matching the behaviour of the task Canvas view.
- A depth toggle switches between directory-level and file-level nodes without
  a re-fetch; the current selection is preserved across the toggle where the
  node still exists.
- Selecting a node from any lens (the shared Atlas selection from
  `atlas-shell-and-file-map`) highlights it here, and "focus" mode reduces the
  graph to that node plus its direct neighbours with a count of what is hidden.
- Import cycles are detected, highlighted, and listed in a panel; clicking a
  cycle selects its members. A repo with no cycles shows an explicit "no cycles"
  state, not an empty panel.
- Files that nothing imports (excluding entrypoints declared in `package.json`,
  config files and test files) are listed as orphans.
- Unit tests cover the extractor and resolver against a fixture tree —
  relative/extensionless/index imports, dynamic import, require, unresolved
  external, a two-node cycle and a three-node cycle — plus the cycle detector
  itself. No network, no agent spawn.

---

## Step 3. Atlas lens: runtime container diagram (C4-style)

### What
Add an Atlas lens that shows the system as it *runs*, not as it is filed: the
browser SPA, the Vite dev middleware / static host, the Node HTTP + WebSocket
server, the Electron main process, the spawned agent CLIs (claude / opencode),
the pty sessions, git and the `.bridza/` file store on disk — with the real
channels between them (HTTP `/api/bridza/*`, the `/api/bridza/pty` WebSocket,
ndjson streams, `child_process` spawns, filesystem reads/writes).

The container set is declared once in a small committed manifest
(`docs/atlas/containers.json`) so it stays reviewable, but the **edges are
derived from the code** by the scanner, not hand-drawn: HTTP edges from the
route table in `server/bridge.js` and the call sites in
`src/app/api/client.js`, spawn edges from the tool runner in
`server/bridza-run.js`, store edges from `server/bridza-store.js` /
`server/bridza-fs.js`. A derived edge whose evidence has disappeared is shown
as **stale**; a call site that matches no declared container is shown as
**undeclared**. Both are listed in a side panel.

Each container box carries the files that implement it; clicking a box selects
it into the shared Atlas selection, and its file list is clickable through to
the file map / editor.

### Why
No one can read the four-host topology of this project out of a file tree: that
the SPA talks to one Node process, which shells out to AI CLIs, which write to
a git worktree, which the SPA then reads back as project state — that is *the*
mental model of Bridza, and it is currently only in people's heads and in a few
comment headers. Deriving the edges from code instead of drawing them by hand
is the difference between a diagram that is true in six months and a
whiteboard photo.

### Acceptance criteria
- A "Runtime" lens is available in the Atlas lens switcher and renders the
  containers from `docs/atlas/containers.json`, grouped by process boundary
  (browser / node server / electron main / external processes / disk).
- Edges are derived at scan time: every `/api/bridza/*` route handled in
  `server/bridge.js` produces a client→server edge when a matching call exists
  in `src/app/api/client.js`; the pty WebSocket, the ndjson run streams, the
  agent `spawn` calls and the git/filesystem writes each produce their own
  labelled edge kind.
- Hovering an edge shows its evidence (file + line of the route handler and of
  the call site); clicking it opens that file.
- A derived edge with no current evidence renders as **stale** and is listed;
  an API call or spawn found in code that maps to no declared container renders
  as **undeclared** and is listed. On this repo as it stands today, both lists
  are empty.
- Clicking a container selects it (shared Atlas selection) and shows its
  implementing files; each file opens in the editor.
- The manifest is data, not code: adding a container entry changes the diagram
  with no component changes, and a malformed manifest shows an inline error
  instead of crashing the view.
- Unit tests cover the edge derivation against a fixture (routes + client calls
  + a spawn), including the stale and undeclared cases, and the manifest
  validator. No agent spawn in tests.

---

## Step 4. Atlas lens: request flow / sequence map

### What
Add an Atlas lens that traces **one operation end to end** as a sequence
diagram: pick an API operation (e.g. `POST /api/bridza/run/stage`,
`POST /api/bridza/finalize`, `GET /api/bridza/state`) and see the ordered hops —
UI call site in `src/app/features/*` → `src/app/api/client.js` export → route
branch in `server/bridge.js` → the store/run functions it calls
(`server/bridza-store.js`, `server/bridza-run.js`, `core/domain.js`) → git
commands and files touched → what comes back (JSON vs ndjson event stream).

The trace is built statically by the scanner: an operation index maps each
`client.js` export to its route path, each route branch to the handler
functions it calls, and one call level deeper into the store/run modules. Ship
it as `GET /api/bridza/atlas/flows` returning
`{ operations: [{ id, method, path, clientFn, steps: [{ label, file, line, kind }], response: "json" | "ndjson" | "ws" }] }`.

UI: a searchable operation list on the left, the selected operation's lane
diagram on the right — one lane per participant (UI, client, server route,
store/runner, git/disk) with numbered arrows. Every step is clickable to its
source line. Streaming operations show their event kinds (`out`, `cmd`,
`commit`, `meta`, end event) on the return arrow.

### Why
The `/api/bridza/*` surface is the seam where most real questions live: "what
actually happens when I press Run", "where does the commit get made", "why did
finalize touch main". Today answering that means reading three files in
sequence and holding the order in your head. A per-operation sequence lens turns
the most common code-reading task in this repo into a click, and it reads the
truth out of the code rather than a doc that drifts.

### Acceptance criteria
- `GET /api/bridza/atlas/flows` lists every `/api/bridza/*` operation handled in
  `server/bridge.js`, each with its HTTP method, path, the `client.js` export
  that calls it (or `null` for server-only routes), and its response kind
  (`json`, `ndjson`, `ws`).
- For each operation, `steps` are in call order with file + line, covering: the
  client export, the route branch, the handler functions it invokes, and any
  git command or file write reached one level deeper.
- The lens renders the selected operation as numbered lanes; a step with no
  known participant lane falls back to a generic lane rather than being
  dropped.
- Clicking any step opens that file at that line in the editor; clicking an
  operation also sets the shared Atlas selection so the other lenses highlight
  the files involved.
- Search filters operations by path, method or client function name.
- Streaming operations (`/run/stage`, `/automate`, `/term/run`) are labelled as
  streams and show their event kinds; non-streaming ones do not.
- Operations whose handler could not be traced past the route branch are shown
  with a visible "not traced further" marker instead of an empty diagram.
- Unit tests cover the operation index against a fixture route file + client
  file: a plain JSON route, a streaming route, a route with no client caller,
  and a handler calling two store functions. No agent spawn.

---

## Step 5. Atlas lens: git history, churn & co-change

### What
Add an Atlas lens over the repo's **history**, built from `git log` (the app
already shells git in `server/bridza-store.js` / `server/bridza-run.js`; reuse
that plumbing, do not add a git library). New endpoint
`GET /api/bridza/atlas/history?since=&limit=` returns, for the scanned files:

- per-file churn: commits, insertions, deletions, first/last touched, authors;
- a commit timeline bucketed by day/week;
- **co-change pairs**: files that change together in the same commit, with a
  support/confidence score;
- per-directory rollups.

UI gives three linked views on one screen: a **heat overlay** (the file-map
boxes from `atlas-shell-and-file-map` tinted by churn), a **timeline scrubber**
that restricts the window and re-tints live, and a **co-change graph** where
edge weight = how often two files move together. Selecting a file shows its
commit list; each commit opens the existing diff viewer
(`src/app/features/diff.jsx` via the `/api/bridza/diff` endpoint) — no new diff
UI.

Bridza-specific touch: commits made by stage runs are tagged in their messages,
so attribute each commit to human / agent-run and let the user filter by that.

### Why
Half of "understanding a codebase" is understanding its motion: what is hot,
what is dead, what always breaks together, who touched it last. This repo's own
history is dense with agent-generated commits, which makes the question "was
this written by a person or by a run" a real one. Coupling that is invisible in
the import graph — two files with no import edge that always change together —
only shows up in co-change, and it is usually where the hidden design contract
lives.

### Acceptance criteria
- `GET /api/bridza/atlas/history` returns per-file churn (`commits`,
  `insertions`, `deletions`, `firstAt`, `lastAt`, `authors[]`), day/week commit
  buckets, directory rollups and co-change pairs with support and confidence;
  `since` and `limit` bound the walk.
- Renames are followed (`git log --follow`-equivalent behaviour) so a renamed
  file does not appear as two unrelated histories; merge commits are excluded
  from churn by default.
- The heat overlay tints the file map by churn with a legend and an explicit
  "no commits in window" state; the tint updates when the timeline window
  changes, without a full re-scan.
- The timeline scrubber narrows the window to a date range; all three views
  (heat, file list, co-change) reflect the same window.
- The co-change graph shows the top N pairs with weights, filters by minimum
  support, and clicking an edge selects both files and lists the commits they
  share.
- Selecting a file lists its commits (sha, subject, author, date, +/−); clicking
  one opens the existing diff view for that commit.
- Commits produced by Bridza stage runs are distinguishable from hand commits,
  and a filter shows human-only / agent-only / all.
- History for this repo loads in under 3s for the default window and the UI
  shows progress rather than freezing on larger windows.
- Unit tests parse fixed `git log` output fixtures (including a rename, a merge
  commit and a multi-file commit) and assert churn, buckets and co-change
  scoring; tests must not invoke git against the developer's real repo.

---

## Step 6. Atlas lens: docs, ADRs & code links

### What
Add an Atlas lens over the repo's **written knowledge**: `docs/` (including
`docs/adr/`), the root markdown set (`README.md`, `CLAUDE.md`,
`CONTRIBUTING.md`, `DEPLOY.md`, `spec.md`, `acceptance.md`, `review.md`,
`repro.md`) and any `*.md` elsewhere in the tree.

The scanner indexes each doc's title, headings, size, last-touched date, its
outgoing markdown links, and — the point of the lens — the **code paths it
mentions** (inline-code spans and link targets that resolve to real files in the
repo). Expose as `GET /api/bridza/atlas/docs` returning
`{ docs: [{ path, title, headings, mtime, links, mentions }], orphans, brokenLinks }`.

UI: a bipartite map with docs on one side and code areas on the other, edges =
mentions; select a doc to read it rendered in a side pane with its mentioned
files clickable, select a code file to see which docs talk about it. Flag three
health signals: **broken links** (link target missing), **stale docs** (doc
older than the code it describes), and **undocumented areas** (directories no
doc mentions). ADRs get their own strip ordered by number with their status
(proposed / accepted / superseded) pulled from the file.

### Why
This repo carries a real doc set — a numbered `docs/` series plus ADRs — and
none of it is reachable from inside the app; worse, nothing tells you whether a
given doc still matches the code. Linking docs to the files they mention turns
prose into part of the map: "what has been decided about this file" becomes a
click from the file, and doc rot becomes visible instead of silent.

### Acceptance criteria
- `GET /api/bridza/atlas/docs` indexes every markdown file in the scan
  (respecting the same ignore rules) with title, heading outline, mtime,
  outgoing links and resolved code mentions.
- A mention is recorded only when the referenced path resolves to a file that
  exists in the repo; unresolvable references are not mentions and, when they
  came from a markdown link, are reported under `brokenLinks`.
- The bipartite view renders docs ↔ code-area edges; selecting a doc opens it
  rendered (headings, code blocks, lists) in a side pane, and every mentioned
  path in it is clickable to the file.
- Selecting a code file (shared Atlas selection, from any lens) lists the docs
  that mention it, or an explicit "no docs mention this file".
- Stale docs are flagged when the doc's last commit predates the last commit of
  every file it mentions, with the comparison dates shown.
- Undocumented areas lists directories with source files that no doc mentions.
- The ADR strip lists `docs/adr/*` in number order with each ADR's status
  parsed from its content; a superseded ADR links to its successor when the
  file states one.
- Unit tests cover the doc indexer against a fixture doc set: a doc with valid
  and broken links, an inline-code path mention, a doc with no mentions, and an
  ADR with `superseded by`. No agent spawn.

---

## Step 7. Ask AI about the selected part of the diagram

### What
Make the Atlas answer questions. Click any node in any lens → an **Ask** panel
opens pre-scoped to that node → type a question → a streamed answer comes back
about *that* part of the codebase.

Server: a one-shot ask endpoint `POST /api/bridza/atlas/ask` that streams ndjson
the same way `/api/bridza/run/stage` does, reusing the existing agent runner and
tool discovery in `server/bridza-run.js` (claude / opencode, with the model
picker from `GET /api/bridza/models`) — no new provider integration, no API
keys in the app.

The value is in the **context pack** the endpoint builds from the selection
before it asks, so the agent is not left to grep from scratch:

- what the node is (file / directory / container / operation / commit) and where;
- the file's source, truncated with a stated budget (head + tail for big files);
- its direct importers and imports (from `atlas-module-dependency-graph` when
  present, skipped when not);
- its recent commits and churn (from `atlas-git-history-lens` when present);
- docs that mention it (from `atlas-docs-knowledge-lens` when present);
- the question itself, plus a system prompt that pins the agent to explaining
  this repo and citing `file:line`.

Client: `askAtlas` in `src/app/api/client.js` (stream helper already exists),
an Ask panel in `src/app/features/atlas.jsx` with agent + model pickers
mirroring `StageRunner` (`src/app/features/views.jsx`), streamed output, stop,
and a few one-click starter questions ("what is this for?", "who depends on
this?", "what would break if I changed it?", "walk me through this flow").

### Why
The intent is explicit: the diagrams alone are not the feature — being able to
point at a box and ask about it is. Diagrams answer *what* and *where*; the
questions people actually have are *why* and *what happens if*. Bridza already
owns an agent runner and streaming plumbing, so the honest scope here is
context assembly and a panel, not an AI stack.

### Acceptance criteria
- With a node selected in any lens, an Ask panel shows what the question is
  scoped to (kind + path/label) and lets the user pick agent and model; defaults
  come from the same tool discovery the stage runner uses, and an unavailable
  tool is disabled with a reason, not silently failing.
- `POST /api/bridza/atlas/ask` streams ndjson events and the panel renders
  tokens as they arrive; Stop cancels the run and kills the child process, and
  the panel returns to idle within a second.
- The context pack is assembled server-side and is inspectable from the UI
  ("show what was sent") before or after asking — no hidden prompt.
- Context respects a byte budget: large files are truncated head+tail with the
  omission marked, and the pack states which sources were included and which
  were unavailable.
- Optional enrichments degrade cleanly: with the import graph, history or docs
  lenses not yet built (or their scan failing), the ask still works with the
  sources that are available and says so.
- Answers cite `file:line` references; each citation in the rendered answer is
  clickable and opens that file at that line.
- Asking with nothing selected scopes to the repo as a whole rather than
  erroring.
- Two asks in a row do not leak processes: the previous run is ended before a
  new one starts, and no orphaned child remains after Stop (assert via the
  runner's active-run bookkeeping).
- Unit tests cover context-pack assembly (each node kind, truncation, missing
  optional sources) and the endpoint's event/stop lifecycle with an injected
  fake runner — no real agent spawn in tests.

---

## Step 8. Atlas AI chat thread with two-way citations

### What
Turn the one-shot Ask panel into a **conversation** about the codebase, wired
both ways to the diagrams.

- Multi-turn thread: follow-up questions carry the prior turns plus the context
  packs already sent, within a stated token/byte budget; when the budget forces
  a drop, the UI says which turns were summarised or dropped.
- Threads persist per repo under `.bridza/atlas/threads/*.json` (written via
  the existing store/fs helpers), survive a reload and an app restart, and can
  be renamed, deleted and switched between from a thread list.
- Selection pinning: a turn records which node it was asked about. Changing the
  diagram selection mid-thread adds a new pinned context rather than silently
  changing the subject, and the pinned chips are removable.
- **Two-way citations**: `file:line` references in answers are clickable and
  (a) open the file and (b) select and reveal that node in the active lens —
  scrolling/zooming it into view. Conversely, selecting a node filters the
  thread to turns that touched it.
- Copy/export a thread as markdown.

### Why
Understanding a system is a conversation, not a lookup: the second question is
always "…and how does that reach the server?" A one-shot ask throws that away
and makes the user re-establish the subject every time. Persisting threads also
turns accumulated answers into a repo artefact the next person (or agent) can
read, and the citation round-trip is what keeps the chat and the diagram from
becoming two disconnected tools sharing a screen.

### Acceptance criteria
- A follow-up question is answered with the prior turns in context: asking
  "what calls it?" after "what is this file?" resolves "it" to the pinned node,
  with no restatement by the user.
- Threads are persisted per repo, listed newest-first, and restored after a full
  app restart with their turns, pinned selections and agent/model choices
  intact; renaming and deleting a thread updates the list and the files.
- Budgeting is explicit: when history plus context exceeds the budget, the
  oldest turns are dropped or summarised and the UI states what happened; it
  never silently truncates mid-message.
- Changing the diagram selection while a thread is open adds a second pinned
  context chip; the next question includes both, and removing a chip removes it
  from subsequent turns.
- Clicking a `file:line` citation opens the file and selects + reveals the
  matching node in the active lens; when no node matches (e.g. the file is
  filtered out of the current view), the UI says so instead of doing nothing.
- Selecting a node offers "show turns about this" and filters the thread to
  those turns, with a clear control to unfilter.
- Export copies the thread as markdown including questions, answers and
  citations.
- Streaming, stop and process hygiene from `atlas-ask-ai-about-selection` still
  hold across a multi-turn thread: stopping turn 3 leaves turns 1–2 intact and
  no orphaned child process.
- Unit tests cover thread persistence (write → reload → restore), budget
  trimming, pinned-context accumulation and citation→node resolution (match and
  no-match), with an injected fake runner; no real agent spawn.

---

## Step 9. AI-written architecture overview & area briefs

### What
Use the ask infrastructure in the other direction: instead of the user asking,
the Atlas **pre-answers** the obvious questions.

- **Repo overview**: a "Explain this repo" action runs the agent over the scan
  summary (areas, sizes, entrypoints, containers, top-churn files, doc index)
  and writes a narrative overview — what this project is, its hosts and
  boundaries, where to start reading, the five files that matter most — into
  `docs/atlas/overview.md`, committed via the existing store commit helper.
- **Area briefs**: per top-level area (`src/app`, `server`, `core`,
  `electron`, `e2e`) a short brief cached in `.bridza/atlas/briefs/<area>.json`,
  shown inline when that area is selected in any lens, so hovering the map gives
  a sentence without asking anything.
- **Freshness**: each generated artefact records the commit sha and scan digest
  it was generated from. When the underlying files move past a threshold, the
  UI marks it stale and offers Regenerate; nothing regenerates automatically or
  on a timer.
- Generated prose is clearly labelled as AI-written with its model, date and
  source commit, and is editable by hand — a hand edit is preserved and the
  regenerate action warns before overwriting it.

### Why
The first five minutes in an unfamiliar repo are spent forming a story, and no
diagram supplies the story. An overview generated from the *scanned* structure
(rather than from a blind agent read) is both cheap and grounded, and writing it
to `docs/` means it helps people reading the repo on GitHub, not just inside the
app. Caching per area keeps the cost bounded and the UI instant; explicit
staleness is what stops it from becoming the next stale doc.

### Acceptance criteria
- "Explain this repo" streams generation and writes `docs/atlas/overview.md`
  with front matter recording model, agent, generated-at, source commit sha and
  scan digest; the file is committed through the existing commit helper, not a
  new git path.
- The overview names real areas, entrypoints and files that exist in the scan;
  every file path it cites resolves (a post-generation check flags any that do
  not, and flagged paths are listed rather than silently written).
- Selecting an area in any lens shows its cached brief immediately when present,
  or a "generate brief" affordance when not; generating one caches it under
  `.bridza/atlas/briefs/`.
- Staleness: after commits change the files an artefact was generated from
  beyond the threshold, the UI marks it stale, shows what changed since, and
  offers Regenerate. Nothing regenerates without the user asking.
- Hand edits to `docs/atlas/overview.md` are detected (content digest differs
  from the generated one) and Regenerate warns and requires confirmation before
  overwriting.
- Every AI-written block is visibly attributed (model + date + source commit) in
  the UI and in the written file.
- Generation failure (agent unavailable, non-zero exit, empty output) leaves the
  previous artefact untouched and reports the error.
- Unit tests cover artefact write/read, digest-based staleness, hand-edit
  detection, citation resolution checking and the failure path, with an injected
  fake runner; no real agent spawn and no commits to the user's repo in tests.

---

## Step 10. Export a lens as SVG / PNG / Mermaid

### What
Let the current Atlas view leave the app. An **Export** control on every lens
offers:

- **SVG** — the diagram exactly as shown (current layout, manual node positions,
  filters, zoom window), self-contained with inlined styles;
- **PNG** — the same, rasterised at 1× / 2×;
- **Mermaid / DOT text** — the graph as source (`flowchart` for node-link
  lenses, `sequenceDiagram` for the request-flow lens), so it can be pasted into
  a PR or a markdown doc that renders on GitHub;
- **Save to `docs/atlas/`** — write the export into the repo and commit it via
  the existing commit helper, so a diagram can be referenced from `README.md` or
  an ADR.

Exports carry a caption footer: repo name, source commit sha, lens name and
generated-at, so a diagram found later can be traced to the state it described.

### Why
Diagrams that only exist inside one app do not make it into PR descriptions,
ADRs or onboarding docs, which is where a system design picture does most of its
work. Mermaid text matters more than the image: it renders on GitHub, diffs as
text, and can be regenerated when the code moves. This is the slice that makes
the Atlas useful to people who are not sitting in front of it.

### Acceptance criteria
- Every lens that renders a diagram offers Export; the exported artefact matches
  what is on screen, including manual node positions, the active filters and the
  current zoom/drill level.
- SVG output opens standalone in a browser with correct fonts, colours and
  layout (no missing CSS), and has no external references.
- PNG export is offered at 1× and 2× and produces a non-empty image of the same
  bounds as the SVG.
- Mermaid export produces valid source: `flowchart` for the file map, import
  graph, runtime and docs lenses; `sequenceDiagram` for the request-flow lens.
  Node ids are sanitised so paths with `/`, `.` and `-` do not break parsing,
  and labels keep the readable path.
- Round-trip check: the exported Mermaid renders (validated in a test with the
  same parser rules) and contains one node per visible node and one edge per
  visible edge.
- "Save to repo" writes under `docs/atlas/` with a predictable filename
  (`<lens>-<shortsha>.svg|png|mmd`), commits through the existing commit helper,
  and reports the written path; the user is asked before overwriting an existing
  file.
- Each export includes the caption footer (repo, commit sha, lens,
  generated-at).
- A lens with nothing to show exports an explicit empty-state artefact rather
  than a zero-byte file.
- Unit tests cover Mermaid/DOT serialisation (id sanitisation, both diagram
  kinds, empty graph) and the filename/caption logic; no commits to the user's
  repo in tests.

---

## Step 11. Incremental scan cache + ignore settings

### What
Make the Atlas scan fast and controllable on repos much larger than this one.

- **Cache**: persist the scan result under `.bridza/atlas/cache.json` keyed by
  repo + scanner version. On re-open, serve the cache immediately and refresh in
  the background.
- **Incremental refresh**: recompute only files whose mtime/size changed since
  the cached entry (and their dependents in the import graph), instead of
  re-walking and re-parsing everything.
- **Ignore settings**: a per-repo `.bridza/atlas/config.json` with extra ignore
  globs, max file size, and an opt-in to include `node_modules`/vendor; editable
  from an Atlas settings panel (matching the style of
  `src/app/features/settings.jsx`).
- **Budget + progress**: a hard cap on files scanned with a visible "scan
  truncated at N files" state and a control to raise it; a progress indicator
  while a refresh runs, with the stale cache still interactive underneath.
- **Manual rescan**: a rescan control that bypasses the cache.

### Why
The first lens ships a straight walk because it is enough for an 8k-line repo.
Bridza is pointed at whatever repo the user opens, and on a large monorepo an
unbounded walk plus an import parse per file turns the Atlas from a map into a
spinner — and, worse, blocks the AI ask that depends on the scan. Caching also
removes the cold-start cost on every visit to the view, which is what decides
whether people use it daily or once.

### Acceptance criteria
- A second open of the Atlas for the same repo renders from cache with no
  full walk, and the refresh happens in the background while the view stays
  interactive.
- Changing one file and refreshing recomputes that file (and, for the import
  graph, only its dependents) — asserted by counting parse calls, not by timing.
- The cache is invalidated wholesale when the scanner version changes or the
  config changes; a corrupt or unreadable cache falls back to a full scan
  instead of erroring the view.
- Ignore globs, max file size and the vendor opt-in from
  `.bridza/atlas/config.json` are honoured by the scan and editable from the
  settings panel; saving triggers a rescan.
- The file cap is enforced with a visible truncation state naming the cap and
  the number of files skipped, and a control to raise it.
- Cache files live under `.bridza/atlas/` and are covered by the repo's ignore
  rules so a scan cache is never committed by a stage run.
- On a synthetic fixture of 10k files the initial scan reports progress and
  never blocks the UI thread for more than 100ms at a time; the cached re-open
  is under 300ms.
- Unit tests cover cache write/read/invalidate, incremental selection of changed
  files and their dependents, corrupt-cache fallback, config precedence over
  defaults, and cap enforcement.
