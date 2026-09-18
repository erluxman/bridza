// features/board.jsx — the per-pipeline kanban. Columns are the union of every
// stage used by any task; each task sits in its first not-yet-done stage, or a
// terminal "Delivered" column when finalized.
import { useState, useEffect } from "react";
import * as api from "../api/client.js";
import { Hamburger } from "../ui.jsx";
import { TermDrawer } from "./term.jsx";

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

export function Board({ dir, pipeline, runningTasks, onOpen, onNewTask, onFlow, onChange, flash, collapsed, onExpandSide }) {
  const { columns, nameOf } = kanbanColumns(pipeline);
  const byCol = {}; columns.forEach((c) => (byCol[c] = []));
  (pipeline.tasks || []).forEach((t) => { const c = currentStage(t); (byCol[c] || byCol[DONE_COL]).push(t); });
  const [termOpen, setTermOpen] = useState(false);
  // hover a card + press "L" → a dropdown of this pipeline's stage flows, so you
  // can retarget a task without opening it. Only meaningful with several flows.
  const flows = pipeline.flows || [];
  const [hover, setHover] = useState(null);
  const [flowMenu, setFlowMenu] = useState(null);
  useEffect(() => {
    if (!hover || flows.length < 2) return;
    const onKey = (e) => {
      if ((e.key === "l" || e.key === "L") && !/^(input|textarea|select)$/i.test(e.target.tagName || "")) { e.preventDefault(); setFlowMenu(hover); }
      else if (e.key === "Escape") setFlowMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hover, flows.length]);
  const changeFlow = async (t, nf) => {
    setFlowMenu(null);
    if (!nf || nf === t.flow) return;
    const fl = flows.find((f) => f.id === nf);
    if (!window.confirm(`Switch “${t.title}” to the “${fl ? fl.name : nf}” flow?\n\nProgress is DISCARDED — stage commits on ${t.branch} are dropped and the task restarts with the new flow's stages.`)) return;
    const r = await api.retargetTask(dir, { pipeline: pipeline.id, task: t.id, flow: nf });
    if (r.ok) { flash && flash(r.removed ? `flow → ${fl ? fl.name : nf} · ${r.removed} stage commit${r.removed === 1 ? "" : "s"} discarded` : "flow changed", 4000); onChange && onChange(); }
    else flash && flash(r.error);
  };
  return (
    <>
      <div className="topbar">
        <div className="row"><Hamburger collapsed={collapsed} onExpandSide={onExpandSide} /><h1>{pipeline.label}</h1></div>
        <div className="row">
          <button className={"btn ghost" + (termOpen ? " on" : "")} onClick={() => setTermOpen((o) => !o)} title="Terminal at the repo root">⌨ Terminal</button>
          <button className="btn ghost" onClick={onFlow}>⚙ Stage flow</button>
          <button className="btn primary" onClick={onNewTask}>＋ New task</button>
        </div>
      </div>
      {termOpen && <TermDrawer dir={dir} onClose={() => setTermOpen(false)} />}
      {pipeline.tasks.length === 0 ? (
        <div className="content"><p className="muted">No tasks yet. Create one — it gets its own branch <code>bridza/{pipeline.id}/&lt;task&gt;</code>.</p></div>
      ) : (
        <div className="kanban">
          {columns.map((c) => (
            <div className="kcol" key={c}>
              <div className="kcol-h"><span className={c === DONE_COL ? "done" : ""}>{c === DONE_COL ? "Delivered" : (nameOf[c] || c)}</span><span className="n">{byCol[c].length}</span></div>
              <div className="kcol-body">
                {byCol[c].map((t) => (
                  <div className="kcard" key={t.id} style={{ position: "relative" }} onClick={() => onOpen(t.id)}
                    onMouseEnter={() => setHover(t.id)} onMouseLeave={() => { setHover((h) => (h === t.id ? null : h)); }}>
                    <div className="spread"><b title={t.title}>{t.ref ? <span className="tref">#{t.ref}</span> : null}{t.title}</b>{runningTasks && runningTasks.has(pipeline.id + "/" + t.id) ? <span className="tag running"><span className="livedot" /> running</span> : t.finalized && <span className="tag done">✓</span>}</div>
                    <div className="muted mono kcard-branch">{t.branch}</div>
                    <div className="bar"><i style={{ width: t.progress + "%" }} /></div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>{t.progress}% · {t.stages.length} stages</div>
                    {flows.length > 1 && hover === t.id && flowMenu !== t.id && !t.finalized && (
                      <div className="muted" style={{ fontSize: 10, marginTop: 4, opacity: 0.65 }}>press <b>L</b> to change flow</div>
                    )}
                    {flowMenu === t.id && (
                      <div className="proj-menu" style={{ right: 6, left: "auto", top: 6, minWidth: 160, zIndex: 5 }} onClick={(e) => e.stopPropagation()} onMouseLeave={() => setFlowMenu(null)}>
                        <div className="path" style={{ padding: "4px 9px" }}>Change stage flow</div>
                        {flows.map((f) => <button className="item" key={f.id} onClick={(e) => { e.stopPropagation(); changeFlow(t, f.id); }}>{f.id === t.flow ? "● " : ""}{f.name}</button>)}
                      </div>
                    )}
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
