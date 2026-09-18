// lib/format.js — pure, framework-free UI helpers shared across feature modules:
// localStorage wrappers, time/path formatting, prompt assembly, and the
// bookkeeping-file filter. No React, no DOM beyond the download anchor.
import { pipelineFlows, judgeStageId, flowFitCheck, mergeGateStageId, withSpecs } from "../../../core/domain.js";

export const recKey = (d) => "bridza-rec:" + d;
export const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v != null ? v : def; } catch (e) { return def; } };
export const lsSet = (k, v) => { try { if (v != null) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } };

export const LS = { dir: "bridza-project", recents: "bridza-recents", side: "bridza-side", welcome: "bridza-welcome" };
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const readRecents = () => { try { return JSON.parse(localStorage.getItem(LS.recents)) || []; } catch (e) { return []; } };
export const base = (p) => (p || "").replace(/\/+$/, "").split("/").pop() || p;
export const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`; };
export const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};
// Fit judge: when a pipeline has several flows and this is the task's JUDGE
// stage (implementation time — the earlier stages' research/requirements are
// on the branch by then), the run prompt gets a fit-check block: is this
// really one task of this flow, or a mis-filed multi-task feature?
export const fitCheckFor = (pipeline, task, stageId) => {
  const flows = pipelineFlows(pipeline);
  const own = flows.find((f) => f.id === task.flow);
  if (!own || flows.length < 2 || judgeStageId(own) !== stageId) return "";
  return flowFitCheck(own.name, flows.filter((f) => f.id !== own.id));
};
// Merge readiness — appended to a flow's MERGE GATE stage run prompt (the
// review/release step, or a flow's final stage). Names the branch this task's
// work actually lands on and makes preparing that merge the reviewer's job, so
// every flow's review runs against the TARGET branch, not an implicit main.
export const mergeStepFor = (pipeline, task, stageId) => {
  const flows = pipelineFlows(pipeline);
  const own = flows.find((f) => f.id === task.flow) || flows.find((f) => f.stages.some((s) => s.id === stageId));
  if (!own || mergeGateStageId(own) !== stageId) return "";
  const target = (task && task.target) || "main";
  return `Merge readiness — this task's change will be merged into the branch "${target}" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "${target}": review the task's branch against that branch (\`git diff ${target}...HEAD\`, \`git merge-tree\`), resolve or flag conflicts with it, make sure outputs and docs name "${target}" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "${target}" will be clean. A delivered task must be merge-ready into "${target}", not just done.`;
};
// ONE prompt assembly for every run (manual + auto-advance): base text, then
// the spec block, then the fit check, then the merge-readiness gate — the
// system prompt is never touched.
export const runPrompt = (pipeline, task, def, base) =>
  [withSpecs(base, def.specs), fitCheckFor(pipeline, task, def.id), mergeStepFor(pipeline, task, def.id)].filter(Boolean).join("\n\n");
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const downloadJSON = (name, obj) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
// bridza bookkeeping files — hidden from change lists so only the WORK shows
export const BOOKKEEP = /\/metadata\.json$|\/README\.md$|\/prompts\.md$|\.gitkeep$|^\.bridza\/(\.gitignore|inbox\.json)$/;
export const workFiles = (files) => (files || []).filter((f) => !BOOKKEEP.test(f.path));
