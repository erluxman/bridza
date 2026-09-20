// create-pr.test.js — createPR() against a real temp git repo with a STUBBED
// `gh` on PATH. The stub logs its argv (one arg per line, "--" between calls)
// so the tests assert the exact command Bridza runs, and switches behaviour off
// env vars (auth failure, an existing PR, a failing create). `origin` carries a
// github.com fetch URL (what createPR parses) and a local bare pushurl (what
// `git push` actually talks to), so the push path is exercised for real without
// a network.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

import { createPR, ensureTaskBranch, taskBranchName } from "../../../server/bridza-run.js";
import { rel } from "../../../core/domain.js";

const PIPELINE = "engineering", TASK = "add-thing";
const BRANCH = taskBranchName(PIPELINE, TASK);
const dirs = [];
let root, bare, binDir, log, origPath;

function tmp(tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), tag)); dirs.push(d); return d; }
function git(cwd, args) { return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }); }

// Every `gh` invocation, oldest first, as an array of argv arrays.
function ghCalls() {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, "utf8").split("\n--\n").filter((r) => r.trim())
    .map((r) => r.split("\n").filter((l) => l !== ""));
}
const ghCall = (sub) => ghCalls().find((c) => c.slice(0, 2).join(" ") === sub);

beforeEach(() => {
  root = tmp("bridza-pr-");
  bare = tmp("bridza-pr-origin-");
  execFileSync("git", ["init", "--bare", "-b", "main"], { cwd: bare });
  git(root, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(root, "README.md"), "seed\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "init"]);
  // fetch URL = what createPR parses; pushurl = where push really goes
  git(root, ["remote", "add", "origin", "https://github.com/acme/widgets.git"]);
  git(root, ["remote", "set-url", "--push", "origin", bare]);

  const taskDir = path.join(root, rel.task(PIPELINE, TASK));
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "metadata.json"), JSON.stringify({ title: "Add the thing", target: "main" }));
  fs.writeFileSync(path.join(taskDir, "context.md"), "# Add the thing\n\nWhy the thing matters.\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "task"]);
  expect(ensureTaskBranch(root, PIPELINE, TASK).ok).toBe(true);

  binDir = tmp("bridza-pr-bin-");
  log = path.join(binDir, "gh.log");
  const gh = path.join(binDir, "gh");
  fs.writeFileSync(gh, [
    "#!/bin/sh",
    'for a in "$@"; do printf "%s\\n" "$a" >> "$GH_LOG"; done',
    'printf -- "--\\n" >> "$GH_LOG"',
    'case "$1 $2" in',
    '  "auth status") [ -n "$GH_AUTH_FAIL" ] && { echo "not logged in" >&2; exit 1; }; echo "Logged in"; exit 0;;',
    '  "pr view") [ -n "$GH_EXISTING" ] && { printf \'{"url":"https://github.com/acme/widgets/pull/7","state":"%s"}\\n\' "${GH_EXISTING_STATE:-OPEN}"; exit 0; }; echo "no pull requests found" >&2; exit 1;;',
    '  "pr create") [ -n "$GH_CREATE_FAIL" ] && { echo "a pull request already exists" >&2; exit 1; }; echo "https://github.com/acme/widgets/pull/42"; exit 0;;',
    "esac",
    "exit 1",
  ].join("\n") + "\n");
  fs.chmodSync(gh, 0o755);

  origPath = process.env.PATH;
  process.env.PATH = binDir + path.delimiter + origPath;
  process.env.GH_LOG = log;
});

afterEach(() => {
  process.env.PATH = origPath;
  for (const k of ["GH_LOG", "GH_AUTH_FAIL", "GH_EXISTING", "GH_EXISTING_STATE", "GH_CREATE_FAIL"]) delete process.env[k];
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("createPR — gh installed and authenticated", () => {
  it("pushes the branch, then creates the PR with the task title and context body", () => {
    const r = createPR(root, PIPELINE, TASK);
    expect(r).toEqual({ ok: true, url: "https://github.com/acme/widgets/pull/42" });

    const create = ghCall("pr create");
    expect(create).toBeTruthy();
    expect(create.slice(0, 6)).toEqual(["pr", "create", "--base", "main", "--head", BRANCH]);
    expect(create[create.indexOf("--title") + 1]).toBe("Add the thing");
    expect(create[create.indexOf("--body") + 1]).toContain("Why the thing matters.");
    expect(ghCall("auth status")).toBeTruthy();

    // really pushed: origin has the task branch, and it is now the upstream
    expect(execFileSync("git", ["rev-parse", "--verify", BRANCH], { cwd: bare, encoding: "utf8" }).trim()).toBeTruthy();
    expect(git(root, ["rev-parse", "--abbrev-ref", BRANCH + "@{upstream}"]).trim()).toBe("origin/" + BRANCH);
  });

  it("does not re-push a branch that already has an upstream", () => {
    git(root, ["push", "-u", "origin", BRANCH]);
    git(root, ["remote", "set-url", "--push", "origin", path.join(bare, "gone")]);   // any push now fails
    expect(createPR(root, PIPELINE, TASK)).toEqual({ ok: true, url: "https://github.com/acme/widgets/pull/42" });
  });

  it("surfaces a failed push as a real error and never runs pr create", () => {
    git(root, ["remote", "set-url", "--push", "origin", path.join(bare, "gone")]);
    const r = createPR(root, PIPELINE, TASK);
    expect(r.ok).toBe(false);
    expect(r.fallback).toBeUndefined();
    expect(r.error).toMatch(/^push failed: /);
    expect(ghCall("pr create")).toBeFalsy();
  });

  it("reports an already-open PR instead of creating a duplicate", () => {
    process.env.GH_EXISTING = "1";
    expect(createPR(root, PIPELINE, TASK)).toEqual({ ok: true, url: "https://github.com/acme/widgets/pull/7", existing: true });
    expect(ghCall("pr create")).toBeFalsy();
  });

  it("creates a new PR when the branch's only PR is closed or merged", () => {
    process.env.GH_EXISTING = "1";
    for (const state of ["CLOSED", "MERGED"]) {
      fs.rmSync(log, { force: true });
      process.env.GH_EXISTING_STATE = state;
      expect(createPR(root, PIPELINE, TASK)).toEqual({ ok: true, url: "https://github.com/acme/widgets/pull/42" });
      expect(ghCall("pr create")).toBeTruthy();
    }
  });

  it("falls back to the compose page when pr create fails", () => {
    process.env.GH_CREATE_FAIL = "1";
    const r = createPR(root, PIPELINE, TASK);
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe(true);
    expect(r.error).toMatch(/gh pr create failed: /);
    expect(r.url).toBe(`https://github.com/acme/widgets/compare/main...${BRANCH}?expand=1`);
  });
});

describe("createPR — fallbacks", () => {
  it("falls back with the compose URL when gh is not on PATH", () => {
    process.env.PATH = "/usr/bin:/bin";
    const r = createPR(root, PIPELINE, TASK);
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe(true);
    expect(r.error).toMatch(/not installed/);
    expect(r.url).toBe(`https://github.com/acme/widgets/compare/main...${BRANCH}?expand=1`);
    expect(r.title).toBe("Add the thing");
    expect(r.body).toContain("Why the thing matters.");
  });

  it("falls back when gh auth status exits non-zero, naming the cause", () => {
    process.env.GH_AUTH_FAIL = "1";
    const r = createPR(root, PIPELINE, TASK);
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe(true);
    expect(r.error).toMatch(/not logged in to GitHub CLI/);
    expect(r.url).toBe(`https://github.com/acme/widgets/compare/main...${BRANCH}?expand=1`);
    expect(ghCall("pr view")).toBeFalsy();
  });

  it("errors without a GitHub remote", () => {
    git(root, ["remote", "remove", "origin"]);
    expect(createPR(root, PIPELINE, TASK).error).toMatch(/no remote origin configured/);
  });
});
