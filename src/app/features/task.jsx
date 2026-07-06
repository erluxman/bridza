// features/task.jsx — the task detail screen and its rail cards: per-stage
// runner (Stage), auto-advance, the change timeline, dependency/context
// relations (TaskRelations), time-by-stage, and the blast-radius diagram.
import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "../api/client.js";
import { pipelineFlows, specLabel } from "../../../core/domain.js";
import { slug, runPrompt, fmt, workFiles, base, ago } from "../lib/format.js";
import { Hamburger, ColGrip, useColWidth, Kv } from "../ui.jsx";
import { DiffView } from "./diff.jsx";
import { TermDrawer } from "./term.jsx";

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
  const [diffCommit, setDiffCommit] = useState(null);
  const [diffBranch, setDiffBranch] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [automating, setAutomating] = useState(false);
  // ONE task-level terminal log: everything any run of this task prints (stage
  // runs + auto-advance) lands here — shown in the auto-advance card.
  const [taskLog, setTaskLog] = useState("");
  const appendLog = useCallback((s) => setTaskLog((o) => (o + s).slice(-64000)), []);
  const [showTerm, setShowTerm] = useState(false);   // full-height PTY replaces the stage list
  const [railW, railGrip] = useColWidth("bridza.railW", 332, { min: 240, max: 560, side: "right" });   // #3
  const [railHidden, setRailHidden] = useState(() => localStorage.getItem("bridza.railHidden") === "1");
  const toggleRail = () => setRailHidden((h) => { const n = !h; try { localStorage.setItem("bridza.railHidden", n ? "1" : "0"); } catch (e) { /* ignore */ } return n; });
  const [plan, setPlan] = useState(null);   // project plan: deps (blocks/needs) + focused-context links
  const autoRef = useRef(null);
  const timeRef = useRef({}); const dirtyRef = useRef(false);
  const key = pipeline.id + "/" + task.id;
  useEffect(() => { setTaskLog(""); setShowTerm(false); }, [task.id]);
  useEffect(() => {
    let on = true;
    api.getPlan(dir).then((r) => { if (on) setPlan((r && r.plan) || { deps: {}, milestones: [], pos: {}, links: {} }); });
    return () => { on = false; };
  }, [dir, key]);

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
  useEffect(() => { if (autoRef.current) autoRef.current.scrollTop = autoRef.current.scrollHeight; }, [taskLog, showTerm]);

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
    // Send ALL stages in order — the SERVER resumes from the first incomplete
    // one by re-checking the branch tip per stage (this client snapshot can be
    // stale). NO model is ever passed — each tool runs with its own default.
    const bodies = stageObjs.map((def) => ({
      pipeline: pipeline.id, task: task.id, stage: def.id, tool: def.tool || "opencode",
      prompt: runPrompt(pipeline, task, def, [task.title && ("Task: " + task.title), task.context, def.hint].filter(Boolean).join("\n\n") || ("Complete the " + (def.name || def.id) + " stage.")),
      system: def.systemPrompt || "", shell: def.shell || [], workingDir: pipeline.workingDir || ".",
      stageName: def.name || def.id, taskTitle: task.title,
    }));
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

  return (
    <>
      <div className="topbar">
        <div className="row">
          <Hamburger collapsed={collapsed} onExpandSide={onExpandSide} />
          <button className="btn ghost" onClick={onBack}>← {pipeline.label}</button>
          <h1 style={{ marginLeft: 6 }}>{task.ref ? <span className="tref">#{task.ref}</span> : null}{task.title}</h1>
        </div>
        <div className="row">
          <div className="seg" title="Stages: the pipeline steps · Terminal: a real shell in this task's worktree, full-height">
            <button className={!showTerm ? "on" : ""} onClick={() => setShowTerm(false)}>Stages</button>
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
          <label className="switch" title="Auto-advance: AI runs each remaining stage once the previous one finishes (keeps going in the background)">
            <input type="checkbox" checked={automating} disabled={automating || task.finalized} onChange={(e) => e.target.checked && automate()} />
            <span className="slider" /><span className="switch-lbl">{automating ? "⚡ Auto-advancing…" : "⚡ Auto-advance"}</span>
          </label>
          {handoff && (
            <button className="btn" onClick={followOn} disabled={!delivered}
              title={delivered ? `Create the follow-on task in ${handoff.tp.label} · ${handoff.tf.name}, plan-gated on this task` : `This flow hands off to ${handoff.tp.label} · ${handoff.tf.name} — finish all stages here first`}>
              → {handoff.tf.name}
            </button>
          )}
          <button className="btn" onClick={() => finalize()} disabled={task.finalized}>{task.finalized ? "Finalized" : "Finalize → main"}</button>
        </div>
      </div>
      <div className="content detail" style={{ gridTemplateColumns: railHidden ? "1fr" : `1fr ${railW}px`, position: "relative" }}>
        {!railHidden && <ColGrip side="right" {...railGrip} style={{ right: railW - 3 }} />}
        <button className="rail-toggle" onClick={toggleRail} title={railHidden ? "Show details panel" : "Hide details panel"}>{railHidden ? "‹" : "›"}</button>
        {showTerm ? (
          <div className="stages">
            <TermDrawer full dir={dir} pipeline={pipeline.id} task={task.id} onClose={() => setShowTerm(false)} />
          </div>
        ) : (
        <div className="stages">
          {automating && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="side-label" style={{ padding: "0 0 8px" }}>⚡ Auto-advancing · <button className="btn ghost sm" onClick={() => setShowTerm(true)}>open worktree terminal →</button></div>
              <div className="term" ref={autoRef}>{taskLog || "…"}</div>
            </div>
          )}
          {stageObjs.map((def) => (
            <Stage key={def.id} dir={dir} pipeline={pipeline} task={task} def={def} track={task.tracking[def.id] || { status: "idle" }}
              live={runningStages && runningStages.has(pipeline.id + "/" + task.id + "/" + def.id)}
              tools={tools} seconds={stageTime[def.id] || 0} open={openStage === def.id}
              onToggle={() => setOpenStage(openStage === def.id ? "" : def.id)}
              onDone={() => { onChange(); loadTimeline(); }} flash={flash} onDiff={setDiffCommit} resultFor={resultFor} onLog={appendLog} />
          ))}
        </div>
        )}

        {!railHidden && (
        <aside className="rail">
          <div className="card">
            <div className="side-label" style={{ padding: "0 0 8px" }}>Task</div>
            {task.ref && <Kv k="Ref" v={<span className="mono">#{task.ref}</span>} />}
            <Kv k="Status" v={task.finalized ? "finalized" : task.status} />
            <Kv k="Branch" v={<span className="mono" style={{ fontSize: 11 }}>{task.branch}</span>} />
            <Kv k="Type" v={task.type || "—"} />
            <Kv k="Output" v={task.outputMode || "—"} />
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

          <BlastRadius dir={dir} pipeline={pipeline.id} task={task.id} refreshKey={timeline.length} onOpen={() => setDiffBranch(true)} />
        </aside>
        )}
      </div>
      {diffCommit && <DiffView dir={dir} commit={diffCommit} commits={timeline} onCommit={setDiffCommit} pipeline={pipeline.id} task={task.id} flash={flash} onEdited={() => { onChange(); loadTimeline(); }} onClose={() => setDiffCommit(null)} />}
      {diffBranch && <DiffView dir={dir} branch pipeline={pipeline.id} task={task.id} flash={flash} onEdited={() => { onChange(); loadTimeline(); }} onClose={() => setDiffBranch(false)} />}
      {resolveOpen && <DiffView dir={dir} working pipeline={pipeline.id} task={task.id} flash={flash} onResolve={(action, m) => finalize(action, m)} onClose={() => setResolveOpen(false)} />}
    </>
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
    api.savePlan(dir, next).then((r) => { if (!r.ok) flash(r.error || "couldn't save links"); });
  };
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
      {(needs.length > 0 || blocks.length > 0) && (
        <div className="card">
          <div className="side-label" style={{ padding: "0 0 6px" }}>Dependencies</div>
          {needs.length > 0 && <>
            <div className="muted" style={{ fontSize: 11, margin: "2px 0 4px" }}>⛔ waits on</div>
            {needs.map((k) => row(k))}
          </>}
          {blocks.length > 0 && <>
            <div className="muted" style={{ fontSize: 11, margin: "8px 0 4px" }}>🧱 blocked by this task</div>
            {blocks.map((t) => row(t.key))}
          </>}
        </div>
      )}
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

function Stage({ dir, pipeline, task, def, track, tools, seconds, open, onToggle, onDone, flash, onDiff, resultFor, live, onLog }) {
  const runs = track.runs || [];
  const lastPrompt = runs.length ? (runs[runs.length - 1].prompt || "") : "";
  const [tool, setTool] = useState(def.tool || (tools[0] && tools[0].id) || "claude");
  const [prompt, setPrompt] = useState(lastPrompt);
  // empty model = the TOOL'S OWN default. ALWAYS starts empty — a model is only
  // passed when explicitly picked for THIS run, never remembered from earlier
  // runs (a sticky model once made every run inherit a bad earlier choice).
  const [model, setModel] = useState("");
  const [models, setModels] = useState([]);
  const [out, setOut] = useState("");
  const [running, setRunning] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const termRef = useRef(null);
  // autofill the prompt with the stage's last run when switching task/stage
  // (the model is deliberately NOT carried over — tool default unless picked now)
  useEffect(() => { setPrompt(lastPrompt); setModel(""); setOut(""); }, [task.id, def.id]);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [out]);
  useEffect(() => {
    let on = true;
    api.getModels(dir, tool).then((r) => { if (on) setModels((r && r.models) || []); });
    return () => { on = false; };
  }, [dir, tool]);

  // Roll the BRANCH back to before this stage: its commit and every later
  // stage's commit are removed (hard reset) — HEAD moves to the last valid
  // commit, files included. A "delivered" task can be revised from any stage.
  const reopen = async (e) => {
    e.stopPropagation();
    const r = await api.reopenStage(dir, { pipeline: pipeline.id, task: task.id, stage: def.id });
    flash(r.ok ? `${def.name} reopened — ${r.removed || 0} commit${(r.removed || 0) === 1 ? "" : "s"} rolled back, HEAD is at the last valid stage` : r.error, 4600);
    onDone();
  };

  const run = async () => {
    setOut(""); setRunning(true);
    // mirror into the task-level terminal too, so the Terminal view has it all
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
          <div className="row" style={{ marginBottom: 8 }}>
            <select className="input" style={{ width: 150 }} value={tool} onChange={(e) => { setTool(e.target.value); setModel(""); }}>
              {tools.map((t) => <option key={t.id} value={t.id} disabled={!t.available}>{t.label}{t.available ? "" : " (n/a)"}{t.stub ? " · stub" : ""}</option>)}
            </select>
            <input className="input mono model-pick" list={"models-" + def.id} placeholder="model · tool default"
              title="Leave empty to use the tool's own default model; pick or type to override for this run"
              value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id={"models-" + def.id}>
              {models.map((m) => <option key={m} value={m} />)}
            </datalist>
            {model.trim() && <button className="btn ghost sm" title="Back to the tool's default model" onClick={() => setModel("")}>×</button>}
            <button className="btn primary" onClick={run} disabled={running}>{running ? "Running…" : "▸ Run stage"}</button>
          </div>
          <textarea className="input" placeholder={`What should ${def.name} do? (the stage system prompt is applied automatically)`} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          {(out || running) && <div className="term" ref={termRef} style={{ marginTop: 10 }}>{out || "…"}</div>}
          {def.specs && def.specs.filter((v) => v.key && String(v.value || "").trim()).length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }} title="Appended to every run's prompt as hard requirements">
              specs: {def.specs.filter((v) => v.key && String(v.value || "").trim()).map((v, k) => <code key={k} className="iochip" style={{ marginRight: 4 }}>{specLabel(v.key)}: {v.value}</code>)}
            </div>
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
