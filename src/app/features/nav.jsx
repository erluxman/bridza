// features/nav.jsx — the left-hand navigation surfaces: the pipeline sidebar
// (project switcher, running tasks, pipeline list, archive), the project Inbox,
// and the per-item "send to pipeline" menu.
import { useState } from "react";
import * as api from "../api/client.js";
import { pipelineFlows, shortTitle } from "../../../core/domain.js";
import { base } from "../lib/format.js";
import { Hamburger, Modal, Field, Expandable } from "../ui.jsx";

export function Sidebar({ proj, running, runningTasks, active, onPipe, onNewPipe, onClose, onPick, recents, onOpen, onOpenTask, onCollapse, inboxCount, inboxActive, onInbox, planActive, onPlan, dir, onChange, flash, firstLaunch }) {
  const [menu, setMenu] = useState(false);
  const [showArch, setShowArch] = useState(false);
  // right-click a pipeline → our own menu (native browser menu suppressed)
  const [ctx, setCtx] = useState(null);   // { id, label, archived, x, y }
  const openCtx = (e, p) => { e.preventDefault(); setCtx({ id: p.id, label: p.label, archived: !!p.archived, x: e.clientX, y: e.clientY }); };
  const doArchive = async () => {
    const c = ctx; setCtx(null);
    const r = await api.archivePipeline(dir, { id: c.id, archived: !c.archived });
    if (r && r.ok) { flash && flash(r.archived ? `"${c.label}" archived — data kept, hidden` : `"${c.label}" restored`); onChange && onChange(); }
    else flash && flash((r && r.error) || "archive failed");
  };
  const doDelete = async () => {
    const c = ctx; setCtx(null);
    if (!window.confirm(`Delete pipeline "${c.label}" and ALL its flows & tasks?\n\nThe entry is removed from the database; git history stays on task branches. This can't be undone from here.`)) return;
    const r = await api.deletePipeline(dir, { id: c.id });
    if (r && r.ok) { flash && flash(`"${c.label}" deleted — git history kept`, 4500); onChange && onChange(); }
    else flash && flash((r && r.error) || "delete failed");
  };
  // one entry per running TASK across ALL pipelines (a task may have several
  // live stage runs during auto-advance — collapse to the task)
  const liveTasks = [];
  const seen = new Set();
  for (const r of running || []) {
    const key = r.pipeline + "/" + r.task;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = proj.pipelines.find((x) => x.id === r.pipeline);
    const t = p && p.tasks.find((x) => x.id === r.task);
    liveTasks.push({ pid: r.pipeline, tid: r.task, stage: r.stage, title: (t && t.ref ? "#" + t.ref + " " : "") + ((t && t.title) || r.task), pipe: (p && p.label) || r.pipeline });
  }
  return (
    <div className="side">
      <div className="side-hd">
        <div className="spread">
          <div className={"brand" + (firstLaunch ? " pulse" : "")}>⎇ Bridza</div>
          <button className="btn ghost sm" title="Collapse" onClick={onCollapse}>‹</button>
        </div>
        <div className="proj-switch">
          <button className="btn proj-btn" onClick={() => setMenu((m) => !m)}>
            <span>{proj.business.name || base(proj.repo)}</span><span className="muted">▾</span>
          </button>
          {menu && (
            <div className="proj-menu" onMouseLeave={() => setMenu(false)}>
              <div className="path" style={{ padding: "4px 9px" }}>{proj.repo}</div>
              <button className="item" onClick={() => { setMenu(false); onPick(); }}>＋ Open another project…</button>
              {/* proj.repo is the RESOLVED path (macOS: /tmp → /private/tmp) — compare both forms */}
              {recents.filter((d) => d !== proj.repo && "/private" + d !== proj.repo && d !== "/private" + proj.repo).map((d) => (
                <button className="item" key={d} onClick={() => { setMenu(false); onOpen(d); }}>{base(d)} <span className="path">{d}</span></button>
              ))}
              <button className="item" onClick={() => { setMenu(false); onClose(); }}>✕ Close project</button>
            </div>
          )}
        </div>
      </div>
      <div className="side-scroll">
        <button className={"pipe" + (inboxActive ? " on" : "")} onClick={onInbox} style={{ marginBottom: 4 }}>
          📥 Inbox {inboxCount > 0 && <span className="n">{inboxCount}</span>}
        </button>
        <button className={"pipe" + (planActive ? " on" : "")} onClick={onPlan} style={{ marginBottom: 4 }}>
          🗺 Plan
        </button>
        {liveTasks.length > 0 && (
          <div className="running-tasks" style={{ margin: "2px 0 10px", borderLeftColor: "var(--accent)" }}>
            <div className="side-sub">Running now · {liveTasks.length}</div>
            {liveTasks.map((r) => (
              <button key={r.pid + "/" + r.tid} className="run-task" onClick={() => onOpenTask(r.pid, r.tid)} title={`${r.pipe} · ${r.title} — stage ${r.stage}`}>
                <span className="livedot" />
                <span className="rt-name">{r.title}</span>
                <span className="rt-pipe">{r.pipe}</span>
              </button>
            ))}
          </div>
        )}
        <div className="side-label">Pipelines</div>
        {proj.pipelines.filter((p) => !p.archived).map((p) => {
          const nLive = (p.tasks || []).filter((t) => runningTasks.has(p.id + "/" + t.id)).length;
          return (
            <button key={p.id} className={"pipe" + (p.id === active ? " on" : "")} onClick={() => onPipe(p.id)} onContextMenu={(e) => openCtx(e, p)}>
              <span className="dot" /> {p.label} <span className="n">{p.tasks.length}</span>
              {nLive > 0 && <span className="run-badge" title={`${nLive} running`}>🔄 {nLive}</span>}
            </button>
          );
        })}
        <button className="pipe" onClick={onNewPipe} style={{ color: "var(--txt-3)" }}>＋ New pipeline</button>
        {(() => {
          // archived pipelines: data kept, list hidden — one toggle away
          const arch = proj.pipelines.filter((p) => p.archived);
          if (!arch.length) return null;
          return (
            <>
              <button className="pipe arch-tog" onClick={() => setShowArch((s) => !s)} title="Archived pipelines — all data is kept, just hidden">
                {showArch ? "▾" : "▸"} 📦 Archived <span className="n">{arch.length}</span>
              </button>
              {showArch && arch.map((p) => (
                <button key={p.id} className={"pipe archived" + (p.id === active ? " on" : "")} onClick={() => onPipe(p.id)} onContextMenu={(e) => openCtx(e, p)}>
                  <span className="dot" /> {p.label} <span className="n">{p.tasks.length}</span>
                </button>
              ))}
            </>
          );
        })()}
      </div>
      {ctx && (
        <>
          <div className="ctx-backdrop" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div className="proj-menu ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
            <button className="item" onClick={doArchive}>{ctx.archived ? "⇱ Unarchive" : "📦 Archive"} <span className="path">data kept</span></button>
            <button className="item danger" onClick={doDelete}>🗑 Delete <span className="path">git history kept</span></button>
          </div>
        </>
      )}
    </div>
  );
}

export function Inbox({ dir, proj, onChange, onOpenTask, flash, collapsed, onExpandSide }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("idea");
  // a pipeline/flow has been picked — confirm the title before the task exists
  const [promo, setPromo] = useState(null);   // { item, pid, flowId }
  const items = proj.inbox || [];
  const add = async () => { if (!text.trim()) return; const r = await api.addInbox(dir, { kind, text }); if (r.ok) { setText(""); onChange(); } else flash(r.error); };
  const discard = async (id) => { await api.discardInbox(dir, id); onChange(); };
  const promote = async ({ title, description }) => {
    const { item, pid, flowId } = promo;
    const r = await api.promoteInbox(dir, { id: item.id, pipeline: pid, flow: flowId || "", title, description });
    setPromo(null);
    if (r.ok) { flash("sent to " + pid); onChange(); onOpenTask(pid, r.task.id); } else flash(r.error);
  };
  return (
    <>
      <div className="topbar">
        <div className="row"><Hamburger collapsed={collapsed} onExpandSide={onExpandSide} /><h1>Inbox</h1><span className="muted">{items.length}</span></div>
      </div>
      <div className="content" style={{ maxWidth: 780 }}>
        <p className="muted" style={{ marginTop: 0 }}>Capture ideas, bugs and requests for this project — write as much as you want, the full text becomes the task's brief. Route each into a pipeline (it becomes a task), or discard.</p>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <select className="input" style={{ width: 120, flex: "0 0 auto" }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="idea">Idea</option><option value="bug">Bug</option><option value="feature">Feature</option>
            </select>
            {/* multi-line on purpose: the whole capture survives into the task's
                context.md, so there's no reason to squeeze it onto one line */}
            <textarea className="input" rows={3} placeholder="Capture an idea, bug or request — as much detail as you like. (Enter to capture, Shift+Enter for a new line)"
              value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } }} />
            <button className="btn primary" style={{ flex: "0 0 auto" }} onClick={add} disabled={!text.trim()}>Capture</button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="muted">Inbox is empty.</p>
        ) : (
          <div className="inbox-list">
            {items.map((it) => (
              <div className="inbox-item" key={it.id}>
                <span className={"tag kind-" + it.kind}>{it.kind}</span>
                <div className="inbox-text">
                  <Expandable text={it.text} lines={3} />
                  <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{it.time ? new Date(it.time).toLocaleString() : ""}</div>
                </div>
                <PromoteMenu pipelines={proj.pipelines} onPromote={(pid, flowId) => setPromo({ item: it, pid, flowId })} />
                <button className="btn ghost sm" onClick={() => discard(it.id)} title="Discard">🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {promo && <PromoteModal promo={promo} pipelines={proj.pipelines} onClose={() => setPromo(null)} onConfirm={promote} flash={flash} />}
    </>
  );
}

/* Idea → task. The task TITLE is a headline (a dozen words, editable here);
   the description keeps the capture verbatim and lands in the task's
   context.md, which every stage prompt reads. */
function PromoteModal({ promo, pipelines, onClose, onConfirm, flash }) {
  const { item, pid, flowId } = promo;
  const [title, setTitle] = useState(() => shortTitle(item.text) || item.kind);
  const [description, setDescription] = useState(item.text || "");
  const pipe = pipelines.find((p) => p.id === pid);
  const flow = pipe && pipelineFlows(pipe).find((f) => f.id === flowId);
  const create = () => {
    if (!title.trim()) return flash("give the task a title");
    onConfirm({ title: title.trim(), description });
  };
  return (
    <Modal title={`Send to ${pipe ? pipe.label : pid}`} onClose={onClose} onConfirm={create} confirm="Create task →">
      <Field label="Title — a headline, kept short so the board and task header stay readable">
        <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()} placeholder="e.g. Clarify stage flow ordering" />
      </Field>
      <Field label="Description — the full capture, saved as the task's brief (context.md)">
        <textarea className="input" style={{ minHeight: 140 }} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <p className="muted" style={{ fontSize: 12 }}>
        Nothing is dropped: every word above is written to the task's <code>context.md</code> and fed to each stage prompt.
        {flow ? <> Starts in flow <b>{flow.name}</b>: {(flow.stages || []).map((s) => s.name).join(" → ")}.</> : null}
      </p>
    </Modal>
  );
}

function PromoteMenu({ pipelines, onPromote }) {
  const [open, setOpen] = useState(false);
  // picking a pipeline with >1 stage flow opens a second level to choose which
  // flow (i.e. which stage sequence) the task should start in — mirrors the
  // flow picker in NewTaskModal (onboarding.jsx).
  const [sub, setSub] = useState(null);   // pipeline object, or null
  const close = () => { setOpen(false); setSub(null); };
  const pick = (p) => {
    const flows = pipelineFlows(p);
    if (flows.length > 1) { setSub(p); return; }
    close(); onPromote(p.id, flows[0] ? flows[0].id : "");
  };
  return (
    <div style={{ position: "relative" }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)}>→ Send to ▾</button>
      {open && (
        <div className="proj-menu" style={{ right: 0, left: "auto", minWidth: 180, maxWidth: 300 }} onMouseLeave={close}>
          {sub ? (
            <>
              <button className="item" onClick={() => setSub(null)}>‹ Back</button>
              <div className="muted" style={{ padding: "4px 8px", fontSize: 11 }}>{sub.label} — pick a stage flow</div>
              {pipelineFlows(sub).map((f) => (
                <button className="item" key={f.id} onClick={() => { close(); onPromote(sub.id, f.id); }}>
                  {f.name} <span className="path">{(f.stages || []).map((s) => s.name).join(" → ")}</span>
                </button>
              ))}
            </>
          ) : pipelines.length ? pipelines.map((p) => (
            <button className="item" key={p.id} onClick={() => pick(p)}>{p.label}</button>
          )) : <div className="muted" style={{ padding: 8, fontSize: 12 }}>No pipelines yet</div>}
        </div>
      )}
    </div>
  );
}
