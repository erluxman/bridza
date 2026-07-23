// lib/canvas.js — drag + resize for stage nodes on a canvas, shared by the task
// Canvas view and the Stage planner. A node's manual {x,y,w,h} override is kept
// per canvas in localStorage (a per-user view preference — not committed);
// nodes without an override fall back to the current layout preset. Reset clears
// the overrides so the layout takes over again.
// ponytail: localStorage is enough for a view preference; promote to a committed
// file only if manual positions must be shared across machines.
import { useState, useEffect, useCallback } from "react";

const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

export function useCanvasOverrides(key) {
  const [over, setOver] = useState(() => load(key));
  useEffect(() => { setOver(load(key)); }, [key]);   // reload when the canvas (task/flow) changes
  const setNode = useCallback((id, patch) => setOver((o) => { const next = { ...o, [id]: { ...o[id], ...patch } }; store(key, next); return next; }), [key]);
  const clear = useCallback(() => { setOver({}); store(key, {}); }, [key]);
  return { over, setNode, clear, count: Object.keys(over).length };
}

// Merge a layout's base positions with the manual overrides, and size the canvas
// to fit whichever reaches furthest. `ids` is parallel to `base.nodes`.
export function effLayout(base, ids, over, nodeW, nodeH, pad = 40) {
  const eff = ids.map((id, i) => ({
    id,
    x: (over[id] && over[id].x != null) ? over[id].x : base.nodes[i].x,
    y: (over[id] && over[id].y != null) ? over[id].y : base.nodes[i].y,
    w: (over[id] && over[id].w != null) ? over[id].w : nodeW,
    h: (over[id] && over[id].h != null) ? over[id].h : nodeH,
  }));
  const width = Math.max(base.width, ...eff.map((e) => e.x + e.w), 0) + pad;
  const height = Math.max(base.height, ...eff.map((e) => e.y + e.h), 0) + pad;
  return { eff, width, height };
}

// A draggable + resizable absolutely-positioned node. Drag the body to move
// (a real drag past a small threshold suppresses the click-to-select); drag the
// corner handle to resize. Keyboard: Enter/Space selects.
export function CanvasNode({ x, y, w, h, minW = 150, minH = 74, scale = 1, className = "", selected, title, onMove, onResize, onSelect, children }) {
  const startDrag = (e) => {
    if (e.button !== 0 || (e.target.closest && e.target.closest(".uxv-resize"))) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = x, oy = y;
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;   // undo zoom so drag tracks the cursor
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) onMove(Math.max(0, Math.round(ox + dx)), Math.max(0, Math.round(oy + dy)));
    };
    const up = () => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      document.body.classList.remove("uxv-dragging");
      if (!moved && onSelect) onSelect();
    };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.body.classList.add("uxv-dragging");
  };
  const startResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = w, oh = h;
    const move = (ev) => onResize(Math.max(minW, Math.round(ow + (ev.clientX - sx) / scale)), Math.max(minH, Math.round(oh + (ev.clientY - sy) / scale)));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.classList.remove("uxv-dragging"); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.body.classList.add("uxv-dragging");
  };
  return (
    <div className={"uxv-node " + className + (selected ? " on" : "")} style={{ left: x, top: y, width: w, height: h }}
      role="button" tabIndex={0} title={title} onMouseDown={startDrag}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect && onSelect(); } }}>
      {children}
      <span className="uxv-resize" title="Drag to resize" onMouseDown={startResize} />
    </div>
  );
}
