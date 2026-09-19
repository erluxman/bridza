// Repro: one logical bridza action produces N commits.
// Usage: node repro.mjs <path-to-bridza-checkout> <scratch-repo>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [src, root] = process.argv.slice(2);
const store = await import(path.join(src, "server/bridza-store.js"));
const g = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const count = () => Number(g(["rev-list", "--count", "HEAD"]));
const since = (n) => (n ? g(["log", "--format=%s", `-${n}`]).split("\n").reverse() : []);

// fresh repo with one commit
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
g(["init", "-q", "-b", "main"]);
g(["config", "user.name", "t"]);
g(["config", "user.email", "t@t"]);
fs.writeFileSync(path.join(root, "README.md"), "seed\n");
g(["add", "-A"]);
g(["commit", "-qm", "seed"]);

// a pipeline with a single flow so promote needs no flow choice
const b0 = count();
const p = store.createPipeline(root, { id: "engineering", label: "Engineering", stages: ["repro", "fix"] });
const n0 = count() - b0;
console.log(`ACTION createPipeline -> ${n0} commit(s)   ok=${p.ok} ${p.error || ""}`);
since(n0).forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

// ACTION 1: capture one inbox item
const b1 = count();
const cap = store.addInbox(root, { kind: "idea", text: "Archive cards are not syncing between tabs, needs a fix." });
const n1 = count() - b1;
console.log(`\nACTION addInbox       -> ${n1} commit(s)`);
since(n1).forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

// ACTION 2: promote that item into a task (the user's reported case)
const b2 = count();
const pr = store.promoteInbox(root, { id: cap.item.id, pipeline: "engineering", flow: "" });
const n2 = count() - b2;
console.log(`\nACTION promoteInbox   -> ${n2} commit(s)   ok=${pr.ok} ${pr.error || ""}`);
since(n2).forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

// ACTION 3: plain createTask
const b3 = count();
const ct = store.createTask(root, { pipeline: "engineering", id: "plain-task", title: "Plain task", flow: "" });
const n3 = count() - b3;
console.log(`\nACTION createTask     -> ${n3} commit(s)   ok=${ct.ok} ${ct.error || ""}`);
since(n3).forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

// ACTION 4: createTask with a milestone (plan wiring -> extra commit)
const b4 = count();
const ct2 = store.createTask(root, { pipeline: "engineering", id: "milestone-task", title: "Milestone task", flow: "", milestone: { id: "m1", title: "M1" }, est: 3 });
const n4 = count() - b4;
console.log(`\nACTION createTask+plan-> ${n4} commit(s)   ok=${ct2.ok} ${ct2.error || ""}`);
since(n4).forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

console.log(`\nTOTAL commits in repo: ${count()} (1 was the seed)`);
