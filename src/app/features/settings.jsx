// features/settings.jsx — app Settings modal. Terminal font/size/ligatures for
// now; add more fields as sections appear. Writes through lib/settings.js which
// notifies the live terminal.
import { useState } from "react";
import { Modal, Field } from "../ui.jsx";
import { getTermSettings, setTermSettings, TERM_DEFAULTS } from "../lib/settings.js";

const FONTS = [
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  "Menlo, monospace",
  "'SF Mono', ui-monospace, monospace",
  "'JetBrains Mono', monospace",
  "'Fira Code', monospace",
  "'Cascadia Code', monospace",
  "Consolas, monospace",
];

export function SettingsModal({ onClose }) {
  const init = getTermSettings();
  const [fontFamily, setFontFamily] = useState(init.fontFamily);
  const [fontSize, setFontSize] = useState(init.fontSize);
  const [ligatures, setLigatures] = useState(init.ligatures);
  // custom = the stored font isn't one of the presets → keep the free-text box open
  const known = FONTS.includes(fontFamily);
  const [custom, setCustom] = useState(!known);

  const save = () => {
    setTermSettings({ fontFamily, fontSize: Math.max(8, Math.min(32, Number(fontSize) || TERM_DEFAULTS.fontSize)), ligatures });
    onClose();
  };

  return (
    <Modal title="⚙ Settings" onClose={onClose} onConfirm={save} confirm="Save">
      <div className="side-label" style={{ padding: "0 0 8px" }}>Terminal</div>
      <Field label="Font family">
        <select className="input" value={custom ? "__custom__" : fontFamily}
          onChange={(e) => { if (e.target.value === "__custom__") { setCustom(true); } else { setCustom(false); setFontFamily(e.target.value); } }}>
          {FONTS.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/'/g, "")}</option>)}
          <option value="__custom__">Custom…</option>
        </select>
      </Field>
      {custom && (
        <Field label="Custom font CSS (font-family value)">
          <input className="input" value={fontFamily} placeholder="'My Mono', monospace" onChange={(e) => setFontFamily(e.target.value)} />
        </Field>
      )}
      <Field label="Font size (px)">
        <input className="input" type="number" min="8" max="32" step="0.5" value={fontSize} onChange={(e) => setFontSize(e.target.value)} />
      </Field>
      <Field label="Ligatures">
        <label className="row" style={{ gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={ligatures} onChange={(e) => setLigatures(e.target.checked)} />
          <span className="muted">Render programming ligatures (needs a ligature font like Fira Code / JetBrains Mono). Applies on next terminal open.</span>
        </label>
      </Field>
    </Modal>
  );
}
