// features/views.jsx — the three task-detail views that all read the ONE unified
// stage record (lib/record.js): Inspector (devtools split-pane), Canvas (spatial
// node graph with 5 layouts), and Chat (conversation thread). Running a stage
// stays in the classic Stages view — these three are for reading, auditing and
// navigating what each stage did. Every file, commit chip and node is clickable.
import { useState } from "react";
import { fmt, ago } from "../lib/format.js";
import { layoutNodes, LAYOUTS } from "../lib/layout.js";

const STATUS = ["idle", "running", "done", "failed", "interrupted", "stopped"];
const led = (s) => "uxv-led " + (STATUS.includes(s) ? s : "idle");

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

// The full detail of one stage: its run history selector + a tabbed inspector
// over the selected run (Prompt / Files / Response / Summary / Raw). Reused by
// Inspector (right pane) and Canvas (side sheet).
function StageDetail({ rec, onDiff, onOpenFile, onRunStage }) {
  const [runIdx, setRunIdx] = useState(rec.runs.length - 1);
  const [tab, setTab] = useState("prompt");
  if (!rec.runs.length) {
    return (
      <div className="uxv-detail empty">
        <div className="uxv-detail-hd"><span className={led(rec.status)} /><b>{rec.name}</b><span className={"uxv-tag " + rec.status}>{rec.status}</span></div>
        <p className="uxv-dim">This stage hasn't run yet.</p>
        <button className="uxv-run" onClick={() => onRunStage(rec.id)}>▸ Run in Stages view</button>
      </div>
    );
  }
  const run = rec.runs[Math.min(runIdx, rec.runs.length - 1)];
  const TABS = [["prompt", "Prompts"], ["files", `Files ${run.files.length ? "· " + run.files.length : ""}`], ["response", "Response"], ["summary", "Summary"], ["raw", "Raw JSON"]];
  return (
    <div className="uxv-detail">
      <div className="uxv-detail-hd">
        <span className={led(rec.status)} />
        <b>{rec.name}</b>
        {rec.gate && <span className="uxv-dim">· {rec.gate}</span>}
        <span className={"uxv-tag " + run.status}>{run.status}{run.exit != null ? " · exit " + run.exit : ""}</span>
        <span className="uxv-sp" />
        <button className="uxv-run sm" onClick={() => onRunStage(rec.id)} title="Open this stage in the Stages view to run it">▸ Run</button>
      </div>

      {/* audit cue: who / when / duration / session — and the run selector */}
      <div className="uxv-audit">
        <span title="tool + model">{run.tool}{run.model ? " · " + run.model : ""}</span>
        {run.durationSec ? <span title="run duration">{fmt(run.durationSec)}</span> : null}
        {run.finishedAt && <span title={new Date(run.finishedAt).toLocaleString()}>{ago(run.finishedAt)}</span>}
        <span title="recorded author">by {run.by}</span>
        {run.commit && <button className="uxv-sha" onClick={() => onDiff(run.commit)} title="View this run's diff">{run.commit.slice(0, 7)}</button>}
        {rec.runs.length > 1 && (
          <span className="uxv-runsel">
            {rec.runs.map((r, i) => (
              <button key={i} className={"uxv-runpin " + r.status + (i === runIdx ? " on" : "")} title={`run #${r.seq} · ${r.status}`}
                onClick={() => setRunIdx(i)}>#{r.seq}</button>
            ))}
          </span>
        )}
      </div>

      <div className="uxv-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={"uxv-tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="uxv-tabbody">
        {tab === "prompt" && (
          <>
            <div className="uxv-plabel">System prompt <span className="uxv-dim">— snapshot, applied every run</span></div>
            <pre className="uxv-pre sys">{run.systemPrompt || "—"}</pre>
            <div className="uxv-plabel">User prompt</div>
            <pre className="uxv-pre">{run.userPrompt || "—"}</pre>
          </>
        )}
        {tab === "files" && <FileList files={run.files} commit={run.commit} onDiff={onDiff} onOpenFile={onOpenFile} />}
        {tab === "response" && <pre className="uxv-pre resp">{run.response || (run.error ? "⚠ " + run.error : "no response captured for this run")}</pre>}
        {tab === "summary" && (
          <div className="uxv-summary">
            <p>{run.summary || "—"}</p>
            <FileList files={run.files} commit={run.commit} onDiff={onDiff} onOpenFile={onOpenFile} />
          </div>
        )}
        {tab === "raw" && <pre className="uxv-pre raw">{JSON.stringify(run, null, 2)}</pre>}
      </div>
    </div>
  );
}

// ── Inspector: a stage list on the left, the detail inspector on the right ────
export function InspectorView({ records, activeId, setActiveId, onDiff, onOpenFile, onRunStage }) {
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
      {rec && <StageDetail rec={rec} onDiff={onDiff} onOpenFile={onOpenFile} onRunStage={onRunStage} />}
    </div>
  );
}

// ── Canvas: a spatial node graph, 5 layouts, click a node → side sheet ────────
export function CanvasView({ records, activeId, setActiveId, onDiff, onOpenFile, onRunStage }) {
  const [mode, setMode] = useState(() => localStorage.getItem("bridza.canvasLayout") || "linear");
  const pick = (m) => { setMode(m); try { localStorage.setItem("bridza.canvasLayout", m); } catch (e) { /* ignore */ } };
  const { nodes, width, height } = layoutNodes(records.length, mode, { cell: { w: 230, h: 168 }, nodeW: 190, nodeH: 104 });
  const rec = records.find((r) => r.id === activeId);
  const NW = 190, NH = 104;
  const center = (i) => ({ x: nodes[i].x + NW / 2, y: nodes[i].y + NH / 2 });
  return (
    <div className="uxv-canvaswrap">
      <div className="uxv-layoutbar">
        <span className="uxv-dim" style={{ marginRight: 4 }}>layout</span>
        {LAYOUTS.map((l) => (
          <button key={l.id} className={"uxv-chip" + (mode === l.id ? " on" : "")} title={l.hint} onClick={() => pick(l.id)}>{l.label}</button>
        ))}
      </div>
      <div className="uxv-canvas" style={{ minHeight: height }}>
        <div className="uxv-canvasinner" style={{ width, height }}>
          <svg className="uxv-edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            {records.slice(1).map((r, i) => {
              const a = center(i), b = center(i + 1);
              const mx = (a.x + b.x) / 2;
              return <path key={r.id} className="uxv-edge" d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`} />;
            })}
          </svg>
          {records.map((r, i) => (
            <button key={r.id} className={"uxv-node " + r.status + (rec && rec.id === r.id ? " on" : "")}
              style={{ left: nodes[i].x, top: nodes[i].y, width: NW, height: NH }}
              onClick={() => setActiveId(r.id)}>
              <span className="uxv-node-hd"><span className={led(r.status)} /><b>{r.name}</b><span className="uxv-ord">{String(r.order + 1).padStart(2, "0")}</span></span>
              <span className="uxv-node-sum">{r.summary || "—"}</span>
              <span className="uxv-node-ft">
                <span className={"uxv-tag " + r.status}>{r.status}</span>
                {r.runCount > 1 && <span className="uxv-rr">×{r.runCount}</span>}
                {r.files.length > 0 && <span className="uxv-dim">{r.files.length} file{r.files.length === 1 ? "" : "s"}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
      {rec && (
        <div className="uxv-sheet">
          <button className="uxv-sheet-x" onClick={() => setActiveId("")} title="Close">×</button>
          <StageDetail rec={rec} onDiff={onDiff} onOpenFile={onOpenFile} onRunStage={onRunStage} />
        </div>
      )}
    </div>
  );
}

// ── Chat: the task as a threaded conversation across stages ───────────────────
export function ChatView({ records, onDiff, onOpenFile, onRunStage }) {
  return (
    <div className="uxv-chat">
      {records.map((r) => (
        <section className="uxv-thread" key={r.id}>
          <div className="uxv-thread-hd">
            <span className={led(r.status)} />
            <b>{String(r.order + 1).padStart(2, "0")} · {r.name}</b>
            <span className={"uxv-tag " + r.status}>{r.status}</span>
            <span className="uxv-sp" />
            <button className="uxv-run sm" onClick={() => onRunStage(r.id)}>▸ Run</button>
          </div>
          {!r.runs.length && <div className="uxv-msg note">Not run yet.</div>}
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
        </section>
      ))}
    </div>
  );
}
