// App.jsx — the Bridza app shell. Owns the open project (dir), polling/refresh,
// and top-level routing between the screens; every screen lives in features/.
import { useState, useEffect, useCallback, useRef } from "react";
import "./bridza.css";
import * as api from "./api/client.js";
import confetti from "canvas-confetti";
import { LS, readRecents, today } from "./lib/format.js";
import { parseRoute, routePath, currentPath } from "./lib/route.js";
import { useColWidth, ColGrip } from "./ui.jsx";
import { Welcome, WelcomeDialog, PipelinePicker, NewPipelineModal, NewTaskModal } from "./features/onboarding.jsx";
import { Sidebar, Inbox } from "./features/nav.jsx";
import { Board } from "./features/board.jsx";
import { TaskDetail } from "./features/task.jsx";
import { PipelineFlow } from "./features/flow.jsx";
import { PlanView } from "./features/plan.jsx";

export default function App() {
  // the open project is in the tab's own URL (?dir=) — two tabs on two repos each
  // reload into their own; localStorage only seeds a fresh tab
  const urlDir = () => { try { return new URLSearchParams(location.search).get("dir") || ""; } catch (e) { return ""; } };
  const setUrlDir = (d) => { try { const u = new URL(location.href); if (d) u.searchParams.set("dir", d); else u.searchParams.delete("dir"); history.replaceState(null, "", u); } catch (e) { /* no history api */ } };
  const [dir, setDir] = useState(() => urlDir() || localStorage.getItem(LS.dir) || "");
  const [proj, setProj] = useState(null);
  const [recents, setRecents] = useState(readRecents);
  const [tools, setTools] = useState([]);
  const [activePipe, setActivePipe] = useState(() => parseRoute().pipe);
  const [activeTask, setActiveTask] = useState(() => parseRoute().task);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [modal, setModal] = useState(null);
  const [welcomeOpen, setWelcomeOpen] = useState(() => localStorage.getItem(LS.welcome) !== today());
  const [sideCollapsed, setSideCollapsed] = useState(() => localStorage.getItem(LS.side) === "1");
  const [sideW, sideGrip] = useColWidth("bridza.sideW", 264, { min: 200, max: 460, side: "left" });
  const [flowOpen, setFlowOpen] = useState(() => parseRoute().view === "flow");
  const [inboxOpen, setInboxOpen] = useState(() => parseRoute().view === "inbox");
  const [planOpen, setPlanOpen] = useState(() => parseRoute().view === "plan");
  const confettiShown = useRef(false);
  // The logo heartbeats every time we land back on the home board (and on the
  // first render, which is home) — a small pull of focus after a detour.
  const [logoPulse, setLogoPulse] = useState(0);
  const atHome = !planOpen && !inboxOpen && !flowOpen && !activeTask;
  useEffect(() => { if (atHome) setLogoPulse((n) => n + 1); }, [atHome]);
  const flash = (m, ms = 2400) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  };
  const collapse = (v) => { setSideCollapsed(v); localStorage.setItem(LS.side, v ? "1" : "0"); };
  const fireConfetti = () => {
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, duration: 2500 });
  };

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
    localStorage.setItem(LS.dir, d); setUrlDir(d);
    const next = [d, ...recents.filter((x) => x !== d)].slice(0, 8);
    setRecents(next); localStorage.setItem(LS.recents, JSON.stringify(next));
  };
  const pick = async () => { const r = await api.pickFolder(); if (r && r.path) openDir(r.path); else if (r && r.error) flash(r.error); };
  const closeProject = () => { setDir(""); localStorage.removeItem(LS.dir); setUrlDir(""); setProj(null); setActiveTask(""); };
  const forget = (d) => { const next = recents.filter((x) => x !== d); setRecents(next); localStorage.setItem(LS.recents, JSON.stringify(next)); };

  // Which pipeline/task the screen is actually showing: `activePipe` can name
  // one the project no longer has (a stale URL, a deleted pipeline), so the
  // fallback below — not the raw state — is what the address bar mirrors.
  const pipes = (proj && proj.pipelines) || [];
  const pipeline = pipes.find((p) => p.id === activePipe) || pipes.find((p) => !p.archived) || pipes[0];
  const task = pipeline && pipeline.tasks.find((t) => t.id === activeTask);

  // ── URL ⇄ navigation state ────────────────────────────────────────────────
  // The address bar is read once at boot (the useState initialisers above) and
  // mirrored from then on, so a refresh, a back/forward, or a pasted link all
  // land on the same screen instead of falling back to the board.
  const view = planOpen ? "plan" : inboxOpen ? "inbox" : flowOpen ? "flow" : "";
  useEffect(() => {
    const onPop = () => {
      const r = parseRoute();
      setActivePipe(r.pipe); setActiveTask(r.task);
      setPlanOpen(r.view === "plan"); setInboxOpen(r.view === "inbox"); setFlowOpen(r.view === "flow");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // A task id the project doesn't have degrades to that pipeline's board rather
  // than to a blank screen — and takes the stale id out of the URL with it.
  useEffect(() => {
    if (activeTask && pipeline && !pipeline.tasks.some((t) => t.id === activeTask)) setActiveTask("");
  }, [pipeline, activeTask]);
  const urlSettled = useRef(false);
  useEffect(() => {
    const next = routePath({ pipe: pipeline ? pipeline.id : activePipe, task: activeTask, view });
    if (next !== currentPath()) {
      // The first write only resolves what the URL already meant (the default
      // pipeline, an id that has since vanished); replacing keeps that
      // normalisation out of the back button's history.
      window.history[urlSettled.current ? "pushState" : "replaceState"]({}, "", next);
    }
    // "settled" only once the project has actually loaded — everything before
    // that is still boot normalisation, not navigation.
    if (proj) urlSettled.current = true;
  }, [proj, pipeline, activePipe, activeTask, view]);

  if (!dir || !proj) return <Welcome recents={recents} onPick={pick} onOpen={openDir} onForget={forget} />;
  if (proj.available === false) return <Welcome recents={recents} onPick={pick} onOpen={openDir} onForget={forget} error={`Can't open ${dir}`} />;
  if (!proj.initialized)
    return <PipelinePicker dir={dir} repo={proj.repo} onClose={closeProject} onCreated={(pid) => { setActivePipe(pid); refresh(); }} flash={flash} />;

  const topbarNav = { collapsed: sideCollapsed, onExpandSide: () => collapse(false) };
  // what is running RIGHT NOW (server truth — the in-process run registry, not
  // committed metadata, which can say "running" forever after a crashed run)
  const running = proj.running || [];
  const runningTasks = new Set(running.map((r) => r.pipeline + "/" + r.task));
  const runningStages = new Set(running.map((r) => r.pipeline + "/" + r.task + "/" + r.stage));

  return (
    <div className={"app" + (sideCollapsed ? " side-collapsed" : "")} style={sideCollapsed ? undefined : { gridTemplateColumns: `${sideW}px 1fr`, position: "relative" }}>
      {!sideCollapsed && (
        <Sidebar proj={proj} running={running} runningTasks={runningTasks} active={activePipe} activeTask={activeTask} pulseKey={logoPulse} dir={dir} onChange={refresh} flash={flash} onPipe={(id) => { setActivePipe(id); setActiveTask(""); setFlowOpen(false); setInboxOpen(false); setPlanOpen(false); }}
          onNewPipe={() => setModal({ type: "pipeline" })} onClose={closeProject} onPick={pick} recents={recents} onOpen={openDir}
          onOpenTask={(pid, tid) => { setInboxOpen(false); setFlowOpen(false); setPlanOpen(false); setActivePipe(pid); setActiveTask(tid); }}
          onCollapse={() => collapse(true)} inboxCount={(proj.inbox || []).length} inboxActive={inboxOpen} onInbox={() => { setInboxOpen(true); setActiveTask(""); setFlowOpen(false); setPlanOpen(false); if (!confettiShown.current && (proj.inbox || []).length === 0) { confettiShown.current = true; fireConfetti(); } }}
          planActive={planOpen} onPlan={() => { setPlanOpen(true); setInboxOpen(false); setFlowOpen(false); setActiveTask(""); }} />
      )}
      {!sideCollapsed && <ColGrip side="left" {...sideGrip} style={{ left: sideW - 3 }} />}
      <div className="main">
        {planOpen ? (
          <PlanView dir={dir} proj={proj} runningTasks={runningTasks} flash={flash} onChange={refresh} {...topbarNav}
            onOpenTask={(pid, tid) => { setPlanOpen(false); setActivePipe(pid); setActiveTask(tid); }} />
        ) : inboxOpen ? (
          <Inbox dir={dir} proj={proj} onChange={refresh} flash={flash} {...topbarNav}
            onOpenTask={(pid, tid) => { setInboxOpen(false); setActivePipe(pid); refresh().then(() => setActiveTask(tid)); }} />
        ) : flowOpen ? (
          <PipelineFlow dir={dir} proj={proj} pipeline={pipeline} tools={tools} onClose={() => setFlowOpen(false)} onSaved={refresh} flash={flash} {...topbarNav} />
        ) : !task ? (
          <Board dir={dir} pipeline={pipeline} runningTasks={runningTasks} onOpen={setActiveTask} onNewTask={() => setModal({ type: "task" })} onFlow={() => setFlowOpen(true)} onChange={refresh} flash={flash} {...topbarNav} />
        ) : (
          <TaskDetail key={pipeline.id + "/" + task.id} dir={dir} proj={proj} pipeline={pipeline} task={task} tools={tools} runningStages={runningStages} onBack={() => setActiveTask("")} onChange={refresh} flash={flash} {...topbarNav}
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
      {welcomeOpen && <WelcomeDialog onClose={() => { setWelcomeOpen(false); localStorage.setItem(LS.welcome, today()); }} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
