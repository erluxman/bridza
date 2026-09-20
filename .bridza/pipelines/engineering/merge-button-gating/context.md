# Gate the Finalize button on a clean preflight

## Intent

Delivers ticket #50 (`do-not-allow-merge-domain-until-the`): the
`Finalize → <target>` button must be DISABLED while the task's change is not
actually ready to land, instead of letting the user start a merge that will
fail halfway.

Consumes the readiness payload from [[merge-preflight-check]] and turns it into
an enable/disable decision plus a reason the user can act on. No new git logic
lives here.

Disabled is only useful if it is escapable: the panel must always tell the user
what to do next (rebase/merge the target in, resolve via
[[conflict-open-in-vscode]], or retry the check), and must offer an explicit
"finalize anyway" override for the case where the preflight is `unknown` — a
stale check must never permanently trap a task.

## Acceptance Criteria

- [ ] `Finalize → <target>` is disabled when preflight `state === "conflict"`,
      with a tooltip naming the conflicting files.
- [ ] Enabled when `state` is `clean`; for `up-to-date` the button reads
      "Already merged" and is disabled.
- [ ] `state: "unknown"` does NOT disable the button — it shows a warning and
      lets the user proceed, so a preflight failure can't strand a task.
- [ ] The readiness panel offers a manual "Re-check" action; the check also
      re-runs after a stage run finishes on that task.
- [ ] Nothing auto-merges, auto-rebases, or auto-pushes as a side effect of
      the check.
- [ ] vitest/component coverage: conflict → disabled + reason, clean → enabled,
      unknown → enabled with warning, re-check updates the state.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.

## ARCHIVED by #88 — folded into [[merge-preflight-check]]; the spec written here was copied there verbatim. One slice, not two tickets.
