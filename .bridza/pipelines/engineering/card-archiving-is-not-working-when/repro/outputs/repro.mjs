// Repro: archiving a card does not survive a git sync to another device.
//
// Models the user's actual setup: two computers sharing ONE git remote.
// Bridza has no push/pull of its own, so "syncing" means the user pushes and
// pulls the branches git tracks — in this repo, `origin` carries only main
// (no bridza/* task branches exist on origin at all).
//
// Run:  node .bridza/pipelines/engineering/card-archiving-is-not-working-when/repro/outputs/repro.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../../../..");

const { readProject, createPipeline, createTask } = await import(path.join(REPO, "server/bridza-store.js"));
const { setTaskArchived, ensureTaskBranch, finalizeTask, git } = await import(path.join(REPO, "server/bridza-run.js"));

const IDENT = ["-c", "user.name=t", "-c", "user.email=t@t"];
const tmps = [];
const tmp = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), tag)); tmps.push(d); return d; };
const g = (cwd, args) => execFileSync("git", [...IDENT, ...args], { cwd, encoding: "utf8" });

const PIPE = "engineering", TASK = "dawn-card";
const taskOf = (root) => {
  const p = readProject(root).pipelines.find((x) => x.id === PIPE);
  return (p ? p.tasks : []).find((t) => t.id === TASK) || null;
};

// worktrees must live outside the repo
process.env.BRIDZA_WORKTREE_DIR = tmp("bridza-wt-");

// ── the shared remote both computers sync through ──────────────────────────
const origin = tmp("bridza-origin-");
g(origin, ["init", "--bare", "-b", "main"]);

// ── COMPUTER A ─────────────────────────────────────────────────────────────
const A = tmp("bridza-deviceA-");
g(A, ["init", "-b", "main"]);
fs.writeFileSync(path.join(A, "README.md"), "seed\n");
g(A, ["add", "-A"]);
g(A, ["commit", "-m", "init"]);
g(A, ["remote", "add", "origin", origin]);

createPipeline(A, { id: PIPE, label: "Engineering", stages: [{ id: "build", label: "Build" }] });
createTask(A, { pipeline: PIPE, id: TASK, title: "A DAWN card", stages: ["build"] });

// the card is Delivered: its branch was finalized (squash-merged) into main.
ensureTaskBranch(A, PIPE, TASK);
finalizeTask(A, PIPE, TASK, { style: "squash", into: "main" });

// >>> the user clicks the 🗄 Archive button on the Delivered card <<<
const res = setTaskArchived(A, PIPE, TASK, true);

console.log("── COMPUTER A (where the user archived) ──────────────────────");
console.log("setTaskArchived         →", JSON.stringify(res));
console.log("board shows archived    →", taskOf(A).archived);
console.log("flag on task branch     →", (() => {
  try { return JSON.parse(git(A, ["show", `bridza/${PIPE}/${TASK}:.bridza/pipelines/${PIPE}/${TASK}/metadata.json`])).archived; }
  catch { return "<no branch>"; }
})());
console.log("flag on main            →", (() => {
  try { return JSON.parse(git(A, ["show", `main:.bridza/pipelines/${PIPE}/${TASK}/metadata.json`])).archived; }
  catch { return "<no file>"; }
})());

// the user syncs: push everything git is tracking for the shared remote.
g(A, ["push", "origin", "main"]);
console.log("\nrefs published to origin:");
console.log(g(origin, ["for-each-ref", "--format=  %(refname:short)"]).trimEnd() || "  <none>");

// ── COMPUTER B ─────────────────────────────────────────────────────────────
const B = tmp("bridza-deviceB-");
g(path.dirname(B), ["clone", origin, B]);

const tb = taskOf(B);
console.log("\n── COMPUTER B (after git sync) ───────────────────────────────");
console.log("card present            →", !!tb);
console.log("board shows archived    →", tb && tb.archived);
console.log("card lands in column    →", tb && tb.archived ? "Archived" : "Delivered  ← WRONG");

console.log("\n──────────────────────────────────────────────────────────────");
console.log("EXPECTED on B: archived = true   (card in the Archived column)");
console.log("ACTUAL   on B: archived =", tb && tb.archived, "  (card back in Delivered)");
console.log(taskOf(A).archived === true && tb && tb.archived === false
  ? "\nREPRODUCED ✓  the archived flag never crossed the sync boundary."
  : "\nNOT reproduced.");

for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
