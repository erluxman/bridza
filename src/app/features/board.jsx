// features/board.jsx — the per-pipeline kanban. Columns are the union of every
// stage used by any task; each task sits in its first not-yet-done stage, or a
// terminal "Delivered" column when finalized.
import { useState, useEffect, useRef } from "react";
import * as api from "../api/client.js";
import { lsGet } from "../lib/format.js";
import { Hamburger } from "../ui.jsx";
import { TermDrawer } from "./term.jsx";
import { applyKanbanOrder, moveColumn } from "./kanban-order.js";
import { TAG_PALETTE } from "../../../core/domain.js";

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

// The tag picker: every registry tag as a toggle row, plus a name input and a
// swatch row that create a new tag and assign it in one go. The swatches start
// on the palette's next colour (registry size, so tags made back to back walk
// the palette), and the create moment is the only chance to choose — recolour
// after the fact is out of scope.
function TagMenu({ task, registry, onToggle, onCreate, onClose }) {
  const entries = Object.entries(registry);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_PALETTE[entries.length % TAG_PALETTE.length]);
  const assigned = new Set((task.tags || []).map((g) => g.id));
  const submit = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!name.trim()) return;
    setName("");
    onCreate(name, color);
  };
  return (
    <div className="proj-menu tag-menu" style={{ right: 6, left: "auto", top: 6, minWidth: 180, zIndex: 5 }} onClick={(e) => e.stopPropagation()}>
      <div className="path" style={{ padding: "4px 9px" }}>Tags <button className="btn sm ghost" style={{ float: "right" }} onClick={onClose}>✕</button></div>
      {entries.length === 0 && <div className="muted" style={{ padding: "4px 9px", fontSize: 11 }}>no tags yet — name one below</div>}
      {entries.map(([id, g]) => (
        <button className="item" key={id} onClick={(e) => { e.stopPropagation(); onToggle(id); }}>
          <span className={"tag-dot tag-" + g.color} />{g.name}{assigned.has(id) ? " ✓" : ""}
        </button>
      ))}
      <form onSubmit={submit} style={{ padding: "4px 6px" }}>
        <div className="tag-swatches">
          {TAG_PALETTE.map((c) => (
            <button type="button" key={c} title={c} aria-label={c} aria-pressed={c === color}
              className={"tag-swatch tag-" + c + (c === color ? " on" : "")}
              onClick={(e) => { e.stopPropagation(); setColor(c); }} />
          ))}
        </div>
        <input className="search-input" style={{ width: "100%" }} placeholder="new tag…" value={name}
          autoFocus onChange={(e) => setName(e.target.value)} onClick={(e) => e.stopPropagation()} />
      </form>
    </div>
  );
}

export function Board({ dir, pipeline, runningTasks, onOpen, onNewTask, onFlow, onChange, flash, collapsed, onExpandSide }) {
  const derived = kanbanColumns(pipeline);
  const nameOf = derived.nameOf;
  // optimistic order right after a drop, until the reloaded pipeline carries it
  const [saved, setSaved] = useState(null);
  const [showAllColumns, setShowAllColumns] = useState(() => lsGet("bridza.showAllColumns." + pipeline.id, "false") === "true");
  const toggleShowAll = (val) => {
    setShowAllColumns(val);
    try { localStorage.setItem("bridza.showAllColumns." + pipeline.id, val ? "1" : "0"); } catch (e) {}
  };
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
    const fromId = drag.id;
    const toIndex = drag.to;
    const targetCol = visibleColumns[toIndex];
    const rest = columns.filter((id) => id !== fromId);
    let next;
    if (targetCol) {
      const targetIdx = rest.indexOf(targetCol);
      next = [...rest.slice(0, targetIdx), fromId, ...rest.slice(targetIdx)];
    } else {
      next = [...rest, fromId];
    }
    setDrag(null);
    if (next.join("\n") === columns.join("\n")) return;
    const prev = saved;
    setSaved({ pid: pipeline.id, order: next });
    const r = await api.saveKanbanOrder(dir, { id: pipeline.id, order: next });
    if (r.ok) onChange && onChange();
    else { setSaved(prev); flash && flash(r.error); }
  };
  const [termOpen, setTermOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef(null);
  const byCol = {}; columns.forEach((c) => (byCol[c] = []));
  (pipeline.tasks || []).forEach((t) => { const c = currentStage(t); (byCol[c] || byCol[DONE_COL]).push(t); });
  const q = searchQuery.toLowerCase();
  const filtered = q ? { title: q, ref: q.replace(/^#/, ""), branch: q } : null;
  const matches = (t) => !filtered ||
    t.title.toLowerCase().includes(filtered.title) ||
    (t.ref && String(t.ref).includes(filtered.ref)) ||
    (t.branch && t.branch.toLowerCase().includes(filtered.branch));
  const filteredByCol = {};
  Object.entries(byCol).forEach(([c, ts]) => { filteredByCol[c] = ts.filter(matches); });
  // a pipeline's stage union is wide and mostly empty, so only columns holding
  // a card (after the search filter) are rendered unless the user asks for all
  const visibleColumns = showAllColumns ? columns : columns.filter((c) => filteredByCol[c].length > 0);
  // hover a card + press "L" → the tag picker for that task; "F" → a dropdown of
  // this pipeline's stage flows, so you can retarget without opening the task.
  // Tagging is the frequent action so it owns L; the flow menu is rare and
  // destructive, and stays gated on the pipeline having several flows.
  const flows = pipeline.flows || [];
  const registry = pipeline.tags || {};
  const [hover, setHover] = useState(null);
  const [flowMenu, setFlowMenu] = useState(null);
  const [tagMenu, setTagMenu] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && !/^(input|textarea|select)$/i.test(e.target.tagName || "")) {
        e.preventDefault();
        setSearchOpen(true);
        // already open but the caret is elsewhere — the shortcut still means
        // "put me in the box", and no mount is coming to do it for us
        if (searchRef.current) searchRef.current.focus();
      }
      else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);
  // Focus on the INTENT to open (the 🔍 click or the shortcut flipping
  // searchOpen), not on every commit: the board re-renders on each 4s poll and
  // on every card hover, and a focus() tied to render steals the caret back
  // from wherever the user put it.
  useEffect(() => {
    if (searchOpen && searchRef.current) searchRef.current.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (!hover) return;
    const onKey = (e) => {
      const typing = /^(input|textarea|select)$/i.test(e.target.tagName || "");
      if (typing) return;
      // only one menu at a time — both sit at the card's top-right corner
      if (e.key === "l" || e.key === "L") { e.preventDefault(); setFlowMenu(null); setTagMenu(hover); }
      else if ((e.key === "f" || e.key === "F") && flows.length >= 2) { e.preventDefault(); setTagMenu(null); setFlowMenu(hover); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hover, flows.length]);
  // Escape follows the OPEN MENU, not the hover: the pointer leaves the card the
  // moment you reach for the menu (and the tag picker holds a focused input), so
  // a hover-scoped listener would strand an open menu with only the ✕ to close it.
  useEffect(() => {
    if (!tagMenu && !flowMenu) return;
    const onKey = (e) => { if (e.key === "Escape") { setFlowMenu(null); setTagMenu(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagMenu, flowMenu]);
const changeFlow = async (t, nf) => {
    setFlowMenu(null);
    if (!nf || nf === t.flow) return;
    const fl = flows.find((f) => f.id === nf);
    if (!window.confirm(`Switch "${t.title}" to the "${fl ? fl.name : nf}" flow?\n\nProgress is DISCARDED — stage commits on ${t.branch} are dropped and the task restarts with the new flow's stages.`)) return;
    const r = await api.retargetTask(dir, { pipeline: pipeline.id, task: t.id, flow: nf });
    if (r.ok) { flash && flash(r.removed ? `flow → ${fl ? fl.name : nf} · ${r.removed} stage commit${r.removed === 1 ? "" : "s"} discarded` : "flow changed", 4000); onChange && onChange(); }
    else flash && flash(r.error);
  };
  const saveTags = async (t, ids) => {
    const r = await api.setTaskTags(dir, { pipeline: pipeline.id, task: t.id, tags: ids });
    if (r.ok) onChange && onChange();
    else flash && flash(r.error);
  };
  const toggleTag = (t, id) => {
    const cur = (t.tags || []).map((x) => x.id);
    saveTags(t, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const createAndAssign = async (t, name, color) => {
    const r = await api.createTag(dir, { name, color });
    if (!r.ok) return void (flash && flash(r.error));
    const cur = (t.tags || []).map((x) => x.id);
    await saveTags(t, cur.includes(r.id) ? cur : [...cur, r.id]);
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
          {searchOpen ? (
            <input
              ref={searchRef}
              className="search-input"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={(e) => { if (!e.target.value) setSearchOpen(false); }}
            />
          ) : (
            <button className="btn ghost" onClick={() => setSearchOpen(true)} title="Search tasks (press /)">🔍</button>
          )}
          <label className="muted col-toggle" title="Show every column, or only the ones holding a card">
            <input type="checkbox" checked={showAllColumns} onChange={(e) => toggleShowAll(e.target.checked)} />
            Show all columns
          </label>
          <button className="btn ghost" onClick={onFlow}>⚙ Stage flow</button>
          <button className="btn primary" onClick={onNewTask}>＋ New task</button>
        </div>
      </div>
      {termOpen && <TermDrawer dir={dir} onClose={() => setTermOpen(false)} />}
      {pipeline.tasks.length === 0 ? (
        <div className="content"><p className="muted">No tasks yet. Create one — it gets its own branch <code>bridza/{pipeline.id}/&lt;task&gt;</code>.</p></div>
      ) : (
        <div className="kanban">
          {visibleColumns.map((c, i) => (
            <div key={c} onDragOver={(e) => onColOver(e, i)} onDrop={onColDrop}
              className={"kcol" + (drag && drag.to === i ? " drop-before" : "") + (drag && drag.to === visibleColumns.length && i === visibleColumns.length - 1 ? " drop-after" : "")}>
              <div className={"kcol-h" + (drag && drag.id === c ? " grabbed" : "")} draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c); setDrag({ id: c, to: null }); }}
                onDragEnd={() => setDrag(null)}><span className={c === DONE_COL ? "done" : c === ARCHIVED_COL ? "archived" : ""}>{nameOf[c] || c}</span><span className="n">{filteredByCol[c].length}</span></div>
              <div className="kcol-body">
                {filteredByCol[c].map((t) => (
                   <div className="kcard" key={t.id} style={{ position: "relative" }} onClick={() => onOpen(t.id)}
                     onMouseEnter={() => setHover(t.id)} onMouseLeave={() => { setHover((h) => (h === t.id ? null : h)); }}>
                     <div className="spread"><b title={t.title}>{t.ref ? <span className="tref">#{t.ref}</span> : null}{t.title}</b><div style={{ display: "flex", gap: "6px", alignItems: "center" }}>{runningTasks && runningTasks.has(pipeline.id + "/" + t.id) ? <span className="tag running"><span className="livedot" /> running</span> : t.finalized && !t.archived && <span className="tag done">✓</span>}<button className="btn sm ghost" onClick={(e) => toggleArchive(e, t)} title={t.archived ? "Restore from archive" : "Archive task"}>🗄</button></div></div>
                     {(t.tags || []).length > 0 && (
                       <div className="tag-chips">{t.tags.map((g) => <span className={"tag tag-" + g.color} key={g.id}>{g.name}</span>)}</div>
                     )}
                     <div className="muted mono kcard-branch">{t.branch}</div>
                     <div className="bar"><i style={{ width: t.progress + "%" }} /></div>
                     <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>{t.progress}% · {t.stages.length} stages</div>
                     {hover === t.id && flowMenu !== t.id && tagMenu !== t.id && !t.finalized && (
                       <div className="muted" style={{ fontSize: 10, marginTop: 4, opacity: 0.65 }}>press <b>L</b> to tag{flows.length > 1 ? <> · <b>F</b> for flow</> : null}</div>
                     )}
                     {flowMenu === t.id && (
                       <div className="proj-menu" style={{ right: 6, left: "auto", top: 6, minWidth: 160, zIndex: 5 }} onClick={(e) => e.stopPropagation()} onMouseLeave={() => setFlowMenu(null)}>
                         <div className="path" style={{ padding: "4px 9px" }}>Change stage flow</div>
                         {flows.map((f) => <button className="item" key={f.id} onClick={(e) => { e.stopPropagation(); changeFlow(t, f.id); }}>{f.id === t.flow ? "● " : ""}{f.name}</button>)}
                       </div>
                     )}
                     {tagMenu === t.id && (
                       <TagMenu task={t} registry={registry} onToggle={(id) => toggleTag(t, id)} onCreate={(name, color) => createAndAssign(t, name, color)} onClose={() => setTagMenu(null)} />
                     )}
                   </div>
                 ))}

                {!filteredByCol[c].length && <div className="kcol-empty">—</div>}
              </div>
            </div>
          ))}
          {q && Object.values(filteredByCol).every((ts) => !ts.length) && (
            <div className="muted" style={{ padding: 40, textAlign: "center" }}>No matching tasks</div>
          )}
        </div>
      )}
    </>
  );
}
