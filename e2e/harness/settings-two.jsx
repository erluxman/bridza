// Dev-only harness: SettingsModal driven by a STUBBED two-entry registry.
// Proves the extensibility claim visually (and in the capture spec's video):
// a second category is one `{ id, label, Panel }` entry — SettingsModal itself
// is untouched. Served by the vite dev server at
// /e2e/harness/settings-two.html; never part of the production bundle.
import { createRoot } from "react-dom/client";
import "../../src/app/bridza.css";
import { Field } from "../../src/app/ui.jsx";
import { SettingsModal, TerminalPanel } from "../../src/app/features/settings.jsx";

function AppearancePanel({ value, onChange }) {
  return (
    <div>
      <Field label="Theme">
        <select className="input" value={value.theme} onChange={(e) => onChange({ ...value, theme: e.target.value })}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </Field>
      <Field label="Density">
        <select className="input" value={value.density} onChange={(e) => onChange({ ...value, density: e.target.value })}>
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </Field>
    </div>
  );
}

const CATEGORIES = [
  { id: "terminal", label: "Terminal", Panel: TerminalPanel },
  { id: "appearance", label: "Appearance", Panel: AppearancePanel, initialValue: { theme: "dark", density: "comfortable" } },
];

createRoot(document.getElementById("root")).render(
  <SettingsModal onClose={() => {}} categories={CATEGORIES} />,
);
