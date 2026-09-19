// verify.mjs — runs the store's write actions against scratch repos and counts
// the commits each one leaves behind. Same scenarios as the vitest block
// "one commit per action" in src/app/__tests__/bridza-store.test.js, but with
// no npm deps, so it runs in a bare worktree.
//
//   npx node verify.mjs <path-to-checkout>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CHECKOUT = path.resolve(process.argv[2] || process.cwd());
const store = await import(path.join(CHECKOUT, "server/bridza-store.js"));
const { git } = await import(path.join(CHECKOUT, "server/bridza-run.js"));
const { rel } = await import(path.join(CHECKOUT, "core/domain.js"));

const MARKETING = { id: "marketing", label: "Marketing", workingDir: ".", stages: [
  { id: "research", name: "Research" }, { id: "planning", name: "Planning" }, { id: "spec", name: "Spec" },
] };

const tmps = [];
function makeRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-verify-"));
  tmps.push(d);
  execFileSync("git", ["init", "-b", "main"], { cwd: d, stdio: "ignore" });
  fs.writeFileSync(path.join(d, "README.md"), "seed\n");
  execFileSync("git", ["add", "-A"], { cwd: d });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"], { cwd: d, stdio: "ignore" });
  return d;
}
const count = (root) => Number(git(root, ["rev-list", "--count", "HEAD"]).trim());

let failed = 0;
function check(name, fn) {
  const root = makeRepo();
  try { fn(root); console.log("  PASS  " + name); }
  catch (e) { failed++; console.log("  FAIL  " + name + "\n        " + (e && e.message)); }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: got ${a}, want ${b}`);
}
function ok(cond, what) { if (!cond) throw new Error(what); }

process.env.BRIDZA_WORKTREE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bridza-verify-wt-"));
tmps.push(process.env.BRIDZA_WORKTREE_DIR);

console.log("commits left behind by one user action:\n");

check("promote an inbox item = 1 commit (was 4)", (root) => {
  store.createPipeline(root, MARKETING);
  const a = store.addInbox(root, { kind: "bug", text: "Sync drops archived cards" });
  const before = count(root);
  const p = store.promoteInbox(root, { id: a.item.id, pipeline: "marketing" });
  ok(p.ok, "promote failed: " + p.error);
  eq(count(root) - before, 1, "commits");
  const body = git(root, ["log", "-1", "--format=%B"]);
  ok(/^bridza: inbox promote \(bug\) ".*" → task #\d+ marketing\//.test(body.split("\n")[0]), "subject: " + body.split("\n")[0]);
  ok(body.includes("- bridza: assign task #ref"), "the #ref step is logged in the body");
  ok(body.includes("- bridza: add task #"), "the add-task step is logged in the body");
  const ctxPath = rel.taskContext("marketing", p.task.id);
  ok(fs.readFileSync(path.join(root, ctxPath), "utf8").includes("Sync drops archived cards"), "brief on disk");
  ok(!git(root, ["log", "-p", "--", ctxPath]).includes("Describe the intent of this task."), "no placeholder blob in history");
});

check("create a task = 1 commit (was 3), branch forked off it", (root) => {
  store.createPipeline(root, MARKETING);
  const before = count(root);
  const r = store.createTask(root, { pipeline: "marketing", id: "t1", title: "T", est: 4, milestone: { id: "ms", title: "M" } });
  ok(r.ok, "createTask failed: " + r.error);
  eq(count(root) - before, 1, "commits");
  ok(/^bridza: add task #\d+ "T" \(marketing\/t1\)$/.test(git(root, ["log", "-1", "--format=%s"]).trim()), "subject");
  eq(git(root, ["rev-parse", r.branch]).trim(), git(root, ["rev-parse", "HEAD"]).trim(), "branch tip");
  const files = git(root, ["show", "--name-only", "--format=", "HEAD"]).trim().split("\n");
  ok(files.includes(rel.taskMeta("marketing", "t1")), "task metadata in the commit");
  ok(files.includes(rel.plan()), "plan wiring in the same commit");
});

check("a run of plan edits = 1 commit (was 1 each)", (root) => {
  const before = count(root);
  store.savePlan(root, { links: { "dev/a": ["dev/spec"] } });
  store.savePlan(root, { links: { "dev/a": ["dev/spec"], "dev/b": ["dev/spec"] } });
  store.savePlan(root, { links: { "dev/a": ["dev/spec"], "dev/b": ["dev/spec"], "dev/c": ["dev/spec"] } });
  eq(count(root) - before, 1, "commits");
  ok(/3 context links/.test(git(root, ["log", "-1", "--format=%s"]).trim()), "subject carries the latest state");
  eq(Object.keys(store.readPlan(root).links), ["dev/a", "dev/b", "dev/c"], "plan state");
});

check("never amends a commit another ref reaches", (root) => {
  store.savePlan(root, { pos: { "dev/a": { x: 1, y: 2 } } });
  const pinned = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["branch", "keep-me"]);
  const before = count(root);
  store.savePlan(root, { pos: { "dev/a": { x: 3, y: 4 } } });
  eq(count(root) - before, 1, "commits");
  eq(git(root, ["rev-parse", "keep-me"]).trim(), pinned, "pinned ref untouched");
});

check("never amends the user's own commit", (root) => {
  fs.writeFileSync(path.join(root, "user.txt"), "hi\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "user work"], { cwd: root, stdio: "ignore" });
  const before = count(root);
  store.savePlan(root, { pos: { "dev/a": { x: 7, y: 8 } } });
  eq(count(root) - before, 1, "commits");
  eq(git(root, ["log", "-1", "--format=%s", "HEAD~1"]).trim(), "user work", "the user's commit");
});

check("leaves the user's staged work alone", (root) => {
  store.savePlan(root, { pos: { "dev/a": { x: 1, y: 2 } } });
  fs.writeFileSync(path.join(root, "mine.txt"), "wip\n");
  execFileSync("git", ["add", "mine.txt"], { cwd: root });
  const before = count(root);
  store.savePlan(root, { pos: { "dev/a": { x: 5, y: 6 } } });
  eq(count(root) - before, 1, "commits");
  eq(git(root, ["diff", "--cached", "--name-only"]).trim(), "mine.txt", "still staged");
  ok(!git(root, ["show", "--name-only", "--format=", "HEAD"]).includes("mine.txt"), "not swallowed by the commit");
});

check("kanban drags and context saves fold; a different edit does not", (root) => {
  store.createPipeline(root, MARKETING);
  store.createTask(root, { pipeline: "marketing", id: "t2" });
  let before = count(root);
  store.saveKanbanOrder(root, { id: "marketing", order: ["spec", "research", "planning"] });
  store.saveKanbanOrder(root, { id: "marketing", order: ["planning", "spec", "research"] });
  eq(count(root) - before, 1, "kanban commits");

  before = count(root);
  store.saveContext(root, { pipeline: "marketing", task: "t2", text: "First draft.\n" });
  store.saveContext(root, { pipeline: "marketing", task: "t2", text: "Second draft.\n" });
  eq(count(root) - before, 1, "context commits");
  eq(store.readContext(root, { pipeline: "marketing", task: "t2" }).text, "Second draft.\n", "context state");

  before = count(root);
  store.saveKanbanOrder(root, { id: "marketing", order: ["research", "spec", "planning"] });
  eq(count(root) - before, 1, "a different edit starts its own commit");
  ok(/edit task context/.test(git(root, ["log", "-1", "--format=%s", "HEAD~1"]).trim()), "previous commit kept");
});

for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall green");
process.exit(failed ? 1 : 0);
