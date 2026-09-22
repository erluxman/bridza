// features/views.jsx — the three task-detail views that all read the ONE unified
// stage record (lib/record.js): Inspector (devtools split-pane), Canvas (spatial
// node graph with 5 layouts), and Chat (conversation thread). Every view can now
// OPERATE a stage — pick/change the agent, see the system prompt, edit the user
// prompt and run — via the shared StageRunner, so you can queue instructions on
// one stage while another runs. Every file, commit chip and node is clickable.
import { useState, useEffect, useRef } from "react";
import * as api from "../api/client.js";
import { fmt, ago, runPrompt } from "../lib/format.js";
import { lastRunTool, lastRunModel, buildChatTurns } from "../lib/record.js";
import { CHAT_STAGE, isToolChatter } from "../../../core/domain.js";
import { layoutNodes, LAYOUTS } from "../lib/layout.js";
import { useCanvasOverrides, effLayout, CanvasNode } from "../lib/canvas.jsx";

const STATUS = ["idle", "running", "done", "failed", "interrupted", "stopped"];
const led = (s) => "uxv-led " + (STATUS.includes(s) ? s : "idle");

// The run controls for one stage, shared by the classic Stages view AND all three
// new views: agent (tool) picker, optional model, the stage's system prompt
// (viewable), an editable user prompt, Run, and live output. Self-contained — it
// owns its own tool/model/prompt/output state and calls api.runStage directly.
export function StageRunner({ dir, pipeline, task, def, track, tools = [], live, seconds = 0, onDone, flash, onLog, onActivity, onRunning, onAttach, onEnded, advanceFor, brief = "" }) {
  const runs = track.runs || [];
  const lastPrompt = runs.length ? (runs[runs.length - 1].prompt || "") : "";
  // First run of a stage starts from the task's brief (title + context.md +
  // the stage hint) — the same text auto-advance would send, so the intent the
  // user captured is there to edit instead of an empty box.
  const seed = () => lastPrompt || [task.title && ("Task: " + task.title), brief, def.hint].filter(Boolean).join("\n\n");
  // the agent the user PICKED for this stage (task.routing, saved on the task)
  // comes first — it survives windows, background runs and auto-advance; the
  // last run and the stage default are the fallbacks for tasks without one.
  const routed = () => (task.routing && task.routing[def.id]) || {};
  const remembered = () => routed().tool || lastRunTool(runs) || def.tool || (tools[0] && tools[0].id) || "opencode";
  const rememberedModel = () => routed().model || lastRunModel(runs);
  const [tool, setTool] = useState(remembered);
  const [model, setModel] = useState(rememberedModel);
  const [models, setModels] = useState([]);
  const [prompt, setPrompt] = useState(seed);
  const [out, setOut] = useState("");
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);   // the run THIS page started (not a re-attach)
  const attachRef = useRef(null);     // the attach stream's AbortController, if one is up
  const [sysOpen, setSysOpen] = useState(false);
  const termRef = useRef(null);
  const setLive = (on) => { setRunning(on); if (onRunning) onRunning(on); };
  const append = (s) => { setOut((o) => (o + s).slice(-12000)); if (onLog) onLog(s); };
  // one place turns stream events into text — the run we started and a run we
  // re-attached to look identical
  const handle = (e) => {
    if (e.t === "out") append(e.d);
    else if (e.t === "cmd") append("\n$ " + e.cmd + "\n");
    else if (e.t === "commit") append(`\n● ${e.phase} commit ${e.sha.slice(0, 7)}\n`);
    else if (e.t === "meta") append(`⎇ ${e.branch}\n`);
  };
  const dropAttach = () => { if (attachRef.current) { attachRef.current.abort(); attachRef.current = null; } };
  // switching task/stage re-seeds from that stage's last run: prompt, agent AND
  // model — so you resume with exactly what you last used, not the tool default.
  useEffect(() => { dropAttach(); setPrompt(seed()); setTool(remembered()); setModel(rememberedModel()); setOut(""); }, [pipeline.id, task.id, def.id]);
  useEffect(() => () => dropAttach(), []);
  // The run lives on the server, this box is only a window onto it. On mount and
  // whenever the stage's live flag flips, (re)attach: a run that's live right now
  // (page refreshed mid-run, auto-advance, another window) replays what it has
  // printed and streams on — Run stays disabled, Stop keeps working. A run that
  // finished while nobody was looking shows its text and why it ended.
  useEffect(() => {
    if (runningRef.current || attachRef.current) return;
    const ac = new AbortController(); attachRef.current = ac;
    let isLive = false;
    api.attachRun(dir, { pipeline: pipeline.id, task: task.id, stage: def.id }, (e) => {
      if (e.t === "replay") {
        isLive = !!e.live;
        if (isLive) {
          setLive(true); setOut(e.log || "");
          if (onLog) onLog(`\n━━ ${def.name} · reattached to the live run ━━\n` + (e.log || ""));
          if (onAttach) onAttach(def.id, e);
        } else setOut((o) => o || (e.log || ""));
      } else if (e.t === "end") {
        // a finished run's reason, shown once — a live run's end is handled below
        if (!isLive && e.error) setOut((o) => o.includes(e.error) ? o : o + `\n✖ ${e.error}\n`);
        if (!isLive && e.replayed && onEnded) onEnded(e);   // the header can say "failed", not "idle"
      } else if (isLive) handle(e);
    }, ac.signal).then((end) => {
      if (attachRef.current === ac) attachRef.current = null;
      if (!isLive || ac.signal.aborted) return;
      setLive(false);
      if (end && end.error) append(`\n✖ ${end.error}\n`);
      if (end && end.status === "done") flash(`${def.name}: done`); else if (end) flash(`${def.name}: ${end.error || end.status}`);
      if (end && end.advancing) append(`\n⚡ auto-advance · ${end.advancing} stage(s) continue on the server\n`);
      if (onEnded) onEnded(end);
      if (onDone) onDone(end, def.id);
    });
  }, [dir, pipeline.id, task.id, def.id, live]);
  // saved at PICK time, not run time: a stage chosen and never run still keeps
  // its agent, and every later execution of it — anywhere — uses that one.
  // a no-op (the model box blurred untouched) must not write — saving a pick
  // materialises the task's branch/worktree, so only a real change does it.
  const persist = (t, m) => {
    const r = routed();
    if ((r.tool || "") === t && (r.model || "") === m) return;
    api.setStageRouting(dir, { pipeline: pipeline.id, task: task.id, stage: def.id, tool: t, model: m });
  };
  // the brief loads async, usually after this mounts — fill the box only while
  // it's still empty, so it never clobbers what the user is typing
  useEffect(() => { if (brief) setPrompt((p) => p || seed()); }, [brief]);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [out]);
  useEffect(() => { let on = true; api.getModels(dir, tool).then((r) => { if (on) setModels((r && r.models) || []); }); return () => { on = false; }; }, [dir, tool]);

  const run = async () => {
    if (onActivity) onActivity();
    dropAttach();
    setOut(""); runningRef.current = true; setLive(true);
    if (onLog) onLog(`\n━━ ${def.name} · run ━━\n`);
    // the stages after this one ride along: the SERVER carries the task on
    // through them when this stage ends done (auto-advance), so a refresh or a
    // closed tab mid-run never stalls the chain
    const advance = advanceFor ? advanceFor(def.id) : [];
    const end = await api.runStage(dir, {
      pipeline: pipeline.id, task: task.id, stage: def.id, tool, model: model.trim(),
      prompt: runPrompt(pipeline, task, def, prompt), system: def.systemPrompt || "", shell: def.shell || [], workingDir: pipeline.workingDir || ".",
      stageName: def.name, taskTitle: task.title, wallSeconds: seconds, advance,
    }, handle);
    runningRef.current = false; setLive(false);
    if (end && end.error) append(`\n✖ ${end.error}\n`);
    if (end && end.status === "done") flash(`${def.name}: done`); else if (end) flash(`${def.name}: ${end.error || end.status}`);
    if (end && end.advancing) append(`\n⚡ auto-advance · ${end.advancing} stage(s) continue on the server\n`);
    if (onEnded) onEnded(end);
    if (onDone) onDone(end, def.id);
  };

  return (
    <div className="stage-run">
      <div className="row" style={{ marginBottom: 8 }}>
        <select className="input" style={{ width: 150 }} value={tool} onChange={(e) => { setTool(e.target.value); setModel(""); persist(e.target.value, ""); }} title="Which agent runs this stage — saved on the task, used by every later run of it">
          {tools.map((t) => <option key={t.id} value={t.id} disabled={!t.available}>{t.label}{t.available ? "" : " (n/a)"}{t.stub ? " · stub" : ""}</option>)}
        </select>
        <input className="input mono model-pick" list={"models-run-" + def.id} placeholder="model · tool default"
          title="Leave empty to use the tool's own default model; pick or type to override for this run"
          value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => persist(tool, model.trim())} />
        <datalist id={"models-run-" + def.id}>{models.map((m) => <option key={m} value={m} />)}</datalist>
        {model.trim() && <button className="btn ghost sm" title="Back to the tool's default model" onClick={() => { setModel(""); persist(tool, ""); }}>×</button>}
        <button className="btn primary" onClick={run} disabled={running}>{running ? "Running…" : (runs.length ? "▸ Run again" : "▸ Run stage")}</button>
      </div>
      <button className="uxv-syslink" onClick={() => setSysOpen((o) => !o)} title="The stage's system prompt — applied automatically every run">{sysOpen ? "▾" : "▸"} system prompt</button>
      {sysOpen && <pre className="uxv-pre sys">{def.systemPrompt || "— none —"}</pre>}
      <textarea className="input" placeholder={`What should ${def.name} do? (the system prompt is applied automatically)`}
        value={prompt} onChange={(e) => { setPrompt(e.target.value); onActivity && onActivity(); }} />
      {(out || running) && <div className="term" ref={termRef} style={{ marginTop: 10 }}>{out || "…"}</div>}
    </div>
  );
}

// Resolve the StageRunner props for a record from the shared `runner` context.
function runnerFor(runner, rec) {
  const def = (runner.pipeline.stages || []).find((s) => s.id === rec.id) || { id: rec.id, name: rec.name };
  const track = runner.task.tracking[rec.id] || { status: "idle" };
  const live = runner.runningStages ? runner.runningStages.has(runner.pipeline.id + "/" + runner.task.id + "/" + rec.id) : false;
  return { dir: runner.dir, pipeline: runner.pipeline, task: runner.task, def, track, tools: runner.tools, live, onDone: runner.onDone, flash: runner.flash, onLog: runner.onLog, onActivity: runner.onActivity, onAttach: runner.onAttach, advanceFor: runner.advanceFor };
}

// A run's changed-file list — each file opens its diff (via its result commit)
// or the file itself. Shared by every view.
function FileList({ files, commit, onDiff, onOpenFile }) {
  if (!files || !files.length) return <span className="uxv-dim">no file changes</span>;
  return (
    <div className="uxv-files">
      {files.map((f) => (
        <button key={f.path} className={"uxv-file" + (f.change ? " ch-" + f.change : "")}
          title={`${f.path}${f.add || f.del ? `  +${f.add} −${f.del}` : ""} — ${commit ? "view diff" : "open file"}`}
          onClick={() => commit ? onDiff(commit) : onOpenFile(f.path)}>
          {f.change && <i className="uxv-chg">{f.change}</i>}
          <span className="uxv-fn">{f.name}</span>
          {(f.add || f.del) ? <span className="uxv-churn"><i className="add">+{f.add}</i> <i className="del">−{f.del}</i></span> : null}
        </button>
      ))}
    </div>
  );
}

// The full detail of one stage: the runner (agent + prompts + Run) on top, then a
// run-history selector + a tabbed inspector over the selected run. Reused by
// Inspector (right pane) and Canvas (side sheet).
function StageDetail({ rec, runner, onDiff, onOpenFile }) {
  const [pinned, setPinned] = useState(null);   // null = follow the newest run; a number = the user parked on an older one
  const [tab, setTab] = useState("files");
  const runIdx = pinned == null ? rec.runs.length - 1 : Math.min(Math.max(pinned, 0), rec.runs.length - 1);
  const run = rec.runs.length ? rec.runs[runIdx] : null;
  const TABS = run ? [["files", `Files ${run.files.length ? "· " + run.files.length : ""}`], ["response", "Response"], ["summary", "Summary"], ["raw", "Raw JSON"]] : [];
  return (
    <div className="uxv-detail">
      <div className="uxv-detail-hd">
        <span className={led(rec.status)} />
        <b>{rec.name}</b>
        {rec.gate && <span className="uxv-dim">· {rec.gate}</span>}
        <span className={"uxv-tag " + rec.status}>{rec.status}</span>
      </div>

      {runner && <StageRunner {...runnerFor(runner, rec)} />}

      {!run && <p className="uxv-dim">No runs yet — set the agent and instructions above, then Run.</p>}
      {run && (
        <>
          <div className="uxv-audit">
            <span title="tool + model">{run.tool}{run.model ? " · " + run.model : ""}</span>
            {run.durationSec ? <span title="run duration">{fmt(run.durationSec)}</span> : null}
            {run.finishedAt && <span title={new Date(run.finishedAt).toLocaleString()}>{ago(run.finishedAt)}</span>}
            <span title="recorded author">by {run.by}</span>
            {run.commit && <button className="uxv-sha" onClick={() => onDiff(run.commit)} title="View this run's diff">{run.commit.slice(0, 7)}</button>}
            {rec.runs.length > 1 && (
              <span className="uxv-runsel">
                {rec.runs.map((r, i) => (
                  <button key={i} className={"uxv-runpin " + r.status + (i === runIdx ? " on" : "")} title={`run #${r.seq} · ${r.status}`} onClick={() => setPinned(i)}>#{r.seq}</button>
                ))}
              </span>
            )}
          </div>
          <div className="uxv-tabs">
            {TABS.map(([id, label]) => <button key={id} className={"uxv-tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>{label}</button>)}
          </div>
          <div className="uxv-tabbody">
            {tab === "files" && <FileList files={run.files} commit={run.commit} onDiff={onDiff} onOpenFile={onOpenFile} />}
            {tab === "response" && <pre className="uxv-pre resp">{run.response || (run.error ? "⚠ " + run.error : "no response captured for this run")}</pre>}
            {tab === "summary" && (
              <div className="uxv-summary"><p>{run.summary || "—"}</p><FileList files={run.files} commit={run.commit} onDiff={onDiff} onOpenFile={onOpenFile} /></div>
            )}
            {tab === "raw" && <pre className="uxv-pre raw">{JSON.stringify(run, null, 2)}</pre>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Inspector: a stage list on the left, the detail inspector on the right ────
export function InspectorView({ records, activeId, setActiveId, runner, onDiff, onOpenFile }) {
  const rec = records.find((r) => r.id === activeId) || records[0];
  return (
    <div className="uxv-inspector">
      <div className="uxv-stagelist">
        {records.map((r) => (
          <button key={r.id} className={"uxv-stagerow" + (rec && r.id === rec.id ? " on" : "")} onClick={() => setActiveId(r.id)}>
            <span className={led(r.status)} />
            <span className="uxv-ord">{String(r.order + 1).padStart(2, "0")}</span>
            <span className="uxv-srow-name">{r.name}</span>
            <span className="uxv-srow-sum">{r.summary || "—"}</span>
            {r.runCount > 1 && <span className="uxv-rr" title={`${r.runCount} runs`}>×{r.runCount}</span>}
          </button>
        ))}
      </div>
      {rec && <StageDetail key={rec.id} rec={rec} runner={runner} onDiff={onDiff} onOpenFile={onOpenFile} />}
    </div>
  );
}

// ── Canvas: a spatial node graph, 5 layouts, click a node → side sheet ────────
export function CanvasView({ records, activeId, setActiveId, runner, onDiff, onOpenFile }) {
  const canvasKey = runner ? runner.dir + "|" + runner.pipeline.id + "/" + runner.task.id : "t";
  const [mode, setMode] = useState(() => localStorage.getItem("bridza.canvasLayout:" + canvasKey) || "linear");
  const pick = (m) => { setMode(m); try { localStorage.setItem("bridza.canvasLayout:" + canvasKey, m); } catch (e) { /* ignore */ } };
  const NW = 190, NH = 104;
  const base = layoutNodes(records.length, mode, { cell: { w: 230, h: 168 }, nodeW: NW, nodeH: NH });
  const { over, setNode, clear, count } = useCanvasOverrides("bridza.canvasPos:" + canvasKey);
  const { eff, width, height } = effLayout(base, records.map((r) => r.id), over, NW, NH);
  const rec = records.find((r) => r.id === activeId);
  const center = (i) => ({ x: eff[i].x + eff[i].w / 2, y: eff[i].y + eff[i].h / 2 });
  return (
    <div className="uxv-canvaswrap">
      <div className="uxv-layoutbar">
        <span className="uxv-dim" style={{ marginRight: 4 }}>layout</span>
        {LAYOUTS.map((l) => <button key={l.id} className={"uxv-chip" + (mode === l.id ? " on" : "")} title={l.hint} onClick={() => pick(l.id)}>{l.label}</button>)}
        {count > 0 && <button className="uxv-chip reset" title="Clear manual positions — snap every stage back to the layout" onClick={clear}>↺ reset positions</button>}
        <span className="uxv-dim" style={{ marginLeft: "auto" }}>drag to move · corner to resize</span>
      </div>
      <div className="uxv-canvas" style={{ minHeight: height }}>
        <div className="uxv-canvasinner" style={{ width, height }}>
          <svg className="uxv-edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            {records.slice(1).map((r, i) => {
              const a = center(i), b = center(i + 1), mx = (a.x + b.x) / 2;
              return <path key={r.id} className="uxv-edge" d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`} />;
            })}
          </svg>
          {records.map((r, i) => (
            <CanvasNode key={r.id} x={eff[i].x} y={eff[i].y} w={eff[i].w} h={eff[i].h} className={r.status} selected={rec && rec.id === r.id}
              onMove={(x, y) => setNode(r.id, { x, y })} onResize={(w, h) => setNode(r.id, { w, h })} onSelect={() => setActiveId(r.id)}>
              <span className="uxv-node-hd"><span className={led(r.status)} /><b>{r.name}</b><span className="uxv-ord">{String(r.order + 1).padStart(2, "0")}</span></span>
              <span className="uxv-node-sum">{r.summary || "—"}</span>
              <span className="uxv-node-ft">
                <span className={"uxv-tag " + r.status}>{r.status}</span>
                {r.runCount > 1 && <span className="uxv-rr">×{r.runCount}</span>}
                {r.files.length > 0 && <span className="uxv-dim">{r.files.length} file{r.files.length === 1 ? "" : "s"}</span>}
              </span>
            </CanvasNode>
          ))}
        </div>
      </div>
      {rec && (
        <div className="uxv-sheet">
          <button className="uxv-sheet-x" onClick={() => setActiveId("")} title="Close">×</button>
          <StageDetail key={rec.id} rec={rec} runner={runner} onDiff={onDiff} onOpenFile={onOpenFile} />
        </div>
      )}
    </div>
  );
}

// ── Chat: the task as a threaded conversation across stages ───────────────────
// One stage's runs as a thread. The full-pane Chat view stacks these open; the
// chat panel stacks them COLLAPSED, as the conversation's history — the stage
// runs are what was said before, not what the panel is for.
export function StageThread({ r, runner, onDiff, onOpenFile }) {
  return (
    <section className="uxv-thread">
      <div className="uxv-thread-hd">
        <span className={led(r.status)} />
        <b>{String(r.order + 1).padStart(2, "0")} · {r.name}</b>
        <span className={"uxv-tag " + r.status}>{r.status}</span>
      </div>
      {!r.runs.length && <div className="uxv-msg note">Not run yet — set the agent and instructions below, then Run.</div>}
      {r.runs.map((run) => (
        <div className="uxv-turn" key={run.seq}>
          <div className="uxv-turn-meta"><span className="uxv-runpin static">#{run.seq}</span><span className={"uxv-tag " + run.status}>{run.status}</span>
            <span className="uxv-dim">{run.tool}{run.model ? " · " + run.model : ""}{run.finishedAt ? " · " + ago(run.finishedAt) : ""}</span>
            {run.commit && <button className="uxv-sha" onClick={() => onDiff(run.commit)}>{run.commit.slice(0, 7)}</button>}
          </div>
          {run.systemPrompt && <div className="uxv-msg system"><span className="uxv-role">system</span><pre>{run.systemPrompt}</pre></div>}
          <div className="uxv-msg user"><span className="uxv-role">user</span><pre>{run.userPrompt || "—"}</pre></div>
          <div className="uxv-msg asst"><span className="uxv-role">assistant</span>
            <pre>{run.response || (run.error ? "⚠ " + run.error : "no response captured")}</pre>
            <div className="uxv-summary-chip" title="what changed">✎ {run.summary}</div>
            <FileList files={run.files} commit={run.commit} onDiff={onDiff} onOpenFile={onOpenFile} />
          </div>
        </div>
      ))}
      {runner && (
        <div className="uxv-thread-run">
          <div className="uxv-role" style={{ padding: "0 0 6px" }}>continue / re-run</div>
          <StageRunner {...runnerFor(runner, r)} />
        </div>
      )}
    </section>
  );
}

export function ChatView({ records, runner, onDiff, onOpenFile }) {
  return (
    <div className="uxv-chat">
      {records.map((r) => <StageThread key={r.id} r={r} runner={runner} onDiff={onDiff} onOpenFile={onOpenFile} />)}
    </div>
  );
}

// ── the chat panel: talk to the task's agent, and watch it work ──────────────
// The entry point is the floating bubble, not a view tab: this is the one
// surface in the product aimed at someone who would never open a terminal, so
// it cannot be the fourth button in an audit-view switcher.

// What the agent is doing RIGHT NOW, in plain words. The run stream already
// carries it: every agent's tool use is mapped to a `· <Tool> <arg>` line by the
// runner, shell gates arrive as {t:"cmd"}, and a commit as {t:"commit"}. This
// turns the most recent one into something a non-engineer can read. An unmapped
// tool falls back to its own name rather than lying about what it is doing.
const ACTIVITY = {
  Read: (a) => a ? "reading " + a : "reading a file",
  Edit: (a) => a ? "editing " + a : "editing a file",
  MultiEdit: (a) => a ? "editing " + a : "editing a file",
  Write: (a) => a ? "writing " + a : "writing a file",
  NotebookEdit: (a) => a ? "editing " + a : "editing a notebook",
  Bash: (a) => a ? "running " + a : "running a command",
  Grep: () => "searching the code",
  Glob: () => "looking for files",
  Task: () => "thinking it through",
  TodoWrite: () => "planning the steps",
  WebFetch: () => "reading a page",
  WebSearch: () => "searching the web",
};
const clip = (s, n = 48) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export function activityPhrase(line) {
  const s = String(line || "").trim();
  if (!s) return "";
  if (s.startsWith("$ ")) return "running " + clip(s.slice(2));
  const m = s.match(/^·\s+(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return "";
  const name = m[1], arg = clip(String(m[2] || "").trim());
  if (ACTIVITY[name]) return ACTIVITY[name](arg);
  if (/^(done|step|model:|claude|session|opencode)/i.test(name)) return "";   // the runner's own notes, not tool use
  return arg ? name + " " + arg : name;
}

function ActivityLine({ text, done }) {
  return (
    <div className={"chat-activity" + (done ? " done" : "")}>
      <i className="chat-pulse" />
      <span>{text || "working…"}</span>
    </div>
  );
}

// One message pair in the task-level conversation: what you said, and what the
// agent said + did. `live` turns drive the same markup from the open stream, so
// a turn looks identical while it runs and after it lands.
function ChatTurn({ turn, onDiff, onOpenFile }) {
  const [rawOpen, setRawOpen] = useState(false);
  const termRef = useRef(null);
  useEffect(() => { if (rawOpen && termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [rawOpen, turn.log]);
  const failed = turn.status === "failed" || turn.status === "stopped";
  // a plan gate or a finalized task isn't the agent failing — it's the flow
  // saying "not yet", so it reads as a note rather than an error
  const note = turn.status === "blocked" || turn.status === "finalized";
  return (
    <div className={"chat-turn " + (turn.status || "done")}>
      <div className="chat-bub you">{turn.message}</div>
      <div className="chat-bub agent">
        {turn.answer ? <p className="chat-answer">{turn.answer}</p> : null}
        {turn.status === "running" && <ActivityLine text={turn.activity} />}
        {failed && <p className="chat-err">⚠ {turn.error || "the turn did not finish"}</p>}
        {note && <p className="chat-note">{turn.error}</p>}
        {!turn.answer && !failed && !note && turn.status !== "running" && <p className="chat-answer dim">no answer text captured</p>}
        {turn.files && turn.files.length ? <FileList files={turn.files} commit={turn.commit} onDiff={onDiff} onOpenFile={onOpenFile} /> : null}
        <div className="chat-foot">
          <span className="uxv-dim">{turn.tool}{turn.model ? " · " + turn.model : ""}{turn.at ? " · " + ago(turn.at) : ""}</span>
          {turn.commit && <button className="uxv-sha" onClick={() => onDiff(turn.commit)}>{turn.commit.slice(0, 7)}</button>}
          {turn.log ? <button className="uxv-syslink" onClick={() => setRawOpen((o) => !o)}>{rawOpen ? "▾" : "▸"} show details</button> : null}
        </div>
        {rawOpen && <div className="term chat-term" ref={termRef}>{turn.log || "…"}</div>}
      </div>
    </div>
  );
}

// The panel itself. It owns ONE live turn at a time (the task's one-live-run
// rule) and re-attaches to a turn running on the server — started here, in
// another window, or before a reload.
export function ChatPanel({
  dir, pipeline, task, tools = [], records = [], runner, turns = [], live, busyStage,
  onDiff, onOpenFile, onClose, onDone, flash,
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(null);   // the turn in flight, rendered like any other
  const [agentOpen, setAgentOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [tool, setTool] = useState(() => (turns.length ? turns[turns.length - 1].tool : "") || "");
  const [model, setModel] = useState(() => (turns.length ? (turns[turns.length - 1].model || "") : ""));
  const [models, setModels] = useState([]);
  const sendingRef = useRef(false);     // a turn THIS panel started (not a re-attach)
  const attachRef = useRef(null);
  const lineRef = useRef("");           // partial line across stream chunks
  const bodyRef = useRef(null);
  const taRef = useRef(null);

  // the agent this task last ran with — the person this panel is for should
  // never have to pick one, so the ⚙ control starts collapsed and pre-filled
  const fallbackTool = () => {
    for (let i = task.stages.length - 1; i >= 0; i--) {
      const r = (task.routing || {})[task.stages[i]];
      if (r && r.tool) return r.tool;
    }
    return (tools.find((t) => t.available) || tools[0] || {}).id || "opencode";
  };
  const effTool = tool || fallbackTool();
  useEffect(() => { let on = true; api.getModels(dir, effTool).then((r) => { if (on) setModels((r && r.models) || []); }); return () => { on = false; }; }, [dir, effTool]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [turns.length, pending]);
  // …and hand it over the moment they do, so it is never rendered twice
  useEffect(() => { setPending((p) => (p && p.seq && turns.some((t) => t.seq === p.seq) ? null : p)); }, [turns]);

  // fold one stream chunk into the live turn: prose builds the answer, tool
  // chatter drives the activity line. Same split the server uses to store the
  // turn's answer, so what you read live is what lands in the record.
  const absorb = (d) => {
    lineRef.current += d;
    let nl, answer = "", act = null;
    while ((nl = lineRef.current.indexOf("\n")) >= 0) {
      const line = lineRef.current.slice(0, nl); lineRef.current = lineRef.current.slice(nl + 1);
      if (isToolChatter(line)) { const ph = activityPhrase(line); if (ph) act = ph; }
      else if (line.trim()) answer += line + "\n";
    }
    if (!answer && !act) return;
    setPending((p) => p && ({ ...p, answer: (p.answer || "") + answer, activity: act || p.activity }));
  };
  const handle = (e) => {
    if (e.t === "out") { setPending((p) => p && ({ ...p, log: ((p.log || "") + e.d).slice(-24000) })); absorb(e.d); }
    else if (e.t === "cmd") { setPending((p) => p && ({ ...p, log: ((p.log || "") + "\n$ " + e.cmd + "\n").slice(-24000), activity: "running " + clip(e.cmd) })); }
    else if (e.t === "commit") setPending((p) => p && ({ ...p, log: ((p.log || "") + `\n● ${e.phase} commit ${String(e.sha || "").slice(0, 7)}\n`).slice(-24000), activity: "saving the change" }));
    else if (e.t === "meta") setPending((p) => p && ({ ...p, log: ((p.log || "") + `⎇ ${e.branch}\n`).slice(-24000) }));
  };
  const settle = (end) => {
    sendingRef.current = false;
    if (!end) return setPending(null);
    if (end.status === "done") {
      // keep the finished turn on screen, with its answer and file chips, until
      // the stored turns come back carrying it — otherwise the answer blinks out
      // for as long as the refresh takes
      setPending((p) => (end.turn ? { ...p, ...buildChatTurns([end.turn])[0], status: "done", activity: "" } : null));
      if (onDone) onDone(end);
      return;
    }
    // a turn that did not finish stays on screen with its reason — it is part of
    // the conversation even though (like a failed stage) nothing was committed
    setPending((p) => p && ({ ...p, status: end.status || "failed", error: end.error || "the turn did not finish", activity: "" }));
    if (flash && end.error) flash(end.error, 5000);
  };

  // A turn runs on the SERVER. Closing the panel, switching view, reloading or
  // opening the task elsewhere and coming back re-attaches to it — the log
  // replays, the activity line resumes, the answer lands when it ends.
  useEffect(() => {
    if (sendingRef.current || attachRef.current) return;
    const ac = new AbortController(); attachRef.current = ac;
    let isLive = false;
    api.attachRun(dir, { pipeline: pipeline.id, task: task.id, stage: CHAT_STAGE }, (e) => {
      if (e.t === "replay") {
        isLive = !!e.live;
        if (!isLive) return;
        setPending({ message: "(sent from another window)", answer: "", activity: "", status: "running", tool: e.tool || effTool, log: e.log || "", files: [] });
        lineRef.current = "";
        for (const line of String(e.log || "").split("\n")) { const ph = activityPhrase(line); if (ph) setPending((p) => p && ({ ...p, activity: ph })); }
      } else if (isLive) handle(e);
    }, ac.signal).then((end) => {
      if (attachRef.current === ac) attachRef.current = null;
      if (!isLive || ac.signal.aborted) return;
      settle(end);
    });
    return () => { if (attachRef.current) { attachRef.current.abort(); attachRef.current = null; } };
  }, [dir, pipeline.id, task.id, live]);

  const blocked = task.finalized ? "This task is finalized. Reopen a stage or create a follow-up task to keep working."
    : busyStage ? `${busyStage} is running — you can send as soon as it finishes.`
      : pending && pending.status === "running" ? "The agent is working — one turn at a time."
        : "";

  const send = async () => {
    const text = draft.trim();
    if (!text || blocked) return;
    setDraft("");
    lineRef.current = "";
    sendingRef.current = true;
    if (attachRef.current) { attachRef.current.abort(); attachRef.current = null; }
    // the message and a working bubble are on screen before the server answers —
    // silence after pressing send is what reads as broken
    setPending({ message: text, answer: "", activity: "", status: "running", tool: effTool, model: model.trim(), log: "", files: [] });
    const end = await api.sendChat(dir, {
      pipeline: pipeline.id, task: task.id, message: text, tool: effTool, model: model.trim(),
      taskTitle: task.title, workingDir: pipeline.workingDir || ".",
    }, handle);
    settle(end);
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <aside className="chat-panel">
      <div className="chat-hd">
        <b>💬 Chat</b>
        <span className="uxv-dim" style={{ marginLeft: "auto" }}>{task.ref ? "#" + task.ref : ""}</span>
        <button className="chat-x" onClick={onClose} title="Close chat">✕</button>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {records.length > 0 && (
          <div className="chat-hist">
            <button className="chat-histtog" onClick={() => setHistOpen((o) => !o)}>
              {histOpen ? "▾" : "▸"} the stages so far <span className="uxv-dim">{records.length}</span>
            </button>
            {histOpen && records.map((r) => <StageThread key={r.id} r={r} runner={runner} onDiff={onDiff} onOpenFile={onOpenFile} />)}
          </div>
        )}

        {turns.map((t) => <ChatTurn key={t.seq} turn={t} onDiff={onDiff} onOpenFile={onOpenFile} />)}
        {pending && <ChatTurn key={pending.seq || "live"} turn={pending} onDiff={onDiff} onOpenFile={onOpenFile} />}

        {!turns.length && !pending && (
          <p className="chat-empty">Ask for anything else — in plain words.<br /><span className="uxv-dim">e.g. “make the header smaller”</span></p>
        )}
      </div>

      <div className="chat-composer">
        <textarea ref={taRef} className="input chat-input" rows={3} value={draft} disabled={!!blocked}
          placeholder={blocked || "Ask for a change…  (Enter sends, Shift+Enter for a new line)"}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} />
        <div className="chat-crow">
          <button className="uxv-syslink" onClick={() => setAgentOpen((o) => !o)} title="Which agent answers — by default the one this task last ran with">
            {agentOpen ? "▾" : "▸"} ⚙ agent <span className="uxv-dim">{effTool}{model.trim() ? " · " + model.trim() : ""}</span>
          </button>
          <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={send} disabled={!!blocked || !draft.trim()}>Send</button>
        </div>
        {agentOpen && (
          <div className="row chat-agent">
            <select className="input" style={{ width: 140 }} value={effTool} onChange={(e) => { setTool(e.target.value); setModel(""); }}>
              {tools.map((t) => <option key={t.id} value={t.id} disabled={!t.available}>{t.label}{t.available ? "" : " (n/a)"}</option>)}
            </select>
            <input className="input mono model-pick" list="models-chat" placeholder="model · agent default"
              value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id="models-chat">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
        )}
        {blocked && <p className="chat-hint">{blocked}</p>}
      </div>
    </aside>
  );
}

// The entry point: a round 💬 fixed to the bottom-right of the task detail,
// present in every view — including the terminal — and never scrolled away. A
// live turn pulses on it, so someone who navigated elsewhere still sees the
// agent working.
export function ChatBubble({ onClick, live, turns = 0 }) {
  return (
    <button className={"chat-bubble" + (live ? " live" : "")} onClick={onClick}
      title={live ? "The agent is working — open the chat" : "Ask for a change — in plain words"}>
      <span className="chat-bubble-ico">💬</span>
      {live ? <i className="chat-bubble-dot" /> : turns > 0 ? <i className="chat-bubble-n">{turns}</i> : null}
    </button>
  );
}
