// client.js — browser-side calls to the Bridza bridge (/api/bridza/*). The
// open project folder is passed as ?dir on every call (the bridge is stateless).

const api = (p, dir) => "/api/bridza" + p + (dir ? (p.includes("?") ? "&" : "?") + "dir=" + encodeURIComponent(dir) : "");

// On the deployed (static) site there is no bridge — every call would throw or
// return HTML. Degrade to a clear "run it locally" message instead of crashing.
const NO_BRIDGE = { ok: false, available: false, canceled: true, error: "Bridza works on YOUR machine's repos — clone github.com/erluxman/bridza, run `pnpm install && pnpm dev`, then open http://app.localhost:5173" };

async function get(p, dir) {
  try { const r = await fetch(api(p, dir)); return await r.json(); }
  catch (e) { return { ...NO_BRIDGE }; }
}
async function post(p, dir, body, init = {}) {
  try {
    const r = await fetch(api(p, dir), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), ...init });
    return await r.json();
  } catch (e) { return { ...NO_BRIDGE }; }
}

export const recommendPipelines = (dir, description) => post("/recommend-pipelines", dir, { description });
export const getState = (dir) => get("/state", dir);
export const getTools = (dir) => get("/tools", dir);
export const getModels = (dir, tool) => get(`/models?tool=${encodeURIComponent(tool)}`, dir);
export const pickFolder = () => post("/pick-folder");
export const reveal = (p) => post("/reveal", null, { path: p });
export const createPipeline = (dir, body) => post("/pipeline", dir, body);
export const savePipeline = (dir, body) => post("/pipeline/save", dir, body);
export const archivePipeline = (dir, body) => post("/pipeline/archive", dir, body);
export const saveKanbanOrder = (dir, body) => post("/pipeline/kanban-order", dir, body);
export const deletePipeline = (dir, body) => post("/pipeline/delete", dir, body);
export const createTask = (dir, body) => post("/task", dir, body);
export const deleteTask = (dir, body) => post("/task/delete", dir, body);
export const retargetTask = (dir, body) => post("/task/retarget", dir, body);
export const getBranches = (dir) => get("/branches", dir);
export const setTaskReuse = (dir, body) => post("/task/reuse", dir, body);
export const setStageRouting = (dir, body) => post("/task/routing", dir, body);
export const setTaskArchived = (dir, body) => post("/task/archive", dir, body);
export const createTag = (dir, body) => post("/tag/create", dir, body);
export const updateTag = (dir, body) => post("/tag/update", dir, body);
export const setTaskTags = (dir, body) => post("/task/tags", dir, body);
export const stopRun = (dir, body) => post("/run/stop", dir, body);
export const getContext = (dir, pipeline, task, stage = "") => get(`/context?pipeline=${encodeURIComponent(pipeline)}&task=${encodeURIComponent(task)}&stage=${encodeURIComponent(stage)}`, dir);
export const saveContext = (dir, body) => post("/context", dir, body);
export const addInbox = (dir, body) => post("/inbox", dir, body);
export const promoteInbox = (dir, body) => post("/inbox/promote", dir, body);
export const discardInbox = (dir, id) => post("/inbox/discard", dir, { id });
export const finalize = (dir, body) => post("/finalize", dir, body);
export const openConflict = (dir, body) => post("/conflict/open", dir, body);
export const finishConflict = (dir, body) => post("/conflict/finish", dir, body);
export const abortConflict = (dir, body) => post("/conflict/abort", dir, body);
export const getPlan = (dir) => get("/plan", dir);
export const reopenStage = (dir, body) => post("/stage/reopen", dir, body);
export const savePlan = (dir, body) => post("/plan", dir, body);
export const openEditor = (dir, body) => post("/open", dir, body);
export const getTimeline = (dir, pipeline, task) => get(`/timeline?pipeline=${encodeURIComponent(pipeline)}&task=${encodeURIComponent(task)}`, dir);
export const getDiff = (dir, commit) => get(`/diff?commit=${encodeURIComponent(commit)}`, dir);
export const getBranchDiff = (dir, pipeline, task) => get(`/branch-diff?pipeline=${encodeURIComponent(pipeline)}&task=${encodeURIComponent(task)}`, dir);
export const getBlast = (dir, pipeline, task) => get(`/blast?pipeline=${encodeURIComponent(pipeline)}&task=${encodeURIComponent(task)}`, dir);
export const getWorkingDiff = (dir) => get(`/working-diff`, dir);
export const getFile = (dir, pipeline, task, path) => get(`/file?pipeline=${encodeURIComponent(pipeline)}&task=${encodeURIComponent(task)}&path=${encodeURIComponent(path)}`, dir);
export const saveFile = (dir, body) => post("/file/save", dir, body);
export const fetchTime = (dir, pipeline, task) => get(`/time?pipeline=${encodeURIComponent(pipeline)}&task=${encodeURIComponent(task)}`, dir);
// keepalive: the last flush happens on beforeunload — without it the browser
// drops the request with the page and up to 10s of tracked time goes missing
export const saveTime = (dir, pipeline, task, time) => post("/time", dir, { pipeline, task, time }, { keepalive: true });
export const createPR = (dir, body) => post("/pr", dir, body);

// Stream an ndjson timeline endpoint: parses each event and calls onEvent for
// each, resolving with the final {t:"end",…} event. An optional AbortSignal
// cancels the request (the bridge kills the child process on disconnect).
async function stream(path, dir, body, onEvent, signal) {
  let last = null;
  const handle = (line) => { if (!line.trim()) return; try { const e = JSON.parse(line); if (e.t === "end") last = e; onEvent(e); } catch (err) { /* skip */ } };
  try {
    const res = await fetch(api(path, dir), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    }
    handle(buf);
  } catch (e) {
    if (!(signal && signal.aborted)) throw e;   // user-initiated stop is not an error
  }
  return last;
}

// Stream a single stage run. Resolves with the final {t:"end",…} event.
// `body.advance` (optional) = the run bodies of the stages after it; the server
// carries the task on through them once this one ends done.
export const runStage = (dir, body, onEvent) => stream("/run/stage", dir, body, onEvent);

// (Re)attach to a stage's run on the server: a {t:"replay",live,log,…} event
// first, then the live tail until its end — or the last finished run's text +
// end (marked `replayed`), or {t:"end",none:true} when there was never one.
export const attachRun = (dir, body, onEvent, signal) => stream("/run/attach", dir, body, onEvent, signal);

// Send one chat message to the task's agent. Streams the same events a stage run
// does ({t:"out"} carrying the agent's prose AND its tool-use markers, {t:"cmd"},
// {t:"commit"}), and resolves with the turn's end event — which carries the
// finished `turn` record when it committed.
export const sendChat = (dir, body, onEvent) => stream("/chat/send", dir, body, onEvent);

// Stream the Automate flow — every stage of a task, back-to-back. `body.stages`
// is an ordered array of run/stage bodies. Resolves with the final automate end.
export const automate = (dir, body, onEvent) => stream("/automate", dir, body, onEvent);

// Web terminal: stream one shell command run in the task's worktree (when
// pipeline+task given) or the repo root. Abort the signal to kill the process.
export const termRun = (dir, body, onEvent, signal) => stream("/term/run", dir, body, onEvent, signal);
