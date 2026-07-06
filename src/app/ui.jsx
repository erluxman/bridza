// ui.jsx — small presentational primitives shared across feature modules:
// the collapse hamburger, the draggable column grip + its width hook, key/value
// rows, the modal shell, and labelled form fields.
import { useState, useEffect } from "react";

export const Hamburger = ({ collapsed, onExpandSide }) => collapsed ? <button className="btn ghost sm" title="Show pipelines" onClick={onExpandSide}>☰</button> : null;

// #3 — draggable column widths, persisted per key. `side` says which edge the
// grip sits on: "left" column grows as you drag right, "right" column grows as
// you drag left. Clamped to [min,max]. Double-click resets to the initial width.
export function useColWidth(key, initial, { min = 180, max = 680, side = "left" } = {}) {
  const [w, setW] = useState(() => {
    const s = Number(typeof localStorage !== "undefined" && localStorage.getItem(key));
    return s && s >= min && s <= max ? s : initial;
  });
  useEffect(() => { try { localStorage.setItem(key, String(w)); } catch (e) { /* private mode */ } }, [key, w]);
  const onPointerDown = (e) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = w;
    const move = (ev) => { const dx = (side === "left" ? 1 : -1) * (ev.clientX - x0); setW(Math.max(min, Math.min(max, w0 + dx))); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  };
  return [w, { onPointerDown, onDoubleClick: () => setW(initial), title: "Drag to resize · double-click to reset" }];
}
export const ColGrip = ({ side, ...h }) => <span className={"col-grip " + side} {...h} />;

export const Kv = ({ k, v }) => <div className="kv"><span>{k}</span><b>{v}</b></div>;

export function Modal({ title, children, onClose, onConfirm, confirm }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>{title}</h2>
        {children}
        <div className="spread" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
export const Field = ({ label, children }) => <div className="field"><label>{label}</label>{children}</div>;
