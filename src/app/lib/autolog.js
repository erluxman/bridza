// lib/autolog.js — the task-level run log: everything any stage run or
// auto-advance of a task prints, kept in a module store keyed by pipeline/task.
// Component state dies when TaskDetail unmounts (navigate back to the board),
// but the background runner keeps going — so the log lives here, where the
// pane can always show what the runner is doing after you come back.
const CAP = 64000;
const LOGS = new Map();

export const logKey = (pipeline, task) => pipeline + "/" + task;

export const readLog = (k) => LOGS.get(k) || "";

export const appendLog = (k, s) => {
  const next = ((LOGS.get(k) || "") + String(s || "")).slice(-CAP);
  LOGS.set(k, next);
  return next;
};

export const __resetLogs = () => LOGS.clear();