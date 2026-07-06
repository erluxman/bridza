// features/flow.jsx — the pipeline stage-flow editor: several named flows side by
// side, each a sequence of FlowNode stages (system prompt, specs, tool, gate,
// shell checks, outputs). Flows/pipelines export + import as portable JSON.
import { useState, useRef } from "react";
import * as api from "../api/client.js";
import { pipelineFlows, exportFlow, parseFlowFile, exportPipeline, parsePipelineFile, SPEC_CATALOG, specLabel, specValues } from "../../../core/domain.js";
import { slug, downloadJSON } from "../lib/format.js";
import { Hamburger, Modal } from "../ui.jsx";

const OUT_TYPES = ["doc", "data", "code", "media", "value", "text", "asset", "git", "issue"];
const mkStage = () => ({ id: "stage-" + Math.random().toString(36).slice(2, 7), name: "New stage", hint: "", tool: "claude", systemPrompt: "Operate only on the previous stage's outputs. Produce only this stage's outputs.", outputs: [{ name: "out.md", type: "doc", note: "" }], specs: [], shell: [], gate: "Output reviewed", auto: false, judge: false });
const normStage = (s, i) => ({ id: s.id || "stage-" + (i + 1), name: s.name || s.id || "Stage " + (i + 1), hint: s.hint || "", tool: s.tool || "claude", systemPrompt: s.systemPrompt || "", outputs: (s.outputs || []).map((o) => ({ name: o.name || "", type: o.type || "doc", note: o.note || "" })), specs: (s.specs || []).map((v) => ({ key: v.key || "", value: v.value || "" })), shell: s.shell || [], gate: s.gate || "", auto: !!s.auto, judge: !!s.judge });

export function PipelineFlow({ dir, proj, pipeline, tools, onClose, onSaved, flash, collapsed, onExpandSide }) {
  // one designer PER FLOW, side by side — a pipeline can carry several named
  // stage flows (ticket, multi-ticket feature, bugfix…); scroll horizontally.
  const [flows, setFlows] = useState(() => pipelineFlows(pipeline).map((f) => ({ ...f, stages: (f.stages || []).map(normStage) })));
  const [label, setLabel] = useState(pipeline.label || pipeline.id);
  const [workingDir, setWorkingDir] = useState(pipeline.workingDir || ".");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const mut = (fn) => { setFlows(fn); setDirty(true); };
  const mutStages = (fi, fn) => mut((fl) => fl.map((f, k) => k === fi ? { ...f, stages: fn(f.stages) } : f));
  const patch = (fi, i, p) => mutStages(fi, (st) => st.map((s, k) => k === i ? { ...s, ...p } : s));
  const move = (fi, i, d) => mutStages(fi, (st) => { const j = i + d; if (j < 0 || j >= st.length) return st; const n = [...st]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const dup = (fi, i) => mutStages(fi, (st) => [...st.slice(0, i + 1), { ...JSON.parse(JSON.stringify(st[i])), id: "stage-" + Math.random().toString(36).slice(2, 7), name: st[i].name + " copy" }, ...st.slice(i + 1)]);
  const del = (fi, i) => mutStages(fi, (st) => st.length <= 1 ? st : st.filter((_, k) => k !== i));
  const insAfter = (fi, i) => mutStages(fi, (st) => [...st.slice(0, i + 1), mkStage(), ...st.slice(i + 1)]);
  // one judge per flow: flagging a stage clears the flag on its siblings
  const setJudge = (fi, i) => mutStages(fi, (st) => st.map((s, k) => ({ ...s, judge: k === i ? !s.judge : false })));
  const setFlowName = (fi, name) => mut((fl) => fl.map((f, k) => k === fi ? { ...f, name } : f));
  const setFlowNext = (fi, v) => mut((fl) => fl.map((f, k) => k === fi ? { ...f, next: v ? { pipeline: v.split("/")[0], flow: v.split("/")[1] } : null } : f));
  // every flow of every pipeline in the project (minus itself) is a valid
  // handoff target — where a delivered task of this flow continues
  const handoffTargets = (proj ? proj.pipelines : []).flatMap((pp) => pipelineFlows(pp).map((tf) => ({ pid: pp.id, plabel: pp.label, fid: tf.id, fname: tf.name })));
  const addFlow = () => mut((fl) => [...fl, { id: "flow-" + Math.random().toString(36).slice(2, 7), name: "", stages: [mkStage()] }]);
  const delFlow = (fi) => { if (flows.length <= 1) return flash("a pipeline needs at least one flow"); mut((fl) => fl.filter((_, k) => k !== fi)); };

  const save = async () => {
    setSaving(true);
    // stage ids must be unique ACROSS flows (tasks resolve defs by id) — keep
    // the first occurrence, re-id later duplicates
    const seen = new Set();
    const out = flows.map((f) => ({ ...f, name: f.name || label, stages: f.stages.map((s) => {
      let sid = s.id;
      while (seen.has(sid)) sid = s.id + "-" + Math.random().toString(36).slice(2, 5);
      seen.add(sid);
      return sid === s.id ? s : { ...s, id: sid };
    }) }));
    const r = await api.savePipeline(dir, { id: pipeline.id, label, workingDir, flows: out });
    setSaving(false);
    if (r.ok) { setDirty(false); flash("stage flows saved"); onSaved && onSaved(); } else flash(r.error);
  };
  const inputsFor = (f, i) => i === 0 ? [{ name: "task intent" }, { name: "context.md" }] : f.stages[i - 1].outputs.filter((o) => o.name);

  // ── a single flow is portable: download as JSON, import from JSON, or send
  // by email (default mail app via mailto:, or Gmail's compose URL).
  const importRef = useRef(null);
  const downloadFlow = (f) => {
    downloadJSON("bridza-flow-" + (slug(f.name || label) || "flow") + ".json", exportFlow({ ...f, name: f.name || label }));
    flash("flow exported — import it from any Bridza project's Stage flows screen");
  };
  const emailFlow = (f, via) => {
    const name = f.name || label;
    const subject = "Bridza stage flow: " + name;
    const body = "Stage flow “" + name + "” from the “" + label + "” pipeline.\nSave the JSON below as a .json file and import it from Bridza → Stage flows → Import flow.\n\n" + JSON.stringify(exportFlow({ ...f, name }), null, 2);
    if (via === "gmail") window.open("https://mail.google.com/mail/?view=cm&fs=1&su=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body), "_blank", "noopener");
    else window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  };
  const addImportedFlows = (fls) => {
    mut((cur) => [...cur, ...fls.map((f) => ({ id: "flow-" + Math.random().toString(36).slice(2, 7), name: f.name || "Imported flow", stages: (f.stages || []).map(normStage) }))]);
    flash(`imported ${fls.length} flow${fls.length === 1 ? "" : "s"} — review, then Save flows`);
  };
  // accepts BOTH file kinds: a single stage flow lands directly; a whole
  // pipeline opens a picker for which of its flows to bring in
  const [pickFrom, setPickFrom] = useState(null);   // { label, flows, sel: [indices] }
  const importFlowFile = (file) => {
    const rd = new FileReader();
    rd.onload = () => {
      const text = String(rd.result);
      const f = parseFlowFile(text);
      if (!f.error) return addImportedFlows([f.flow]);
      const p = parsePipelineFile(text);
      if (p.error) return flash("not a Bridza stage-flow or pipeline file");
      setPickFrom({ label: p.pipeline.label, flows: p.pipeline.flows, sel: p.pipeline.flows.map((_, i) => i) });
    };
    rd.readAsText(file);
  };
  // the WHOLE pipeline (all flows) as one file — importable from New pipeline
  const downloadPipeline = () => {
    downloadJSON("bridza-pipeline-" + (slug(label) || "pipeline") + ".json", exportPipeline({ label, workingDir, flows }));
    flash("pipeline exported — import it from “＋ New pipeline” in any Bridza project");
  };
  const toggleArchive = async () => {
    const r = await api.archivePipeline(dir, { id: pipeline.id, archived: !pipeline.archived });
    if (!r.ok) return flash(r.error);
    flash(r.archived ? `“${label}” archived — data kept, hidden from the pipeline list` : `“${label}” restored`);
    onSaved && onSaved();
  };

  return (
    <>
      <div className="topbar">
        <div className="row">
          <Hamburger collapsed={collapsed} onExpandSide={onExpandSide} />
          <button className="btn ghost" onClick={onClose}>← {pipeline.label}</button>
          <h1 style={{ marginLeft: 6 }}>Stage flows</h1>
        </div>
        <div className="row">
          {dirty && <span className="tag">unsaved</span>}
          <button className="btn" onClick={downloadPipeline} title="Export the WHOLE pipeline (all flows) as a JSON file">⤓ Export pipeline</button>
          <button className="btn" onClick={toggleArchive} title={pipeline.archived ? "Bring this pipeline back to the list" : "Hide this pipeline from the list — all data and history are kept"}>{pipeline.archived ? "⇱ Unarchive" : "📦 Archive"}</button>
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save flows"}</button>
        </div>
      </div>
      <div className="content">
        <p className="muted" style={{ marginTop: 0 }}>Each stage's <b>output</b> is the next stage's <b>input</b>. A pipeline can carry <b>several flows</b> — every new task in <b>{pipeline.label}</b> picks exactly one (existing tasks keep their own).</p>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", maxWidth: 720 }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label>Pipeline name</label><input className="input" value={label} onChange={(e) => { setLabel(e.target.value); setDirty(true); }} /></div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label>Working dir (sparse scope; '.' = whole repo)</label><input className="input" value={workingDir} onChange={(e) => { setWorkingDir(e.target.value); setDirty(true); }} /></div>
        </div>

        <div className="flows-row">
          {flows.map((f, fi) => (
            <div className="flow-col" key={f.id}>
              <div className="row flow-col-hd">
                <input className="flow-name" value={f.name} placeholder={label} title="Flow name — defaults to the pipeline name"
                  onChange={(e) => setFlowName(fi, e.target.value)} spellCheck={false} />
                <button className="btn ghost sm" onClick={() => downloadFlow(f)} title="Export this flow as a JSON file">⤓</button>
                <button className="btn ghost sm" onClick={() => emailFlow(f, "mailto")} title="Email this flow via your default mail app">✉</button>
                <button className="btn ghost sm" onClick={() => emailFlow(f, "gmail")} title="Email this flow via Gmail (opens a compose window)">✉ᴳ</button>
                <button className="btn ghost sm" onClick={() => delFlow(fi)} disabled={flows.length <= 1} title="Delete this flow">🗑</button>
              </div>
              <div className="row" style={{ marginTop: 4, gap: 6 }}>
                <span className="io-lbl" title="Where a DELIVERED task of this flow continues. The follow-on task is plan-gated on this one — its stages refuse to run until this task is done.">hands off to</span>
                <select className="input spec-add" value={f.next ? f.next.pipeline + "/" + f.next.flow : ""} onChange={(e) => setFlowNext(fi, e.target.value)}>
                  <option value="">— none</option>
                  {handoffTargets.filter((t) => !(t.pid === pipeline.id && t.fid === f.id))
                    .map((t) => <option key={t.pid + "/" + t.fid} value={t.pid + "/" + t.fid}>{t.plabel} → {t.fname}</option>)}
                  {f.next && !handoffTargets.some((t) => t.pid === f.next.pipeline && t.fid === f.next.flow) &&
                    <option value={f.next.pipeline + "/" + f.next.flow}>{f.next.pipeline} → {f.next.flow} (not in this project yet)</option>}
                </select>
              </div>
              <div className="flow">
                <div className="flow-term">▸ Capture · task intent</div>
                {f.stages.map((s, i) => (
                  <FlowNode key={s.id} s={s} i={i} total={f.stages.length} tools={tools} inputs={inputsFor(f, i)}
                    patch={(p) => patch(fi, i, p)} onJudge={() => setJudge(fi, i)} onUp={() => move(fi, i, -1)} onDown={() => move(fi, i, 1)} onDup={() => dup(fi, i)} onDel={() => del(fi, i)} onInsert={() => insAfter(fi, i)} />
                ))}
                <button className="btn flow-add" onClick={() => mutStages(fi, (st) => [...st, mkStage()])}>＋ Add stage</button>
                <div className="flow-term done">✓ Delivered</div>
              </div>
            </div>
          ))}
          <div className="flow-col new">
            <button className="btn flow-add" onClick={addFlow} title="Add another stage flow to this pipeline (e.g. bugfix vs multi-ticket feature)">＋ Add flow</button>
            <button className="btn flow-add" onClick={() => importRef.current && importRef.current.click()} title="Import a stage flow from a .json file — a stage-flow file lands directly; a whole-pipeline file lets you pick which of its flows to bring in">⤒ Import flow…</button>
            <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }}
              onChange={(e) => { const file = e.target.files && e.target.files[0]; if (file) importFlowFile(file); e.target.value = ""; }} />
          </div>
        </div>
      </div>
      {pickFrom && (
        <Modal title={`Import flows from “${pickFrom.label}”`} onClose={() => setPickFrom(null)} confirm={`Import ${pickFrom.sel.length} flow${pickFrom.sel.length === 1 ? "" : "s"}`}
          onConfirm={() => {
            if (!pickFrom.sel.length) return flash("pick at least one flow");
            addImportedFlows([...pickFrom.sel].sort((a, b) => a - b).map((i) => pickFrom.flows[i]));
            setPickFrom(null);
          }}>
          <p className="muted" style={{ marginTop: 0 }}>That file is a whole pipeline — pick which of its stage flows to bring into <b>{label}</b>.</p>
          {pickFrom.flows.map((f, i) => (
            <label key={i} className="row" style={{ gap: 8, padding: "5px 0", cursor: "pointer", alignItems: "baseline" }}>
              <input type="checkbox" checked={pickFrom.sel.includes(i)}
                onChange={() => setPickFrom((p) => ({ ...p, sel: p.sel.includes(i) ? p.sel.filter((x) => x !== i) : [...p.sel, i] }))} />
              <b>{f.name || "Flow " + (i + 1)}</b>
              <span className="muted" style={{ fontSize: 12 }}>{(f.stages || []).map((s) => s.name || s.id).join(" → ")}</span>
            </label>
          ))}
        </Modal>
      )}
    </>
  );
}

function FlowNode({ s, i, total, tools, inputs, patch, onJudge, onUp, onDown, onDup, onDel, onInsert }) {
  const setOut = (oi, p) => patch({ outputs: s.outputs.map((o, k) => k === oi ? { ...o, ...p } : o) });
  const setSpec = (si, p) => patch({ specs: s.specs.map((v, k) => k === si ? { ...v, ...p } : v) });
  const toolOpts = tools.length ? tools.map((t) => t.id) : ["claude", "opencode"];
  return (
    <div className="fnode">
      <div className="fnode-h">
        <span className="fnode-i">{String(i + 1).padStart(2, "0")}</span>
        <input className="fnode-name" value={s.name} onChange={(e) => patch({ name: e.target.value })} spellCheck={false} />
        <button className={"fnode-auto" + (s.auto ? " on" : "")} onClick={() => patch({ auto: !s.auto })} title={s.auto ? "Auto-approves & passes on" : "Supervised — pauses for review"}>{s.auto ? "⚡ auto" : "review"}</button>
        <button className={"fnode-auto" + (s.judge ? " on judge" : "")} onClick={onJudge}
          title="Fit judge: at this stage (with the earlier stages' outputs in hand) the run double-checks the task was filed under the right flow — e.g. a multi-task feature mis-filed as one ticket. One judge per flow.">⚖{s.judge ? " judge" : ""}</button>
        <div className="fnode-ops">
          <button className="btn ghost sm" onClick={onUp} disabled={i === 0} title="Move up">↑</button>
          <button className="btn ghost sm" onClick={onDown} disabled={i === total - 1} title="Move down">↓</button>
          <button className="btn ghost sm" onClick={onDup} title="Duplicate">⧉</button>
          <button className="btn ghost sm" onClick={onDel} disabled={total <= 1} title="Delete">🗑</button>
        </div>
      </div>
      <div className="fnode-io">
        <span className="io-lbl">reads {i === 0 ? "· task intent" : "· from " + String(i).padStart(2, "0")}</span>
        {inputs.map((a, k) => <code key={k} className="iochip in">{a.name}</code>)}
      </div>
      <div className="fnode-io">
        <span className="io-lbl" title="Requirement variables — appended to every run's prompt as hard requirements (the system prompt is never modified)">specs · variables</span>
        {s.specs.map((sp, si) => (
          <span className="ochip" key={si}>
            <input className="ochip-name" placeholder="key" value={sp.key} title={specLabel(sp.key)}
              onChange={(e) => setSpec(si, { key: e.target.value })} spellCheck={false} />
            <input className="ochip-val" placeholder={specValues(sp.key)[0] ? "e.g. " + specValues(sp.key)[0] : "value"}
              value={sp.value} list={"spec-vals-" + s.id + "-" + si} onChange={(e) => setSpec(si, { value: e.target.value })} />
            <datalist id={"spec-vals-" + s.id + "-" + si}>{specValues(sp.key).map((v) => <option key={v} value={v} />)}</datalist>
            <button className="ochip-x" onClick={() => patch({ specs: s.specs.filter((_, k) => k !== si) })}>×</button>
          </span>
        ))}
        <select className="input spec-add" value="" title="Add a predefined spec, or a custom key of your own"
          onChange={(e) => { const k = e.target.value; if (!k) return; patch({ specs: [...s.specs, { key: k === "__custom" ? "" : k, value: "" }] }); e.target.value = ""; }}>
          <option value="">＋ spec…</option>
          {SPEC_CATALOG.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((it) => <option key={it.key} value={it.key} disabled={s.specs.some((sp) => sp.key === it.key)}>{it.label}</option>)}
            </optgroup>
          ))}
          <option value="__custom">Custom key…</option>
        </select>
      </div>
      <textarea className="input" rows={3} placeholder="System prompt — the LLM's instructions for this stage" value={s.systemPrompt} onChange={(e) => patch({ systemPrompt: e.target.value })} />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <select className="input" style={{ width: 150 }} value={s.tool} onChange={(e) => patch({ tool: e.target.value })}>
          {toolOpts.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="input" placeholder="acceptance gate" value={s.gate} onChange={(e) => patch({ gate: e.target.value })} />
      </div>
      <div className="fnode-shell">
        {s.shell.map((c, si) => (
          <div className="row" key={si} style={{ marginTop: 6 }}>
            <span className="tag">sh</span>
            <input className="input mono" value={c} onChange={(e) => patch({ shell: s.shell.map((x, k) => k === si ? e.target.value : x) })} />
            <button className="btn ghost sm" onClick={() => patch({ shell: s.shell.filter((_, k) => k !== si) })}>×</button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={() => patch({ shell: [...s.shell, ""] })} style={{ marginTop: 6 }}>＋ shell command (build/check gate)</button>
      </div>
      <div className="fnode-io">
        <span className="io-lbl">writes {i < total - 1 ? "· → " + String(i + 2).padStart(2, "0") : "· final"}</span>
        {s.outputs.map((o, oi) => (
          <span className="ochip" key={oi}>
            <input className="ochip-name" placeholder="file.ext" value={o.name} onChange={(e) => setOut(oi, { name: e.target.value })} spellCheck={false} />
            <select className="ochip-type" value={o.type} onChange={(e) => setOut(oi, { type: e.target.value })}>{OUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <button className="ochip-x" onClick={() => patch({ outputs: s.outputs.filter((_, k) => k !== oi) })}>×</button>
          </span>
        ))}
        <button className="btn ghost sm" onClick={() => patch({ outputs: [...s.outputs, { name: "", type: "doc", note: "" }] })}>＋ output</button>
      </div>
      <button className="fnode-insert" onClick={onInsert} title="Insert a stage after this one">＋</button>
    </div>
  );
}
