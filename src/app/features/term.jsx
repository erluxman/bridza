// features/term.jsx — an interactive shell in the app (xterm.js over the PTY
// WebSocket the bridge exposes). cwd is the task's worktree when a pipeline+task
// are given, else the repo root.
import { useState, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { base } from "../lib/format.js";
import { getTermSettings, subscribeTermSettings } from "../lib/settings.js";
import { SettingsModal } from "./settings.jsx";

export function TermDrawer({ dir, pipeline, task, onClose, full }) {
  const hostRef = useRef(null);
  const [cwd, setCwd] = useState("");
  const [shell, setShell] = useState("");
  const [dead, setDead] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    setDead("");
    const s = getTermSettings();
    const term = new Terminal({
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      cursorBlink: true,
      scrollback: 8000,
      theme: { background: "#0b0e13", foreground: "#d5dbe3", cursor: "#4f9cf2", cursorAccent: "#0b0e13", selectionBackground: "#2b3b52" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    // The first paint can measure glyphs before the chosen font is ready, so a
    // Nerd Font's icons/powerline glyphs show as tofu until a repaint. Once the
    // document's fonts settle, remeasure + refresh so the real font is used.
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready)
      document.fonts.ready.then(() => { try { fit.fit(); term.refresh(0, term.rows - 1); } catch (e) { /* disposed */ } });
    // Ligatures: opt-in, loaded async so a bundling/renderer hiccup can't kill
    // the shell. ponytail: toggling ligatures off applies on next open only.
    if (s.ligatures) import("@xterm/addon-ligatures").then((m) => { try { term.loadAddon(new m.LigaturesAddon()); } catch (e) { /* ligatures unavailable */ } }).catch(() => { /* addon not loadable here */ });
    // live font/size changes from the Settings panel — apply without recreating
    // the shell (recreating would kill the running process). Setting the option
    // alone can leave stale glyph cells, so drop the atlas + force a full repaint.
    const applyFont = (ns) => {
      term.options.fontFamily = ns.fontFamily;
      term.options.fontSize = ns.fontSize;
      try { term.clearTextureAtlas && term.clearTextureAtlas(); } catch (e) { /* no atlas renderer */ }
      fit.fit();
      try { term.refresh(0, term.rows - 1); } catch (e) { /* disposed */ }
    };
    const unsub = subscribeTermSettings(applyFont);
    const q = new URLSearchParams({ dir });
    if (pipeline && task) { q.set("pipeline", pipeline); q.set("task", task); }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/bridza/pty?${q}`);
    ws.onopen = () => {
      fit.fit();
      ws.send(JSON.stringify({ t: "resize", cols: term.cols, rows: term.rows }));
      term.focus();
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.t === "out") term.write(m.d);
        else if (m.t === "cwd") { setCwd(m.d); setShell(m.shell || ""); }
        else if (m.t === "err") setDead(m.d);
        else if (m.t === "exit") setDead(`shell exited (${m.code})`);
      } catch (e) { /* non-JSON frame */ }
    };
    ws.onerror = () => setDead((d) => d || "couldn't reach the PTY bridge — is the dev server running?");
    ws.onclose = () => setDead((d) => d || "disconnected");
    const dataSub = term.onData((d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "in", d })); });
    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: "resize", cols: term.cols, rows: term.rows }));
    });
    ro.observe(hostRef.current);
    return () => { unsub(); ro.disconnect(); dataSub.dispose(); try { ws.close(); } catch (e) { /* */ } term.dispose(); };
  }, [dir, pipeline, task]);
  return (
    <div className={"term-drawer" + (full ? " full" : "")}>
      <div className="term-hd">
        <span className="side-label" style={{ padding: 0, flex: "none" }}>⌨ {shell ? base(shell) : "Terminal"}</span>
        <span className="term-cwd" title={cwd || dir}>{cwd || (task ? "task worktree" : dir)}</span>
        <div className="row" style={{ flex: "none" }}>
          <button className="btn ghost sm" onClick={() => setSettingsOpen(true)} title="Terminal font, size & ligatures">⚙</button>
          <button className="btn ghost sm" onClick={onClose} title="Close (kills the shell)">✕</button>
        </div>
      </div>
      <div className="pty-host" ref={hostRef} />
      {dead && <div className="pty-dead">{dead} — close and reopen to restart</div>}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
