// features/task.jsx — the task detail screen and its rail cards: per-stage
// runner (Stage), auto-advance, the change timeline, dependency/context
// relations (TaskRelations), time-by-stage, and the blast-radius diagram.
import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "../api/client.js";
import { pipelineFlows, specLabel } from "../../../core/domain.js";
import { slug, runPrompt, fmt, workFiles, base, ago } from "../lib/format.js";
import { buildStageRecords, lastRunTool, lastRunModel } from "../lib/record.js";
import { logKey, readLog, appendLog as storeLog } from "../lib/autolog.js";
import { InspectorView, CanvasView, ChatView, StageRunner } from "./views.jsx";
import { Hamburger, ColGrip, useColWidth, Kv, Expandable } from "../ui.jsx";
import { DiffView, FileModal } from "./diff.jsx";
import { TermDrawer } from "./term.jsx";

// where a task's auto-advance setting is remembered (per task, like the other
// view preferences in this screen)
const autoKey = (key) => "bridza.autoAdvance." + key;

export function TaskDetail({ dir, proj, pipeline, task, tools, runningStages, onBack, onChange, onOpenTask, flash, collapsed, onExpandSide }) {
  const stageObjs = task.stages.map((id) => (pipeline.stages || []).find((s) => s.id === id) || { id, name: id });
  // flow handoff: when this task's flow declares `next` and this task is
  // delivered, one click creates the follow-on task there — plan-gated on this
  // one, so the next flow can't start before this one is done.
  const handoff = (() => {
    const own = pipelineFlows(pipeline).find((f) => f.id === task.flow);
    if (!own || !own.next) return null;
    const tp = (proj.pipelines || []).find((p) => p.id === own.next.pipeline);
    const tf = tp && pipelineFlows(tp).find((f) => f.id === own.next.flow);
    return tp && tf ? { tp, tf } : null;
  })();
  const delivered = task.finalized || (task.stages.length > 0 && task.stages.every((s) => task.tracking[s] && task.tracking[s].status === "done"));
  const followOn = async () => {
    const id = (slug(task.title || task.id).slice(0, 30) + "-" + handoff.tf.id).slice(0, 40);
    const r = await api.createTask(dir, { pipeline: handoff.tp.id, id, title: task.title, flow: handoff.tf.id, dependsOn: pipeline.id + "/" + task.id });
    if (!r.ok) return flash(r.error);
    flash(`follow-on task created in ${handoff.tp.label} · ${handoff.tf.name} — gated on this task`, 5000);
    onChange();
    onOpenTask(handoff.tp.id, r.id);
  };
  const [timeline, setTimeline] = useState([]);
  const [tlOpen, setTlOpen] = useState(true);
  const [openStage, setOpenStage] = useState(() => task.stages.find((s) => !(task.tracking[s] && task.tracking[s].status === "done")) || task.stages[0]);
  const [stageTime, setStageTime] = useState({});
  const [stageIdle, setStageIdle] = useState({});   // #14 — idle seconds per stage (open, no typing, no run)
  const idleRef = useRef({});
  const activityRef = useRef(Date.now());   // last keystroke/interaction on the open stage
  const runningRef = useRef(runningStages);
  const markActivity = useCallback(() => { activityRef.current = Date.now(); }, []);
  const [diffCommit, setDiffCommit] = useState(null);
  const [diffBranch, setDiffBranch] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [conflict, setConflict] = useState(null);   // #15 — paused merge conflict { files, dir, target }
  const [fileOpen, setFileOpen] = useState(null);   // #7 — path of a file opened in the editor
  const [automating, setAutomating] = useState(false);   // a chained run is live right now
  // …distinct from the auto-advance SETTING: on by default, per task, remembered
  // across navigation/reload. It only says whether a finished stage may carry the
  // task on to the next one; it never starts anything by itself.
  const [autoAdvance, setAutoAdvance] = useState(true);
  // ONE task-level terminal log: everything any run of this task prints (stage
  // runs + auto-advance) lands here — shown in the auto-advance card. The log
  // lives in a module store keyed pipeline/task, so it survives navigating away
  // and back: component state alone would die with the unmount while the
  // background runner keeps going.
  const [taskLog, setTaskLog] = useState("");
  const key = logKey(pipeline.id, task.id);
  // `key` is the server's identity (matches runningStages / plan keys); browser-side
  // stores prefix the repo too — two repos can hold the same pipeline/task id.
  const skey = dir + "|" + key;
  const appendLog = useCallback((s) => setTaskLog(storeLog(skey, s)), [skey]);
  const [showTerm, setShowTerm] = useState(false);   // full-height PTY replaces the stage list
  // task-detail view mode: the classic stacked Stages, or one of the three new
  // read/audit views (Inspector / Canvas / Chat) — all read the unified record.
  const [view, setView] = useState(() => { const v = localStorage.getItem("bridza.taskView:" + skey); return ["stages", "inspector", "canvas", "chat"].includes(v) ? v : "stages"; });
  const [activeStage, setActiveStage] = useState("");   // selection for inspector/canvas
  const setTaskView = useCallback((v) => { setShowTerm(false); setView(v); try { localStorage.setItem("bridza.taskView:" + skey, v); } catch (e) { /* ignore */ } }, [skey]);
  const [railW, railGrip] = useColWidth("bridza.railW", 332, { min: 240, max: 560, side: "right" });   // #3
  const [railHidden, setRailHidden] = useState(() => localStorage.getItem("bridza.railHidden:" + skey) === "1");
  const toggleRail = () => setRailHidden((h) => { const n = !h; try { localStorage.setItem("bridza.railHidden:" + skey, n ? "1" : "0"); } catch (e) { /* ignore */ } return n; });
  const [plan, setPlan] = useState(null);   // project plan: deps (blocks/needs) + focused-context links
  const [branches, setBranches] = useState([]);   // local branches — the menu for the task's target
  const autoRef = useRef(null);
  const timeRef = useRef({}); const dirtyRef = useRef(false);
  // changing task: restore THIS task's background-run log from the module store
  // instead of wiping it — the pane keeps showing what the runner did/does even
  // if you left and came back mid-run. Run-related state always resets.
  useEffect(() => {
    setTaskLog(readLog(skey)); setShowTerm(false); setAutomating(false);
    setAutoAdvance(localStorage.getItem(autoKey(skey)) !== "0");   // default ON
  }, [skey]);
  // another window flipped THIS task's auto-advance → follow it here, so a stage
  // finishing in this window never chains on a setting the user just turned off.
  useEffect(() => {
    const f = (e) => { if (e.key === autoKey(skey)) setAutoAdvance(e.newValue !== "0"); };
    window.addEventListener("storage", f);
    return () => window.removeEventListener("storage", f);
  }, [skey]);
  const toggleAutoAdvance = (on) => {
    setAutoAdvance(on);
    try { localStorage.setItem(autoKey(skey), on ? "1" : "0"); } catch (e) { /* ignore */ }
  };
  useEffect(() => {
    let on = true;
    api.getPlan(dir).then((r) => { if (on) setPlan((r && r.plan) || { deps: {}, milestones: [], pos: {}, links: {} }); });
    return () => { on = false; };
  }, [dir, key]);
  useEffect(() => {
    let on = true;
    api.getBranches(dir).then((r) => { if (on) setBranches((r && r.branches) || []); });
    return () => { on = false; };
  }, [dir, key]);
  const targetName = task.target || "main";

  const loadTimeline = useCallback(() => api.getTimeline(dir, pipeline.id, task.id).then((r) => setTimeline(r.commits || [])), [dir, pipeline.id, task.id]);
  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  // The brief (context.md): the task's intent in full. Not part of the project
  // state payload — it's prose per task, loaded on open.
  const [brief, setBrief] = useState("");
  const loadBrief = useCallback(() => api.getContext(dir, pipeline.id, task.id).then((r) => setBrief((r && r.text) || "")), [dir, pipeline.id, task.id]);
  useEffect(() => { setBrief(""); loadBrief(); }, [loadBrief]);
  // context.md opens with "# <title>"; the title is already in the header and
  // in the prompt, so strip it and keep the body.
  const briefBody = String(brief || "").replace(/^\s*#[^\n]*\n+/, "").trim();

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
      const idle = (r.time && r.time.__idle) || {};   // #14 — hydrate the idle share
      setStageIdle(idle); idleRef.current = idle;
    });
    return () => { on = false; };
  }, [dir, pipeline.id, task.id]);
  useEffect(() => { timeRef.current = stageTime; }, [stageTime]);
  useEffect(() => { idleRef.current = stageIdle; }, [stageIdle]);
  useEffect(() => { runningRef.current = runningStages; }, [runningStages]);
  useEffect(() => { if (autoRef.current) autoRef.current.scrollTop = autoRef.current.scrollHeight; }, [taskLog, showTerm]);

  // live 1s clock on the open stage — that's where time is being spent. #14 —
  // each second is WORK (a run is live, or you typed in the last 20s) or IDLE
  // (stage open, just reading / left there). Only the idle share is tracked
  // separately; work = total − idle.
  useEffect(() => {
    if (!openStage) return;
    const t = setInterval(() => {
      dirtyRef.current = true;
      const liveHere = runningRef.current && runningRef.current.has(pipeline.id + "/" + task.id + "/" + openStage);
      const idle = !liveHere && (Date.now() - activityRef.current > 20000);
      setStageTime((p) => ({ ...p, [openStage]: (p[openStage] || 0) + 1 }));
      if (idle) setStageIdle((p) => ({ ...p, [openStage]: (p[openStage] || 0) + 1 }));
    }, 1000);
    return () => clearInterval(t);
  }, [openStage, pipeline.id, task.id]);

  // flush to .bridza/.cache/time.json every 10s, on stage switch, and on unmount
  useEffect(() => {
    const flush = () => { if (!dirtyRef.current) return; dirtyRef.current = false; api.saveTime(dir, pipeline.id, task.id, { ...timeRef.current, __idle: idleRef.current }); };
    const t = setInterval(flush, 10000);
    window.addEventListener("beforeunload", flush);
    return () => { clearInterval(t); window.removeEventListener("beforeunload", flush); flush(); };
  }, [dir, pipeline.id, task.id]);

  const total = Object.values(stageTime).reduce((a, b) => a + b, 0);
  const done = task.stages.filter((s) => (task.tracking[s] || {}).status === "done").length;
  // the commit carrying a run's changes: new model = the stage's single commit
  // (newest timeline entry for that stage); old branches recorded a promptCommit
  // whose immediate successor was the result commit.
  const resultFor = (r, stageId) => {
    if (r && r.promptCommit) { const i = timeline.findIndex((c) => c.sha === r.promptCommit); return i > 0 ? timeline[i - 1].sha : null; }
    const c = timeline.find((x) => x.stage === stageId && (x.kind === "done" || x.kind === "failed"));
    return c ? c.sha : null;
  };

  const finalize = async (resolveMain, mainCommitMessage) => {
    flash("finalizing… (committing any pending changes)", 8000);   // stays while opencode writes the message
    const r = await api.finalize(dir, { pipeline: pipeline.id, task: task.id, resolveMain, mainCommitMessage });
    if (r.conflict) { setConflict(r); flash(`merge conflict on ${r.target} — ${r.files.length} file${r.files.length === 1 ? "" : "s"} need resolving`, 5000); return; }
    if (r.needsResolve) { setResolveOpen(true); flash("your checkout of main has uncommitted changes — review and resolve below", 4000); return; }
setResolveOpen(false);
    if (r.ok) { flash(r.autocommit ? `committed "${r.autocommit.message}" + merged → ${r.target}` : (r.mainResolved ? `${r.mainResolved.action === "stash" ? "stashed main" : "committed main"} + merged → ${r.target}` : `merged → ${r.target}`), 4800); onChange(); }
    else flash(r.error, 4800);
  };
  const createPR = async () => {
    flash("creating PR…", 6000);
    const r = await api.createPR(dir, { pipeline: pipeline.id, task: task.id, target: targetName });
    if (!r.ok) { flash(r.error, 5000); return; }
    flash(r.existing ? `PR already exists` : `PR created`, 4000);
    if (r.url) window.open(r.url, "_blank");
  };
  const openVscode = async () => {
    flash("opening VS Code…");
    const r = await api.openEditor(dir, { pipeline: pipeline.id, task: task.id, workingDir: pipeline.workingDir });
    flash(r.ok ? `opened ${r.branch} in VS Code` : r.error);
  };
  // #15 — a merge hit a conflict: hand the RESOLUTION over to VS Code at the
  // exact directory where the merge is paused (its Source Control shows the UU
  // entries as "Merge Changes" with Accept Current / Incoming / Both), then
  // finish or abort the paused merge from here — the loop stays app-driven.
  const openConflictInVscode = async () => {
    flash("opening the conflict in VS Code…");
    const r = await api.openConflict(dir, { dir: conflict && conflict.dir });
    flash(r.ok ? "opened the conflicted checkout in VS Code — pick what to keep per file" : r.error, 6000);
  };
  const finishConflictHere = async () => {
    const r = await api.finishConflict(dir, { dir: conflict && conflict.dir, pipeline: pipeline.id, task: task.id, target: conflict && conflict.target });
    if (r.ok) { setConflict(null); flash(`merge completed → ${r.target} updated`, 4800); onChange(); return; }
    if (r.stillConflicting) flash(`still ${r.files.length} file${r.files.length === 1 ? "" : "s"} to resolve — open VS Code and pick what to keep`, 6000);
    else flash(r.error || "couldn't finish the merge", 4800);
  };
  const abortMerge = async () => {
    if (!window.confirm("Abort this merge? The paused merge is cancelled and the target branch is left exactly as it was before.")) return;
    const r = await api.abortConflict(dir, { dir: conflict && conflict.dir, pipeline: pipeline.id, task: task.id });
    if (r.ok) { setConflict(null); flash("merge aborted — nothing changed", 4000); onChange(); }
    else flash(r.error || "couldn't abort the merge", 4800);
  };
  // Automate: run every stage of this task back-to-back. The prompt for each
  // stage is assembled from the task intent + the stage's own hint/system prompt.
  // `from` is the first stage auto-advance may touch: chaining after a finished
  // stage passes the NEXT index, so an earlier (or never-started) stage is never
  // pulled into the run — you can't auto-advance backwards, least of all into
  // the first stage.
  const automate = async (from = 0) => {
    if (automating) return;
    // Send every stage from `from` on, in order — the SERVER resumes from the
    // first incomplete one by re-checking the branch tip per stage (this client
    // snapshot can be stale).
    const bodies = stageObjs.slice(from).map((def) => {
      // the agent+model saved for the stage (task.routing) wins, then the one it
      // last ran on, then the stage default — so auto-advance never resets a pick
      const routed = (task.routing && task.routing[def.id]) || {};
      const runs = (task.tracking[def.id] || {}).runs;
      return {
        pipeline: pipeline.id, task: task.id, stage: def.id,
        tool: routed.tool || lastRunTool(runs) || def.tool || "opencode",
        model: routed.model || lastRunModel(runs) || "",
        prompt: runPrompt(pipeline, task, def, [task.title && ("Task: " + task.title), briefBody, def.hint].filter(Boolean).join("\n\n") || ("Complete the " + (def.name || def.id) + " stage.")),
        system: def.systemPrompt || "", shell: def.shell || [], workingDir: pipeline.workingDir || ".",
        stageName: def.name || def.id, taskTitle: task.title,
      };
    });
    if (!bodies.length) { flash("This task has no stages.", 4000); return; }
    setAutomating(true);
    const append = appendLog;
    append(`\n⚡ auto-advance · ${bodies.length} stage(s)\n`);
    flash("Auto-advancing — resuming from the first incomplete stage…", 6000);
    const end = await api.automate(dir, { stages: bodies }, (e) => {
      if (e.t === "out") append(e.d);
      else if (e.t === "cmd") append("\n$ " + e.cmd + "\n");
      else if (e.t === "session") append(`\n⛁ opencode session ${e.sessionId}\n`);
      else if (e.t === "commit") append(`● ${e.phase} ${(e.sha || "").slice(0, 7)}\n`);
      else if (e.t === "automate" && e.phase === "skip") append(`↷ ${e.index + 1}/${e.count} · ${e.name} — already done, skipped\n`);
      else if (e.t === "automate" && e.phase === "stage") append(`\n━━ ${e.index + 1}/${e.count} · ${e.name} ━━\n`);
      else if (e.t === "automate" && e.phase === "stage-done") append(`✓ ${e.stage}: ${e.status} (exit ${e.exit})${e.sessionId ? " · " + e.sessionId : ""}\n`);
    });
    setAutomating(false);
    loadTimeline(); onChange();
    if (end && end.exit === 0) flash("Automate complete — all stages done", 5000);
    else if (end) flash(`Automate stopped at ${end.stoppedAt || "?"}: ${end.error || "failed"}`, 6000);
  };

  // ⚡ AUTO-ADVANCE IS A SETTING, ON BY DEFAULT — never an auto-START. Opening a
  // task runs nothing: a stage only begins because a human pressed ▸ Run on it.
  // Once a stage the user started finishes, this carries the task FORWARD
  // through the stages after it (#39). So the first stage of a task always waits
  // for a person, and a failed/stopped stage doesn't silently chain on.
  const stageDone = (end, stageId) => {
    onChange(); loadTimeline();
    if (!autoAdvance || automating || task.finalized) return;
    if (!end || end.status !== "done") return;
    const next = task.stages.indexOf(stageId) + 1;
    if (next <= 0 || next >= task.stages.length) return;   // unknown stage, or the last one
    if (task.stages.slice(next).every((s) => (task.tracking[s] || {}).status === "done")) return;
    // another stage of this task already running (another window) → let it be.
    // The stage that just finished doesn't count: this snapshot of the live set
    // can still list it, the run is over.
    const liveHere = runningStages && [...runningStages].some((k) => k.startsWith(key + "/") && k !== key + "/" + stageId);
    if (!liveHere) automate(next);
  };

  // #15 — commit history (the timeline) leads the rail, ahead of blast radius.
  const timelineCard = (
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
            // visual bucket: done (+old result) = green, failed = red, prompt (old model) = blue
            const vis = kind === "failed" ? "failed" : kind === "prompt" ? "prompt" : "result";
            const files = workFiles(c.files);
            const churn = files.reduce((a, f) => ({ add: a.add + f.add, del: a.del + f.del }), { add: 0, del: 0 });
            return (
              <div className={"tl click " + vis} key={c.sha} onClick={() => setDiffCommit(c.sha)} title="View file changes">
                <span className="tl-rail"><i className="tl-dot" /></span>
                <div className="tl-body">
                  <div className="tl-top">
                    {c.stage && <span className={"tl-stage " + vis}>{c.stage}</span>}
                    <span className={"sub " + vis}>{c.subject.replace(/^bridza\([^)]*\):\s*/, "")}</span>
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
  );

  // The task-level run log card: it shows whenever there's something to look at
  // — while auto-advancing, while one of this task's runs is live in the
  // background (here or in another window), or a log retained from an earlier
  // run. So the pane is never a flash that vanishes the moment you navigate.
  const runLogCard = (automating || taskLive || taskLog) ? (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="side-label" style={{ padding: "0 0 8px" }}>
        {automating ? "⚡ Auto-advancing · " : taskLive ? "⚡ LIVE RUN · " : "⚡ Auto-advance · "}
        <button className="btn ghost sm" onClick={() => setShowTerm(true)}>open worktree terminal →</button>
      </div>
      <div className="term" ref={autoRef}>{taskLog || "…"}</div>
    </div>
  ) : null;

  return (
    <>
      <div className="topbar">
        <div className="row">
          <Hamburger collapsed={collapsed} onExpandSide={onExpandSide} />
          <button className="btn ghost" onClick={onBack}>← {pipeline.label}</button>
          {/* one line, ellipsised: a long title must never push the toolbar
              around — the full text lives in the Brief card below */}
          <h1 className="task-title" style={{ marginLeft: 6 }} title={task.title}>{task.ref ? <span className="tref">#{task.ref}</span> : null}{task.title}</h1>
        </div>
        <div className="row">
          <div className="seg" title="How to view this task's stages. Stages: the classic runner. Inspector / Canvas / Chat: read & audit what each stage did. Terminal: a real shell in this task's worktree.">
            <button className={!showTerm && view === "stages" ? "on" : ""} onClick={() => setTaskView("stages")}>Stages</button>
            <button className={!showTerm && view === "inspector" ? "on" : ""} onClick={() => setTaskView("inspector")}>Inspector</button>
            <button className={!showTerm && view === "canvas" ? "on" : ""} onClick={() => setTaskView("canvas")}>Canvas</button>
            <button className={!showTerm && view === "chat" ? "on" : ""} onClick={() => setTaskView("chat")}>Chat</button>
            <button className={showTerm ? "on" : ""} onClick={() => setShowTerm(true)}>⌨ Terminal</button>
          </div>
          {taskLive && (
            <button className="btn danger" onClick={async () => {
              const r = await api.stopRun(dir, { pipeline: pipeline.id, task: task.id });
              flash(r.ok ? `stopped ${r.stopped} run(s)` : (r.error || "nothing to stop"), 4000);
              onChange();
            }} title="Kill this task's live run(s) — the stop is recorded on the timeline">⏹ Stop</button>
          )}
          <button className="btn" onClick={openVscode} title="Open this task's branch worktree in a new VS Code window"><span style={{ color: "var(--accent)" }}>⧉</span> Open in VS Code</button>
          <label className="switch" title="Auto-advance: once a stage you started finishes, AI runs each remaining stage after it (keeps going in the background). Start the task yourself with ▸ Run on its first stage — this never starts anything on its own.">
            <input type="checkbox" checked={autoAdvance} disabled={automating || task.finalized} onChange={(e) => toggleAutoAdvance(e.target.checked)} />
            <span className="slider" /><span className="switch-lbl">{automating ? "⚡ Auto-advancing…" : "⚡ Auto-advance"}</span>
          </label>
          {handoff && (
            <button className="btn" onClick={followOn} disabled={!delivered}
              title={delivered ? `Create the follow-on task in ${handoff.tp.label} · ${handoff.tf.name}, plan-gated on this task` : `This flow hands off to ${handoff.tp.label} · ${handoff.tf.name} — finish all stages here first`}>
              → {handoff.tf.name}
            </button>
          )}
          <button className="btn primary" onClick={createPR} title={`Create a PR for ${task.branch} → ${targetName}`}>Create PR</button>
          <button className="btn" onClick={() => finalize()} disabled={task.finalized} title={`Merge this task's branch into ${targetName}`}>{task.finalized ? "Finalized" : `Finalize → ${targetName}`}</button>
        </div>
      </div>
      <div className="content detail" style={{ gridTemplateColumns: railHidden ? "1fr" : `1fr ${railW}px`, position: "relative" }}>
        {/* grip sits on the column split: right-padding (22) + railW + half the
            grid gap (9), minus the 4px from grip width to its hairline. Unlike
            the sidebar grid, .content.detail has padding + gap, so railW-3 alone
            (correct there) lands ~30px into the rail here. */}
        {!railHidden && <ColGrip side="right" {...railGrip} style={{ right: railW + 27 }} />}
        <button className="rail-toggle" onClick={toggleRail} title={railHidden ? "Show details panel" : "Hide details panel"}>{railHidden ? "‹" : "›"}</button>
        {showTerm ? (
          <div className="stages">
            <TermDrawer full dir={dir} pipeline={pipeline.id} task={task.id} onClose={() => setShowTerm(false)} />
          </div>
        ) : view !== "stages" ? (
          <div className="stages">
            {runLogCard}
            {(() => {
              const records = buildStageRecords(pipeline, task, timeline, runningStages, stageTime);
              const runner = { dir, pipeline, task, tools, flash, brief: briefBody, onLog: appendLog, onActivity: markActivity, onDone: stageDone, runningStages };
              const shared = { onDiff: setDiffCommit, onOpenFile: setFileOpen, runner };
              const activeId = activeStage || openStage || (records[0] && records[0].id);
              if (view === "inspector") return <InspectorView records={records} activeId={activeId} setActiveId={setActiveStage} {...shared} />;
              if (view === "canvas") return <CanvasView records={records} activeId={activeStage} setActiveId={setActiveStage} {...shared} />;
              return <ChatView records={records} {...shared} />;
            })()}
          </div>
        ) : (
        <div className="stages">
          <Brief dir={dir} pipeline={pipeline} task={task} text={brief} onSaved={(t) => { setBrief(t); loadTimeline(); }} flash={flash} />
          {runLogCard}
          {stageObjs.map((def, i) => {
            // #7 — a stage's inputs are the previous stage's produced files
            const prevId = i > 0 ? task.stages[i - 1] : null;
            const prevDone = prevId ? ((task.tracking[prevId] || {}).runs || []).filter((r) => r.status === "done" && r.files && r.files.length).slice(-1)[0] : null;
            const inputFiles = prevDone ? prevDone.files : [];
            return (
            <Stage key={def.id} dir={dir} pipeline={pipeline} task={task} def={def} track={task.tracking[def.id] || { status: "idle" }}
              live={runningStages && runningStages.has(pipeline.id + "/" + task.id + "/" + def.id)} brief={briefBody}
              tools={tools} seconds={stageTime[def.id] || 0} open={openStage === def.id} inputFiles={inputFiles} onOpenFile={setFileOpen} onActivity={markActivity}
              onToggle={() => setOpenStage(openStage === def.id ? "" : def.id)}
              onDone={stageDone} flash={flash} onDiff={setDiffCommit} resultFor={resultFor} onLog={appendLog} />
            );
          })}
        </div>
        )}

        {!railHidden && (
        <aside className="rail">
          {timelineCard}

          <BlastRadius dir={dir} pipeline={pipeline.id} task={task.id} refreshKey={timeline.length} onOpen={() => setDiffBranch(true)} />

          <div className="card">
            <div className="side-label" style={{ padding: "0 0 8px" }}>Task</div>
            {task.ref && <Kv k="Ref" v={<span className="mono">#{task.ref}</span>} />}
            <Kv k="Status" v={task.finalized ? "finalized" : task.status} />
            <Kv k="Branch" v={<span className="mono" style={{ fontSize: 11 }}>{task.branch}</span>} />
            <div className="kv" title="The branch this task's work lands on — forks from it, reviews diff against it, finalize merges into it">
              <span>Target</span>
              <select className="input" style={{ height: 26, fontSize: 12, width: 130 }} value={targetName} disabled={task.finalized}
                onChange={async (e) => {
                  const t = e.target.value; if (!t || t === targetName) return;
                  const r = await api.retargetTask(dir, { pipeline: pipeline.id, task: task.id, target: t });
                  if (r.ok) flash(`target → ${t} — the review now diffs against it and finalize merges into it`, 4200);
                  else flash(r.error);
                  onChange();
                }}>
                {[...new Set([targetName, ...branches])].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="kv"><span>Type</span>
              <input className="input" style={{ height: 26, fontSize: 12, width: 130, textAlign: "right" }} defaultValue={task.type || ""} placeholder="—" disabled={task.finalized}
                onBlur={async (e) => { const v = e.target.value.trim(); if (v === (task.type || "")) return; const r = await api.retargetTask(dir, { pipeline: pipeline.id, task: task.id, type: v }); if (r.ok) onChange(); else flash(r.error); }} />
            </div>
            {pipeline.flows && pipeline.flows.length > 1 && (
              <div className="kv"><span>Flow</span>
                <select className="input" style={{ height: 26, fontSize: 12, width: 130 }} value={task.flow || ""} disabled={task.finalized}
                  onChange={async (e) => {
                    const nf = e.target.value; if (!nf || nf === task.flow) return;
                    const fl = pipeline.flows.find((f) => f.id === nf);
                    if (!window.confirm(`Switch this task to the “${fl ? fl.name : nf}” flow?\n\nThe current flow's progress is DISCARDED — every stage commit on ${task.branch} is dropped and the task restarts with the new flow's stages.`)) { e.target.value = task.flow || ""; return; }
                    const r = await api.retargetTask(dir, { pipeline: pipeline.id, task: task.id, flow: nf });
                    if (r.ok) { flash(r.removed ? `flow → ${fl ? fl.name : nf} · ${r.removed} stage commit${r.removed === 1 ? "" : "s"} discarded` : "flow changed", 4000); onChange(); loadTimeline(); }
                    else flash(r.error);
                  }}>
                  {pipeline.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            )}
            <Kv k="Output" v={task.outputMode || "—"} />
            <div className="kv" title="Reuse ONE LLM session per tool across this task's stages (context carries over). Rolling back a stage resets it.">
              <span>Reuse LLM session</span>
              <input type="checkbox" checked={!!task.reuseSession} disabled={task.finalized}
                onChange={async (e) => { const r = await api.setTaskReuse(dir, { pipeline: pipeline.id, task: task.id, on: e.target.checked }); if (r.ok) { flash(e.target.checked ? "session reuse on — one session per tool" : "session reuse off", 3500); onChange(); } else flash(r.error); }} />
            </div>
            <Kv k="Stages" v={`${done}/${task.stages.length} done`} />
            <Kv k="Time tracked" v={fmt(total)} />
            <button className="btn ghost sm" style={{ color: "var(--danger)", width: "100%", marginTop: 10, justifyContent: "center" }}
              title="Removes the task from the app and database. Git history (the task branch) is kept."
              onClick={async () => {
                if (!window.confirm(`Delete ${task.ref ? "#" + task.ref + " " : ""}“${task.title}”?\n\nThis removes the task from the database (a "delete task info" commit). Git history — branch ${task.branch} — is kept.`)) return;
                const r = await api.deleteTask(dir, { pipeline: pipeline.id, task: task.id });
                if (r.ok) { flash("task deleted — git history kept", 4500); onBack(); onChange(); } else flash(r.error);
              }}>🗑 Delete task</button>
          </div>

          <TaskRelations dir={dir} proj={proj} taskKey={key} taskRef={task.ref} plan={plan} setPlan={setPlan} flash={flash} onOpenTask={onOpenTask} />

          <TimeByStage stages={stageObjs} stageTime={stageTime} stageIdle={stageIdle} activeId={openStage} total={total} />
        </aside>
        )}
      </div>
      {diffCommit && <DiffView dir={dir} commit={diffCommit} commits={timeline} onCommit={setDiffCommit} pipeline={pipeline.id} task={task.id} flash={flash} onEdited={() => { onChange(); loadTimeline(); }} onClose={() => setDiffCommit(null)} />}
      {diffBranch && <DiffView dir={dir} branch pipeline={pipeline.id} task={task.id} flash={flash} onEdited={() => { onChange(); loadTimeline(); }} onClose={() => setDiffBranch(false)} />}
      {resolveOpen && <DiffView dir={dir} working pipeline={pipeline.id} task={task.id} flash={flash} onResolve={(action, m) => finalize(action, m)} onClose={() => setResolveOpen(false)} />}
      {conflict && <ConflictDialog conflict={conflict} openInVscode={openConflictInVscode} onFinish={finishConflictHere} onAbort={abortMerge} onClose={() => setConflict(null)} />}
      {fileOpen && <FileModal dir={dir} pipeline={pipeline.id} task={task.id} path={fileOpen} flash={flash} onEdited={() => { onChange(); loadTimeline(); }} onSaved={() => { onChange(); loadTimeline(); }} onClose={() => setFileOpen(null)} />}
    </>
  );
}

/* #15 — a merge hit a conflict. The reporter's ask: don't make the user drop to
   a terminal. Git is 'driven by the app' — the conflict is surfaced here, the
   user is handed off to VS Code with the parameters already set (a window on the
   EXACT directory where the merge is paused, so Source Control shows Accept
   Current / Accept Incoming / Accept Both), and resolution is finished -- or the
   merge abandoned -- back in this dialog. In-app accept buttons are a natural
   follow-up; VS Code already has the eye-free 3-way editor baked in. */
function ConflictDialog({ conflict, openInVscode, onFinish, onAbort, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="diffwin" onClick={(e) => e.stopPropagation()}>
        <div className="diff-hd">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--danger)", whiteSpace: "nowrap" }}>CONFLICT</span>
            <b style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 13 }}>
              {conflict.files.length} file{conflict.files.length === 1 ? "" : "s"} conflict on {conflict.target}
            </b>
          </div>
          <div className="row">
            <button className="btn ghost sm" onClick={onClose} title="Keep the merge paused and close this dialog">✕</button>
          </div>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            The merge into <code className="mono">{conflict.target}</code> needs a decision on each file below.
            Open them in VS Code and pick what to keep — <b>Accept Current</b>, <b>Accept Incoming</b> or
            <b> Accept Both</b> — then finish the merge here. No terminal needed.
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {conflict.files.map((f) => <code key={f} className="mono" style={{ fontSize: 11, padding: "2px 6px", background: "var(--bg-2)", borderRadius: 4, border: "1px solid var(--bd)" }}>{f}</code>)}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={openInVscode} title="Opens a VS Code window on the exact folder where the merge is paused — its Source Control lists these files as 'Merge Changes'">⧉ Resolve in VS Code</button>
            <button className="btn primary" onClick={onFinish} title="Every conflict resolved in the editor — commit the finished merge and update main">✓ Finish merge</button>
            <button className="btn danger" onClick={onAbort} title="Cancel the merge; the target branch returns to how it was before">Abort merge</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* The brief — the task's context.md, i.e. the idea exactly as it was captured.
   The topbar title is only a headline, so this is where the detail lives:
   clamped to a few lines with a chevron to expand, and editable in place. It
   is what every stage prompt is seeded from, so keeping it whole matters. */
function Brief({ dir, pipeline, task, text, onSaved, flash }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const body = String(text || "").replace(/^\s*#[^\n]*\n+/, "").trim();
  const heading = "# " + task.title + "\n\n";
  const save = async () => {
    const next = heading + draft.trim() + "\n";
    const r = await api.saveContext(dir, { pipeline: pipeline.id, task: task.id, text: next });
    if (!r.ok) return flash(r.error);
    setEditing(false); onSaved(next); flash("brief saved");
  };
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="spread" style={{ marginBottom: body || editing ? 8 : 0 }}>
        <div className="side-label" style={{ padding: 0 }} title="The task's intent (context.md) — fed to every stage prompt">📝 Brief</div>
        {editing ? (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn primary sm" onClick={save}>Save</button>
          </div>
        ) : (
          <button className="btn ghost sm" onClick={() => { setDraft(body); setEditing(true); }}>✎ Edit</button>
        )}
      </div>
      {editing ? (
        <textarea className="input" style={{ minHeight: 160 }} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
      ) : body ? (
        <Expandable text={body} lines={6} style={{ fontSize: 13.5, lineHeight: 1.55 }} />
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>No brief yet — ✎ Edit to describe what this task is for.</p>
      )}
    </div>
  );
}

/* Relations rail card: ⛔ what this task needs / 🧱 the tasks BLOCKED BY this
   one (from the plan's dependency network), and 🎯 focused context — other
   tickets attached to this task, whose intent is injected into every stage
   prompt so it shapes the work. */
function TaskRelations({ dir, proj, taskKey, plan, setPlan, flash, onOpenTask }) {
  if (!plan) return null;
  const all = [];
  (proj.pipelines || []).forEach((p) => (p.tasks || []).forEach((t) => all.push({
    key: p.id + "/" + t.id, pid: p.id, tid: t.id, ref: t.ref, title: t.title, pipe: p.label,
    done: t.finalized || (t.stages.length > 0 && t.progress === 100),
  })));
  const byKey = new Map(all.map((t) => [t.key, t]));
  const gate = plan.deps[taskKey] || {};
  const needs = [...(gate.all || []), ...(gate.any || [])].filter((k) => byKey.has(k));
  const blocks = all.filter((t) => { const g = plan.deps[t.key] || {}; return (g.all || []).includes(taskKey) || (g.any || []).includes(taskKey); });
  const links = (plan.links && plan.links[taskKey]) || [];
  const saveLinks = (list) => {
    const next = { ...plan, links: { ...(plan.links || {}), [taskKey]: list } };
    setPlan(next);
    api.savePlan(dir, { links: { [taskKey]: list }, merge: true }).then((r) => { if (!r.ok) flash(r.error || "couldn't save links"); });
  };
  // #12 — dependencies are editable right here (mirrors the Plan board): new deps
  // go into the ALL (AND) group; the plan.json save commits + gates run-time.
  const saveDeps = (g) => {
    const next = { ...plan, deps: { ...plan.deps, [taskKey]: g } };
    setPlan(next);
    api.savePlan(dir, { deps: { [taskKey]: g }, merge: true }).then((r) => { if (!r.ok) flash(r.error || "couldn't save dependencies"); });
  };
  const addNeed = (depKey) => { if (!depKey || depKey === taskKey || needs.includes(depKey)) return; saveDeps({ ...gate, all: [...(gate.all || []), depKey] }); };
  const rmNeed = (depKey) => saveDeps({ all: (gate.all || []).filter((x) => x !== depKey), any: (gate.any || []).filter((x) => x !== depKey) });
  const name = (k) => { const t = byKey.get(k); return t ? (t.ref ? "#" + t.ref + " " : "") + t.title : k; };
  const row = (k, extra) => {
    const t = byKey.get(k);
    return (
      <div className="dep-row" key={k}>
        <span className={"lg " + (t && t.done ? "done" : "blocked")} />
        <span className="dep-name click" title={k} onClick={() => t && onOpenTask(t.pid, t.tid)}>{name(k)}</span>
        {extra}
      </div>
    );
  };
  return (
    <>
      <div className="card">
        <div className="side-label" style={{ padding: "0 0 6px" }}>Dependencies</div>
        <div className="muted" style={{ fontSize: 11, margin: "2px 0 4px" }}>⛔ waits on</div>
        {needs.map((k) => row(k, <button className="btn ghost sm" onClick={() => rmNeed(k)} title="Remove dependency">×</button>))}
        <select className="input" value="" onChange={(e) => e.target.value && addNeed(e.target.value)}>
          <option value="">＋ add dependency…</option>
          {all.filter((t) => t.key !== taskKey && !needs.includes(t.key))
            .map((t) => <option key={t.key} value={t.key}>{t.pipe} / {name(t.key)}</option>)}
        </select>
        {blocks.length > 0 && <>
          <div className="muted" style={{ fontSize: 11, margin: "8px 0 4px" }}>🧱 blocked by this task</div>
          {blocks.map((t) => row(t.key))}
        </>}
      </div>
      <div className="card">
        <div className="side-label" style={{ padding: "0 0 6px" }}>🎯 Focused context</div>
        <p className="muted" style={{ fontSize: 11.5, margin: "0 0 8px" }}>Attach tickets whose intent should weigh heavily here — it's injected into every stage prompt.</p>
        {links.map((k) => row(k, <button className="btn ghost sm" onClick={() => saveLinks(links.filter((x) => x !== k))}>×</button>))}
        <select className="input" value="" onChange={(e) => e.target.value && saveLinks([...links, e.target.value])}>
          <option value="">＋ add ticket as context…</option>
          {all.filter((t) => t.key !== taskKey && !links.includes(t.key))
            .map((t) => <option key={t.key} value={t.key}>{t.pipe} / {name(t.key)}</option>)}
        </select>
      </div>
    </>
  );
}

function TimeByStage({ stages, stageTime, stageIdle = {}, activeId, total }) {
  const vals = stages.map((s) => stageTime[s.id] || 0);
  const max = Math.max(1, ...vals);
  const peakSec = Math.max(0, ...vals);
  const peak = stages[vals.indexOf(peakSec)] || stages[0];
  const idleTotal = stages.reduce((a, s) => a + Math.min(stageIdle[s.id] || 0, stageTime[s.id] || 0), 0);
  const workTotal = Math.max(0, total - idleTotal);   // #14
  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 8 }}>
        <span className="side-label" style={{ padding: 0 }}>Time by stage</span>
        <b style={{ fontSize: 13 }} title={`${fmt(workTotal)} working · ${fmt(idleTotal)} idle`}>{fmt(total)}</b>
      </div>
      {total > 0 && (
        <div className="tb-split" title="Working: a run is live, or you typed in the last 20s. Idle: stage open, just reading or left there.">
          <span className="tb-work"><i style={{ width: (total ? workTotal / total * 100 : 0) + "%" }} /></span>
          <span className="tb-split-lbl"><span className="work">▪ {fmt(workTotal)} work</span> · <span className="idle">▪ {fmt(idleTotal)} idle</span></span>
        </div>
      )}
      <div className="timeby">
        {stages.map((s) => {
          const sec = stageTime[s.id] || 0, active = s.id === activeId, isPeak = s.id === (peak && peak.id) && sec > 0;
          const idle = Math.min(stageIdle[s.id] || 0, sec), work = sec - idle;
          return (
            <div className={"tb-row" + (isPeak ? " peak" : "") + (active ? " active" : "")} key={s.id}>
              <span className="tb-name">{active && <i className="livedot lead" title="tracking now" />}{s.name}</span>
              <span className="tb-bar" title={sec ? `${fmt(work)} work · ${fmt(idle)} idle` : ""}>
                <i className="work" style={{ width: (work / max * 100) + "%" }} />
                <i className="idle" style={{ width: (idle / max * 100) + "%" }} />
              </span>
              <span className="tb-val">{sec ? fmt(sec) : "—"}</span>
            </div>
          );
        })}
      </div>
      {peakSec > 0 && total > 0 && <div className="tb-note"><b>{peak.name}</b> is the biggest sink — {Math.round(peakSec / total * 100)}% of tracked time{idleTotal > 0 ? ` · ${Math.round(idleTotal / total * 100)}% idle overall` : ""}.</div>}
    </div>
  );
}

/* Blast radius (#9) — a NAMED node-link graph, laid out left→right by hop. The
   changed files (red) sit in the leftmost column; each column to the right is
   one import hop away (orange, fading with distance). Edges are the real import
   links (importer → the file it imports), so a reviewer sees exactly which files
   are connected and how far the change reaches — not anonymous dots on rings.
   Green note = nothing imports the change (contained). */
const hopOpacity = (d) => d <= 1 ? 1 : d === 2 ? 0.8 : d === 3 ? 0.6 : d === 4 ? 0.4 : 0.2;
function BlastRadius({ dir, pipeline, task, refreshKey, onOpen }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let on = true;
    api.getBlast(dir, pipeline, task).then((d) => { if (on) setData(d && d.ok ? d : { seeds: [], impacted: [], edges: [] }); });
    return () => { on = false; };
  }, [dir, pipeline, task, refreshKey]);
  if (!data || data.seeds.length === 0) return null;

  const { seeds, impacted } = data;
  const HOPCAP = 4, COLCAP = 10;   // cap columns/rows so the rail card stays readable
  const nodes = [
    ...seeds.map((s) => ({ path: s.path, hop: 0, add: s.add, del: s.del })),
    ...impacted.map((i) => ({ path: i.path, hop: Math.min(i.distance, HOPCAP) })),
  ];
  const byHop = {};
  nodes.forEach((n) => (byHop[n.hop] = byHop[n.hop] || []).push(n));
  const hops = Object.keys(byHop).map(Number).sort((a, b) => a - b);
  const COLW = 132, ROWH = 24, NW = 118, NH = 18, PADX = 6, PADY = 6;
  const pos = new Map();
  hops.forEach((h, hi) => byHop[h].slice(0, COLCAP).forEach((n, i) => { n.x = PADX + hi * COLW; n.y = PADY + i * ROWH; pos.set(n.path, n); }));
  const width = PADX * 2 + (hops.length - 1) * COLW + NW;
  const height = PADY * 2 + Math.max(1, ...hops.map((h) => Math.min(byHop[h].length, COLCAP))) * ROWH;
  const edges = (data.edges || []).filter((e) => pos.has(e.from) && pos.has(e.to));
  const label = (p) => { const b = base(p); return b.length > 18 ? b.slice(0, 17) + "…" : b; };

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 6 }}>
        <span className="side-label" style={{ padding: 0 }}>Blast radius</span>
        <span className="muted" style={{ fontSize: 11 }}>{seeds.length} changed → <span style={{ color: impacted.length ? "var(--blast-orange)" : "var(--blast-green)" }}>{impacted.length} impacted</span></span>
      </div>
      {impacted.length === 0 ? (
        <div className="blast-contained">✓ contained — nothing in the repo imports the changed files</div>
      ) : (
        <div style={{ overflowX: "auto" }} onClick={onOpen} title="Open all changes on this branch">
          <svg className="blast-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Blast radius graph: which files import this task's changes">
            {edges.map((e, i) => {
              const a = pos.get(e.to), b = pos.get(e.from);            // a = imported, b = importer
              const [L, R] = a.x <= b.x ? [a, b] : [b, a];
              const x1 = L.x + NW, y1 = L.y + NH / 2, x2 = R.x, y2 = R.y + NH / 2, mx = (x1 + x2) / 2;
              return <path key={i} className="blast-link" d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} />;
            })}
            {hops.flatMap((h) => byHop[h].slice(0, COLCAP)).map((n) => (
              <g key={n.path} className="blast-node" transform={`translate(${n.x},${n.y})`}>
                <rect width={NW} height={NH} rx="4" className={n.hop === 0 ? "bn red" : "bn orange"} style={n.hop ? { opacity: hopOpacity(n.hop) } : undefined} />
                <text x="6" y={NH / 2 + 3.5} className="bn-t">{label(n.path)}</text>
                <title>{n.hop === 0 ? `${n.path}  +${n.add} −${n.del}  (changed)` : `${n.path} — ${n.hop} hop${n.hop === 1 ? "" : "s"} from the change`}</title>
              </g>
            ))}
            {hops.map((h, hi) => byHop[h].length > COLCAP && (
              <text key={"m" + h} x={PADX + hi * COLW + 6} y={PADY + COLCAP * ROWH + 2} className="blast-more">+{byHop[h].length - COLCAP} more</text>
            ))}
          </svg>
        </div>
      )}
      <div className="blast-legend">
        <span><i className="bl red" /> changed</span>
        <span><i className="bl orange" /> imports it (→ = import edge, fades per hop)</span>
      </div>
    </div>
  );
}

function Stage({ dir, pipeline, task, def, track, tools, seconds, open, onToggle, onDone, flash, onDiff, resultFor, live, onLog, inputFiles = [], onOpenFile, onActivity, brief = "" }) {
  const runs = track.runs || [];
  const [running, setRunning] = useState(false);   // lifted from StageRunner for the header (stop/tag)
  const [histOpen, setHistOpen] = useState(false);

  // Roll the BRANCH back to before this stage: its commit and every later
  // stage's commit are removed (hard reset) — HEAD moves to the last valid
  // commit, files included. A "delivered" task can be revised from any stage.
  const reopen = async (e) => {
    e.stopPropagation();
    const r = await api.reopenStage(dir, { pipeline: pipeline.id, task: task.id, stage: def.id });
    flash(r.ok ? `${def.name} reopened — ${r.removed || 0} commit${(r.removed || 0) === 1 ? "" : "s"} rolled back, HEAD is at the last valid stage` : r.error, 4600);
    onDone();
  };

  return (
    <div className="stage">
      <div className="stage-hd" onClick={onToggle}>
        <div className="row"><b>{def.name}</b>{def.gate && <span className="muted" style={{ fontSize: 12 }}>· {def.gate}</span>}</div>
        <div className="row">
          {seconds > 0 && <span className="muted mono" style={{ fontSize: 11 }}>{fmt(seconds)}{open && <i className="livedot" />}</span>}
          {(running || live) && (
            <button className="btn ghost sm" style={{ color: "var(--danger)" }} title="Kill this stage's live run — recorded as stopped on the timeline"
              onClick={(e) => { e.stopPropagation(); api.stopRun(dir, { pipeline: pipeline.id, task: task.id, stage: def.id }).then((r) => { flash(r.ok ? def.name + " stopped" : (r.error || "no live run"), 3600); onDone(); }); }}>⏹ Stop</button>
          )}
          {["done", "failed", "stopped"].includes(track.status) && !running && !live && (
            <button className="btn ghost sm" onClick={reopen} title="Revise from this stage — REMOVES this and every later stage's commit (git reset --hard to the last valid commit)">↺ Revise</button>
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
          <StageRunner dir={dir} pipeline={pipeline} task={task} def={def} track={track} tools={tools} live={live} seconds={seconds} brief={brief}
            onDone={onDone} flash={flash} onLog={onLog} onActivity={onActivity} onRunning={setRunning} />
          {def.specs && def.specs.filter((v) => v.key && String(v.value || "").trim()).length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }} title="Appended to every run's prompt as hard requirements">
              specs: {def.specs.filter((v) => v.key && String(v.value || "").trim()).map((v, k) => <code key={k} className="iochip" style={{ marginRight: 4 }}>{specLabel(v.key)}: {v.value}</code>)}
            </div>
          )}
          {inputFiles.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>inputs: {inputFiles.map((f, k) => <code key={k} className="ck" title={"Open " + f} onClick={() => onOpenFile && onOpenFile(f)}>{base(f)}</code>)}</div>
          )}
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
                    const rc = resultFor && resultFor(r, def.id);
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
