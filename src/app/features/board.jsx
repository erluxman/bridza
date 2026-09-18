// features/board.jsx — the per-pipeline kanban. Columns are the union of every
// stage used by any task; each task sits in its first not-yet-done stage, or a
// terminal "Delivered" column when finalized.
import { useState, useEffect } from "react";
import * as api from "../api/client.js";
import { Hamburger } from "../ui.jsx";
import { TermDrawer } from "./term.jsx";
import { applyKanbanOrder, moveColumn } from "./kanban-order.js";

const DONE_COL = "__done__";
const ARCHIVED_COL = "__archived__";

function kanbanColumns(pipeline) {
  const order = [], nameOf = {};
  (pipeline.stages || []).forEach((s) => { if (!order.includes(s.id)) { order.push(s.id); nameOf[s.id] = s.name; } });
  (pipeline.tasks || []).forEach((t) => (t.stages || []).forEach((sid) => { if (!order.includes(sid)) { order.push(sid); nameOf[sid] = nameOf[sid] || sid; } }));
  nameOf[DONE_COL] = "Delivered";
  nameOf[ARCHIVED_COL] = "Archived";
  return { columns: [...order, DONE_COL, ARCHIVED_COL], nameOf };
}
function currentStage(t) {
  if (t.archived) return ARCHIVED_COL;
  if (t.finalized) return DONE_COL;
  return (t.stages || []).find((s) => (t.tracking[s] || {}).status !== "done") || DONE_COL;
}

export function Board({ dir, pipeline, runningTasks, onOpen, onNewTask, onFlow, onChange, flash, collapsed, onExpandSide }) {
  const derived = kanbanColumns(pipeline);
  const nameOf = derived.nameOf;
  // optimistic order right after a drop, until the reloaded pipeline carries it
  const [saved, setSaved] = useState(null);
  const columns = applyKanbanOrder(derived.columns, saved && saved.pid === pipeline.id ? saved.order : pipeline.kanbanOrder);
  // header drag: `to` is the insertion slot (0..columns.length) under the pointer
  const [drag, setDrag] = useState(null);
  const onColOver = (e, i) => {
    if (!drag) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const to = e.clientX < r.left + r.width / 2 ? i : i + 1;
    if (to !== drag.to) setDrag({ ...drag, to });
  };
  const onColDrop = async (e) => {
    e.preventDefault();
    if (!drag || drag.to == null) return setDrag(null);
    const from = columns.indexOf(drag.id);
    const next = moveColumn(columns, drag.id, drag.to > from ? drag.to - 1 : drag.to);
    setDrag(null);
    if (next.join("\n") === columns.join("\n")) return;
    const prev = saved;
    setSaved({ pid: pipeline.id, order: next });
    const r = await api.saveKanbanOrder(dir, { id: pipeline.id, order: next });
    if (r.ok) onChange && onChange();
    else { setSaved(prev); flash && flash(r.error); }
  };
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
    if (!window.confirm(`Switch "${t.title}" to the "${fl ? fl.name : nf}" flow?\n\nProgress is DISCARDED — stage commits on ${t.branch} are dropped and the task restarts with the new flow's stages.`)) return;
    const r = await api.retargetTask(dir, { pipeline: pipeline.id, task: t.id, flow: nf });
    if (r.ok) { flash && flash(r.removed ? `flow → ${fl ? fl.name : nf} · ${r.removed} stage commit${r.removed === 1 ? "" : "s"} discarded` : "flow changed", 4000); onChange && onChange(); }
    else flash && flash(r.error);
  };
  const toggleArchive = async (e, t) => {
    e.stopPropagation();
    const r = await api.setTaskArchived(dir, { pipeline: pipeline.id, task: t.id, archived: !t.archived });
    if (r.ok) { flash && flash(r.archived ? "task archived" : "task restored", 3000); onChange && onChange(); }
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
          {columns.map((c, i) => (
            <div key={c} onDragOver={(e) => onColOver(e, i)} onDrop={onColDrop}
              className={"kcol" + (drag && drag.to === i ? " drop-before" : "") + (drag && drag.to === columns.length && i === columns.length - 1 ? " drop-after" : "")}>
              <div className={"kcol-h" + (drag && drag.id === c ? " grabbed" : "")} draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c); setDrag({ id: c, to: null }); }}
                onDragEnd={() => setDrag(null)}><span className={c === DONE_COL ? "done" : c === ARCHIVED_COL ? "archived" : ""}>{nameOf[c] || c}</span><span className="n">{byCol[c].length}</span></div>
              <div className="kcol-body">
                {byCol[c].map((t) => (
                   <div className="kcard" key={t.id} style={{ position: "relative" }} onClick={() => onOpen(t.id)}
                     onMouseEnter={() => setHover(t.id)} onMouseLeave={() => { setHover((h) => (h === t.id ? null : h)); }}>
                     <div className="spread"><b title={t.title}>{t.ref ? <span className="tref">#{t.ref}</span> : null}{t.title}</b><div style={{ display: "flex", gap: "6px", alignItems: "center" }}>{runningTasks && runningTasks.has(pipeline.id + "/" + t.id) ? <span className="tag running"><span className="livedot" /> running</span> : t.finalized && !t.archived && <span className="tag done">✓</span>}<button className="btn sm ghost" onClick={(e) => toggleArchive(e, t)} title={t.archived ? "Restore from archive" : "Archive task"}>🗄</button></div></div>
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
