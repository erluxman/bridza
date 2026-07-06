// lib/settings.js — user-tunable app settings, persisted in localStorage.
// Currently just the terminal font/size/ligatures (the Settings panel writes
// here; term.jsx reads + subscribes so changes apply live).
import { lsGet, lsSet } from "./format.js";

const K = { fontFamily: "bridza.term.fontFamily", fontSize: "bridza.term.fontSize", ligatures: "bridza.term.ligatures" };
export const TERM_DEFAULTS = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12.5, ligatures: false };

export function getTermSettings() {
  return {
    fontFamily: lsGet(K.fontFamily, TERM_DEFAULTS.fontFamily),
    fontSize: Number(lsGet(K.fontSize, TERM_DEFAULTS.fontSize)) || TERM_DEFAULTS.fontSize,
    ligatures: lsGet(K.ligatures, TERM_DEFAULTS.ligatures ? "1" : "0") === "1",
  };
}

const subs = new Set();
export function setTermSettings(s) {
  lsSet(K.fontFamily, s.fontFamily || TERM_DEFAULTS.fontFamily);
  lsSet(K.fontSize, String(s.fontSize || TERM_DEFAULTS.fontSize));
  lsSet(K.ligatures, s.ligatures ? "1" : "0");
  const next = getTermSettings();
  subs.forEach((fn) => fn(next));
}
export function subscribeTermSettings(fn) { subs.add(fn); return () => subs.delete(fn); }
