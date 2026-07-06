// features/term.jsx — an interactive shell in the app (xterm.js over the PTY
// WebSocket the bridge exposes). cwd is the task's worktree when a pipeline+task
// are given, else the repo root.
import { useState, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { base } from "../lib/format.js";

export function TermDrawer({ dir, pipeline, task, onClose, full }) {
  const hostRef = useRef(null);
  const [cwd, setCwd] = useState("");
  const [shell, setShell] = useState("");
  const [dead, setDead] = useState("");
  useEffect(() => {
    setDead("");
    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      cursorBlink: true,
      scrollback: 8000,
      theme: { background: "#0b0e13", foreground: "#d5dbe3", cursor: "#4f9cf2", cursorAccent: "#0b0e13", selectionBackground: "#2b3b52" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
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
    return () => { ro.disconnect(); dataSub.dispose(); try { ws.close(); } catch (e) { /* */ } term.dispose(); };
  }, [dir, pipeline, task]);
  return (
    <div className={"term-drawer" + (full ? " full" : "")}>
      <div className="term-hd">
        <span className="side-label" style={{ padding: 0, flex: "none" }}>⌨ {shell ? base(shell) : "Terminal"}</span>
        <span className="term-cwd" title={cwd || dir}>{cwd || (task ? "task worktree" : dir)}</span>
        <div className="row" style={{ flex: "none" }}>
          <button className="btn ghost sm" onClick={onClose} title="Close (kills the shell)">✕</button>
        </div>
      </div>
      <div className="pty-host" ref={hostRef} />
      {dead && <div className="pty-dead">{dead} — close and reopen to restart</div>}
    </div>
  );
}
