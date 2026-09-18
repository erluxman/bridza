// features/plan.jsx — the project plan board (a "circuit board"): every task is a
// chip, dependencies are traces through AND/OR gates, milestones are module boxes
// drawn around their tasks, and pipelines sequence on a timeline strip. Live
// status colouring + a cost-weighted critical path. All edits commit plan.json.
import { useState, useEffect, useRef } from "react";
import * as api from "../api/client.js";
import { gateSatisfied, criticalPath } from "../../../core/domain.js";
import { Hamburger } from "../ui.jsx";

const PN = { H: 50, ROW: 86, GW: 34, GH: 18, SLOT: 15 };   // SLOT = vertical room per gate input
// #16 — palette assigned to pipelines by order; nodes carry their pipeline's colour
const PIPE_COLORS = ["#5ad18b", "#e0726f", "#4f9cf2", "#d8a24a", "#a97bd6", "#4ec9c9", "#e59abf", "#8bbf5a", "#f0a860", "#7aa2f7"];
const trunc = (s, n) => (s || "").length > n ? s.slice(0, n - 1) + "…" : (s || "");

// layer = longest dependency chain leading into a task (roots = 0), with a
// cycle guard so a bad edit can't hang the layout.
function planLayout(tasks, gateOf, msIndexOf, colW) {
  const layer = {};
  const visiting = new Set();
  const L = (k) => {
    if (layer[k] != null) return layer[k];
    if (visiting.has(k)) return 0;
    visiting.add(k);
    const g = gateOf(k);
    const parents = [...g.all, ...g.any];
    layer[k] = parents.length ? 1 + Math.max(...parents.map(L)) : 0;
    visiting.delete(k);
    return layer[k];
  };
  tasks.forEach((t) => L(t.key));
  // one horizontal BAND per milestone (unassigned tasks in a final band), so a
  // milestone's module box never contains or overlaps foreign nodes.
  const groups = new Map();
  tasks.forEach((t) => { const g = msIndexOf(t.key); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); });
  const pos = {};
  let bandY = 64;
  for (const gi of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(gi).sort((a, b) => a.pipe.localeCompare(b.pipe) || a.title.localeCompare(b.title));
    const perCol = {};
    let rows = 1;
    list.forEach((t) => {
      const l = layer[t.key];
      const i = perCol[l] || 0;
      perCol[l] = i + 1;
      rows = Math.max(rows, i + 1);
      pos[t.key] = { x: 50 + l * colW, y: bandY + i * PN.ROW };
    });
    bandY += rows * PN.ROW + (gi === 999 ? 10 : 44);   // milestone bands get room for box chrome
  }
  return pos;
}

// an orthogonal circuit trace: out of the source, across, down/up, into the target
const tracePath = (px, py, ix, iy) => {
  const mid = ix - 16;
  return { d: `M ${px} ${py} L ${mid} ${py} L ${mid} ${iy} L ${ix} ${iy}`, vias: py === iy ? [] : [[mid, py], [mid, iy]] };
};

export function PlanView({ dir, proj, runningTasks, onOpenTask, flash, collapsed, onExpandSide }) {
  const [plan, setPlan] = useState(null);
  const [sel, setSel] = useState(null);      // selected task key
  const [selMs, setSelMs] = useState(null);  // selected milestone id
  const [view, setView] = useState({ x: 16, y: 8, k: 1 });
  const [wide, setWide] = useState(() => localStorage.getItem("bridza-plan-wide") === "1");
  const [critOn, setCritOn] = useState(false);
  const [dragPos, setDragPos] = useState({});   // live positions while dragging a node/milestone
  const [sizeLive, setSizeLive] = useState({});   // #13 — live sizes while dragging a resize handle
  const [linkFrom, setLinkFrom] = useState(null);   // pipeline-timeline: edge source being connected
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    let on = true;
    api.getPlan(dir).then((r) => { if (on) setPlan({ deps: (r.plan && r.plan.deps) || {}, milestones: (r.plan && r.plan.milestones) || [], pos: (r.plan && r.plan.pos) || {}, sizes: (r.plan && r.plan.sizes) || {}, pipeDeps: (r.plan && r.plan.pipeDeps) || [], est: (r.plan && r.plan.est) || {} }); });
    return () => { on = false; };
  }, [dir]);

  // wheel zoom needs a NON-passive native listener (React's synthetic onWheel can't preventDefault)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const v = viewRef.current;
      // macOS trackpad pinch (and ctrl/cmd+wheel) fire wheel with ctrlKey → zoom.
      // Plain two-finger scroll → pan (like dragging the canvas).
      if (!e.ctrlKey) { setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }); return; }
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const k = Math.min(2.5, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.12 : 0.9)));
      const f = k / v.k;
      setView({ k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [plan]);

  if (!plan) return (
    <>
      <div className="topbar"><div className="row"><Hamburger collapsed={collapsed} onExpandSide={onExpandSide} /><h1>Plan</h1></div></div>
      <div className="content"><p className="muted">Loading plan…</p></div>
    </>
  );

  // ---- model ---------------------------------------------------------------
  const tasks = [];
  proj.pipelines.forEach((p) => (p.tasks || []).forEach((t) => tasks.push({
    key: p.id + "/" + t.id, pid: p.id, tid: t.id, title: (t.ref ? "#" + t.ref + " " : "") + t.title, pipe: p.label,
    progress: t.progress, done: t.finalized || (t.stages.length > 0 && t.progress === 100),
  })));
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const doneSet = new Set(tasks.filter((t) => t.done).map((t) => t.key));
  // #16 — stable color per pipeline, so nodes read as colour-coded groups
  const pipeColor = (pid) => { const i = proj.pipelines.findIndex((p) => p.id === pid); return PIPE_COLORS[(i < 0 ? 0 : i) % PIPE_COLORS.length]; };
  const gateOf = (k) => {
    const g = plan.deps[k] || {};
    return { all: (g.all || []).filter((x) => byKey.has(x)), any: (g.any || []).filter((x) => byKey.has(x)) };
  };
  const blocksOf = (k) => tasks.filter((t) => { const g = gateOf(t.key); return g.all.includes(k) || g.any.includes(k); });
  const msOf = (k) => plan.milestones.find((m) => (m.tasks || []).includes(k));
  const msIndexOf = (k) => { const i = plan.milestones.findIndex((m) => (m.tasks || []).includes(k)); return i < 0 ? 999 : i; };
  const msMembers = (m) => (m.tasks || []).filter((k) => byKey.has(k));
  const msById = new Map(plan.milestones.map((m) => [m.id, m]));
  const msIsDone = (m) => { const mem = msMembers(m); return mem.length > 0 && mem.every((k) => doneSet.has(k)); };
  // a milestone's own gate: the milestones it requires that aren't complete yet
  const msBlockedBy = (m) => (((m && m.needs) || []).map((id) => msById.get(id)).filter((x) => x && !msIsDone(x)));
  const stateOf = (t) => t.done ? "done"
    : runningTasks.has(t.key) ? "running"
      : (gateSatisfied(gateOf(t.key), doneSet) && msBlockedBy(msOf(t.key)).length === 0) ? "ready" : "blocked";

  // critical path: the longest chain of REMAINING work (done tasks cost 0).
  // Milestone requirements count as AND-deps on every member of the required
  // milestone, so the path reflects milestone gating too.
  const effGateOf = (k) => {
    const g = gateOf(k);
    const m = msOf(k);
    const extra = (((m && m.needs) || []).flatMap((id) => { const req = msById.get(id); return req ? msMembers(req) : []; })).filter((d) => d !== k);
    return extra.length ? { all: [...new Set([...g.all, ...extra])], any: g.any } : g;
  };
  // cost-weighted: a task's weight is its estimated hours (plan.est), so the
  // critical path is the LONGEST-RUNNING chain, not just the deepest one
  const est = plan.est || {};
  const hasEst = tasks.some((t) => est[t.key] > 0);
  const crit = criticalPath(tasks.map((t) => t.key), effGateOf, (k) => (doneSet.has(k) ? 0 : (Number(est[k]) > 0 ? Number(est[k]) : 1)));
  const critSet = new Set(critOn ? crit.path : []);
  const critPairs = new Set();
  if (critOn) for (let i = 1; i < crit.path.length; i++) critPairs.add(crit.path[i - 1] + ">" + crit.path[i]);

  // card width: normal, or wide enough to show every full task name
  const maxTitle = Math.max(8, ...tasks.map((t) => t.title.length));
  const W = wide ? Math.min(380, Math.max(190, 30 + maxTitle * 7)) : 170;
  const COL = W + 96;
  // #13 — per-task card size (falls back to a default sized to that task's own
  // title, so short titles stay compact and long ones get more room without
  // needing a manual resize). live sizes while dragging a resize handle
  // override the saved ones.
  const defWOf = (k) => { const t = byKey.get(k); return Math.min(wide ? 380 : 280, Math.max(W, 30 + ((t && t.title.length) || 0) * 6.5)); };
  const wOf = (k) => (sizeLive[k] && sizeLive[k].w) || (plan.sizes && plan.sizes[k] && plan.sizes[k].w) || defWOf(k);
  const hOf = (k) => (sizeLive[k] && sizeLive[k].h) || (plan.sizes && plan.sizes[k] && plan.sizes[k].h) || PN.H;
  // title truncation now tracks the CARD'S ACTUAL WIDTH (manually resized or
  // auto-sized) instead of a fixed character count, so dragging the resize
  // handle grows/shrinks how much of the title is visible.
  const titleCharsFor = (w) => Math.max(4, Math.floor((w - 24) / 6.1));

  // positions: auto layout, overridden by saved manual positions (plan.pos),
  // then auto-only members get shifted down until milestone boxes don't overlap
  const autoPos = planLayout(tasks, gateOf, msIndexOf, COL);
  const basePos = {};
  tasks.forEach((t) => { basePos[t.key] = (plan.pos && plan.pos[t.key]) || autoPos[t.key]; });
  const boxOf = (members) => {
    const xs = members.map((k) => basePos[k].x), ys = members.map((k) => basePos[k].y);
    const x = Math.min(...xs) - 16, y = Math.min(...ys) - 34;
    const right = Math.max(...members.map((k) => basePos[k].x + wOf(k)));
    const bottom = Math.max(...members.map((k) => basePos[k].y + hOf(k)));
    return { x, y, w: right - x + 16, h: bottom - y + 14 };
  };
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const placed = [];
  plan.milestones.forEach((m) => {
    const members = msMembers(m);
    if (!members.length) return;
    let box = boxOf(members);
    for (const other of placed) {
      if (hits(box, other)) {
        const dy = other.y + other.h + 30 - box.y;
        members.forEach((k) => { if (!(plan.pos && plan.pos[k])) basePos[k] = { x: basePos[k].x, y: basePos[k].y + dy }; });
        box = boxOf(members);
      }
    }
    placed.push(box);
  });
  const pos = { ...basePos, ...dragPos };
  const maxX = Math.max(0, ...tasks.map((t) => pos[t.key].x + wOf(t.key))) + 80;
  const maxY = Math.max(0, ...tasks.map((t) => pos[t.key].y + hOf(t.key))) + 80;

  // ---- mutations (each save commits .bridza/plan.json) ----------------------
  const save = (next) => { setPlan(next); api.savePlan(dir, next).then((r) => { if (!r.ok) flash(r.error || "plan save failed"); }); };
  const setGate = (key, gate) => save({ ...plan, deps: { ...plan.deps, [key]: gate } });
  const addDep = (key, group, dep) => {
    if (!dep || dep === key) return;
    const g = gateOf(key);
    if (g.all.includes(dep) || g.any.includes(dep)) return;
    setGate(key, { ...g, [group]: [...g[group], dep] });
  };
  const rmDep = (key, group, dep) => { const g = gateOf(key); setGate(key, { ...g, [group]: g[group].filter((x) => x !== dep) }); };
  const flipDep = (key, group, dep) => { const g = gateOf(key); const other = group === "all" ? "any" : "all"; setGate(key, { ...g, [group]: g[group].filter((x) => x !== dep), [other]: [...g[other], dep] }); };
  const addMilestone = () => {
    const id = "ms-" + Math.random().toString(36).slice(2, 7);
    save({ ...plan, milestones: [...plan.milestones, { id, title: "Milestone " + (plan.milestones.length + 1), due: "", tasks: [] }] });
    setSelMs(id); setSel(null);
  };
  const patchMs = (id, p) => save({ ...plan, milestones: plan.milestones.map((m) => m.id === id ? { ...m, ...p } : m) });
  const delMs = (id) => { save({ ...plan, milestones: plan.milestones.filter((m) => m.id !== id) }); setSelMs(null); };
  const assignMs = (key, msId) => save({
    ...plan,
    milestones: plan.milestones.map((m) => ({ ...m, tasks: m.id === msId ? [...new Set([...(m.tasks || []), key])] : (m.tasks || []).filter((t) => t !== key) })),
  });
  const addMsNeed = (id, reqId) => { const m = msById.get(id); if (!m || !reqId || reqId === id) return; patchMs(id, { needs: [...new Set([...(m.needs || []), reqId])] }); };
  const rmMsNeed = (id, reqId) => { const m = msById.get(id); if (m) patchMs(id, { needs: (m.needs || []).filter((x) => x !== reqId) }); };
  const toggleWide = () => { setWide((w) => { localStorage.setItem("bridza-plan-wide", w ? "0" : "1"); return !w; }); };

  // ---- pipeline timeline: sequence edges between whole pipelines -------------
  // An edge A → B auto-gates every NEW task created in B on A's open tasks
  // (createTask does the wiring; blockedByPlan enforces it at run time).
  const pipeDeps = plan.pipeDeps || [];
  const pipes = proj.pipelines.filter((p) => !p.archived);
  const pipeById = new Map(pipes.map((p) => [p.id, p]));
  const orderedPipes = (() => {   // topological by edges; original order breaks ties/cycles
    const inDeg = new Map(pipes.map((p) => [p.id, 0]));
    const edges = pipeDeps.filter((d) => inDeg.has(d.from) && inDeg.has(d.to));
    edges.forEach((d) => inDeg.set(d.to, inDeg.get(d.to) + 1));
    const out = [], q = pipes.filter((p) => !inDeg.get(p.id)).map((p) => p.id);
    const left = new Set(edges.map((_, i) => i));
    while (q.length) {
      const id = q.shift(); out.push(id);
      edges.forEach((d, i) => { if (left.has(i) && d.from === id) { left.delete(i); inDeg.set(d.to, inDeg.get(d.to) - 1); if (!inDeg.get(d.to)) q.push(d.to); } });
    }
    pipes.forEach((p) => { if (!out.includes(p.id)) out.push(p.id); });
    return out.map((id) => pipeById.get(id));
  })();
  const pipePct = (p) => { const ts = p.tasks || []; if (!ts.length) return null; return Math.round(ts.filter((t) => t.finalized || (t.stages.length > 0 && t.progress === 100)).length / ts.length * 100); };
  const clickPipe = (id) => {
    if (!linkFrom) return setLinkFrom(id);
    if (linkFrom === id) return setLinkFrom(null);
    const exists = pipeDeps.some((d) => d.from === linkFrom && d.to === id);
    save({ ...plan, pipeDeps: exists ? pipeDeps.filter((d) => !(d.from === linkFrom && d.to === id)) : [...pipeDeps, { from: linkFrom, to: id }] });
    flash(exists ? "sequence removed" : `${(pipeById.get(linkFrom) || {}).label} → ${(pipeById.get(id) || {}).label}: new ${(pipeById.get(id) || {}).label} tasks will wait for ${(pipeById.get(linkFrom) || {}).label}'s open tasks`, 5200);
    setLinkFrom(null);
  };

  // ---- one drag system: pan the board, drag a node, or drag a whole milestone ----
  const startDrag = (e, d) => { e.stopPropagation(); dragRef.current = { ...d, sx: e.clientX, sy: e.clientY, moved: false }; };
  // #13 — resize a card from its bottom-right handle. ⌘/Ctrl-drag resizes EVERY card.
  const startResize = (e, key) => {
    e.stopPropagation();
    dragRef.current = { type: "resize", key, all: e.metaKey || e.ctrlKey, ow: wOf(key), oh: hOf(key), sx: e.clientX, sy: e.clientY, moved: false };
  };
  const bgDown = (e) => { dragRef.current = { type: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }; };
  const bgMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.type === "pan") setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    else if (d.type === "resize") {
      const nw = Math.min(600, Math.max(120, d.ow + dx / view.k));
      const nh = Math.min(240, Math.max(38, d.oh + dy / view.k));
      d.liveSize = d.all ? Object.fromEntries(tasks.map((t) => [t.key, { w: nw, h: nh }])) : { [d.key]: { w: nw, h: nh } };
      setSizeLive(d.liveSize);
    } else {
      // keep the live positions on the ref too — mouseup may fire before React
      // re-renders, and persisting must not read stale state
      d.live = Object.fromEntries(d.keys.map((k) => [k, { x: d.orig[k].x + dx / view.k, y: d.orig[k].y + dy / view.k }]));
      setDragPos(d.live);
    }
  };
  const bgUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      if (d.type === "node") { setSel(d.keys[0]); setSelMs(null); }
      else if (d.type === "ms") { setSelMs(d.id); setSel(null); }
      else if (d.type === "resize") { /* a click on the handle, no drag — do nothing */ }
      else { setSel(null); setSelMs(null); }
      return;
    }
    if (d.type === "pan") return;
    if (d.type === "resize") {
      const nextSizes = { ...(plan.sizes || {}), ...(d.liveSize || {}) };
      setSizeLive({});
      save({ ...plan, sizes: nextSizes });
      return;
    }
    // persist the dragged positions (rounded) into the committed plan
    const nextPos = { ...(plan.pos || {}) };
    d.keys.forEach((k) => { const p = (d.live && d.live[k]) || dragPos[k] || pos[k]; nextPos[k] = { x: Math.round(p.x), y: Math.round(p.y) }; });
    setDragPos({});
    save({ ...plan, pos: nextPos });
  };
  const zoomBy = (f) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = r.width / 2, my = r.height / 2;
    setView((v) => { const k = Math.min(2.5, Math.max(0.25, v.k * f)); const ff = k / v.k; return { k, x: mx - (mx - v.x) * ff, y: my - (my - v.y) * ff }; });
  };
  const fit = () => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = Math.min(1.4, Math.max(0.25, Math.min(r.width / maxX, r.height / maxY)));
    setView({ k, x: (r.width - maxX * k) / 2, y: Math.max(4, (r.height - maxY * k) / 2) });
  };

  // ---- geometry for milestones / edges / gates -------------------------------
  const msBoxes = plan.milestones.map((m) => {
    const members = msMembers(m);
    if (!members.length) return { m, empty: true, members };
    const xs = members.map((k) => pos[k].x), ys = members.map((k) => pos[k].y);
    const x = Math.min(...xs) - 16, y = Math.min(...ys) - 34;
    const w = Math.max(...members.map((k) => pos[k].x + wOf(k))) - x + 16, h = Math.max(...members.map((k) => pos[k].y + hOf(k))) - y + 14;
    const done = members.filter((k) => doneSet.has(k)).length;
    return { m, x, y, w, h, done, n: members.length, members, gated: msBlockedBy(m).length > 0 };
  });
  const boxById = new Map(msBoxes.filter((b) => !b.empty).map((b) => [b.m.id, b]));

  // milestone → milestone requirement wires (module-to-module traces)
  const msEdges = [];
  msBoxes.filter((b) => !b.empty).forEach((b) => {
    (b.m.needs || []).forEach((reqId) => {
      const req = boxById.get(reqId);
      if (!req) return;
      msEdges.push({ id: b.m.id + "←" + reqId, hot: msIsDone(req.m), ...tracePath(req.x + req.w, req.y + req.h / 2, b.x, b.y + b.h / 2) });
    });
  });

  const gates = [], edges = [];
  tasks.forEach((t) => {
    const g = gateOf(t.key);
    const { x: tx, y: ty } = pos[t.key];
    const inY = ty + hOf(t.key) / 2;
    const groups = [["all", g.all], ["any", g.any]].filter(([, list]) => list.length);
    const single = groups.length === 1 && groups[0][1].length === 1;
    // Both an AND-group and an OR-group? They combine in SERIES: each keeps its
    // own gate, then a final AND join merges the two — so the picture reads
    // (all-group) AND (any-group), exactly what gateSatisfied evaluates. With a
    // single group the gate wires straight to the task as before.
    const both = groups.length === 2;
    // Each gate box grows to fit its inputs so every dependency line lands on a
    // DISTINCT point of the box's left edge — the box itself gathers the lines,
    // instead of them merging into one trunk before a tiny fixed gate.
    // ponytail: box height = inputs × SLOT; very wide fan-in (>5) can spill into
    // the neighbouring row — bump PN.ROW if that shows up in practice.
    const ghOf = (n) => Math.max(PN.GH, n * PN.SLOT);
    const joinH = ghOf(2);
    const joinX = tx - PN.GW - 16;
    const groupColX = both ? joinX - PN.GW - 16 : tx - PN.GW - 16;
    const gh0 = both ? ghOf(groups[0][1].length) : 0;
    const gh1 = both ? ghOf(groups[1][1].length) : 0;
    const stackTop = inY - (gh0 + gh1 + 14) / 2;   // stack both group boxes, 14px gap
    const openOf = {};
    groups.forEach(([kind, list], gi) => {
      const gh = ghOf(list.length);
      const cy = both ? (gi === 0 ? stackTop + gh0 / 2 : stackTop + gh0 + 14 + gh1 / 2) : inY;
      const gy = cy - gh / 2;
      const gx = groupColX;
      const useGate = !single;
      const open = kind === "all" ? list.every((k) => doneSet.has(k)) : list.some((k) => doneSet.has(k));
      openOf[kind] = open;
      if (useGate) {
        gates.push({ id: t.key + ":" + kind, kind, x: gx, y: gy, h: gh, open });
        // out of this gate → its own slot on the join box, or straight to the task
        const to = both ? { x: joinX, y: inY - joinH / 2 + (gi + 0.5) * joinH / 2 } : { x: tx, y: inY };
        edges.push({ id: t.key + ":" + kind + ":out", from: null, hot: open, crit: list.some((dep) => critPairs.has(dep + ">" + t.key)), ...tracePath(gx + PN.GW, cy, to.x, to.y) });
      }
      list.forEach((dep, di) => {
        const dp = pos[dep];
        const src = { x: dp.x + wOf(dep), y: dp.y + hOf(dep) / 2 };
        // land on the gate's left edge at this input's own slot (box converges them)
        const dst = useGate ? { x: gx, y: gy + (di + 0.5) * gh / list.length } : { x: tx, y: inY };
        edges.push({ id: t.key + ":" + kind + ":" + dep, hot: doneSet.has(dep), run: runningTasks.has(dep), crit: critPairs.has(dep + ">" + t.key), ...tracePath(src.x, src.y, dst.x, dst.y) });
      });
    });
    if (both) {
      const jOpen = !!openOf.all && !!openOf.any;                          // the series AND
      gates.push({ id: t.key + ":join", kind: "all", x: joinX, y: inY - joinH / 2, h: joinH, open: jOpen });
      edges.push({ id: t.key + ":join:out", from: null, hot: jOpen, ...tracePath(joinX + PN.GW, inY, tx, inY) });
    }
  });

  const blocked = tasks.filter((t) => stateOf(t) === "blocked");
  const selTask = sel && byKey.get(sel);
  const selMile = selMs && plan.milestones.find((m) => m.id === selMs);
  const depPicker = (key, group) => (
    <select className="input" value="" onChange={(e) => addDep(key, group, e.target.value)}>
      <option value="">＋ add dependency…</option>
      {tasks.filter((t) => t.key !== key && !gateOf(key).all.includes(t.key) && !gateOf(key).any.includes(t.key))
        .map((t) => <option key={t.key} value={t.key}>{t.pipe} / {t.title}</option>)}
    </select>
  );

  return (
    <>
      <div className="topbar">
        <div className="row">
          <Hamburger collapsed={collapsed} onExpandSide={onExpandSide} />
          <h1>Plan</h1>
          <span className="muted" style={{ fontSize: 12 }}>{tasks.length} tasks · {plan.milestones.length} milestones{blocked.length ? <> · <span style={{ color: "var(--warn, #d8a03a)" }}>{blocked.length} blocked</span></> : null}</span>
        </div>
        <div className="row">
          <div className="plan-legend">
            <span><i className="lg done" /> done</span><span><i className="lg running" /> running</span><span><i className="lg ready" /> ready</span><span><i className="lg blocked" /> blocked</span>
          </div>
          <div className="seg">
            <button onClick={() => zoomBy(0.83)} title="Zoom out">−</button>
            <button onClick={fit} title="Fit the whole board">⌖</button>
            <button onClick={() => zoomBy(1.2)} title="Zoom in">＋</button>
          </div>
          <button className={"btn ghost" + (wide ? " on" : "")} onClick={toggleWide} title={wide ? "Compact cards" : "Widen cards to show full task names"}>⤢ {wide ? "Compact" : "Full names"}</button>
          <button className={"btn ghost" + (critOn ? " on" : "")} onClick={() => setCritOn((c) => !c)}
            title="Highlight the longest chain of remaining work — the path that sets the project's finish date">
            ⚡ Critical path{crit.path.length > 0 ? ` · ${crit.path.length}${hasEst ? " · ~" + Math.round(crit.length) + "h" : ""}` : ""}
          </button>
          <button className="btn primary" onClick={addMilestone}>＋ Milestone</button>
        </div>
      </div>
      <div className="pipe-strip">
        <span className="io-lbl" title="Pipeline sequence: click a pipeline, then the one that comes AFTER it, to connect (or disconnect). An edge A → B auto-gates every NEW task in B on A's open tasks — enforced when stages run.">⧖ pipeline timeline</span>
        {orderedPipes.map((p) => {
          const pct = pipePct(p);
          return (
            <button key={p.id} className={"pipe-chip" + (linkFrom === p.id ? " src" : "")} onClick={() => clickPipe(p.id)}
              title={linkFrom && linkFrom !== p.id ? `Connect: ${(pipeById.get(linkFrom) || {}).label} → ${p.label}` : "Click to start a sequence edge from " + p.label}>
              {p.label}{pct != null && <span className="pipe-pct">{pct}%</span>}
            </button>
          );
        })}
        {pipeDeps.filter((d) => pipeById.has(d.from) && pipeById.has(d.to)).map((d) => (
          <span className="pipe-edge" key={d.from + "→" + d.to}>
            {pipeById.get(d.from).label} → {pipeById.get(d.to).label}
            <button className="ochip-x" title="Remove this sequence edge" onClick={() => save({ ...plan, pipeDeps: pipeDeps.filter((x) => !(x.from === d.from && x.to === d.to)) })}>×</button>
          </span>
        ))}
        {linkFrom && <span className="muted" style={{ fontSize: 12 }}>connecting from <b>{(pipeById.get(linkFrom) || {}).label}</b> — click the pipeline that comes after it (click it again to cancel)</span>}
      </div>
      <div className="plan-wrap">
        {tasks.length === 0 ? (
          <div className="content"><p className="muted">No tasks yet — create tasks in a pipeline first, then wire them up here.</p></div>
        ) : (
          <svg ref={svgRef} className="plan-svg" onMouseDown={bgDown} onMouseMove={bgMove} onMouseUp={bgUp} onMouseLeave={bgUp}>
            <defs>
              <pattern id="plan-dots" width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="1" fill="var(--line)" />
              </pattern>
            </defs>
            <rect className="plan-board" width="100%" height="100%" fill="url(#plan-dots)" />
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {msBoxes.filter((b) => !b.empty).map(({ m, x, y, w, h, done, n, members, gated }) => (
                <g key={m.id} className={"plan-ms" + (selMs === m.id ? " sel" : "") + (gated ? " gated" : "")}
                  onMouseDown={(e) => startDrag(e, { type: "ms", id: m.id, keys: members, orig: Object.fromEntries(members.map((k) => [k, pos[k]])) })}>
                  <rect x={x} y={y} width={w} height={h} rx="12" className="ms-box" />
                  {Array.from({ length: Math.max(2, Math.floor(w / 26)) }, (_, i) => (
                    <rect key={i} x={x + 14 + i * 26} y={y - 4} width="9" height="8" rx="1.5" className="ms-pin" />
                  ))}
                  <circle cx={x + w - 18} cy={y + 16} r="4" className="ms-notch" />
                  <text x={x + 12} y={y + 21} className="ms-label">▦ {trunc(m.title, wide ? 60 : 28)}{m.due ? `  ·  ${m.due}` : ""}{gated ? "  ·  ⛔ gated" : ""}</text>
                  <text x={x + w - 34} y={y + 21} className="ms-count" textAnchor="end">{done}/{n}</text>
                </g>
              ))}
              {msEdges.map((e) => (
                <g key={e.id} className={"plan-edge ms" + (e.hot ? " hot" : "")}>
                  <path d={e.d} />
                  {e.vias.map(([vx, vy], i) => <circle key={i} cx={vx} cy={vy} r="2.6" className="via" />)}
                </g>
              ))}
              {edges.map((e) => (
                <g key={e.id} className={"plan-edge" + (e.hot ? " hot" : "") + (e.run ? " run" : "") + (e.crit ? " crit" : "")}>
                  <path d={e.d} />
                  {e.vias.map(([vx, vy], i) => <circle key={i} cx={vx} cy={vy} r="2.2" className="via" />)}
                </g>
              ))}
              {gates.map((g) => (
                <g key={g.id} className={"plan-gate" + (g.open ? " open" : "")} transform={`translate(${g.x},${g.y})`}>
                  <rect width={PN.GW} height={g.h || PN.GH} rx="4" />
                  <text x={PN.GW / 2} y={(g.h || PN.GH) / 2 + 3.5} textAnchor="middle">{g.kind === "all" ? "AND" : "OR"}</text>
                </g>
              ))}
              {tasks.map((t) => {
                const st = stateOf(t);
                const { x, y } = pos[t.key];
                const nw = wOf(t.key), nh = hOf(t.key);   // #13 — per-card size
                return (
                  <g key={t.key} transform={`translate(${x},${y})`} className={"plan-node " + st + (sel === t.key ? " sel" : "") + (critSet.has(t.key) ? " crit" : "")}
                    onMouseDown={(e) => startDrag(e, { type: "node", keys: [t.key], orig: { [t.key]: pos[t.key] } })}
                    onDoubleClick={() => onOpenTask(t.pid, t.tid)}>
                    <rect className="pn-box" width={nw} height={nh} rx="9" />
                    <rect className="pn-accent" x="0" y="7" width="3.5" height={nh - 14} rx="1.75" fill={pipeColor(t.pid)} />
                    <rect className="pn-prog" x="1" y={nh - 4} width={Math.max(0, (nw - 2) * t.progress / 100)} height="3" rx="1.5" />
                    <circle className="pn-pin" cx="0" cy={nh / 2} r="3" />
                    <circle className="pn-pin" cx={nw} cy={nh / 2} r="3" />
                    <text className="pn-title" x="14" y="20">{trunc(t.title, titleCharsFor(nw))}</text>
                    <text className="pn-sub" x="14" y="36"><tspan fill={pipeColor(t.pid)} style={{ fontWeight: 600 }}>{trunc(t.pipe, wide ? 40 : 12)}</tspan> · {st === "done" ? "✓ done" : st === "running" ? "● running" : st === "blocked" ? "⛔ blocked" : "○ ready"}</text>
                    {est[t.key] > 0 && <text className="pn-est" x={nw - 10} y="20" textAnchor="end">~{est[t.key]}h</text>}
                    {/* #13 — resize handle (⌘/Ctrl-drag resizes every card) */}
                    <path className="pn-resize" d={`M ${nw - 12} ${nh} L ${nw} ${nh - 12} L ${nw} ${nh} Z`}
                      onMouseDown={(e) => startResize(e, t.key)}><title>Drag to resize · ⌘-drag resizes all cards</title></path>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {critOn && !sel && !selMs && (
          <aside className="plan-panel">
            <div className="spread">
              <b style={{ fontSize: 14 }}>⚡ Critical path</b>
              <button className="btn ghost sm" onClick={() => setCritOn(false)}>✕</button>
            </div>
            {crit.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>🎉 No remaining work on any dependency chain — everything is done.</p>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 11.5, margin: "6px 0 10px" }}>
                  <b style={{ color: "var(--warn, #d8a03a)" }}>{crit.path.length}</b> task{crit.path.length === 1 ? "" : "s"} deep{hasEst ? <> · ~<b style={{ color: "var(--warn, #d8a03a)" }}>{Math.round(crit.length)}h</b> of estimated work</> : null} — the longest chain of unfinished work.
                  Nothing can shorten the project without shortening this path: split its tasks, parallelize them, or cut scope here first.
                </div>
                {crit.path.map((k, i) => {
                  const t = byKey.get(k);
                  return (
                    <div className="crit-row" key={k} onClick={() => { setSel(k); }}>
                      <span className="crit-n">{i + 1}</span>
                      <span className="dep-name" title={k}>{t ? t.title : k}</span>
                      <span className={"lg " + (doneSet.has(k) ? "done" : stateOf(t) === "running" ? "running" : "blocked")} />
                    </div>
                  );
                })}
              </>
            )}
          </aside>
        )}

        {selTask && (() => {
          const g = gateOf(sel);
          const unmet = [...g.all.filter((k) => !doneSet.has(k)), ...(g.any.length && !g.any.some((k) => doneSet.has(k)) ? g.any : [])];
          const children = blocksOf(sel);
          const mine = msOf(sel);
          const depRow = (dep, group) => (
            <div className="dep-row" key={group + dep}>
              <span className={"lg " + (doneSet.has(dep) ? "done" : "blocked")} />
              <span className="dep-name" title={dep}>{(byKey.get(dep) || {}).title || dep}</span>
              <button className="btn ghost sm" title={group === "all" ? "Move to ANY group (OR)" : "Move to ALL group (AND)"} onClick={() => flipDep(sel, group, dep)}>⇄</button>
              <button className="btn ghost sm" onClick={() => rmDep(sel, group, dep)}>×</button>
            </div>
          );
          return (
            <aside className="plan-panel">
              <div className="spread">
                <b style={{ fontSize: 14 }}>{selTask.title}</b>
                <button className="btn ghost sm" onClick={() => setSel(null)}>✕</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>{selTask.pipe} · <span className={"tag " + stateOf(selTask)}>{stateOf(selTask)}</span></div>
              <div className="side-label" style={{ padding: "0 0 4px" }}>Needs ALL of <span className="muted">(AND)</span></div>
              {g.all.map((d) => depRow(d, "all"))}
              {depPicker(sel, "all")}
              <div className="side-label" style={{ padding: "12px 0 4px" }}>Needs ANY of <span className="muted">(OR)</span></div>
              {g.any.map((d) => depRow(d, "any"))}
              {depPicker(sel, "any")}
              {(unmet.length > 0 || msBlockedBy(mine).length > 0) && (
                <div className="plan-blockers">⛔ blocked by {unmet.map((k) => <code key={k}>{(byKey.get(k) || {}).title || k}</code>)}
                  {msBlockedBy(mine).map((m) => <code key={m.id} onClick={() => { setSelMs(m.id); setSel(null); }}>▦ {m.title}</code>)}</div>
              )}
              {children.length > 0 && (
                <>
                  <div className="side-label" style={{ padding: "12px 0 4px" }}>Blocks</div>
                  <div className="plan-children">{children.map((c) => <code key={c.key} onClick={() => { setSel(c.key); }}>{c.title}</code>)}</div>
                </>
              )}
              <div className="side-label" style={{ padding: "12px 0 4px" }}>Milestone</div>
              <select className="input" value={mine ? mine.id : ""} onChange={(e) => assignMs(sel, e.target.value)}>
                <option value="">— none —</option>
                {plan.milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
              <div className="side-label" style={{ padding: "12px 0 4px" }}>Cost estimate (hours)</div>
              <input className="input" type="number" min="0" step="0.5" placeholder="e.g. 4" value={est[sel] || ""}
                title="Estimated hours of work — shown on the node and weighted into the critical path"
                onChange={(e) => { const v = Number(e.target.value); const n = { ...est }; if (v > 0) n[sel] = v; else delete n[sel]; save({ ...plan, est: n }); }} />
              <button className="btn" style={{ marginTop: 12, width: "100%" }} onClick={() => onOpenTask(selTask.pid, selTask.tid)}>Open task →</button>
            </aside>
          );
        })()}

        {selMile && (
          <aside className="plan-panel">
            <div className="spread">
              <b style={{ fontSize: 14 }}>▦ Milestone</b>
              <button className="btn ghost sm" onClick={() => setSelMs(null)}>✕</button>
            </div>
            <div className="field" style={{ marginTop: 8 }}><label>Name</label>
              <input className="input" value={selMile.title} onChange={(e) => patchMs(selMile.id, { title: e.target.value })} /></div>
            <div className="field"><label>Due (optional)</label>
              <input className="input" placeholder="e.g. 2026-08-01" value={selMile.due || ""} onChange={(e) => patchMs(selMile.id, { due: e.target.value })} /></div>
            <div className="side-label" style={{ padding: "4px 0" }}>Requires milestones <span className="muted">(must be done first)</span></div>
            {(selMile.needs || []).map((id) => msById.get(id)).filter(Boolean).map((req) => (
              <div className="dep-row" key={req.id}>
                <span className={"lg " + (msIsDone(req) ? "done" : "blocked")} />
                <span className="dep-name">▦ {req.title}</span>
                <button className="btn ghost sm" onClick={() => rmMsNeed(selMile.id, req.id)}>×</button>
              </div>
            ))}
            <select className="input" value="" onChange={(e) => e.target.value && addMsNeed(selMile.id, e.target.value)}>
              <option value="">＋ add required milestone…</option>
              {plan.milestones.filter((m) => m.id !== selMile.id && !(selMile.needs || []).includes(m.id) && !(m.needs || []).includes(selMile.id))
                .map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
            <div className="side-label" style={{ padding: "12px 0 4px" }}>Tasks · {(selMile.tasks || []).filter((k) => byKey.has(k)).length}</div>
            {(selMile.tasks || []).filter((k) => byKey.has(k)).map((k) => (
              <div className="dep-row" key={k}>
                <span className={"lg " + (doneSet.has(k) ? "done" : "blocked")} />
                <span className="dep-name">{byKey.get(k).title}</span>
                <button className="btn ghost sm" onClick={() => patchMs(selMile.id, { tasks: selMile.tasks.filter((x) => x !== k) })}>×</button>
              </div>
            ))}
            <select className="input" value="" onChange={(e) => e.target.value && assignMs(e.target.value, selMile.id)}>
              <option value="">＋ add task (unassigned only)…</option>
              {tasks.filter((t) => msIndexOf(t.key) === 999).map((t) => <option key={t.key} value={t.key}>{t.pipe} / {t.title}</option>)}
            </select>
            <button className="btn ghost" style={{ marginTop: 12, width: "100%", color: "var(--danger)" }} onClick={() => delMs(selMile.id)}>🗑 Delete milestone</button>
          </aside>
        )}
      </div>
    </>
  );
}
