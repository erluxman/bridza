// features/nav.jsx — the left-hand navigation surfaces: the pipeline sidebar
// (project switcher, running tasks, pipeline list, archive), the project Inbox,
// and the per-item "send to pipeline" menu.
import { useState } from "react";
import * as api from "../api/client.js";
import { base } from "../lib/format.js";
import { Hamburger } from "../ui.jsx";

export function Sidebar({ proj, running, runningTasks, active, onPipe, onNewPipe, onClose, onPick, recents, onOpen, onOpenTask, onCollapse, inboxCount, inboxActive, onInbox, planActive, onPlan }) {
  const [menu, setMenu] = useState(false);
  const [showArch, setShowArch] = useState(false);
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
          <div className="brand">⎇ Bridza</div>
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
            <button key={p.id} className={"pipe" + (p.id === active ? " on" : "")} onClick={() => onPipe(p.id)}>
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
                <button key={p.id} className={"pipe archived" + (p.id === active ? " on" : "")} onClick={() => onPipe(p.id)}>
                  <span className="dot" /> {p.label} <span className="n">{p.tasks.length}</span>
                </button>
              ))}
            </>
          );
        })()}
      </div>
    </div>
  );
}

export function Inbox({ dir, proj, onChange, onOpenTask, flash, collapsed, onExpandSide }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("idea");
  const items = proj.inbox || [];
  const add = async () => { if (!text.trim()) return; const r = await api.addInbox(dir, { kind, text }); if (r.ok) { setText(""); onChange(); } else flash(r.error); };
  const discard = async (id) => { await api.discardInbox(dir, id); onChange(); };
  const promote = async (id, pid) => { const r = await api.promoteInbox(dir, { id, pipeline: pid }); if (r.ok) { flash("sent to " + pid); onOpenTask(pid, r.task.id); } else flash(r.error); };
  return (
    <>
      <div className="topbar">
        <div className="row"><Hamburger collapsed={collapsed} onExpandSide={onExpandSide} /><h1>Inbox</h1><span className="muted">{items.length}</span></div>
      </div>
      <div className="content" style={{ maxWidth: 780 }}>
        <p className="muted" style={{ marginTop: 0 }}>Capture ideas, bugs and requests for this project. Route each into a pipeline (it becomes a task), or discard.</p>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 8 }}>
            <select className="input" style={{ width: 120 }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="idea">Idea</option><option value="bug">Bug</option><option value="feature">Feature</option>
            </select>
            <input className="input" placeholder="Capture an idea, bug or request… (Enter)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="btn primary" onClick={add} disabled={!text.trim()}>Capture</button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="muted">Inbox is empty.</p>
        ) : (
          <div className="inbox-list">
            {items.map((it) => (
              <div className="inbox-item" key={it.id}>
                <span className={"tag kind-" + it.kind}>{it.kind}</span>
                <div className="inbox-text">{it.text}<div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{it.time ? new Date(it.time).toLocaleString() : ""}</div></div>
                <PromoteMenu pipelines={proj.pipelines} onPromote={(pid) => promote(it.id, pid)} />
                <button className="btn ghost sm" onClick={() => discard(it.id)} title="Discard">🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PromoteMenu({ pipelines, onPromote }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)}>→ Send to ▾</button>
      {open && (
        <div className="proj-menu" style={{ right: 0, left: "auto", minWidth: 160 }} onMouseLeave={() => setOpen(false)}>
          {pipelines.length ? pipelines.map((p) => (
            <button className="item" key={p.id} onClick={() => { setOpen(false); onPromote(p.id); }}>{p.label}</button>
          )) : <div className="muted" style={{ padding: 8, fontSize: 12 }}>No pipelines yet</div>}
        </div>
      )}
    </div>
  );
}
