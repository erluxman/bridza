# Review — Commands sent to claude are not responding

Branch `bridza/engineering/commands-sent-to-claude-are-not` → lands on `main`.

**Verdict: approved.** The fix addresses the root cause in `repro.md`, regression checks and test suite pass successfully, and the merge into `main` will be clean.

## 1. Root Cause & Fix Verification

- **Problem (`repro.md`)**: When running task stages using the `claude` (Claude Code) CLI tool, the subprocess hangs indefinitely because it lacks a non-interactive bypass flag (`--dangerously-skip-permissions`), blocking on interactive permission/confirmation prompts via stdin.
- **Fix (`core/domain.js`)**: Added `--dangerously-skip-permissions` to the argument generator for `claude` in `CLI_TOOLS`.
- **Verification**: Inspecting `core/domain.js:940` confirms `--dangerously-skip-permissions` is included in the argument array for `claude`.

## 2. Regression Check in Sibling Callers

- `CLI_TOOLS` entries for other tools (`opencode`, `codex`, `gemini`) already use non-interactive flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, `-y`).
- Sibling callers in `server/bridza-run.js` and bridge endpoints spawn processes using `tool.args(...)`, which correctly passes the new flag without breaking existing session reuse flags (`--session-id`, `--resume`).
- Full test suite (`npm test`) ran successfully with **233/233 tests passing**.

## 3. Regression Test Confirmation

- Added/updated test in `src/app/__tests__/bridza-model.test.js` validating that `claude.args({ prompt: "p" })` contains `--dangerously-skip-permissions`.
- Removing `--dangerously-skip-permissions` from `core/domain.js` causes this assertion to fail immediately, confirming the test correctly guards against regressions.

## 4. Merge Readiness (into `main`)

- **Branch Diff**: `git diff main...HEAD` shows clean, minimal changes limited to `core/domain.js`, `src/app/__tests__/bridza-model.test.js`, and pipeline metadata/logs.
- **Merge Tree**: `git merge-tree main HEAD` reports a clean merge with **0 conflicts**.
- **Verdict**: The branch is fully merge-ready into `main`.
