// features/board.jsx — the per-pipeline kanban. Columns are the union of every
// stage used by any task; each task sits in its first not-yet-done stage, or a
// terminal "Delivered" column when finalized.
import { useState } from "react";
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

export function Board({ dir, pipeline, runningTasks, onOpen, onNewTask, onFlow, collapsed, onExpandSide }) {
  const { columns, nameOf } = kanbanColumns(pipeline);
  const byCol = {}; columns.forEach((c) => (byCol[c] = []));
  (pipeline.tasks || []).forEach((t) => { const c = currentStage(t); (byCol[c] || byCol[DONE_COL]).push(t); });
  const [termOpen, setTermOpen] = useState(false);
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
                  <div className="kcard" key={t.id} onClick={() => onOpen(t.id)}>
                    <div className="spread"><b>{t.ref ? <span className="tref">#{t.ref}</span> : null}{t.title}</b>{runningTasks && runningTasks.has(pipeline.id + "/" + t.id) ? <span className="tag running"><span className="livedot" /> running</span> : t.finalized && <span className="tag done">✓</span>}</div>
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
