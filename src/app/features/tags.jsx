// features/tags.jsx — everything tag-shaped that more than one screen needs:
// the chip row, the picker (kanban card, plan-board panel, task detail rail),
// the manage-tags dialog behind the picker's gear, and the write actions all
// three share. It lives here rather than in board.jsx because a tag is not a
// kanban thing — the same picker now hangs off three different surfaces.
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import * as api from "../api/client.js";
import { TAG_PALETTE } from "../../../core/domain.js";

// A tag's colour is a value now, not a class, so the two properties the old
// .tag-<name> rules set are set inline. "55" is the same ~33% alpha border the
// palette rules used, and it only composes this cleanly because the stored
// colour is always #rrggbb (normalizeTagColor guarantees it).
export const tagStyle = (color) => ({ color, borderColor: color + "55" });

export function TagChips({ tags, style }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="tag-chips" style={style}>
      {tags.map((g) => <span className="tag" key={g.id} style={tagStyle(g.color)}>{g.name}</span>)}
    </div>
  );
}

// <input type="color"> fires `input` continuously while the OS picker is
// dragged, and React's onChange IS that event — committing on it would be one
// API round-trip and one git commit per pixel of drag. The native `change`
// event fires once, when the picker is dismissed, so that is the one we take.
function ColorInput({ value, onCommit, title }) {
  const ref = useRef(null);
  const commit = useRef(onCommit);
  useEffect(() => { commit.current = onCommit; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onChange = () => commit.current(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  // defaultValue would go stale after a recolour lands from elsewhere
  useEffect(() => { if (ref.current && ref.current.value !== value) ref.current.value = value; }, [value]);
  return <input ref={ref} type="color" className="tag-color-input" defaultValue={value}
    title={title} aria-label={title} onClick={(e) => e.stopPropagation()} />;
}

// Presets first, then the full picker — the eight cover the common case in one
// click, the input covers "no, that exact green".
function Swatches({ value, onPick, label }) {
  return (
    <div className="tag-swatches">
      {TAG_PALETTE.map((c) => (
        <button type="button" key={c} title={c} aria-label={c} aria-pressed={c === value}
          className={"tag-swatch" + (c === value ? " on" : "")} style={{ color: c }}
          onClick={(e) => { e.stopPropagation(); onPick(c); }} />
      ))}
      <ColorInput value={value} onCommit={onPick} title={label} />
    </div>
  );
}

// Every tag in the registry with its colour, in one window. Reached from the
// picker's gear, and the only place a tag can be recoloured without a card in
// front of you. Renaming and deleting are deliberately not here yet.
export function TagManager({ registry, onRecolor, onClose }) {
  const entries = Object.entries(registry);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  // portalled to <body>: the picker that opens this sits in a z-indexed,
  // absolutely positioned menu, which is a stacking context — a modal rendered
  // inside it would be pinned under the menu's own z-index instead of over the
  // app, however high .modal-bg asks to be.
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="side-label" style={{ padding: "0 0 12px" }}>Tags · colours</div>
        {entries.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No tags yet — create one from a card's tag picker.</div>}
        {entries.map(([id, g]) => (
          <div key={id} className="tag-manage-row">
            <span className="tag" style={tagStyle(g.color)}>{g.name}</span>
            <Swatches value={g.color} onPick={(c) => onRecolor(id, c)} label={"Pick a colour for " + g.name} />
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The picker: every registry tag as a toggle row, plus a name input and a
// swatch row that create a new tag and assign it in one go. New-tag swatches
// start on the palette's next colour (registry size, so tags made back to back
// walk the palette) — and a colour is no longer final at creation: the dot on
// each row recolours it, as does the gear's dialog.
export function TagMenu({ task, registry, onToggle, onCreate, onRecolor, onClose, style }) {
  const entries = Object.entries(registry);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_PALETTE[entries.length % TAG_PALETTE.length]);
  // which existing tag has its swatch row open — one at a time
  const [open, setOpen] = useState(null);
  const [manage, setManage] = useState(false);
  const assigned = new Set((task.tags || []).map((g) => g.id));
  const submit = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!name.trim()) return;
    setName("");
    onCreate(name, color);
  };
  return (
    <div className="proj-menu tag-menu" style={{ right: 6, left: "auto", top: 6, minWidth: 180, zIndex: 5, ...style }} onClick={(e) => e.stopPropagation()}>
      <div className="path" style={{ padding: "4px 9px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1 }}>Tags</span>
        <button className="btn sm ghost" title="Manage tag colours" aria-label="Manage tag colours"
          onClick={(e) => { e.stopPropagation(); setManage(true); }}>⚙</button>
        <button className="btn sm ghost" onClick={onClose}>✕</button>
      </div>
      {entries.length === 0 && <div className="muted" style={{ padding: "4px 9px", fontSize: 11 }}>no tags yet — name one below</div>}
      {entries.map(([id, g]) => (
        <div key={id} style={{ paddingLeft: 9 }}>
          {/* the dot recolours, the name toggles assignment — so a recolour
              never tags or untags the card the picker is open on */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <button className="tag-dot" title="Change colour" aria-label={"Change " + g.name + " colour"}
              style={{ color: g.color }}
              onClick={(e) => { e.stopPropagation(); setOpen(open === id ? null : id); }} />
            <button className="item" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); onToggle(id); }}>
              {g.name}{assigned.has(id) ? " ✓" : ""}
            </button>
          </div>
          {open === id && (
            <div style={{ padding: "0 9px 5px 0" }}>
              <Swatches value={g.color} onPick={(c) => { setOpen(null); onRecolor(id, c); }} label={"Pick a colour for " + g.name} />
            </div>
          )}
        </div>
      ))}
      <form onSubmit={submit} style={{ padding: "4px 6px" }}>
        <Swatches value={color} onPick={setColor} label="Pick a colour for the new tag" />
        <input className="search-input" style={{ width: "100%" }} placeholder="new tag…" value={name}
          autoFocus onChange={(e) => setName(e.target.value)} onClick={(e) => e.stopPropagation()} />
      </form>
      {manage && <TagManager registry={registry} onRecolor={onRecolor} onClose={() => setManage(false)} />}
    </div>
  );
}

// The four writes behind the picker. Pipeline id is a parameter rather than a
// hook argument because the plan board spans every pipeline at once — the tag
// registry is per-pipeline, but which one depends on the selected task.
export function useTagActions(dir, onChange, flash) {
  const say = useCallback((e) => { if (flash) flash(e); }, [flash]);
  const saveTags = useCallback(async (pid, tid, ids) => {
    const r = await api.setTaskTags(dir, { pipeline: pid, task: tid, tags: ids });
    if (r.ok) onChange && onChange();
    else say(r.error);
  }, [dir, onChange, say]);
  const toggleTag = useCallback((pid, tid, tags, id) => {
    const cur = (tags || []).map((x) => x.id);
    return saveTags(pid, tid, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }, [saveTags]);
  const recolorTag = useCallback(async (id, color) => {
    const r = await api.updateTag(dir, { id, color });
    if (r.ok) onChange && onChange();
    else say(r.error);
  }, [dir, onChange, say]);
  const createAndAssign = useCallback(async (pid, tid, tags, name, color) => {
    const r = await api.createTag(dir, { name, color });
    if (!r.ok) return say(r.error);
    const cur = (tags || []).map((x) => x.id);
    return saveTags(pid, tid, cur.includes(r.id) ? cur : [...cur, r.id]);
  }, [dir, saveTags, say]);
  return { toggleTag, recolorTag, createAndAssign };
}
