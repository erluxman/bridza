// features/views.jsx — the three task-detail views that all read the ONE unified
// stage record (lib/record.js): Inspector (devtools split-pane), Canvas (spatial
// node graph with 5 layouts), and Chat (conversation thread). Every view can now
// OPERATE a stage — pick/change the agent, see the system prompt, edit the user
// prompt and run — via the shared StageRunner, so you can queue instructions on
// one stage while another runs. Every file, commit chip and node is clickable.
import { useState, useEffect, useRef } from "react";
import * as api from "../api/client.js";
import { fmt, ago, runPrompt } from "../lib/format.js";
import { lastRunTool, lastRunModel } from "../lib/record.js";
import { layoutNodes, LAYOUTS } from "../lib/layout.js";
import { useCanvasOverrides, effLayout, CanvasNode } from "../lib/canvas.jsx";

const STATUS = ["idle", "running", "done", "failed", "interrupted", "stopped"];
const led = (s) => "uxv-led " + (STATUS.includes(s) ? s : "idle");

// The run controls for one stage, shared by the classic Stages view AND all three
// new views: agent (tool) picker, optional model, the stage's system prompt
// (viewable), an editable user prompt, Run, and live output. Self-contained — it
// owns its own tool/model/prompt/output state and calls api.runStage directly.
export function StageRunner({ dir, pipeline, task, def, track, tools = [], live, seconds = 0, onDone, flash, onLog, onActivity, onRunning, brief = "" }) {
  const runs = track.runs || [];
  const lastPrompt = runs.length ? (runs[runs.length - 1].prompt || "") : "";
  // First run of a stage starts from the task's brief (title + context.md +
  // the stage hint) — the same text auto-advance would send, so the intent the
  // user captured is there to edit instead of an empty box.
  const seed = () => lastPrompt || [task.title && ("Task: " + task.title), brief, def.hint].filter(Boolean).join("\n\n");
  const remembered = () => lastRunTool(runs) || def.tool || (tools[0] && tools[0].id) || "opencode";
  const [tool, setTool] = useState(remembered);
  const [model, setModel] = useState(lastRunModel(runs));
  const [models, setModels] = useState([]);
  const [prompt, setPrompt] = useState(seed);
  const [out, setOut] = useState("");
  const [running, setRunning] = useState(false);
  const [sysOpen, setSysOpen] = useState(false);
  const termRef = useRef(null);
  // switching task/stage re-seeds from that stage's last run: prompt, agent AND
  // model — so you resume with exactly what you last used, not the tool default.
  useEffect(() => { setPrompt(seed()); setTool(remembered()); setModel(lastRunModel(runs)); setOut(""); }, [task.id, def.id]);
  // the brief loads async, usually after this mounts — fill the box only while
  // it's still empty, so it never clobbers what the user is typing
  useEffect(() => { if (brief) setPrompt((p) => p || seed()); }, [brief]);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [out]);
  useEffect(() => { let on = true; api.getModels(dir, tool).then((r) => { if (on) setModels((r && r.models) || []); }); return () => { on = false; }; }, [dir, tool]);

  const run = async () => {
    if (onActivity) onActivity();
    setOut(""); setRunning(true); if (onRunning) onRunning(true);
    const append = (s) => { setOut((o) => (o + s).slice(-12000)); if (onLog) onLog(s); };
    if (onLog) onLog(`\n━━ ${def.name} · run ━━\n`);
    const end = await api.runStage(dir, {
      pipeline: pipeline.id, task: task.id, stage: def.id, tool, model: model.trim(),
      prompt: runPrompt(pipeline, task, def, prompt), system: def.systemPrompt || "", shell: def.shell || [], workingDir: pipeline.workingDir || ".",
      stageName: def.name, taskTitle: task.title, wallSeconds: seconds,
    }, (e) => {
      if (e.t === "out") append(e.d);
      else if (e.t === "cmd") append("\n$ " + e.cmd + "\n");
      else if (e.t === "commit") append(`\n● ${e.phase} commit ${e.sha.slice(0, 7)}\n`);
      else if (e.t === "meta") append(`⎇ ${e.branch}\n`);
    });
    setRunning(false); if (onRunning) onRunning(false);
    if (end && end.status === "done") flash(`${def.name}: done`); else if (end) flash(`${def.name}: ${end.error || end.status}`);
    // hand the outcome + which stage it was to the task: auto-advance chains
    // forward only from a stage that actually finished `done`
    if (onDone) onDone(end, def.id);
  };

  return (
    <div className="stage-run">
      <div className="row" style={{ marginBottom: 8 }}>
        <select className="input" style={{ width: 150 }} value={tool} onChange={(e) => { setTool(e.target.value); setModel(""); }} title="Which agent runs this stage — remembered from its last run">
          {tools.map((t) => <option key={t.id} value={t.id} disabled={!t.available}>{t.label}{t.available ? "" : " (n/a)"}{t.stub ? " · stub" : ""}</option>)}
        </select>
        <input className="input mono model-pick" list={"models-run-" + def.id} placeholder="model · tool default"
          title="Leave empty to use the tool's own default model; pick or type to override for this run"
          value={model} onChange={(e) => setModel(e.target.value)} />
        <datalist id={"models-run-" + def.id}>{models.map((m) => <option key={m} value={m} />)}</datalist>
        {model.trim() && <button className="btn ghost sm" title="Back to the tool's default model" onClick={() => setModel("")}>×</button>}
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
  return { dir: runner.dir, pipeline: runner.pipeline, task: runner.task, def, track, tools: runner.tools, live, onDone: runner.onDone, flash: runner.flash, onLog: runner.onLog, onActivity: runner.onActivity };
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
  const [mode, setMode] = useState(() => localStorage.getItem("bridza.canvasLayout") || "linear");
  const pick = (m) => { setMode(m); try { localStorage.setItem("bridza.canvasLayout", m); } catch (e) { /* ignore */ } };
  const NW = 190, NH = 104;
  const base = layoutNodes(records.length, mode, { cell: { w: 230, h: 168 }, nodeW: NW, nodeH: NH });
  const { over, setNode, clear, count } = useCanvasOverrides("bridza.canvasPos:" + (runner ? runner.pipeline.id + "/" + runner.task.id : "t"));
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
export function ChatView({ records, runner, onDiff, onOpenFile }) {
  return (
    <div className="uxv-chat">
      {records.map((r) => (
        <section className="uxv-thread" key={r.id}>
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
      ))}
    </div>
  );
}
