// features/diff.jsx — the diff viewer modal and its parts: a git-PR file tree,
// unified/split renderers, and the inline output-file editor (#1). Reads diffs
// from the bridge (commit / branch / working) and can commit edits back.
import React, { useState, useEffect } from "react";
import * as api from "../api/client.js";
import { buildFileTree } from "../../../core/domain.js";

// #1 — minimal output-file editor: edit the text and commit the change as either
// an amend of the branch tip or a fresh commit. Layout mirrors a lightweight code
// editor: a path bar, a monospace body, and an action footer.
function FileEditor({ dir, pipeline, task, editing, setEditing, flash, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const dirty = editing.content !== editing.orig;
  const save = async (amend) => {
    setSaving(true);
    const r = await api.saveFile(dir, { pipeline, task, path: editing.path, content: editing.content, amend, message: msg });
    setSaving(false);
    if (!r.ok) return flash && flash(r.error || "save failed");
    flash && flash(r.unchanged ? "no changes to save" : amend ? "amended last commit" : "committed change");
    onSaved();
  };
  return (
    <div className="feditor">
      <div className="fe-bar">
        <span className="mono fe-path" title={editing.path}>{editing.path}</span>
        {dirty && <span className="fe-dirty" title="Unsaved changes">●</span>}
        <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
      </div>
      <textarea className="fe-body mono" spellCheck={false} value={editing.content}
        onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
      <div className="fe-foot">
        <input className="input" placeholder="commit message (new commit)" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button className="btn" onClick={() => save(true)} disabled={saving || !dirty} title="Fold this edit into the branch's last commit">Amend last commit</button>
        <button className="btn primary" onClick={() => save(false)} disabled={saving || !dirty} title="Commit this edit as a new commit">New commit</button>
      </div>
    </div>
  );
}

// Git-PR-style file explorer for DiffView: nested folders (collapsible) with
// files as leaves. Tree shape comes from the pure buildFileTree helper.
function FileTree({ tree, activePath, onPick }) {
  return (
    <div className="ftree">
      {tree.dirs.map((d) => <TreeDir key={d.path} node={d} depth={0} activePath={activePath} onPick={onPick} />)}
      {tree.files.map((f) => <TreeFile key={f.path} file={f} depth={0} active={f.path === activePath} onPick={onPick} />)}
    </div>
  );
}
function TreeDir({ node, depth, activePath, onPick }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button className="ftree-dir" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setOpen((o) => !o)} title={node.path}>
        <span className="ftree-caret">{open ? "▾" : "▸"}</span>
        <span className="ftree-name">{node.name}</span>
      </button>
      {open && node.dirs.map((d) => <TreeDir key={d.path} node={d} depth={depth + 1} activePath={activePath} onPick={onPick} />)}
      {open && node.files.map((f) => <TreeFile key={f.path} file={f} depth={depth + 1} active={f.path === activePath} onPick={onPick} />)}
    </>
  );
}
function TreeFile({ file, depth, active, onPick }) {
  return (
    <button className={"diff-file ftree-file" + (active ? " on" : "")} style={{ paddingLeft: 10 + depth * 12 }} onClick={() => onPick(file.path)} title={file.path}>
      <span className="df-path">{file.name}</span>
      <span className="df-stat"><span className="add">+{file.add}</span> <span className="del">−{file.del}</span></span>
    </button>
  );
}

export function DiffView({ dir, commit, commits = [], onCommit, branch, working, pipeline, task, onResolve, onClose, flash, onEdited }) {
  const [data, setData] = useState(null);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState("unified");
  const [msg, setMsg] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null);   // #1 — { path, content, orig } | null
  const single = !branch && !working;
  const canEdit = !!(pipeline && task);
  useEffect(() => {
    let on = true; setData(null); setActive(0);
    (working ? api.getWorkingDiff(dir) : branch ? api.getBranchDiff(dir, pipeline, task) : api.getDiff(dir, commit)).then((d) => { if (on) setData(d); });
    return () => { on = false; };
  }, [dir, commit, branch, working, pipeline, task, reloadKey]);
  const idx = single ? commits.findIndex((c) => c.sha === commit) : -1;
  const go = (d) => { const j = idx + d; if (single && onCommit && j >= 0 && j < commits.length) onCommit(commits[j].sha); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); else if (single && e.key === "ArrowLeft") go(-1); else if (single && e.key === "ArrowRight") go(1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, commits.length, single]);
  const all = (data && data.files) || [];
  const meaningful = all.filter((f) => !/\/metadata\.json$|\/README\.md$|\/prompts\.md$|\.gitkeep$/.test(f.path));
  const files = meaningful.length ? meaningful : all;
  const file = files[active] || files[0];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="diffwin" onClick={(e) => e.stopPropagation()}>
        <div className="diff-hd">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            {single && commits.length > 1 && (
              <div className="row" style={{ gap: 4 }}>
                <button className="btn ghost sm" disabled={idx <= 0} onClick={() => go(-1)} title="Previous commit (←)">‹</button>
                <span className="muted mono" style={{ fontSize: 11 }}>{idx >= 0 ? idx + 1 : "?"}/{commits.length}</span>
                <button className="btn ghost sm" disabled={idx < 0 || idx >= commits.length - 1} onClick={() => go(1)} title="Next commit (→)">›</button>
              </div>
            )}
            {single && <span className="mono" style={{ fontSize: 11, color: "var(--txt-3)" }}>{commit.slice(0, 7)}</span>}
            <b style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 13 }}>
              {data
                ? working ? `Uncommitted on ${data.base || "main"} · ${files.length} file${files.length === 1 ? "" : "s"}${data.untracked && data.untracked.length ? ` · +${data.untracked.length} untracked` : ""}`
                  : branch ? `All changes · ${data.branch || ""} · ${files.length} file${files.length === 1 ? "" : "s"}`
                    : (data.subject || "changes")
                : "loading…"}
            </b>
          </div>
          <div className="row">
            {canEdit && file && !file.binary && !editing && (
              <button className="btn ghost sm" title="Edit this file and commit the change" onClick={async () => {
                const r = await api.getFile(dir, pipeline, task, file.path);
                if (!r.ok) return flash && flash(r.error || "couldn't open file");
                setEditing({ path: file.path, content: r.content, orig: r.content });
              }}>✎ Edit</button>
            )}
            <div className="seg">
              <button className={mode === "unified" ? "on" : ""} onClick={() => setMode("unified")}>Unified</button>
              <button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")}>Split</button>
            </div>
            <button className="btn ghost sm" onClick={onClose}>✕</button>
          </div>
        </div>
        {onResolve && (
          <div className="diff-resolve">
            <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>Resolve before merging:</span>
            <input className="input" style={{ flex: 1 }} placeholder="commit message (blank → opencode writes it from the diff)" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onResolve("commit", msg)} />
            <button className="btn" onClick={() => onResolve("stash")} title="git stash -u, then merge">Stash &amp; merge</button>
            <button className="btn primary" onClick={() => onResolve("commit", msg)}>Commit &amp; merge</button>
          </div>
        )}
        <div className="diff-body">
          <div className="diff-files">
            {files.length
              ? <FileTree tree={buildFileTree(files)} activePath={file && file.path} onPick={(p) => setActive(files.findIndex((f) => f.path === p))} />
              : <div className="muted" style={{ padding: 12, fontSize: 12 }}>{data ? "No file changes." : "Loading…"}</div>}
          </div>
          <div className="diff-pane">
            {editing
              ? <FileEditor dir={dir} pipeline={pipeline} task={task} editing={editing} setEditing={setEditing} flash={flash}
                  onSaved={() => { setEditing(null); setReloadKey((k) => k + 1); onEdited && onEdited(); }} />
              : file && (file.binary ? <div className="muted" style={{ padding: 16 }}>Binary file.</div> : mode === "unified" ? <UnifiedDiff file={file} /> : <SplitDiff file={file} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function UnifiedDiff({ file }) {
  return (
    <div className="diff-code">
      {file.hunks.map((h, hi) => (
        <React.Fragment key={hi}>
          <div className="dl hunk"><span className="g" /><span className="g" /><span className="dt">@@ {h.header}</span></div>
          {h.lines.map((l, li) => (
            <div key={li} className={"dl " + (l.t === "+" ? "add" : l.t === "-" ? "del" : "ctx")}>
              <span className="g">{l.oldNo || ""}</span><span className="g">{l.newNo || ""}</span>
              <span className="dt"><span className="sgn">{l.t}</span>{l.text}</span>
            </div>
          ))}
        </React.Fragment>
      ))}
      {!file.hunks.length && <div className="muted" style={{ padding: 12 }}>No textual changes.</div>}
    </div>
  );
}

function SplitDiff({ file }) {
  const rows = [];
  file.hunks.forEach((h) => {
    rows.push({ hunk: h.header });
    const L = h.lines; let i = 0;
    while (i < L.length) {
      if (L[i].t === " ") { rows.push({ l: L[i], r: L[i] }); i++; continue; }
      const dels = [], adds = [];
      while (i < L.length && L[i].t === "-") dels.push(L[i++]);
      while (i < L.length && L[i].t === "+") adds.push(L[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ l: dels[k] || null, r: adds[k] || null });
    }
  });
  const Side = ({ c, sign }) => <div className={"side " + (c ? (c.t === sign ? (sign === "+" ? "add" : "del") : "ctx") : "empty")}><span className="g">{c ? (sign === "+" ? c.newNo : c.oldNo) || "" : ""}</span><span className="dt">{c ? c.text : ""}</span></div>;
  return (
    <div className="diff-code split">
      {rows.map((row, ri) => row.hunk !== undefined
        ? <div key={ri} className="dl hunk"><span className="dt">@@ {row.hunk}</span></div>
        : <div key={ri} className="dl-split"><Side c={row.l} sign="-" /><Side c={row.r} sign="+" /></div>)}
    </div>
  );
}
