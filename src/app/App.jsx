import React, { useState, useEffect, useCallback, useRef } from "react";
import "./bridza.css";
import * as api from "./store/client.js";
import { STARTER_PIPELINES, gateSatisfied, criticalPath } from "./store/bridza.js";

const LS = { dir: "bridza-project", recents: "bridza-recents", side: "bridza-side" };
const readRecents = () => { try { return JSON.parse(localStorage.getItem(LS.recents)) || []; } catch (e) { return []; } };
const base = (p) => (p || "").replace(/\/+$/, "").split("/").pop() || p;
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`; };
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};
// bridza bookkeeping files — hidden from change lists so only the WORK shows
const BOOKKEEP = /\/metadata\.json$|\/README\.md$|\.gitkeep$|^\.bridza\/(\.gitignore|inbox\.json)$/;
const workFiles = (files) => (files || []).filter((f) => !BOOKKEEP.test(f.path));

export default function App() {
  const [dir, setDir] = useState(() => localStorage.getItem(LS.dir) || "");
  const [proj, setProj] = useState(null);
  const [recents, setRecents] = useState(readRecents);
  const [tools, setTools] = useState([]);
  const [activePipe, setActivePipe] = useState("");
  const [activeTask, setActiveTask] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [modal, setModal] = useState(null);
  const [sideCollapsed, setSideCollapsed] = useState(() => localStorage.getItem(LS.side) === "1");
  const [flowOpen, setFlowOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const flash = (m, ms = 2400) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  };
  const collapse = (v) => { setSideCollapsed(v); localStorage.setItem(LS.side, v ? "1" : "0"); };

  const refresh = useCallback(async (d = dir) => {
    if (!d) { setProj(null); return; }
    const s = await api.getState(d);
    setProj(s);
    setActivePipe((cur) => (s.initialized && (!cur || !s.pipelines.some((p) => p.id === cur))) ? (s.pipelines[0] ? s.pipelines[0].id : "") : cur);
  }, [dir]);

  useEffect(() => {
    if (!dir) { setProj(null); return; }
    refresh(dir);
    api.getTools(dir).then((r) => setTools(r.tools || []));
  }, [dir]);

  // keep state live: running tasks / stage status / progress change on the
  // server (auto-advance, other windows) without any user action here.
  useEffect(() => {
    if (!dir) return;
    const t = setInterval(() => refresh(), 4000);
    return () => clearInterval(t);
  }, [dir, refresh]);

  const openDir = (d) => {
    if (!d) return;
    setDir(d); setActiveTask(""); setActivePipe("");
    localStorage.setItem(LS.dir, d);
    const next = [d, ...recents.filter((x) => x !== d)].slice(0, 8);
    setRecents(next); localStorage.setItem(LS.recents, JSON.stringify(next));
  };
  const pick = async () => { const r = await api.pickFolder(); if (r && r.path) openDir(r.path); else if (r && r.error) flash(r.error); };
  const closeProject = () => { setDir(""); localStorage.removeItem(LS.dir); setProj(null); setActiveTask(""); };
  const forget = (d) => { const next = recents.filter((x) => x !== d); setRecents(next); localStorage.setItem(LS.recents, JSON.stringify(next)); };

  if (!dir || !proj) return <Welcome recents={recents} onPick={pick} onOpen={openDir} onForget={forget} />;
  if (proj.available === false) return <Welcome recents={recents} onPick={pick} onOpen={openDir} onForget={forget} error={`Can't open ${dir}`} />;
  if (!proj.initialized)
    return <PipelinePicker dir={dir} repo={proj.repo} onClose={closeProject} onCreated={(pid) => { setActivePipe(pid); refresh(); }} flash={flash} />;

  const pipeline = proj.pipelines.find((p) => p.id === activePipe) || proj.pipelines[0];
  const task = pipeline && pipeline.tasks.find((t) => t.id === activeTask);
  const topbarNav = { collapsed: sideCollapsed, onExpandSide: () => collapse(false) };
  // what is running RIGHT NOW (server truth — the in-process run registry, not
  // committed metadata, which can say "running" forever after a crashed run)
  const running = proj.running || [];
  const runningTasks = new Set(running.map((r) => r.pipeline + "/" + r.task));
  const runningStages = new Set(running.map((r) => r.pipeline + "/" + r.task + "/" + r.stage));

  return (
    <div className={"app" + (sideCollapsed ? " side-collapsed" : "")}>
      {!sideCollapsed && (
        <Sidebar proj={proj} running={running} runningTasks={runningTasks} active={activePipe} onPipe={(id) => { setActivePipe(id); setActiveTask(""); setFlowOpen(false); setInboxOpen(false); setPlanOpen(false); }}
          onNewPipe={() => setModal({ type: "pipeline" })} onClose={closeProject} onPick={pick} recents={recents} onOpen={openDir}
          onOpenTask={(pid, tid) => { setInboxOpen(false); setFlowOpen(false); setPlanOpen(false); setActivePipe(pid); setActiveTask(tid); }}
          onCollapse={() => collapse(true)} inboxCount={(proj.inbox || []).length} inboxActive={inboxOpen} onInbox={() => { setInboxOpen(true); setActiveTask(""); setFlowOpen(false); setPlanOpen(false); }}
          planActive={planOpen} onPlan={() => { setPlanOpen(true); setInboxOpen(false); setFlowOpen(false); setActiveTask(""); }} />
      )}
      <div className="main">
        {planOpen ? (
          <PlanView dir={dir} proj={proj} runningTasks={runningTasks} flash={flash} {...topbarNav}
            onOpenTask={(pid, tid) => { setPlanOpen(false); setActivePipe(pid); setActiveTask(tid); }} />
        ) : inboxOpen ? (
          <Inbox dir={dir} proj={proj} onChange={refresh} flash={flash} {...topbarNav}
            onOpenTask={(pid, tid) => { setInboxOpen(false); setActivePipe(pid); refresh().then(() => setActiveTask(tid)); }} />
        ) : flowOpen ? (
          <PipelineFlow dir={dir} pipeline={pipeline} tools={tools} onClose={() => setFlowOpen(false)} onSaved={refresh} flash={flash} {...topbarNav} />
        ) : !task ? (
          <Board pipeline={pipeline} runningTasks={runningTasks} onOpen={setActiveTask} onNewTask={() => setModal({ type: "task" })} onFlow={() => setFlowOpen(true)} {...topbarNav} />
        ) : (
          <TaskDetail dir={dir} pipeline={pipeline} task={task} tools={tools} runningStages={runningStages} onBack={() => setActiveTask("")} onChange={refresh} flash={flash} {...topbarNav} />
        )}
      </div>

      {modal && modal.type === "pipeline" && (
        <NewPipelineModal dir={dir} existing={proj.pipelines.map((p) => p.id)} onClose={() => setModal(null)}
          onDone={(pid) => { setModal(null); setActivePipe(pid); refresh(); flash("pipeline created"); }} flash={flash} />
      )}
      {modal && modal.type === "task" && (
        <NewTaskModal dir={dir} pipeline={pipeline} onClose={() => setModal(null)}
          onDone={(tid) => { setModal(null); refresh().then(() => setActiveTask(tid)); flash("task created"); }} flash={flash} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

const Hamburger = ({ collapsed, onExpandSide }) => collapsed ? <button className="btn ghost sm" title="Show pipelines" onClick={onExpandSide}>☰</button> : null;

/* ───────────────────────── welcome / picker ───────────────────────── */

function Welcome({ recents, onPick, onOpen, onForget, error }) {
  const [typed, setTyped] = useState("");
  return (
    <div className="center">
      <div className="panel">
        <h2>Bridza</h2>
        <p className="muted">Agentic project management. Open a repo — its <code>.bridza/</code> is your database.</p>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={onPick}>Open folder…</button>
          <input className="input" placeholder="…or paste a path" value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && typed.trim() && onOpen(typed.trim())} />
        </div>
        {recents.length > 0 && (
          <div className="recents">
            <div className="side-label" style={{ padding: "10px 0 4px" }}>Recents</div>
            {recents.map((d) => (
              <div className="spread" key={d}>
                <button className="btn ghost" style={{ flex: 1, justifyContent: "flex-start" }} onClick={() => onOpen(d)}>
                  <b>{base(d)}</b>&nbsp;<span className="muted mono" style={{ fontSize: 11 }}>{d}</span>
                </button>
                <button className="btn ghost sm" onClick={() => onForget(d)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PipelinePicker({ dir, repo, onClose, onCreated, flash }) {
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const create = async () => {
    setBusy(true);
    let first = "";
    for (const id of sel) {
      const tpl = STARTER_PIPELINES.find((p) => p.id === id);
      const r = await api.createPipeline(dir, tpl);
      if (r.ok) first = first || r.id; else flash(r.error);
    }
    setBusy(false);
    if (first) onCreated(first);
  };
  return (
    <div className="center">
      <div className="panel">
        <h2>Set up <span className="mono" style={{ fontSize: 15 }}>{base(repo)}</span></h2>
        <p className="muted">No pipelines yet. Pick starter pipelines to write into <code>.bridza/</code>. Nothing else in the folder is touched.</p>
        <div className="picker">
          {STARTER_PIPELINES.map((p) => (
            <button key={p.id} className={"pick" + (sel.includes(p.id) ? " on" : "")} onClick={() => toggle(p.id)}>
              <b>{p.label}</b>
              <div className="meta">{p.stages.map((s) => s.name).join(" → ")}</div>
            </button>
          ))}
        </div>
        <div className="spread">
          <button className="btn ghost" onClick={onClose}>Close project</button>
          <button className="btn primary" disabled={!sel.length || busy} onClick={create}>{busy ? "Creating…" : `Create ${sel.length || ""} pipeline${sel.length === 1 ? "" : "s"}`}</button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── sidebar ───────────────────────── */

function Sidebar({ proj, running, runningTasks, active, onPipe, onNewPipe, onClose, onPick, recents, onOpen, onOpenTask, onCollapse, inboxCount, inboxActive, onInbox, planActive, onPlan }) {
  const [menu, setMenu] = useState(false);
  // one entry per running TASK across ALL pipelines (a task may have several
  // live stage runs during auto-advance — collapse to the task)
  const liveTasks = [];
  const seen = new Set();
  for (const r of running || []) {
    const key = r.pipeline + "/" + r.task;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = proj.pipelines.find((x) => x.id === r.pipeline);
    const t = p && p.tasks.find((x) => x.id === r.task);
    liveTasks.push({ pid: r.pipeline, tid: r.task, stage: r.stage, title: (t && t.title) || r.task, pipe: (p && p.label) || r.pipeline });
  }
  return (
    <div className="side">
      <div className="side-hd">
        <div className="spread">
          <div className="brand">⎇ Bridza</div>
          <button className="btn ghost sm" title="Collapse" onClick={onCollapse}>‹</button>
        </div>
        <div className="proj-switch">
          <button className="btn proj-btn" onClick={() => setMenu((m) => !m)}>
            <span>{proj.business.name || base(proj.repo)}</span><span className="muted">▾</span>
          </button>
          {menu && (
            <div className="proj-menu" onMouseLeave={() => setMenu(false)}>
              <div className="path" style={{ padding: "4px 9px" }}>{proj.repo}</div>
              <button className="item" onClick={() => { setMenu(false); onPick(); }}>＋ Open another project…</button>
              {recents.filter((d) => d !== proj.repo).map((d) => (
                <button className="item" key={d} onClick={() => { setMenu(false); onOpen(d); }}>{base(d)} <span className="path">{d}</span></button>
              ))}
              <button className="item" onClick={() => { setMenu(false); onClose(); }}>✕ Close project</button>
            </div>
          )}
        </div>
      </div>
      <div className="side-scroll">
        <button className={"pipe" + (inboxActive ? " on" : "")} onClick={onInbox} style={{ marginBottom: 4 }}>
          📥 Inbox {inboxCount > 0 && <span className="n">{inboxCount}</span>}
        </button>
        <button className={"pipe" + (planActive ? " on" : "")} onClick={onPlan} style={{ marginBottom: 4 }}>
          🗺 Plan
        </button>
        {liveTasks.length > 0 && (
          <div className="running-tasks" style={{ margin: "2px 0 10px", borderLeftColor: "var(--accent)" }}>
            <div className="side-sub">Running now · {liveTasks.length}</div>
            {liveTasks.map((r) => (
              <button key={r.pid + "/" + r.tid} className="run-task" onClick={() => onOpenTask(r.pid, r.tid)} title={`${r.pipe} · ${r.title} — stage ${r.stage}`}>
                <span className="livedot" />
                <span className="rt-name">{r.title}</span>
                <span className="rt-pipe">{r.pipe}</span>
              </button>
            ))}
          </div>
        )}
        <div className="side-label">Pipelines</div>
        {proj.pipelines.map((p) => {
          const nLive = (p.tasks || []).filter((t) => runningTasks.has(p.id + "/" + t.id)).length;
          return (
            <button key={p.id} className={"pipe" + (p.id === active ? " on" : "")} onClick={() => onPipe(p.id)}>
              <span className="dot" /> {p.label} <span className="n">{p.tasks.length}</span>
              {nLive > 0 && <span className="run-badge" title={`${nLive} running`}>🔄 {nLive}</span>}
            </button>
          );
        })}
        <button className="pipe" onClick={onNewPipe} style={{ color: "var(--txt-3)" }}>＋ New pipeline</button>
      </div>
    </div>
  );
}

/* ───────────────────────── inbox ───────────────────────── */

function Inbox({ dir, proj, onChange, onOpenTask, flash, collapsed, onExpandSide }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("idea");
  const items = proj.inbox || [];
  const add = async () => { if (!text.trim()) return; const r = await api.addInbox(dir, { kind, text }); if (r.ok) { setText(""); onChange(); } else flash(r.error); };
  const discard = async (id) => { await api.discardInbox(dir, id); onChange(); };
  const promote = async (id, pid) => { const r = await api.promoteInbox(dir, { id, pipeline: pid }); if (r.ok) { flash("sent to " + pid); onOpenTask(pid, r.task.id); } else flash(r.error); };
  return (
    <>
      <div className="topbar">
        <div className="row"><Hamburger collapsed={collapsed} onExpandSide={onExpandSide} /><h1>Inbox</h1><span className="muted">{items.length}</span></div>
      </div>
      <div className="content" style={{ maxWidth: 780 }}>
        <p className="muted" style={{ marginTop: 0 }}>Capture ideas, bugs and requests for this project. Route each into a pipeline (it becomes a task), or discard.</p>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 8 }}>
            <select className="input" style={{ width: 120 }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="idea">Idea</option><option value="bug">Bug</option><option value="feature">Feature</option>
            </select>
            <input className="input" placeholder="Capture an idea, bug or request… (Enter)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="btn primary" onClick={add} disabled={!text.trim()}>Capture</button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="muted">Inbox is empty.</p>
        ) : (
          <div className="inbox-list">
            {items.map((it) => (
              <div className="inbox-item" key={it.id}>
                <span className={"tag kind-" + it.kind}>{it.kind}</span>
                <div className="inbox-text">{it.text}<div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{it.time ? new Date(it.time).toLocaleString() : ""}</div></div>
                <PromoteMenu pipelines={proj.pipelines} onPromote={(pid) => promote(it.id, pid)} />
                <button className="btn ghost sm" onClick={() => discard(it.id)} title="Discard">🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PromoteMenu({ pipelines, onPromote }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)}>→ Send to ▾</button>
      {open && (
        <div className="proj-menu" style={{ right: 0, left: "auto", minWidth: 160 }} onMouseLeave={() => setOpen(false)}>
          {pipelines.length ? pipelines.map((p) => (
            <button className="item" key={p.id} onClick={() => { setOpen(false); onPromote(p.id); }}>{p.label}</button>
          )) : <div className="muted" style={{ padding: 8, fontSize: 12 }}>No pipelines yet</div>}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── board ───────────────────────── */

const DONE_COL = "__done__";

// Kanban columns = the UNION of every stage used by any task in the pipeline,
// ordered by the pipeline's own stage flow first, then any task-only stages,
// then a terminal "Delivered" column. Each task sits in its CURRENT stage (the
// first not-yet-done stage), or Delivered when all stages are done / finalized.
function kanbanColumns(pipeline) {
  const order = [], nameOf = {};
  (pipeline.stages || []).forEach((s) => { if (!order.includes(s.id)) { order.push(s.id); nameOf[s.id] = s.name; } });
  (pipeline.tasks || []).forEach((t) => (t.stages || []).forEach((sid) => { if (!order.includes(sid)) { order.push(sid); nameOf[sid] = nameOf[sid] || sid; } }));
  return { columns: [...order, DONE_COL], nameOf };
}
function currentStage(t) {
  if (t.finalized) return DONE_COL;
  return (t.stages || []).find((s) => (t.tracking[s] || {}).status !== "done") || DONE_COL;
}

function Board({ pipeline, runningTasks, onOpen, onNewTask, onFlow, collapsed, onExpandSide }) {
  const { columns, nameOf } = kanbanColumns(pipeline);
  const byCol = {}; columns.forEach((c) => (byCol[c] = []));
  (pipeline.tasks || []).forEach((t) => { const c = currentStage(t); (byCol[c] || byCol[DONE_COL]).push(t); });
  return (
    <>
      <div className="topbar">
        <div className="row"><Hamburger collapsed={collapsed} onExpandSide={onExpandSide} /><h1>{pipeline.label}</h1></div>
        <div className="row">
          <button className="btn ghost" onClick={onFlow}>⚙ Stage flow</button>
          <button className="btn primary" onClick={onNewTask}>＋ New task</button>
        </div>
      </div>
      {pipeline.tasks.length === 0 ? (
        <div className="content"><p className="muted">No tasks yet. Create one — it gets its own branch <code>bridza/{pipeline.id}/&lt;task&gt;</code>.</p></div>
      ) : (
        <div className="kanban">
          {columns.map((c) => (
            <div className="kcol" key={c}>
              <div className="kcol-h"><span className={c === DONE_COL ? "done" : ""}>{c === DONE_COL ? "Delivered" : (nameOf[c] || c)}</span><span className="n">{byCol[c].length}</span></div>
              <div className="kcol-body">
                {byCol[c].map((t) => (
                  <div className="kcard" key={t.id} onClick={() => onOpen(t.id)}>
                    <div className="spread"><b>{t.title}</b>{runningTasks && runningTasks.has(pipeline.id + "/" + t.id) ? <span className="tag running"><span className="livedot" /> running</span> : t.finalized && <span className="tag done">✓</span>}</div>
                    <div className="muted mono kcard-branch">{t.branch}</div>
                    <div className="bar"><i style={{ width: t.progress + "%" }} /></div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>{t.progress}% · {t.stages.length} stages</div>
                  </div>
                ))}
                {!byCol[c].length && <div className="kcol-empty">—</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ───────────────────────── task detail + rail ───────────────────────── */

function TaskDetail({ dir, pipeline, task, tools, runningStages, onBack, onChange, flash, collapsed, onExpandSide }) {
  const stageObjs = task.stages.map((id) => (pipeline.stages || []).find((s) => s.id === id) || { id, name: id });
  const [timeline, setTimeline] = useState([]);
  const [tlOpen, setTlOpen] = useState(true);
  const [openStage, setOpenStage] = useState(() => task.stages.find((s) => !(task.tracking[s] && task.tracking[s].status === "done")) || task.stages[0]);
  const [stageTime, setStageTime] = useState({});
  const [diffCommit, setDiffCommit] = useState(null);
  const [diffBranch, setDiffBranch] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [automating, setAutomating] = useState(false);
  const [autoOut, setAutoOut] = useState("");
  const autoRef = useRef(null);
  const timeRef = useRef({}); const dirtyRef = useRef(false);

  const loadTimeline = useCallback(() => api.getTimeline(dir, pipeline.id, task.id).then((r) => setTimeline(r.commits || [])), [dir, pipeline.id, task.id]);
  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  // while any stage of THIS task runs (here, auto-advance, or another window),
  // keep the change timeline live — prompt/result commits appear as they land.
  const taskLive = runningStages && [...runningStages].some((k) => k.startsWith(pipeline.id + "/" + task.id + "/"));
  useEffect(() => {
    if (!taskLive) return;
    const t = setInterval(loadTimeline, 5000);
    return () => clearInterval(t);
  }, [taskLive, loadTimeline]);

  // hydrate the clock: max(persisted wall-clock, agent run-seconds) per stage
  useEffect(() => {
    let on = true;
    api.fetchTime(dir, pipeline.id, task.id).then((r) => {
      if (!on) return;
      const m = {};
      for (const s of task.stages) m[s] = Math.max((r.time || {})[s] || 0, (task.tracking[s] || {}).seconds || 0);
      setStageTime(m); timeRef.current = m;
    });
    return () => { on = false; };
  }, [dir, pipeline.id, task.id]);
  useEffect(() => { timeRef.current = stageTime; }, [stageTime]);
  useEffect(() => { if (autoRef.current) autoRef.current.scrollTop = autoRef.current.scrollHeight; }, [autoOut]);

  // live 1s clock on the open stage — that's where time is being spent
  useEffect(() => {
    if (!openStage) return;
    const t = setInterval(() => { dirtyRef.current = true; setStageTime((p) => ({ ...p, [openStage]: (p[openStage] || 0) + 1 })); }, 1000);
    return () => clearInterval(t);
  }, [openStage]);

  // flush to .bridza/.cache/time.json every 10s, on stage switch, and on unmount
  useEffect(() => {
    const flush = () => { if (!dirtyRef.current) return; dirtyRef.current = false; api.saveTime(dir, pipeline.id, task.id, timeRef.current); };
    const t = setInterval(flush, 10000);
    window.addEventListener("beforeunload", flush);
    return () => { clearInterval(t); window.removeEventListener("beforeunload", flush); flush(); };
  }, [dir, pipeline.id, task.id]);

  const total = Object.values(stageTime).reduce((a, b) => a + b, 0);
  const done = task.stages.filter((s) => (task.tracking[s] || {}).status === "done").length;
  // a run records its promptCommit; the result commit it produced is the entry
  // just newer than it in the timeline (runs are prompt-then-result sequential).
  const resultFor = (p) => { const i = timeline.findIndex((c) => c.sha === p); return i > 0 ? timeline[i - 1].sha : null; };

  const finalize = async (resolveMain, mainCommitMessage) => {
    flash("finalizing… (committing any pending changes)", 8000);   // stays while opencode writes the message
    const r = await api.finalize(dir, { pipeline: pipeline.id, task: task.id, resolveMain, mainCommitMessage });
    if (r.needsResolve) { setResolveOpen(true); flash("your checkout of main has uncommitted changes — review and resolve below", 4000); return; }
    setResolveOpen(false);
    if (r.ok) { flash(r.autocommit ? `committed “${r.autocommit.message}” + merged → ${r.target}` : (r.mainResolved ? `${r.mainResolved.action === "stash" ? "stashed main" : "committed main"} + merged → ${r.target}` : `merged → ${r.target}`), 4800); onChange(); }
    else flash(r.error, 4800);
  };
  const openVscode = async () => {
    flash("opening VS Code…");
    const r = await api.openEditor(dir, { pipeline: pipeline.id, task: task.id, workingDir: pipeline.workingDir });
    flash(r.ok ? `opened ${r.branch} in VS Code` : r.error);
  };
  // Automate: run every stage of this task back-to-back. The prompt for each
  // stage is assembled from the task intent + the stage's own hint/system prompt.
  const automate = async () => {
    if (automating) return;
    // auto-advance = run only the stages not yet done, in order (continue the pipeline)
    const bodies = stageObjs.filter((def) => (task.tracking[def.id] || {}).status !== "done").map((def) => ({
      pipeline: pipeline.id, task: task.id, stage: def.id, tool: def.tool || "opencode",
      prompt: [task.title && ("Task: " + task.title), task.context, def.hint].filter(Boolean).join("\n\n") || ("Complete the " + (def.name || def.id) + " stage."),
      system: def.systemPrompt || "", shell: def.shell || [], workingDir: pipeline.workingDir || ".",
      stageName: def.name || def.id, taskTitle: task.title,
    }));
    if (!bodies.length) { flash("All stages already done — nothing to auto-advance.", 4000); return; }
    setAutomating(true); setAutoOut("");
    const append = (s) => setAutoOut((o) => (o + s).slice(-16000));
    flash(`Auto-advancing ${bodies.length} stage(s)…`, 6000);
    const end = await api.automate(dir, { stages: bodies }, (e) => {
      if (e.t === "out") append(e.d);
      else if (e.t === "cmd") append("\n$ " + e.cmd + "\n");
      else if (e.t === "session") append(`\n⛁ opencode session ${e.sessionId}\n`);
      else if (e.t === "commit") append(`● ${e.phase} ${(e.sha || "").slice(0, 7)}\n`);
      else if (e.t === "automate" && e.phase === "stage") append(`\n━━ ${e.index + 1}/${e.count} · ${e.name} ━━\n`);
      else if (e.t === "automate" && e.phase === "stage-done") append(`✓ ${e.stage}: ${e.status} (exit ${e.exit})${e.sessionId ? " · " + e.sessionId : ""}\n`);
    });
    setAutomating(false);
    loadTimeline(); onChange();
    if (end && end.exit === 0) flash("Automate complete — all stages done", 5000);
    else if (end) flash(`Automate stopped at ${end.stoppedAt || "?"}: ${end.error || "failed"}`, 6000);
  };

  return (
    <>
      <div className="topbar">
        <div className="row">
          <Hamburger collapsed={collapsed} onExpandSide={onExpandSide} />
          <button className="btn ghost" onClick={onBack}>← {pipeline.label}</button>
          <h1 style={{ marginLeft: 6 }}>{task.title}</h1>
        </div>
        <div className="row">
          <button className="btn" onClick={openVscode} title="Open this task's branch worktree in a new VS Code window"><span style={{ color: "var(--accent)" }}>⧉</span> Open in VS Code</button>
          <label className="switch" title="Auto-advance: AI runs each remaining stage once the previous one finishes (keeps going in the background)">
            <input type="checkbox" checked={automating} disabled={automating || task.finalized} onChange={(e) => e.target.checked && automate()} />
            <span className="slider" /><span className="switch-lbl">{automating ? "⚡ Auto-advancing…" : "⚡ Auto-advance"}</span>
          </label>
          <button className="btn" onClick={() => finalize()} disabled={task.finalized}>{task.finalized ? "Finalized" : "Finalize → main"}</button>
        </div>
      </div>
      <div className="content detail">
        {(automating || autoOut) && (
          <div className="card" style={{ gridColumn: "1 / -1", marginBottom: 12 }}>
            <div className="side-label" style={{ padding: "0 0 8px" }}>⚡ Automate {automating ? "· running" : "· last run"}</div>
            <div className="term" ref={autoRef}>{autoOut || "…"}</div>
          </div>
        )}
        <div className="stages">
          {stageObjs.map((def) => (
            <Stage key={def.id} dir={dir} pipeline={pipeline} task={task} def={def} track={task.tracking[def.id] || { status: "idle" }}
              live={runningStages && runningStages.has(pipeline.id + "/" + task.id + "/" + def.id)}
              tools={tools} seconds={stageTime[def.id] || 0} open={openStage === def.id}
              onToggle={() => setOpenStage(openStage === def.id ? "" : def.id)}
              onDone={() => { onChange(); loadTimeline(); }} flash={flash} onDiff={setDiffCommit} resultFor={resultFor} />
          ))}
        </div>

        <aside className="rail">
          <div className="card">
            <div className="side-label" style={{ padding: "0 0 8px" }}>Task</div>
            <Kv k="Status" v={task.finalized ? "finalized" : task.status} />
            <Kv k="Branch" v={<span className="mono" style={{ fontSize: 11 }}>{task.branch}</span>} />
            <Kv k="Type" v={task.type || "—"} />
            <Kv k="Output" v={task.outputMode || "—"} />
            <Kv k="Stages" v={`${done}/${task.stages.length} done`} />
            <Kv k="Time tracked" v={fmt(total)} />
          </div>

          <TimeByStage stages={stageObjs} stageTime={stageTime} activeId={openStage} total={total} />

          <div className="card">
            <div className="spread" style={{ marginBottom: tlOpen ? 6 : 0 }}>
              <button className="tl-tog" style={{ width: "auto", flex: 1 }} onClick={() => setTlOpen((o) => !o)}>
                <span>{tlOpen ? "▾" : "▸"} TIMELINE <span className="muted">{timeline.length}</span></span>
              </button>
              <button className="btn ghost sm" onClick={() => setDiffBranch(true)} title="Every file change on this branch, in one view">⊟ all changes</button>
            </div>
            {tlOpen && (timeline.length === 0 ? <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>No runs yet.</p> : (
              <div className="timeline">
                {timeline.map((c) => {
                  const kind = c.kind || (/: prompt/.test(c.subject) ? "prompt" : /: result/.test(c.subject) ? "result" : "");
                  const files = workFiles(c.files);
                  const churn = files.reduce((a, f) => ({ add: a.add + f.add, del: a.del + f.del }), { add: 0, del: 0 });
                  return (
                    <div className={"tl click " + kind} key={c.sha} onClick={() => setDiffCommit(c.sha)} title="View file changes">
                      <span className="tl-rail"><i className="tl-dot" /></span>
                      <div className="tl-body">
                        <div className="tl-top">
                          {c.stage && <span className={"tl-stage " + kind}>{c.stage}</span>}
                          <span className={"sub " + kind}>{c.subject.replace(/^bridza\([^)]*\):\s*/, "")}</span>
                        </div>
                        <div className="tl-meta">
                          <span className="sha">{c.sha.slice(0, 7)}</span>
                          <span>{ago(c.date)}</span>
                          {files.length > 0 && <span className="tl-churn"><span className="add">+{churn.add}</span> <span className="del">−{churn.del}</span></span>}
                        </div>
                        {files.length > 0 && (
                          <div className="tl-files">
                            {files.slice(0, 3).map((f) => <code key={f.path} title={`${f.path}  +${f.add} −${f.del}`}>{base(f.path)}</code>)}
                            {files.length > 3 && <span className="muted">+{files.length - 3} more</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <BlastRadius dir={dir} pipeline={pipeline.id} task={task.id} refreshKey={timeline.length} onOpen={() => setDiffBranch(true)} />
        </aside>
      </div>
      {diffCommit && <DiffView dir={dir} commit={diffCommit} commits={timeline} onCommit={setDiffCommit} onClose={() => setDiffCommit(null)} />}
      {diffBranch && <DiffView dir={dir} branch pipeline={pipeline.id} task={task.id} onClose={() => setDiffBranch(false)} />}
      {resolveOpen && <DiffView dir={dir} working onResolve={(action, m) => finalize(action, m)} onClose={() => setResolveOpen(false)} />}
    </>
  );
}

const Kv = ({ k, v }) => <div className="kv"><span>{k}</span><b>{v}</b></div>;

function TimeByStage({ stages, stageTime, activeId, total }) {
  const vals = stages.map((s) => stageTime[s.id] || 0);
  const max = Math.max(1, ...vals);
  const peakSec = Math.max(0, ...vals);
  const peak = stages[vals.indexOf(peakSec)] || stages[0];
  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 8 }}><span className="side-label" style={{ padding: 0 }}>Time by stage</span><b style={{ fontSize: 13 }}>{fmt(total)}</b></div>
      <div className="timeby">
        {stages.map((s) => {
          const sec = stageTime[s.id] || 0, active = s.id === activeId, isPeak = s.id === (peak && peak.id) && sec > 0;
          return (
            <div className={"tb-row" + (isPeak ? " peak" : "") + (active ? " active" : "")} key={s.id}>
              <span className="tb-name">{s.name}{active && <i className="livedot" title="tracking now" />}</span>
              <span className="tb-bar"><i style={{ width: (sec / max * 100) + "%" }} /></span>
              <span className="tb-val">{sec ? fmt(sec) : "—"}</span>
            </div>
          );
        })}
      </div>
      {peakSec > 0 && total > 0 && <div className="tb-note"><b>{peak.name}</b> is the biggest sink — {Math.round(peakSec / total * 100)}% of tracked time.</div>}
    </div>
  );
}

/* Blast radius — gitGraph semantics: BFS along REVERSE import edges from the
   task's changed files. Red = changed (distance 0, center). Orange = files
   that transitively import a changed file; ring = hop distance, opacity fades
   with distance (1 / .8 / .6 / .4 / .2). Green note = nothing else imports the
   change (contained). */
const hopOpacity = (d) => d <= 1 ? 1 : d === 2 ? 0.8 : d === 3 ? 0.6 : d === 4 ? 0.4 : 0.2;
function BlastRadius({ dir, pipeline, task, refreshKey, onOpen }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let on = true;
    api.getBlast(dir, pipeline, task).then((d) => { if (on) setData(d && d.ok ? d : { seeds: [], impacted: [] }); });
    return () => { on = false; };
  }, [dir, pipeline, task, refreshKey]);
  if (!data || data.seeds.length === 0) return null;

  const { seeds, impacted } = data;
  const maxHop = Math.min(4, Math.max(1, ...impacted.map((f) => f.distance)));
  const byHop = {};
  impacted.forEach((f) => { const h = Math.min(f.distance, 4); (byHop[h] = byHop[h] || []).push(f); });

  const C = 88, R0 = 16, STEP = maxHop > 3 ? 17 : 21;
  const ringR = (h) => R0 + h * STEP;
  const spread = (list, r, seedJitter) => list.map((f, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, list.length) + (seedJitter ? 0.4 : 0);
    return { ...f, x: C + Math.cos(a) * r, y: C + Math.sin(a) * r };
  });
  const seedDots = spread(seeds, seeds.length === 1 ? 0 : R0 * 0.55, true);
  const hopDots = Object.entries(byHop).flatMap(([h, list]) => spread(list, ringR(+h)).map((f) => ({ ...f, hop: +h })));

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 6 }}>
        <span className="side-label" style={{ padding: 0 }}>Blast radius</span>
        <span className="muted" style={{ fontSize: 11 }}>{seeds.length} changed → <span style={{ color: impacted.length ? "var(--blast-orange)" : "var(--blast-green)" }}>{impacted.length} impacted</span></span>
      </div>
      <svg className="blast" viewBox="0 0 176 176" onClick={onOpen} role="img" aria-label="Blast radius: files transitively importing this task's changes">
        {Array.from({ length: maxHop }, (_, i) => <circle key={i} cx={C} cy={C} r={ringR(i + 1)} className="blast-ring" />)}
        {hopDots.map((f, i) => (
          <circle key={"o" + i} cx={f.x} cy={f.y} r="4" className="blast-dot orange" style={{ opacity: hopOpacity(f.hop) }}>
            <title>{`${f.path} — ${f.distance} hop${f.distance === 1 ? "" : "s"} from the change`}</title>
          </circle>
        ))}
        {seedDots.map((f, i) => (
          <circle key={"s" + i} cx={f.x} cy={f.y} r="5.5" className="blast-dot red">
            <title>{`${f.path}  +${f.add} −${f.del}  (changed)`}</title>
          </circle>
        ))}
      </svg>
      <div className="blast-legend">
        <span><i className="bl red" /> changed</span>
        <span><i className="bl orange" /> imports it (fades per hop)</span>
      </div>
      <div className="blast-hops">
        {impacted.length === 0 ? (
          <div className="blast-contained">✓ contained — nothing in the repo imports the changed files</div>
        ) : (
          Object.entries(byHop).map(([h, list]) => (
            <div className="blast-hop" key={h}>
              <span className="hop-n" style={{ opacity: hopOpacity(+h) }}>{h}{+h === 4 && maxHop === 4 ? "+" : ""} hop{list.length === 1 && +h === 1 ? "" : "s"}</span>
              <span className="hop-files">{list.slice(0, 3).map((f) => <code key={f.path} title={f.path}>{base(f.path)}</code>)}{list.length > 3 && <span className="muted">+{list.length - 3}</span>}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stage({ dir, pipeline, task, def, track, tools, seconds, open, onToggle, onDone, flash, onDiff, resultFor, live }) {
  const runs = track.runs || [];
  const lastPrompt = runs.length ? (runs[runs.length - 1].prompt || "") : "";
  const [tool, setTool] = useState(def.tool || (tools[0] && tools[0].id) || "claude");
  const [prompt, setPrompt] = useState(lastPrompt);
  const [out, setOut] = useState("");
  const [running, setRunning] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const termRef = useRef(null);
  // autofill the prompt with the stage's last run when switching task/stage
  useEffect(() => { setPrompt(lastPrompt); setOut(""); }, [task.id, def.id]);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [out]);

  // Roll this task back to this stage: it and every later stage return to idle
  // (history, prompts and time are kept), and the task is un-finalized — so a
  // "delivered" task can always be revised from any stage.
  const reopen = async (e) => {
    e.stopPropagation();
    const r = await api.reopenStage(dir, { pipeline: pipeline.id, task: task.id, stage: def.id });
    flash(r.ok ? `${def.name} reopened — this and later stages reset (history kept)` : r.error, 4200);
    onDone();
  };

  const run = async () => {
    setOut(""); setRunning(true);
    const append = (s) => setOut((o) => (o + s).slice(-12000));
    const end = await api.runStage(dir, {
      pipeline: pipeline.id, task: task.id, stage: def.id, tool,
      prompt, system: def.systemPrompt || "", shell: def.shell || [], workingDir: pipeline.workingDir || ".",
      stageName: def.name, taskTitle: task.title, wallSeconds: seconds,
    }, (e) => {
      if (e.t === "out") append(e.d);
      else if (e.t === "cmd") append("\n$ " + e.cmd + "\n");
      else if (e.t === "commit") append(`\n● ${e.phase} commit ${e.sha.slice(0, 7)}\n`);
      else if (e.t === "meta") append(`⎇ ${e.branch}\n`);
    });
    setRunning(false);
    if (end && end.status === "done") flash(`${def.name}: done`); else if (end) flash(`${def.name}: ${end.error || end.status}`);
    onDone();
  };

  return (
    <div className="stage">
      <div className="stage-hd" onClick={onToggle}>
        <div className="row"><b>{def.name}</b>{def.gate && <span className="muted" style={{ fontSize: 12 }}>· {def.gate}</span>}</div>
        <div className="row">
          {seconds > 0 && <span className="muted mono" style={{ fontSize: 11 }}>{fmt(seconds)}{open && <i className="livedot" />}</span>}
          {["done", "failed"].includes(track.status) && !running && !live && (
            <button className="btn ghost sm" onClick={reopen} title="Revise from this stage — resets this and every later stage to idle (runs, prompts and time are kept)">↺ Revise</button>
          )}
          {(() => {
            // committed metadata can say "running" after a crashed/killed run —
            // without a live server run that's "interrupted", not running.
            const status = running || live ? "running" : track.status === "running" ? "interrupted" : (track.status || "idle");
            return <span className={"tag " + status}>{status}</span>;
          })()}
        </div>
      </div>
      {open && (
        <div className="stage-body">
          <div className="row" style={{ marginBottom: 8 }}>
            <select className="input" style={{ width: 160 }} value={tool} onChange={(e) => setTool(e.target.value)}>
              {tools.map((t) => <option key={t.id} value={t.id} disabled={!t.available}>{t.label}{t.available ? "" : " (n/a)"}{t.stub ? " · stub" : ""}</option>)}
            </select>
            <button className="btn primary" onClick={run} disabled={running}>{running ? "Running…" : "▸ Run stage"}</button>
          </div>
          <textarea className="input" placeholder={`What should ${def.name} do? (the stage system prompt is applied automatically)`} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          {(out || running) && <div className="term" ref={termRef} style={{ marginTop: 10 }}>{out || "…"}</div>}
          {def.outputs && def.outputs.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>outputs: {def.outputs.map((o) => o.name).join(", ")}</div>
          )}
          {runs.length > 0 && (
            <div className="runs">
              <button className="runs-tog" onClick={() => setHistOpen((o) => !o)}>{histOpen ? "▾" : "▸"} {runs.length} run{runs.length > 1 ? "s" : ""} on this stage</button>
              {histOpen && [...runs].reverse().map((r, i) => {
                // a "running" record with no finish and no live run = the server
                // died mid-run — honest label, not stuck-on-running forever
                const st = (r.status === "running" && !r.finishedAt && !((running || live) && i === 0)) ? "interrupted" : (r.status || "?");
                return (
                <div className="run" key={i}>
                  <div className="spread">
                    <span className={"tag " + st}>{st}{r.exit != null ? " · exit " + r.exit : ""}</span>
                    <span className="muted mono" style={{ fontSize: 11 }}>{r.tool}{r.finishedAt ? " · " + new Date(r.finishedAt).toLocaleString() : ""}</span>
                  </div>
                  {r.prompt && <div className="run-prompt">{r.prompt}</div>}
                  {r.error && <div className="run-error">⚠ {r.error}</div>}
                  {r.log && (
                    <details className="run-log">
                      <summary>{r.status === "failed" ? "why it failed — tool output" : "tool output"} ({r.log.length > 3900 ? "last 4k" : r.log.split("\n").length + " lines"})</summary>
                      <pre>{r.log}</pre>
                    </details>
                  )}
                  {r.files && r.files.length > 0 && (() => {
                    const rc = resultFor && resultFor(r.promptCommit);
                    return (
                      <div className="run-files">
                        {r.files.map((f, j) => <code key={j} className={rc ? "ck" : ""} onClick={rc ? () => onDiff(rc) : undefined} title={rc ? "View diff" : ""}>{f}</code>)}
                        {rc && <button className="btn ghost sm" onClick={() => onDiff(rc)}>view diff →</button>}
                      </div>
                    );
                  })()}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── file diff viewer (VS Code / lazygit) ───────────────────────── */

function DiffView({ dir, commit, commits = [], onCommit, branch, working, pipeline, task, onResolve, onClose }) {
  const [data, setData] = useState(null);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState("unified");
  const [msg, setMsg] = useState("");
  const single = !branch && !working;
  useEffect(() => {
    let on = true; setData(null); setActive(0);
    (working ? api.getWorkingDiff(dir) : branch ? api.getBranchDiff(dir, pipeline, task) : api.getDiff(dir, commit)).then((d) => { if (on) setData(d); });
    return () => { on = false; };
  }, [dir, commit, branch, working, pipeline, task]);
  const idx = single ? commits.findIndex((c) => c.sha === commit) : -1;
  const go = (d) => { const j = idx + d; if (single && onCommit && j >= 0 && j < commits.length) onCommit(commits[j].sha); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); else if (single && e.key === "ArrowLeft") go(-1); else if (single && e.key === "ArrowRight") go(1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, commits.length, single]);
  const all = (data && data.files) || [];
  const meaningful = all.filter((f) => !/\/metadata\.json$|\/README\.md$|\.gitkeep$/.test(f.path));
  const files = meaningful.length ? meaningful : all;
  const file = files[active] || files[0];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="diffwin" onClick={(e) => e.stopPropagation()}>
        <div className="diff-hd">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            {single && commits.length > 1 && (
              <div className="row" style={{ gap: 4 }}>
                <button className="btn ghost sm" disabled={idx <= 0} onClick={() => go(-1)} title="Previous commit (←)">‹</button>
                <span className="muted mono" style={{ fontSize: 11 }}>{idx >= 0 ? idx + 1 : "?"}/{commits.length}</span>
                <button className="btn ghost sm" disabled={idx < 0 || idx >= commits.length - 1} onClick={() => go(1)} title="Next commit (→)">›</button>
              </div>
            )}
            {single && <span className="mono" style={{ fontSize: 11, color: "var(--txt-3)" }}>{commit.slice(0, 7)}</span>}
            <b style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 13 }}>
              {data
                ? working ? `Uncommitted on ${data.base || "main"} · ${files.length} file${files.length === 1 ? "" : "s"}${data.untracked && data.untracked.length ? ` · +${data.untracked.length} untracked` : ""}`
                  : branch ? `All changes · ${data.branch || ""} · ${files.length} file${files.length === 1 ? "" : "s"}`
                    : (data.subject || "changes")
                : "loading…"}
            </b>
          </div>
          <div className="row">
            <div className="seg">
              <button className={mode === "unified" ? "on" : ""} onClick={() => setMode("unified")}>Unified</button>
              <button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")}>Split</button>
            </div>
            <button className="btn ghost sm" onClick={onClose}>✕</button>
          </div>
        </div>
        {onResolve && (
          <div className="diff-resolve">
            <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>Resolve before merging:</span>
            <input className="input" style={{ flex: 1 }} placeholder="commit message (blank → opencode writes it from the diff)" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onResolve("commit", msg)} />
            <button className="btn" onClick={() => onResolve("stash")} title="git stash -u, then merge">Stash &amp; merge</button>
            <button className="btn primary" onClick={() => onResolve("commit", msg)}>Commit &amp; merge</button>
          </div>
        )}
        <div className="diff-body">
          <div className="diff-files">
            {files.map((f, i) => (
              <button key={i} className={"diff-file" + (i === active ? " on" : "")} onClick={() => setActive(i)}>
                <span className="df-path">{f.path}</span>
                <span className="df-stat"><span className="add">+{f.add}</span> <span className="del">−{f.del}</span></span>
              </button>
            ))}
            {!files.length && <div className="muted" style={{ padding: 12, fontSize: 12 }}>{data ? "No file changes." : "Loading…"}</div>}
          </div>
          <div className="diff-pane">
            {file && (file.binary ? <div className="muted" style={{ padding: 16 }}>Binary file.</div> : mode === "unified" ? <UnifiedDiff file={file} /> : <SplitDiff file={file} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function UnifiedDiff({ file }) {
  return (
    <div className="diff-code">
      {file.hunks.map((h, hi) => (
        <React.Fragment key={hi}>
          <div className="dl hunk"><span className="g" /><span className="g" /><span className="dt">@@ {h.header}</span></div>
          {h.lines.map((l, li) => (
            <div key={li} className={"dl " + (l.t === "+" ? "add" : l.t === "-" ? "del" : "ctx")}>
              <span className="g">{l.oldNo || ""}</span><span className="g">{l.newNo || ""}</span>
              <span className="dt"><span className="sgn">{l.t}</span>{l.text}</span>
            </div>
          ))}
        </React.Fragment>
      ))}
      {!file.hunks.length && <div className="muted" style={{ padding: 12 }}>No textual changes.</div>}
    </div>
  );
}

function SplitDiff({ file }) {
  const rows = [];
  file.hunks.forEach((h) => {
    rows.push({ hunk: h.header });
    const L = h.lines; let i = 0;
    while (i < L.length) {
      if (L[i].t === " ") { rows.push({ l: L[i], r: L[i] }); i++; continue; }
      const dels = [], adds = [];
      while (i < L.length && L[i].t === "-") dels.push(L[i++]);
      while (i < L.length && L[i].t === "+") adds.push(L[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ l: dels[k] || null, r: adds[k] || null });
    }
  });
  const Side = ({ c, sign }) => <div className={"side " + (c ? (c.t === sign ? (sign === "+" ? "add" : "del") : "ctx") : "empty")}><span className="g">{c ? (sign === "+" ? c.newNo : c.oldNo) || "" : ""}</span><span className="dt">{c ? c.text : ""}</span></div>;
  return (
    <div className="diff-code split">
      {rows.map((row, ri) => row.hunk !== undefined
        ? <div key={ri} className="dl hunk"><span className="dt">@@ {row.hunk}</span></div>
        : <div key={ri} className="dl-split"><Side c={row.l} sign="-" /><Side c={row.r} sign="+" /></div>)}
    </div>
  );
}

/* ───────────────────────── pipeline stage-flow editor ───────────────────────── */

const OUT_TYPES = ["doc", "data", "code", "media", "value", "text", "asset", "git", "issue"];
const mkStage = () => ({ id: "stage-" + Math.random().toString(36).slice(2, 7), name: "New stage", hint: "", tool: "claude", systemPrompt: "Operate only on the previous stage's outputs. Produce only this stage's outputs.", outputs: [{ name: "out.md", type: "doc", note: "" }], shell: [], gate: "Output reviewed", auto: false });
const normStage = (s, i) => ({ id: s.id || "stage-" + (i + 1), name: s.name || s.id || "Stage " + (i + 1), hint: s.hint || "", tool: s.tool || "claude", systemPrompt: s.systemPrompt || "", outputs: (s.outputs || []).map((o) => ({ name: o.name || "", type: o.type || "doc", note: o.note || "" })), shell: s.shell || [], gate: s.gate || "", auto: !!s.auto });

function PipelineFlow({ dir, pipeline, tools, onClose, onSaved, flash, collapsed, onExpandSide }) {
  const [stages, setStages] = useState(() => (pipeline.stages || []).map(normStage));
  const [label, setLabel] = useState(pipeline.label || pipeline.id);
  const [workingDir, setWorkingDir] = useState(pipeline.workingDir || ".");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const mut = (fn) => { setStages(fn); setDirty(true); };
  const patch = (i, p) => mut((st) => st.map((s, k) => k === i ? { ...s, ...p } : s));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= stages.length) return; mut((st) => { const n = [...st]; [n[i], n[j]] = [n[j], n[i]]; return n; }); };
  const dup = (i) => mut((st) => [...st.slice(0, i + 1), { ...JSON.parse(JSON.stringify(st[i])), id: "stage-" + Math.random().toString(36).slice(2, 7), name: st[i].name + " copy" }, ...st.slice(i + 1)]);
  const del = (i) => { if (stages.length <= 1) return; mut((st) => st.filter((_, k) => k !== i)); };
  const insAfter = (i) => mut((st) => [...st.slice(0, i + 1), mkStage(), ...st.slice(i + 1)]);

  const save = async () => {
    setSaving(true);
    const r = await api.savePipeline(dir, { id: pipeline.id, label, workingDir, stages });
    setSaving(false);
    if (r.ok) { setDirty(false); flash("stage flow saved"); onSaved && onSaved(); } else flash(r.error);
  };
  const inputsFor = (i) => i === 0 ? [{ name: "task intent" }, { name: "context.md" }] : stages[i - 1].outputs.filter((o) => o.name);

  return (
    <>
      <div className="topbar">
        <div className="row">
          <Hamburger collapsed={collapsed} onExpandSide={onExpandSide} />
          <button className="btn ghost" onClick={onClose}>← {pipeline.label}</button>
          <h1 style={{ marginLeft: 6 }}>Stage flow</h1>
        </div>
        <div className="row">
          {dirty && <span className="tag">unsaved</span>}
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save flow"}</button>
        </div>
      </div>
      <div className="content">
        <p className="muted" style={{ marginTop: 0 }}>Each stage's <b>output</b> is the next stage's <b>input</b>. New tasks in <b>{pipeline.label}</b> use this flow (existing tasks keep their own).</p>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", maxWidth: 720 }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label>Pipeline name</label><input className="input" value={label} onChange={(e) => { setLabel(e.target.value); setDirty(true); }} /></div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label>Working dir (sparse scope; '.' = whole repo)</label><input className="input" value={workingDir} onChange={(e) => { setWorkingDir(e.target.value); setDirty(true); }} /></div>
        </div>

        <div className="flow">
          <div className="flow-term">▸ Capture · task intent</div>
          {stages.map((s, i) => (
            <FlowNode key={s.id} s={s} i={i} total={stages.length} tools={tools} inputs={inputsFor(i)}
              patch={(p) => patch(i, p)} onUp={() => move(i, -1)} onDown={() => move(i, 1)} onDup={() => dup(i)} onDel={() => del(i)} onInsert={() => insAfter(i)} />
          ))}
          <button className="btn flow-add" onClick={() => mut((st) => [...st, mkStage()])}>＋ Add stage</button>
          <div className="flow-term done">✓ Delivered</div>
        </div>
      </div>
    </>
  );
}

function FlowNode({ s, i, total, tools, inputs, patch, onUp, onDown, onDup, onDel, onInsert }) {
  const setOut = (oi, p) => patch({ outputs: s.outputs.map((o, k) => k === oi ? { ...o, ...p } : o) });
  const toolOpts = tools.length ? tools.map((t) => t.id) : ["claude", "opencode"];
  return (
    <div className="fnode">
      <div className="fnode-h">
        <span className="fnode-i">{String(i + 1).padStart(2, "0")}</span>
        <input className="fnode-name" value={s.name} onChange={(e) => patch({ name: e.target.value })} spellCheck={false} />
        <button className={"fnode-auto" + (s.auto ? " on" : "")} onClick={() => patch({ auto: !s.auto })} title={s.auto ? "Auto-approves & passes on" : "Supervised — pauses for review"}>{s.auto ? "⚡ auto" : "review"}</button>
        <div className="fnode-ops">
          <button className="btn ghost sm" onClick={onUp} disabled={i === 0} title="Move up">↑</button>
          <button className="btn ghost sm" onClick={onDown} disabled={i === total - 1} title="Move down">↓</button>
          <button className="btn ghost sm" onClick={onDup} title="Duplicate">⧉</button>
          <button className="btn ghost sm" onClick={onDel} disabled={total <= 1} title="Delete">🗑</button>
        </div>
      </div>
      <div className="fnode-io">
        <span className="io-lbl">reads {i === 0 ? "· task intent" : "· from " + String(i).padStart(2, "0")}</span>
        {inputs.map((a, k) => <code key={k} className="iochip in">{a.name}</code>)}
      </div>
      <textarea className="input" rows={3} placeholder="System prompt — the LLM's instructions for this stage" value={s.systemPrompt} onChange={(e) => patch({ systemPrompt: e.target.value })} />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <select className="input" style={{ width: 150 }} value={s.tool} onChange={(e) => patch({ tool: e.target.value })}>
          {toolOpts.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="input" placeholder="acceptance gate" value={s.gate} onChange={(e) => patch({ gate: e.target.value })} />
      </div>
      <div className="fnode-shell">
        {s.shell.map((c, si) => (
          <div className="row" key={si} style={{ marginTop: 6 }}>
            <span className="tag">sh</span>
            <input className="input mono" value={c} onChange={(e) => patch({ shell: s.shell.map((x, k) => k === si ? e.target.value : x) })} />
            <button className="btn ghost sm" onClick={() => patch({ shell: s.shell.filter((_, k) => k !== si) })}>×</button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={() => patch({ shell: [...s.shell, ""] })} style={{ marginTop: 6 }}>＋ shell command (build/check gate)</button>
      </div>
      <div className="fnode-io">
        <span className="io-lbl">writes {i < total - 1 ? "· → " + String(i + 2).padStart(2, "0") : "· final"}</span>
        {s.outputs.map((o, oi) => (
          <span className="ochip" key={oi}>
            <input className="ochip-name" placeholder="file.ext" value={o.name} onChange={(e) => setOut(oi, { name: e.target.value })} spellCheck={false} />
            <select className="ochip-type" value={o.type} onChange={(e) => setOut(oi, { type: e.target.value })}>{OUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <button className="ochip-x" onClick={() => patch({ outputs: s.outputs.filter((_, k) => k !== oi) })}>×</button>
          </span>
        ))}
        <button className="btn ghost sm" onClick={() => patch({ outputs: [...s.outputs, { name: "", type: "doc", note: "" }] })}>＋ output</button>
      </div>
      <button className="fnode-insert" onClick={onInsert} title="Insert a stage after this one">＋</button>
    </div>
  );
}

/* ───────────────────────── plan: task network + milestones (circuit board) ─────────────────────────
   Every task in the project is a chip on the board. Dependencies are traces;
   where several inputs join, an AND (&) or OR (≥1) logic gate sits in front of
   the task. Milestones are memory-module chips drawn around their tasks. Status
   is live: done (green), running (pulsing), ready (lit), blocked (dim + ⛔). */

const PN = { H: 50, ROW: 86, GW: 34, GH: 18 };
const trunc = (s, n) => (s || "").length > n ? s.slice(0, n - 1) + "…" : (s || "");

// layer = longest dependency chain leading into a task (roots = 0), with a
// cycle guard so a bad edit can't hang the layout.
function planLayout(tasks, gateOf, msIndexOf, colW) {
  const layer = {};
  const visiting = new Set();
  const L = (k) => {
    if (layer[k] != null) return layer[k];
    if (visiting.has(k)) return 0;
    visiting.add(k);
    const g = gateOf(k);
    const parents = [...g.all, ...g.any];
    layer[k] = parents.length ? 1 + Math.max(...parents.map(L)) : 0;
    visiting.delete(k);
    return layer[k];
  };
  tasks.forEach((t) => L(t.key));
  // one horizontal BAND per milestone (unassigned tasks in a final band), so a
  // milestone's module box never contains or overlaps foreign nodes.
  const groups = new Map();
  tasks.forEach((t) => { const g = msIndexOf(t.key); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); });
  const pos = {};
  let bandY = 64;
  for (const gi of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(gi).sort((a, b) => a.pipe.localeCompare(b.pipe) || a.title.localeCompare(b.title));
    const perCol = {};
    let rows = 1;
    list.forEach((t) => {
      const l = layer[t.key];
      const i = perCol[l] || 0;
      perCol[l] = i + 1;
      rows = Math.max(rows, i + 1);
      pos[t.key] = { x: 50 + l * colW, y: bandY + i * PN.ROW };
    });
    bandY += rows * PN.ROW + (gi === 999 ? 10 : 44);   // milestone bands get room for box chrome
  }
  return pos;
}

// an orthogonal circuit trace: out of the source, across, down/up, into the target
const tracePath = (px, py, ix, iy) => {
  const mid = ix - 16;
  return { d: `M ${px} ${py} L ${mid} ${py} L ${mid} ${iy} L ${ix} ${iy}`, vias: py === iy ? [] : [[mid, py], [mid, iy]] };
};

function PlanView({ dir, proj, runningTasks, onOpenTask, flash, collapsed, onExpandSide }) {
  const [plan, setPlan] = useState(null);
  const [sel, setSel] = useState(null);      // selected task key
  const [selMs, setSelMs] = useState(null);  // selected milestone id
  const [view, setView] = useState({ x: 16, y: 8, k: 1 });
  const [wide, setWide] = useState(() => localStorage.getItem("bridza-plan-wide") === "1");
  const [critOn, setCritOn] = useState(false);
  const [dragPos, setDragPos] = useState({});   // live positions while dragging a node/milestone
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    let on = true;
    api.getPlan(dir).then((r) => { if (on) setPlan({ deps: (r.plan && r.plan.deps) || {}, milestones: (r.plan && r.plan.milestones) || [], pos: (r.plan && r.plan.pos) || {} }); });
    return () => { on = false; };
  }, [dir]);

  // wheel zoom needs a NON-passive native listener (React's synthetic onWheel can't preventDefault)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const v = viewRef.current;
      const k = Math.min(2.5, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.12 : 0.9)));
      const f = k / v.k;
      setView({ k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [plan]);

  if (!plan) return (
    <>
      <div className="topbar"><div className="row"><Hamburger collapsed={collapsed} onExpandSide={onExpandSide} /><h1>Plan</h1></div></div>
      <div className="content"><p className="muted">Loading plan…</p></div>
    </>
  );

  // ---- model ---------------------------------------------------------------
  const tasks = [];
  proj.pipelines.forEach((p) => (p.tasks || []).forEach((t) => tasks.push({
    key: p.id + "/" + t.id, pid: p.id, tid: t.id, title: t.title, pipe: p.label,
    progress: t.progress, done: t.finalized || (t.stages.length > 0 && t.progress === 100),
  })));
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const doneSet = new Set(tasks.filter((t) => t.done).map((t) => t.key));
  const gateOf = (k) => {
    const g = plan.deps[k] || {};
    return { all: (g.all || []).filter((x) => byKey.has(x)), any: (g.any || []).filter((x) => byKey.has(x)) };
  };
  const blocksOf = (k) => tasks.filter((t) => { const g = gateOf(t.key); return g.all.includes(k) || g.any.includes(k); });
  const msOf = (k) => plan.milestones.find((m) => (m.tasks || []).includes(k));
  const msIndexOf = (k) => { const i = plan.milestones.findIndex((m) => (m.tasks || []).includes(k)); return i < 0 ? 999 : i; };
  const msMembers = (m) => (m.tasks || []).filter((k) => byKey.has(k));
  const msById = new Map(plan.milestones.map((m) => [m.id, m]));
  const msIsDone = (m) => { const mem = msMembers(m); return mem.length > 0 && mem.every((k) => doneSet.has(k)); };
  // a milestone's own gate: the milestones it requires that aren't complete yet
  const msBlockedBy = (m) => (((m && m.needs) || []).map((id) => msById.get(id)).filter((x) => x && !msIsDone(x)));
  const stateOf = (t) => t.done ? "done"
    : runningTasks.has(t.key) ? "running"
      : (gateSatisfied(gateOf(t.key), doneSet) && msBlockedBy(msOf(t.key)).length === 0) ? "ready" : "blocked";

  // critical path: the longest chain of REMAINING work (done tasks cost 0).
  // Milestone requirements count as AND-deps on every member of the required
  // milestone, so the path reflects milestone gating too.
  const effGateOf = (k) => {
    const g = gateOf(k);
    const m = msOf(k);
    const extra = (((m && m.needs) || []).flatMap((id) => { const req = msById.get(id); return req ? msMembers(req) : []; })).filter((d) => d !== k);
    return extra.length ? { all: [...new Set([...g.all, ...extra])], any: g.any } : g;
  };
  const crit = criticalPath(tasks.map((t) => t.key), effGateOf, (k) => (doneSet.has(k) ? 0 : 1));
  const critSet = new Set(critOn ? crit.path : []);
  const critPairs = new Set();
  if (critOn) for (let i = 1; i < crit.path.length; i++) critPairs.add(crit.path[i - 1] + ">" + crit.path[i]);

  // card width: normal, or wide enough to show every full task name
  const maxTitle = Math.max(8, ...tasks.map((t) => t.title.length));
  const W = wide ? Math.min(380, Math.max(190, 30 + maxTitle * 7)) : 170;
  const COL = W + 96;
  const titleChars = wide ? 999 : 21;

  // positions: auto layout, overridden by saved manual positions (plan.pos),
  // then auto-only members get shifted down until milestone boxes don't overlap
  const autoPos = planLayout(tasks, gateOf, msIndexOf, COL);
  const basePos = {};
  tasks.forEach((t) => { basePos[t.key] = (plan.pos && plan.pos[t.key]) || autoPos[t.key]; });
  const boxOf = (members) => {
    const xs = members.map((k) => basePos[k].x), ys = members.map((k) => basePos[k].y);
    const x = Math.min(...xs) - 16, y = Math.min(...ys) - 34;
    return { x, y, w: Math.max(...xs) + W - x + 16, h: Math.max(...ys) + PN.H - y + 14 };
  };
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const placed = [];
  plan.milestones.forEach((m) => {
    const members = msMembers(m);
    if (!members.length) return;
    let box = boxOf(members);
    for (const other of placed) {
      if (hits(box, other)) {
        const dy = other.y + other.h + 30 - box.y;
        members.forEach((k) => { if (!(plan.pos && plan.pos[k])) basePos[k] = { x: basePos[k].x, y: basePos[k].y + dy }; });
        box = boxOf(members);
      }
    }
    placed.push(box);
  });
  const pos = { ...basePos, ...dragPos };
  const maxX = Math.max(0, ...tasks.map((t) => pos[t.key].x)) + W + 80;
  const maxY = Math.max(0, ...tasks.map((t) => pos[t.key].y)) + PN.H + 80;

  // ---- mutations (each save commits .bridza/plan.json) ----------------------
  const save = (next) => { setPlan(next); api.savePlan(dir, next).then((r) => { if (!r.ok) flash(r.error || "plan save failed"); }); };
  const setGate = (key, gate) => save({ ...plan, deps: { ...plan.deps, [key]: gate } });
  const addDep = (key, group, dep) => {
    if (!dep || dep === key) return;
    const g = gateOf(key);
    if (g.all.includes(dep) || g.any.includes(dep)) return;
    setGate(key, { ...g, [group]: [...g[group], dep] });
  };
  const rmDep = (key, group, dep) => { const g = gateOf(key); setGate(key, { ...g, [group]: g[group].filter((x) => x !== dep) }); };
  const flipDep = (key, group, dep) => { const g = gateOf(key); const other = group === "all" ? "any" : "all"; setGate(key, { ...g, [group]: g[group].filter((x) => x !== dep), [other]: [...g[other], dep] }); };
  const addMilestone = () => {
    const id = "ms-" + Math.random().toString(36).slice(2, 7);
    save({ ...plan, milestones: [...plan.milestones, { id, title: "Milestone " + (plan.milestones.length + 1), due: "", tasks: [] }] });
    setSelMs(id); setSel(null);
  };
  const patchMs = (id, p) => save({ ...plan, milestones: plan.milestones.map((m) => m.id === id ? { ...m, ...p } : m) });
  const delMs = (id) => { save({ ...plan, milestones: plan.milestones.filter((m) => m.id !== id) }); setSelMs(null); };
  const assignMs = (key, msId) => save({
    ...plan,
    milestones: plan.milestones.map((m) => ({ ...m, tasks: m.id === msId ? [...new Set([...(m.tasks || []), key])] : (m.tasks || []).filter((t) => t !== key) })),
  });
  const addMsNeed = (id, reqId) => { const m = msById.get(id); if (!m || !reqId || reqId === id) return; patchMs(id, { needs: [...new Set([...(m.needs || []), reqId])] }); };
  const rmMsNeed = (id, reqId) => { const m = msById.get(id); if (m) patchMs(id, { needs: (m.needs || []).filter((x) => x !== reqId) }); };
  const toggleWide = () => { setWide((w) => { localStorage.setItem("bridza-plan-wide", w ? "0" : "1"); return !w; }); };

  // ---- one drag system: pan the board, drag a node, or drag a whole milestone ----
  const startDrag = (e, d) => { e.stopPropagation(); dragRef.current = { ...d, sx: e.clientX, sy: e.clientY, moved: false }; };
  const bgDown = (e) => { dragRef.current = { type: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }; };
  const bgMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.type === "pan") setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    else {
      // keep the live positions on the ref too — mouseup may fire before React
      // re-renders, and persisting must not read stale state
      d.live = Object.fromEntries(d.keys.map((k) => [k, { x: d.orig[k].x + dx / view.k, y: d.orig[k].y + dy / view.k }]));
      setDragPos(d.live);
    }
  };
  const bgUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      if (d.type === "node") { setSel(d.keys[0]); setSelMs(null); }
      else if (d.type === "ms") { setSelMs(d.id); setSel(null); }
      else { setSel(null); setSelMs(null); }
      return;
    }
    if (d.type === "pan") return;
    // persist the dragged positions (rounded) into the committed plan
    const nextPos = { ...(plan.pos || {}) };
    d.keys.forEach((k) => { const p = (d.live && d.live[k]) || dragPos[k] || pos[k]; nextPos[k] = { x: Math.round(p.x), y: Math.round(p.y) }; });
    setDragPos({});
    save({ ...plan, pos: nextPos });
  };
  const zoomBy = (f) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = r.width / 2, my = r.height / 2;
    setView((v) => { const k = Math.min(2.5, Math.max(0.25, v.k * f)); const ff = k / v.k; return { k, x: mx - (mx - v.x) * ff, y: my - (my - v.y) * ff }; });
  };
  const fit = () => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = Math.min(1.4, Math.max(0.25, Math.min(r.width / maxX, r.height / maxY)));
    setView({ k, x: (r.width - maxX * k) / 2, y: Math.max(4, (r.height - maxY * k) / 2) });
  };

  // ---- geometry for milestones / edges / gates -------------------------------
  const msBoxes = plan.milestones.map((m) => {
    const members = msMembers(m);
    if (!members.length) return { m, empty: true, members };
    const xs = members.map((k) => pos[k].x), ys = members.map((k) => pos[k].y);
    const x = Math.min(...xs) - 16, y = Math.min(...ys) - 34;
    const w = Math.max(...xs) + W - x + 16, h = Math.max(...ys) + PN.H - y + 14;
    const done = members.filter((k) => doneSet.has(k)).length;
    return { m, x, y, w, h, done, n: members.length, members, gated: msBlockedBy(m).length > 0 };
  });
  const boxById = new Map(msBoxes.filter((b) => !b.empty).map((b) => [b.m.id, b]));

  // milestone → milestone requirement wires (module-to-module traces)
  const msEdges = [];
  msBoxes.filter((b) => !b.empty).forEach((b) => {
    (b.m.needs || []).forEach((reqId) => {
      const req = boxById.get(reqId);
      if (!req) return;
      msEdges.push({ id: b.m.id + "←" + reqId, hot: msIsDone(req.m), ...tracePath(req.x + req.w, req.y + req.h / 2, b.x, b.y + b.h / 2) });
    });
  });

  const gates = [], edges = [];
  tasks.forEach((t) => {
    const g = gateOf(t.key);
    const { x: tx, y: ty } = pos[t.key];
    const inY = ty + PN.H / 2;
    const groups = [["all", g.all], ["any", g.any]].filter(([, list]) => list.length);
    const single = groups.length === 1 && groups[0][1].length === 1;
    groups.forEach(([kind, list], gi) => {
      const gy = inY - PN.GH / 2 + (groups.length === 2 ? (gi === 0 ? -13 : 13) : 0);
      const gx = tx - PN.GW - 16;
      const useGate = !single;
      if (useGate) {
        const open = kind === "all" ? list.every((k) => doneSet.has(k)) : list.some((k) => doneSet.has(k));
        gates.push({ id: t.key + ":" + kind, kind, x: gx, y: gy, open });
        edges.push({ id: t.key + ":" + kind + ":out", from: null, hot: open, crit: list.some((dep) => critPairs.has(dep + ">" + t.key)), ...tracePath(gx + PN.GW, gy + PN.GH / 2, tx, inY) });
      }
      list.forEach((dep) => {
        const dp = pos[dep];
        const src = { x: dp.x + W, y: dp.y + PN.H / 2 };
        const dst = useGate ? { x: gx, y: gy + PN.GH / 2 } : { x: tx, y: inY };
        edges.push({ id: t.key + ":" + kind + ":" + dep, hot: doneSet.has(dep), run: runningTasks.has(dep), crit: critPairs.has(dep + ">" + t.key), ...tracePath(src.x, src.y, dst.x, dst.y) });
      });
    });
  });

  const blocked = tasks.filter((t) => stateOf(t) === "blocked");
  const selTask = sel && byKey.get(sel);
  const selMile = selMs && plan.milestones.find((m) => m.id === selMs);
  const depPicker = (key, group) => (
    <select className="input" value="" onChange={(e) => addDep(key, group, e.target.value)}>
      <option value="">＋ add dependency…</option>
      {tasks.filter((t) => t.key !== key && !gateOf(key).all.includes(t.key) && !gateOf(key).any.includes(t.key))
        .map((t) => <option key={t.key} value={t.key}>{t.pipe} / {t.title}</option>)}
    </select>
  );

  return (
    <>
      <div className="topbar">
        <div className="row">
          <Hamburger collapsed={collapsed} onExpandSide={onExpandSide} />
          <h1>Plan</h1>
          <span className="muted" style={{ fontSize: 12 }}>{tasks.length} tasks · {plan.milestones.length} milestones{blocked.length ? <> · <span style={{ color: "var(--warn, #d8a03a)" }}>{blocked.length} blocked</span></> : null}</span>
        </div>
        <div className="row">
          <div className="plan-legend">
            <span><i className="lg done" /> done</span><span><i className="lg running" /> running</span><span><i className="lg ready" /> ready</span><span><i className="lg blocked" /> blocked</span>
          </div>
          <div className="seg">
            <button onClick={() => zoomBy(0.83)} title="Zoom out">−</button>
            <button onClick={fit} title="Fit the whole board">⌖</button>
            <button onClick={() => zoomBy(1.2)} title="Zoom in">＋</button>
          </div>
          <button className={"btn ghost" + (wide ? " on" : "")} onClick={toggleWide} title={wide ? "Compact cards" : "Widen cards to show full task names"}>⤢ {wide ? "Compact" : "Full names"}</button>
          <button className={"btn ghost" + (critOn ? " on" : "")} onClick={() => setCritOn((c) => !c)}
            title="Highlight the longest chain of remaining work — the path that sets the project's finish date">
            ⚡ Critical path{crit.length > 0 ? ` · ${crit.length}` : ""}
          </button>
          <button className="btn primary" onClick={addMilestone}>＋ Milestone</button>
        </div>
      </div>
      <div className="plan-wrap">
        {tasks.length === 0 ? (
          <div className="content"><p className="muted">No tasks yet — create tasks in a pipeline first, then wire them up here.</p></div>
        ) : (
          <svg ref={svgRef} className="plan-svg" onMouseDown={bgDown} onMouseMove={bgMove} onMouseUp={bgUp} onMouseLeave={bgUp}>
            <defs>
              <pattern id="plan-dots" width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="1" fill="var(--line)" />
              </pattern>
            </defs>
            <rect className="plan-board" width="100%" height="100%" fill="url(#plan-dots)" />
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {msBoxes.filter((b) => !b.empty).map(({ m, x, y, w, h, done, n, members, gated }) => (
                <g key={m.id} className={"plan-ms" + (selMs === m.id ? " sel" : "") + (gated ? " gated" : "")}
                  onMouseDown={(e) => startDrag(e, { type: "ms", id: m.id, keys: members, orig: Object.fromEntries(members.map((k) => [k, pos[k]])) })}>
                  <rect x={x} y={y} width={w} height={h} rx="12" className="ms-box" />
                  {Array.from({ length: Math.max(2, Math.floor(w / 26)) }, (_, i) => (
                    <rect key={i} x={x + 14 + i * 26} y={y - 4} width="9" height="8" rx="1.5" className="ms-pin" />
                  ))}
                  <circle cx={x + w - 18} cy={y + 16} r="4" className="ms-notch" />
                  <text x={x + 12} y={y + 21} className="ms-label">▦ {trunc(m.title, wide ? 60 : 28)}{m.due ? `  ·  ${m.due}` : ""}{gated ? "  ·  ⛔ gated" : ""}</text>
                  <text x={x + w - 34} y={y + 21} className="ms-count" textAnchor="end">{done}/{n}</text>
                </g>
              ))}
              {msEdges.map((e) => (
                <g key={e.id} className={"plan-edge ms" + (e.hot ? " hot" : "")}>
                  <path d={e.d} />
                  {e.vias.map(([vx, vy], i) => <circle key={i} cx={vx} cy={vy} r="2.6" className="via" />)}
                </g>
              ))}
              {edges.map((e) => (
                <g key={e.id} className={"plan-edge" + (e.hot ? " hot" : "") + (e.run ? " run" : "") + (e.crit ? " crit" : "")}>
                  <path d={e.d} />
                  {e.vias.map(([vx, vy], i) => <circle key={i} cx={vx} cy={vy} r="2.2" className="via" />)}
                </g>
              ))}
              {gates.map((g) => (
                <g key={g.id} className={"plan-gate" + (g.open ? " open" : "")} transform={`translate(${g.x},${g.y})`}>
                  <rect width={PN.GW} height={PN.GH} rx="4" />
                  <text x={PN.GW / 2} y={PN.GH / 2 + 3.5} textAnchor="middle">{g.kind === "all" ? "AND" : "OR"}</text>
                </g>
              ))}
              {tasks.map((t) => {
                const st = stateOf(t);
                const { x, y } = pos[t.key];
                return (
                  <g key={t.key} transform={`translate(${x},${y})`} className={"plan-node " + st + (sel === t.key ? " sel" : "") + (critSet.has(t.key) ? " crit" : "")}
                    onMouseDown={(e) => startDrag(e, { type: "node", keys: [t.key], orig: { [t.key]: pos[t.key] } })}
                    onDoubleClick={() => onOpenTask(t.pid, t.tid)}>
                    <rect className="pn-box" width={W} height={PN.H} rx="9" />
                    <rect className="pn-prog" x="1" y={PN.H - 4} width={Math.max(0, (W - 2) * t.progress / 100)} height="3" rx="1.5" />
                    <circle className="pn-pin" cx="0" cy={PN.H / 2} r="3" />
                    <circle className="pn-pin" cx={W} cy={PN.H / 2} r="3" />
                    <text className="pn-title" x="11" y="20">{trunc(t.title, titleChars)}</text>
                    <text className="pn-sub" x="11" y="36">{trunc(t.pipe, wide ? 40 : 12)} · {st === "done" ? "✓ done" : st === "running" ? "● running" : st === "blocked" ? "⛔ blocked" : "○ ready"}</text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {critOn && !sel && !selMs && (
          <aside className="plan-panel">
            <div className="spread">
              <b style={{ fontSize: 14 }}>⚡ Critical path</b>
              <button className="btn ghost sm" onClick={() => setCritOn(false)}>✕</button>
            </div>
            {crit.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>🎉 No remaining work on any dependency chain — everything is done.</p>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 11.5, margin: "6px 0 10px" }}>
                  <b style={{ color: "var(--warn, #d8a03a)" }}>{crit.length}</b> task{crit.length === 1 ? "" : "s"} deep — the longest chain of unfinished work.
                  Nothing can shorten the project without shortening this path: split its tasks, parallelize them, or cut scope here first.
                </div>
                {crit.path.map((k, i) => {
                  const t = byKey.get(k);
                  return (
                    <div className="crit-row" key={k} onClick={() => { setSel(k); }}>
                      <span className="crit-n">{i + 1}</span>
                      <span className="dep-name" title={k}>{t ? t.title : k}</span>
                      <span className={"lg " + (doneSet.has(k) ? "done" : stateOf(t) === "running" ? "running" : "blocked")} />
                    </div>
                  );
                })}
              </>
            )}
          </aside>
        )}

        {selTask && (() => {
          const g = gateOf(sel);
          const unmet = [...g.all.filter((k) => !doneSet.has(k)), ...(g.any.length && !g.any.some((k) => doneSet.has(k)) ? g.any : [])];
          const children = blocksOf(sel);
          const mine = msOf(sel);
          const depRow = (dep, group) => (
            <div className="dep-row" key={group + dep}>
              <span className={"lg " + (doneSet.has(dep) ? "done" : "blocked")} />
              <span className="dep-name" title={dep}>{(byKey.get(dep) || {}).title || dep}</span>
              <button className="btn ghost sm" title={group === "all" ? "Move to ANY group (OR)" : "Move to ALL group (AND)"} onClick={() => flipDep(sel, group, dep)}>⇄</button>
              <button className="btn ghost sm" onClick={() => rmDep(sel, group, dep)}>×</button>
            </div>
          );
          return (
            <aside className="plan-panel">
              <div className="spread">
                <b style={{ fontSize: 14 }}>{selTask.title}</b>
                <button className="btn ghost sm" onClick={() => setSel(null)}>✕</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>{selTask.pipe} · <span className={"tag " + stateOf(selTask)}>{stateOf(selTask)}</span></div>
              <div className="side-label" style={{ padding: "0 0 4px" }}>Needs ALL of <span className="muted">(AND)</span></div>
              {g.all.map((d) => depRow(d, "all"))}
              {depPicker(sel, "all")}
              <div className="side-label" style={{ padding: "12px 0 4px" }}>Needs ANY of <span className="muted">(OR)</span></div>
              {g.any.map((d) => depRow(d, "any"))}
              {depPicker(sel, "any")}
              {(unmet.length > 0 || msBlockedBy(mine).length > 0) && (
                <div className="plan-blockers">⛔ blocked by {unmet.map((k) => <code key={k}>{(byKey.get(k) || {}).title || k}</code>)}
                  {msBlockedBy(mine).map((m) => <code key={m.id} onClick={() => { setSelMs(m.id); setSel(null); }}>▦ {m.title}</code>)}</div>
              )}
              {children.length > 0 && (
                <>
                  <div className="side-label" style={{ padding: "12px 0 4px" }}>Blocks</div>
                  <div className="plan-children">{children.map((c) => <code key={c.key} onClick={() => { setSel(c.key); }}>{c.title}</code>)}</div>
                </>
              )}
              <div className="side-label" style={{ padding: "12px 0 4px" }}>Milestone</div>
              <select className="input" value={mine ? mine.id : ""} onChange={(e) => assignMs(sel, e.target.value)}>
                <option value="">— none —</option>
                {plan.milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
              <button className="btn" style={{ marginTop: 12, width: "100%" }} onClick={() => onOpenTask(selTask.pid, selTask.tid)}>Open task →</button>
            </aside>
          );
        })()}

        {selMile && (
          <aside className="plan-panel">
            <div className="spread">
              <b style={{ fontSize: 14 }}>▦ Milestone</b>
              <button className="btn ghost sm" onClick={() => setSelMs(null)}>✕</button>
            </div>
            <div className="field" style={{ marginTop: 8 }}><label>Name</label>
              <input className="input" value={selMile.title} onChange={(e) => patchMs(selMile.id, { title: e.target.value })} /></div>
            <div className="field"><label>Due (optional)</label>
              <input className="input" placeholder="e.g. 2026-08-01" value={selMile.due || ""} onChange={(e) => patchMs(selMile.id, { due: e.target.value })} /></div>
            <div className="side-label" style={{ padding: "4px 0" }}>Requires milestones <span className="muted">(must be done first)</span></div>
            {(selMile.needs || []).map((id) => msById.get(id)).filter(Boolean).map((req) => (
              <div className="dep-row" key={req.id}>
                <span className={"lg " + (msIsDone(req) ? "done" : "blocked")} />
                <span className="dep-name">▦ {req.title}</span>
                <button className="btn ghost sm" onClick={() => rmMsNeed(selMile.id, req.id)}>×</button>
              </div>
            ))}
            <select className="input" value="" onChange={(e) => e.target.value && addMsNeed(selMile.id, e.target.value)}>
              <option value="">＋ add required milestone…</option>
              {plan.milestones.filter((m) => m.id !== selMile.id && !(selMile.needs || []).includes(m.id) && !(m.needs || []).includes(selMile.id))
                .map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
            <div className="side-label" style={{ padding: "12px 0 4px" }}>Tasks · {(selMile.tasks || []).filter((k) => byKey.has(k)).length}</div>
            {(selMile.tasks || []).filter((k) => byKey.has(k)).map((k) => (
              <div className="dep-row" key={k}>
                <span className={"lg " + (doneSet.has(k) ? "done" : "blocked")} />
                <span className="dep-name">{byKey.get(k).title}</span>
                <button className="btn ghost sm" onClick={() => patchMs(selMile.id, { tasks: selMile.tasks.filter((x) => x !== k) })}>×</button>
              </div>
            ))}
            <select className="input" value="" onChange={(e) => e.target.value && assignMs(e.target.value, selMile.id)}>
              <option value="">＋ add task (unassigned only)…</option>
              {tasks.filter((t) => msIndexOf(t.key) === 999).map((t) => <option key={t.key} value={t.key}>{t.pipe} / {t.title}</option>)}
            </select>
            <button className="btn ghost" style={{ marginTop: 12, width: "100%", color: "var(--danger)" }} onClick={() => delMs(selMile.id)}>🗑 Delete milestone</button>
          </aside>
        )}
      </div>
    </>
  );
}

/* ───────────────────────── modals ───────────────────────── */

function NewPipelineModal({ dir, existing, onClose, onDone, flash }) {
  const [label, setLabel] = useState("");
  const [workingDir, setWorkingDir] = useState(".");
  const [tplId, setTplId] = useState(STARTER_PIPELINES[0].id);
  const create = async () => {
    const tpl = STARTER_PIPELINES.find((p) => p.id === tplId);
    const id = (label || tpl.label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (existing.includes(id)) return flash("pipeline id already exists");
    const r = await api.createPipeline(dir, { id, label: label || tpl.label, workingDir, stages: tpl.stages });
    if (r.ok) onDone(r.id); else flash(r.error);
  };
  return (
    <Modal title="New pipeline" onClose={onClose} onConfirm={create} confirm="Create">
      <Field label="Name"><input className="input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Marketing" /></Field>
      <Field label="Stage flow (template)">
        <select className="input" value={tplId} onChange={(e) => setTplId(e.target.value)}>
          {STARTER_PIPELINES.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.stages.map((s) => s.name).join(" → ")}</option>)}
        </select>
      </Field>
      <Field label="Working dir (sparse-checkout scope; '.' = whole repo)"><input className="input" value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} /></Field>
    </Modal>
  );
}

function NewTaskModal({ dir, pipeline, onClose, onDone, flash }) {
  const [title, setTitle] = useState("");
  const create = async () => {
    const id = (title || "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
    const r = await api.createTask(dir, { pipeline: pipeline.id, id, title });
    if (r.ok) onDone(r.id); else flash(r.error);
  };
  return (
    <Modal title={`New task in ${pipeline.label}`} onClose={onClose} onConfirm={create} confirm="Create">
      <Field label="Title"><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 launch microsite" /></Field>
      <p className="muted" style={{ fontSize: 12 }}>Stages: {pipeline.stages.map((s) => s.name).join(" → ")}. Gets branch <code>bridza/{pipeline.id}/…</code>.</p>
    </Modal>
  );
}

function Modal({ title, children, onClose, onConfirm, confirm }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>{title}</h2>
        {children}
        <div className="spread" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
const Field = ({ label, children }) => <div className="field"><label>{label}</label>{children}</div>;
