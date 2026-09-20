# Repro — Commands sent to claude are not responding

Task #87 · `engineering/commands-sent-to-claude-are-not` · stage `repro`

## Summary

When running stages or commands using the `claude` (Claude Code) tool CLI runner, the process hangs or does not respond. While `opencode` and other tools work correctly, `claude` subprocesses remain unresponsive.

## Reproduction Steps

1. Select a task stage configured to use the `claude` tool.
2. Trigger the run stage action (or automate task).
3. The server spawns `claude` via `child_process.spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"], ... })`.
4. **Observed**: The process hangs indefinitely; no stdout output is received, and the run stays in the "running" state until stopped or timed out.

## Observed vs Expected

| Action / State | Observed | Expected |
|---|---|---|
| Run stage with `claude` tool | Hangs indefinitely / unresposive | Executes prompt and streams output / exits with result |
| CLI flags for headless execution | Missing full non-interactive bypass | Non-interactive execution bypasses prompts |

## Root Cause

1. **Missing Non-Interactive Flag**: `core/domain.js` defines Claude CLI arguments as:
   ```js
   args: ({ prompt, system, model, session }) => {
     const a = ["-p", prompt, "--permission-mode", "acceptEdits"];
     ...
   }
   ```
   Unlike `opencode` (`--dangerously-skip-permissions`), `codex` (`--dangerously-bypass-approvals-and-sandbox`), and `gemini` (`-y`), `claude` lacks the required non-interactive / dangerous bypass flag (such as `--dangerously-skip-permissions` or `--non-interactive`) needed for unattended subprocess execution.
2. **Stdin Ignored**: With `stdio: ["ignore", "pipe", "pipe"]`, any interactive permission prompt, auth check, or confirmation prompt emitted by `claude` cannot receive user input, causing Claude Code to block indefinitely waiting on stdin.

## Notes for Fix Stage (Nothing Fixed Here)

- Add `--dangerously-skip-permissions` (or equivalent non-interactive flag supported by Claude Code) to `CLI_TOOLS` entry for `claude` in `core/domain.js`.
- Ensure stdin / permission handling is fully non-blocking for automated runs.
