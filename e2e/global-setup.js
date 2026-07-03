// Creates a throwaway git repo the e2e test opens as a Bridza project.
// Fresh every run so the flow (no pipelines → picker → task → stage) is deterministic.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const FIXTURE = path.join(os.tmpdir(), "bridza-e2e-repo");

export default function globalSetup() {
  // clean the repo AND its sibling worktree dir (<repo>.bridza-tasks) from prior runs
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.rmSync(FIXTURE + ".bridza-tasks", { recursive: true, force: true });
  fs.mkdirSync(FIXTURE, { recursive: true });
  const git = (args) => execFileSync("git", args, { cwd: FIXTURE, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "e2e"]);
  git(["config", "user.email", "e2e@local"]);
  fs.writeFileSync(path.join(FIXTURE, "README.md"), "# E2E fixture repo\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "init"]);
}
