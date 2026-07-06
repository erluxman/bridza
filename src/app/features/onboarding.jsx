// features/onboarding.jsx — first-run + creation surfaces: the Welcome/open-repo
// screen, the AI-assisted pipeline picker, and the new-pipeline / new-task modals.
import { useState, useEffect, useRef } from "react";
import * as api from "../api/client.js";
import { STARTER_PIPELINES, pipelineFlows, parsePipelineFile, recommendFlow } from "../../../core/domain.js";
import { base, slug, lsGet, lsSet, recKey } from "../lib/format.js";
import { Modal, Field } from "../ui.jsx";

export function Welcome({ recents, onPick, onOpen, onForget, error }) {
  const [typed, setTyped] = useState("");
  // On the DEPLOYED (static) site there is no local bridge — no folder picker,
  // no git, no CLI runs. Probe once and say so up front instead of offering
  // buttons that can only fail. Locally the probe returns the tool list.
  const [bridge, setBridge] = useState(null);   // null = probing, then true/false
  useEffect(() => { api.getTools("").then((r) => setBridge(!!(r && r.tools))); }, []);
  return (
    <div className="center">
      <div className="panel">
        <h2>Bridza</h2>
        <p className="muted">Agentic project management. Open a repo — its <code>.bridza/</code> is your database.</p>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        {bridge === false ? (
          <div className="no-bridge">
            <p style={{ margin: "14px 0 6px" }}>🌐 <b>You're on the hosted preview.</b> A web page can't open your file manager or touch your repos — Bridza runs on <i>your</i> machine, where it drives git and your local <code>claude</code>/<code>opencode</code> CLIs.</p>
            <pre className="mono">{"git clone https://github.com/erluxman/bridza\ncd bridza && pnpm install && pnpm dev"}</pre>
            <p className="muted" style={{ fontSize: 12.5 }}>then open <code>http://localhost:5173/app</code> and this screen will pick folders for real.</p>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={onPick}>Open folder…</button>
            <input className="input" placeholder="…or paste a path" value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && typed.trim() && onOpen(typed.trim())} />
          </div>
        )}
        {recents.length > 0 && (
          <div className="recents">
            <div className="side-label" style={{ padding: "10px 0 4px" }}>Recents</div>
            {recents.map((d) => (
              <div className="spread" key={d}>
                <button className="btn ghost" style={{ flex: 1, justifyContent: "flex-start" }} onClick={() => onOpen(d)}>
                  <b>{base(d)}</b>&nbsp;<span className="muted mono" style={{ fontSize: 11 }}>{d}</span>
                </button>
                <button className="btn ghost sm" onClick={() => onForget(d)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PipelinePicker({ dir, repo, onClose, onCreated, flash }) {
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [desc, setDesc] = useState(() => lsGet(recKey(dir), ""));
  const [analyzedDesc, setAnalyzedDesc] = useState("");
  const [recs, setRecs] = useState(null);
  const [recBusy, setRecBusy] = useState(false);
  const toggle = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const analyze = async () => {
    if (!desc.trim()) return;
    setRecBusy(true); setRecs(null);
    const r = await api.recommendPipelines(dir, desc.trim());
    setRecBusy(false);
    if (!r.ok || !Array.isArray(r.recommendations)) return flash(r.error || "recommendation failed");
    setRecs(r.recommendations);
    setAnalyzedDesc(desc.trim());
    // Merge AI recs with existing manual selections
    setSel((s) => [...new Set([...s, ...r.recommendations.map((x) => x.id)])]);
    lsSet(recKey(dir), desc.trim());
  };
  const clearAll = () => { setDesc(""); setAnalyzedDesc(""); setRecs(null); setSel([]); lsSet(recKey(dir), null); };
  const create = async () => {
    setBusy(true);
    let first = "";
    for (const id of sel) {
      const tpl = STARTER_PIPELINES.find((p) => p.id === id);
      const r = await api.createPipeline(dir, tpl);
      if (r.ok) first = first || r.id; else flash(r.error);
    }
    setBusy(false);
    if (first) onCreated(first);
  };
  const best = (id) => recs && recs.find((r) => r.id === id);
  const descChanged = recs && desc.trim() !== analyzedDesc;
  return (
    <div className="center">
      <div className="panel">
        <h2>Set up <span className="mono" style={{ fontSize: 15 }}>{base(repo)}</span></h2>
        <p className="muted">No pipelines yet. Describe your project and let AI recommend pipelines, or pick manually.</p>
        <div className="field">
          <label>Describe your project</label>
          <textarea className="input" rows={3} placeholder="e.g. We build a cross-platform mobile app with a web dashboard, need marketing pages, content blog, and customer support." value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="spread" style={{ marginBottom: 14 }}>
          <button className="btn ghost sm" title="Clear description and recommendations" onClick={clearAll}>Clear</button>
          <button className="btn primary" disabled={!desc.trim() || recBusy} onClick={analyze}>{recBusy ? "Analyzing…" : "Analyze with AI ✦"}</button>
        </div>
        {recs && recs.length > 0 && <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>AI recommended {recs.length} pipeline{recs.length === 1 ? "" : "s"} — adjust selections below then create.</p>}
        {recs && recs.length === 0 && <p className="muted" style={{ fontSize: 12, margin: "0 0 10px", color: "var(--warn)" }}>AI found no matching pipelines. Try a more detailed description or pick manually below.</p>}
        {descChanged && <p className="muted" style={{ fontSize: 11, margin: "-6px 0 10px", color: "var(--warn)" }}>Description changed — re-run Analyze to refresh recommendations.</p>}
        <div className="picker">
          {STARTER_PIPELINES.map((p) => { const fl = pipelineFlows(p); const b = best(p.id); return (
            <button key={p.id} className={"pick" + (sel.includes(p.id) ? " on" : "")} onClick={() => toggle(p.id)}>
              <div className="spread" style={{ gap: 4 }}>
                <b>{p.label}</b>
                {b && <span className="tag" style={{ fontSize: 10 }}>✦ {b.score}/10</span>}
              </div>
              <div className="meta">{fl.length > 1 ? fl.length + " flows · " + fl.map((f) => f.name).join(", ") : fl[0].stages.map((s) => s.name).join(" → ")}</div>
              {b && <div className="meta" style={{ color: "var(--accent)", fontSize: 11, marginTop: 2 }}>{b.reason}</div>}
            </button>
          ); })}
        </div>
        <div className="spread">
          <button className="btn ghost" onClick={onClose}>Close project</button>
          <button className="btn primary" disabled={!sel.length || busy} onClick={create}>{busy ? "Creating…" : `Create ${sel.length || ""} pipeline${sel.length === 1 ? "" : "s"}`}</button>
        </div>
      </div>
    </div>
  );
}

export function NewPipelineModal({ dir, existing, onClose, onDone, flash }) {
  const [label, setLabel] = useState("");
  const [workingDir, setWorkingDir] = useState(".");
  const [tplId, setTplId] = useState(STARTER_PIPELINES[0].id);
  const [imported, setImported] = useState(null);
  const importRef = useRef(null);
  const [aiDesc, setAiDesc] = useState("");
  const [aiRecs, setAiRecs] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const create = async () => {
    const tpl = imported || STARTER_PIPELINES.find((p) => p.id === tplId);
    const id = slug(label || tpl.label);
    if (existing.includes(id)) return flash("pipeline id already exists");
    const r = await api.createPipeline(dir, { id, label: label || tpl.label, workingDir, stages: tpl.stages || [], flows: tpl.flows || [], templates: tpl.templates || [] });
    if (r.ok) onDone(r.id); else flash(r.error);
  };
  const importPipelineFile = (file) => {
    const rd = new FileReader();
    rd.onload = () => {
      const r = parsePipelineFile(String(rd.result));
      if (r.error) return flash(r.error);
      setImported(r.pipeline);
      setAiRecs(null); // importing clears AI recommendations
      if (r.pipeline.workingDir) setWorkingDir(r.pipeline.workingDir);
      flash(`pipeline “${r.pipeline.label}” loaded from file — Create to add it`);
    };
    rd.readAsText(file);
  };
  const analyze = async () => {
    if (!aiDesc.trim()) return;
    setAiBusy(true); setAiRecs(null);
    const r = await api.recommendPipelines(dir, aiDesc.trim());
    setAiBusy(false);
    if (!r.ok || !Array.isArray(r.recommendations)) return flash(r.error || "recommendation failed");
    setAiRecs(r.recommendations);
    if (r.recommendations.length) {
      setTplId(r.recommendations[0].id);
      setLabel(r.recommendations[0].label);
    }
  };
  const backFromImport = () => { setImported(null); setAiRecs(null); };
  const chosen = imported || STARTER_PIPELINES.find((p) => p.id === tplId);
  const chosenFlows = pipelineFlows(chosen);
  return (
    <Modal title="New pipeline" onClose={onClose} onConfirm={create} confirm="Create">
      <Field label="Name"><input className="input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={imported ? imported.label : "e.g. Marketing"} /></Field>
      {!imported && (
        <Field label="AI recommend (optional)">
          <textarea className="input" rows={2} placeholder="e.g. We need a pipeline for our content marketing team — blog posts, social media, and newsletter production." value={aiDesc} onChange={(e) => setAiDesc(e.target.value)} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn primary sm" disabled={!aiDesc.trim() || aiBusy} onClick={analyze}>{aiBusy ? "Analyzing…" : "Analyze with AI ✦"}</button>
            {aiRecs && aiRecs.length > 0 && <span className="tag" style={{ fontSize: 11 }}>{aiRecs.length} found</span>}
            {aiRecs && aiRecs.length === 0 && <span className="muted" style={{ fontSize: 11 }}>No matches — try a different description</span>}
            {aiRecs && <button className="btn ghost sm" title="Clear AI recommendations" onClick={() => setAiRecs(null)}>Clear</button>}
          </div>
          {aiRecs && aiRecs.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              {aiRecs.map((r) => (
                <div key={r.id} className="row" style={{ marginBottom: 3 }}>
                  <button className={"btn ghost sm" + (tplId === r.id ? " on" : "")} onClick={() => { setTplId(r.id); setLabel(r.label); }}>{r.label}</button>
                  <span className="tag" style={{ fontSize: 10 }}>✦ {r.score}/10</span>
                  <span className="muted" style={{ fontSize: 11 }}>{r.reason}</span>
                </div>
              ))}
            </div>
          )}
        </Field>
      )}
      {imported ? (
        <Field label="From file">
          <div className="row">
            <span className="tag">⤒ {imported.label} · {chosenFlows.length} flow{chosenFlows.length === 1 ? "" : "s"}</span>
            <button className="btn ghost sm" onClick={backFromImport} title="Back to the built-in templates">× use a template instead</button>
          </div>
        </Field>
      ) : (
        <Field label="Pipeline template">
          <div className="row">
            <select className="input" style={{ flex: 1 }} value={tplId} onChange={(e) => setTplId(e.target.value)}>
              {STARTER_PIPELINES.map((p) => { const fl = pipelineFlows(p); return (
                <option key={p.id} value={p.id}>{p.label} — {fl.length > 1 ? fl.length + " flows: " + fl.map((f) => f.name).join(", ") : fl[0].stages.map((s) => s.name).join(" → ")}</option>
              ); })}
            </select>
            <button className="btn ghost sm" onClick={() => importRef.current && importRef.current.click()} title="Import a whole pipeline from a .json file exported by any Bridza project">⤒ Import…</button>
            <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) importPipelineFile(f); e.target.value = ""; }} />
          </div>
        </Field>
      )}
      <div className="muted" style={{ fontSize: 12, margin: "2px 0 10px" }}>
        {chosenFlows.map((f) => <div key={f.id}><b>{f.name}</b>: {(f.stages || []).map((s) => s.name).join(" → ")}</div>)}
      </div>
      <Field label="Working dir (sparse-checkout scope; '.' = whole repo)"><input className="input" value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} /></Field>
    </Modal>
  );
}

export function NewTaskModal({ dir, pipeline, onClose, onDone, flash }) {
  const flows = pipelineFlows(pipeline);
  const [title, setTitle] = useState("");
  // one flow → preselected; several → auto-pick the most APPROPRIATE flow from
  // the title (recommendFlow), but let the user override — once they touch the
  // select we stop auto-picking.
  const [flowId, setFlowId] = useState(flows.length === 1 ? flows[0].id : "");
  const [touched, setTouched] = useState(false);
  const [autoPicked, setAutoPicked] = useState(false);
  const onTitle = (v) => {
    setTitle(v);
    if (touched || flows.length === 1) return;
    const rec = recommendFlow(pipeline, v).id;
    setFlowId(rec);
    setAutoPicked(!!rec);
  };
  const chosen = flows.find((f) => f.id === flowId);
  const create = async () => {
    if (!chosen) return flash("pick a stage flow — every task belongs to exactly one");
    const id = slug(title || "task").slice(0, 40) || "task";
    const r = await api.createTask(dir, { pipeline: pipeline.id, id, title, flow: flowId });
    if (r.ok) onDone(r.id); else flash(r.error);
  };
  return (
    <Modal title={`New task in ${pipeline.label}`} onClose={onClose} onConfirm={create} confirm="Create">
      <Field label="Title"><input className="input" autoFocus value={title} onChange={(e) => onTitle(e.target.value)} placeholder="e.g. Q3 launch microsite" /></Field>
      {flows.length > 1 && (
        <Field label={autoPicked && !touched ? "Stage flow (auto-picked from the title — change if wrong)" : "Stage flow (required — what kind of work is this?)"}>
          <select className="input" value={flowId} onChange={(e) => { setTouched(true); setAutoPicked(false); setFlowId(e.target.value); }}>
            <option value="" disabled>Choose a stage flow…</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name} — {(f.stages || []).map((s) => s.name).join(" → ")}</option>)}
          </select>
        </Field>
      )}
      <p className="muted" style={{ fontSize: 12 }}>{chosen
        ? <>Flow <b>{chosen.name}</b>: {(chosen.stages || []).map((s) => s.name).join(" → ")}. Gets a #ref and branch <code>bridza/{pipeline.id}/…</code>.</>
        : <>Pick the flow this task constitutes. Don't sweat a borderline call — at implementation time the flow's ⚖ judge stage re-checks the fit (with the research/requirements in hand) and flags a mis-filed task.</>}</p>
    </Modal>
  );
}
