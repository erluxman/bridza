// App.jsx — the Bridza app shell. Owns the open project (dir), polling/refresh,
// and top-level routing between the screens; every screen lives in features/.
import { useState, useEffect, useCallback, useRef } from "react";
import "./bridza.css";
import * as api from "./api/client.js";
import { LS, readRecents } from "./lib/format.js";
import { useColWidth, ColGrip } from "./ui.jsx";
import { Welcome, PipelinePicker, NewPipelineModal, NewTaskModal } from "./features/onboarding.jsx";
import { Sidebar, Inbox } from "./features/nav.jsx";
import { Board } from "./features/board.jsx";
import { TaskDetail } from "./features/task.jsx";
import { PipelineFlow } from "./features/flow.jsx";
import { PlanView } from "./features/plan.jsx";

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
  const [sideW, sideGrip] = useColWidth("bridza.sideW", 264, { min: 200, max: 460, side: "left" });
  const [flowOpen, setFlowOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const flash = (m, ms = 2400) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  };
  const collapse = (v) => { setSideCollapsed(v); localStorage.setItem(LS.side, v ? "1" : "0"); };

  // Poll discipline: background polls never stack (a slow server would
  // snowball), but an EXPLICIT refresh — switching projects, after a mutation —
  // always runs and supersedes any in-flight poll (its response is dropped, so
  // a stale project can't overwrite the one just switched to).
  const refreshBusy = useRef(false);
  const refreshSeq = useRef(0);
  const refresh = useCallback(async (d = dir, { poll = false } = {}) => {
    if (!d) { setProj(null); return; }
    if (poll && refreshBusy.current) return;
    refreshBusy.current = true;
    const seq = ++refreshSeq.current;
    try {
      const s = await api.getState(d);
      if (seq !== refreshSeq.current) return;   // superseded by a newer refresh
      setProj(s);
      setActivePipe((cur) => (s.initialized && (!cur || !s.pipelines.some((p) => p.id === cur))) ? (s.pipelines[0] ? s.pipelines[0].id : "") : cur);
    } finally { if (seq === refreshSeq.current) refreshBusy.current = false; }
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
    const t = setInterval(() => refresh(dir, { poll: true }), 4000);
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

  const pipeline = proj.pipelines.find((p) => p.id === activePipe) || proj.pipelines.find((p) => !p.archived) || proj.pipelines[0];
  const task = pipeline && pipeline.tasks.find((t) => t.id === activeTask);
  const topbarNav = { collapsed: sideCollapsed, onExpandSide: () => collapse(false) };
  // what is running RIGHT NOW (server truth — the in-process run registry, not
  // committed metadata, which can say "running" forever after a crashed run)
  const running = proj.running || [];
  const runningTasks = new Set(running.map((r) => r.pipeline + "/" + r.task));
  const runningStages = new Set(running.map((r) => r.pipeline + "/" + r.task + "/" + r.stage));

  return (
    <div className={"app" + (sideCollapsed ? " side-collapsed" : "")} style={sideCollapsed ? undefined : { gridTemplateColumns: `${sideW}px 1fr`, position: "relative" }}>
      {!sideCollapsed && (
        <Sidebar proj={proj} running={running} runningTasks={runningTasks} active={activePipe} onPipe={(id) => { setActivePipe(id); setActiveTask(""); setFlowOpen(false); setInboxOpen(false); setPlanOpen(false); }}
          onNewPipe={() => setModal({ type: "pipeline" })} onClose={closeProject} onPick={pick} recents={recents} onOpen={openDir}
          onOpenTask={(pid, tid) => { setInboxOpen(false); setFlowOpen(false); setPlanOpen(false); setActivePipe(pid); setActiveTask(tid); }}
          onCollapse={() => collapse(true)} inboxCount={(proj.inbox || []).length} inboxActive={inboxOpen} onInbox={() => { setInboxOpen(true); setActiveTask(""); setFlowOpen(false); setPlanOpen(false); }}
          planActive={planOpen} onPlan={() => { setPlanOpen(true); setInboxOpen(false); setFlowOpen(false); setActiveTask(""); }} />
      )}
      {!sideCollapsed && <ColGrip side="left" {...sideGrip} style={{ left: sideW - 3 }} />}
      <div className="main">
        {planOpen ? (
          <PlanView dir={dir} proj={proj} runningTasks={runningTasks} flash={flash} {...topbarNav}
            onOpenTask={(pid, tid) => { setPlanOpen(false); setActivePipe(pid); setActiveTask(tid); }} />
        ) : inboxOpen ? (
          <Inbox dir={dir} proj={proj} onChange={refresh} flash={flash} {...topbarNav}
            onOpenTask={(pid, tid) => { setInboxOpen(false); setActivePipe(pid); refresh().then(() => setActiveTask(tid)); }} />
        ) : flowOpen ? (
          <PipelineFlow dir={dir} proj={proj} pipeline={pipeline} tools={tools} onClose={() => setFlowOpen(false)} onSaved={refresh} flash={flash} {...topbarNav} />
        ) : !task ? (
          <Board dir={dir} pipeline={pipeline} runningTasks={runningTasks} onOpen={setActiveTask} onNewTask={() => setModal({ type: "task" })} onFlow={() => setFlowOpen(true)} onChange={refresh} flash={flash} {...topbarNav} />
        ) : (
          <TaskDetail dir={dir} proj={proj} pipeline={pipeline} task={task} tools={tools} runningStages={runningStages} onBack={() => setActiveTask("")} onChange={refresh} flash={flash} {...topbarNav}
            onOpenTask={(pid, tid) => { setActivePipe(pid); setActiveTask(tid); }} />
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
