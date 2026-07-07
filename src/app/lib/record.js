// lib/record.js — the ONE unified stage-record shape that every task-detail view
// (Inspector, Canvas, Chat) reads from. Derived from the node-canvas storage
// design: a task is a graph of stage nodes; each node carries its full run
// history with prompts, response, files, summary and the result commit — so a
// view never has to know where the raw bits live (tracking.runs + git timeline).
//
// This is an ADAPTER over the data the app already has (task.tracking + the
// commit timeline). It fills the two fields the old UI hid — `response` and
// `summary` — best-effort from what's on disk, and leaves them empty (not
// broken) when a run predates their capture. New runs can populate them
// directly (run.response / run.summary) and they win over the derived values.
import { workFiles, base } from "./format.js";

// The result commit carrying a run's changes: new model = the stage's single
// commit (newest done/failed timeline entry for that stage); old branches
// recorded a promptCommit whose predecessor was the result commit.
function resultCommit(run, stageId, timeline) {
  if (run && run.promptCommit) {
    const i = timeline.findIndex((c) => c.sha === run.promptCommit);
    return i > 0 ? timeline[i - 1].sha : null;
  }
  const c = timeline.find((x) => x.stage === stageId && (x.kind === "done" || x.kind === "failed"));
  return c ? c.sha : null;
}

// Merge a run's plain file-path list with the churn (+add/−del) from its result
// commit, and infer an add/modify/delete marker from the churn. Honest: with no
// commit churn we still list the file, just without a marker.
function buildFiles(run, commit, timeline) {
  const commitFiles = commit ? workFiles((timeline.find((c) => c.sha === commit) || {}).files) : [];
  const churn = new Map(commitFiles.map((f) => [f.path, f]));
  const paths = (run.files && run.files.length) ? run.files : commitFiles.map((f) => f.path);
  return paths.map((p) => {
    const f = churn.get(p) || {};
    const add = f.add || 0, del = f.del || 0;
    const change = (add || del) ? (del === 0 ? "A" : add === 0 ? "D" : "M") : "";
    return { path: p, name: base(p), add, del, change };
  });
}

const durationSec = (r) => (r.startedAt && r.finishedAt)
  ? Math.max(0, Math.round((new Date(r.finishedAt) - new Date(r.startedAt)) / 1000)) : 0;

// A one-line "what changed" summary. Prefers a stored run.summary; otherwise
// derives one from the file churn — enough for the flow to read at a glance.
function summarize(run, files) {
  if (run.summary) return run.summary;
  if (!files.length) return run.status === "failed" ? (run.error || "run failed") : "no file changes";
  const churn = files.reduce((a, f) => ({ add: a.add + (f.add || 0), del: a.del + (f.del || 0) }), { add: 0, del: 0 });
  const n = files.length;
  return `${n} file${n === 1 ? "" : "s"} changed · +${churn.add} −${churn.del}`;
}

// "running" in committed metadata after a crashed/killed run is really
// "interrupted" — only a live server run counts as running.
function stageStatus(track, live) {
  if (live) return "running";
  if (track.status === "running") return "interrupted";
  return track.status || "idle";
}

// Build the unified record for ONE stage.
export function buildStageRecord(pipeline, task, def, order, timeline, opts = {}) {
  const track = task.tracking[def.id] || { status: "idle" };
  const rawRuns = track.runs || [];
  const runs = rawRuns.map((r, idx) => {
    const commit = resultCommit(r, def.id, timeline);
    const files = buildFiles(r, commit, timeline);
    const live = !!opts.live && idx === rawRuns.length - 1;
    const status = (r.status === "running" && !r.finishedAt && !live) ? "interrupted" : (r.status || "?");
    return {
      seq: idx + 1,
      tool: r.tool || "", model: r.model || "",
      status, exit: r.exit,
      startedAt: r.startedAt || null, finishedAt: r.finishedAt || null,
      durationSec: durationSec(r),
      userPrompt: r.prompt || "",
      systemPrompt: r.system || def.systemPrompt || "",   // snapshot; run-level wins if captured
      response: r.response || r.log || "",                // the two fields the old UI hid…
      summary: "",                                        // …filled just below (needs files)
      files, commit,
      error: r.error || "",
      sessionId: r.sessionId || "",
      by: r.by || "bridza",
    };
  });
  runs.forEach((r) => { r.summary = summarize(rawRuns[r.seq - 1], r.files); });
  const latest = runs.length ? runs[runs.length - 1] : null;
  return {
    id: def.id, name: def.name || def.id, order,
    gate: def.gate || "", tool: def.tool || "",
    systemPrompt: def.systemPrompt || "",
    status: stageStatus(track, !!opts.live),
    seconds: opts.seconds || track.seconds || 0,
    runs, runCount: runs.length,
    latest,
    summary: latest ? latest.summary : "",
    files: latest ? latest.files : [],
  };
}

// Build the whole task as an ordered array of stage records — the canonical
// input to all three views.
export function buildStageRecords(pipeline, task, timeline = [], liveSet = null, stageTime = {}) {
  const stageObjs = task.stages.map((id) => (pipeline.stages || []).find((s) => s.id === id) || { id, name: id });
  return stageObjs.map((def, i) => buildStageRecord(pipeline, task, def, i, timeline, {
    live: liveSet ? liveSet.has(pipeline.id + "/" + task.id + "/" + def.id) : false,
    seconds: stageTime[def.id] || 0,
  }));
}

// The stage graph: nodes + the sequential edges of the flow. Views feed the
// nodes to the layout engine; edges are the flow order (i → i+1). Kept separate
// so a future branching flow only changes this function.
export function buildGraph(records) {
  const nodes = records.map((r) => ({ id: r.id, name: r.name, status: r.status, order: r.order }));
  const edges = records.slice(1).map((r, i) => ({ from: records[i].id, to: r.id }));
  return { nodes, edges };
}
