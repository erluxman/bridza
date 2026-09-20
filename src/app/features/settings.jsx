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

export function TerminalPanel({ value = getTermSettings(), onChange }) {
  const fontFamily = value.fontFamily ?? TERM_DEFAULTS.fontFamily;
  const fontSize = value.fontSize ?? TERM_DEFAULTS.fontSize;
  const ligatures = value.ligatures ?? TERM_DEFAULTS.ligatures;

  const known = FONTS.includes(fontFamily);
  const [custom, setCustom] = useState(!known);

  const update = (patch) => {
    onChange({ fontFamily, fontSize, ligatures, ...patch });
  };

  return (
    <div>
      <Field label="Font family">
        <select className="input" value={custom ? "__custom__" : fontFamily}
          onChange={(e) => { if (e.target.value === "__custom__") { setCustom(true); } else { setCustom(false); update({ fontFamily: e.target.value }); } }}>
          {FONTS.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/'/g, "")}</option>)}
          <option value="__custom__">Custom…</option>
        </select>
      </Field>
      {custom && (
        <Field label="Custom font CSS (font-family value)">
          <input className="input" value={fontFamily} placeholder="'My Mono', monospace" onChange={(e) => update({ fontFamily: e.target.value })} />
        </Field>
      )}
      <Field label="Font size (px)">
        <input className="input" type="number" min="8" max="32" step="0.5" value={fontSize} onChange={(e) => update({ fontSize: e.target.value })} />
      </Field>
      <Field label="Ligatures">
        <label className="row" style={{ gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={ligatures} onChange={(e) => update({ ligatures: e.target.checked })} />
          <span className="muted">Render programming ligatures (needs a ligature font like Fira Code / JetBrains Mono). Applies on next terminal open.</span>
        </label>
      </Field>
    </div>
  );
}

export const CATEGORIES = [
  { id: "terminal", label: "Terminal", Panel: TerminalPanel },
];

export function SettingsModal({ onClose, categories = CATEGORIES }) {
  const [active, setActive] = useState(categories[0]?.id);
  const [drafts, setDrafts] = useState(() => {
    const d = {};
    categories.forEach((cat) => {
      if (cat.id === "terminal") {
        d[cat.id] = getTermSettings();
      } else {
        d[cat.id] = cat.initialValue || {};
      }
    });
    return d;
  });

  const activeCategory = categories.find((c) => c.id === active) || categories[0];
  const ActivePanel = activeCategory?.Panel;

  const save = () => {
    if (drafts.terminal) {
      const t = drafts.terminal;
      setTermSettings({
        fontFamily: t.fontFamily,
        fontSize: Math.max(8, Math.min(32, Number(t.fontSize) || TERM_DEFAULTS.fontSize)),
        ligatures: t.ligatures,
      });
    }
    onClose();
  };

  return (
    <Modal title="⚙ Settings" onClose={onClose} onConfirm={save} confirm="Save" wide>
      <div className="settings-body">
        <div className="settings-cats">
          {categories.map((cat) => (
            <button
              key={cat.id}
              aria-current={cat.id === active ? "page" : undefined}
              onClick={() => setActive(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="settings-pane">
          {ActivePanel && (
            <ActivePanel
              value={drafts[activeCategory.id]}
              onChange={(next) =>
                setDrafts((prev) => ({
                  ...prev,
                  [activeCategory.id]: typeof next === "function" ? next(prev[activeCategory.id]) : next,
                }))
              }
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
