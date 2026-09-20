# Auto-resolve .bridza state conflicts with a union merge driver

## Intent

Second half of ticket #15, and the root-cause fix behind ticket #36
(`card-archiving-is-not-working-when`): most conflicts in this repo are not
code conflicts at all. They are two devices independently rewriting the same
small JSON state files on the base branch.

The hot files, named in #15's own notes:
- `.bridza/refs.json` — rewritten by every `#ref` assignment, every task or
  pipeline delete, and (since #36) every archive/unarchive click, from every
  device that syncs.
- `.bridza/plan.json` — rewritten by every card move, resize, dep, estimate and
  milestone edit on the plan board.

Two devices archiving different cards is a textbook conflict with one obviously
correct resolution: the union of both maps. Nobody should ever see a conflict
marker for that. Register a custom git merge driver for these paths that merges
the JSON key-by-key and only escalates to a real conflict when the SAME key got
two DIFFERENT values.

Resolving this class automatically is what makes [[conflict-open-in-vscode]]
and [[ai-assisted-conflict-merge]] rare rather than routine.

## Acceptance Criteria

- [ ] A `.gitattributes` entry maps `.bridza/refs.json` and `.bridza/plan.json`
      to a `bridza-json` merge driver, and the driver is registered in the
      repo's git config by the app on startup (idempotent — safe to re-run).
- [ ] Driver merges disjoint key edits from both sides without conflict:
      device A archiving card X and device B archiving card Y yields both
      archived.
- [ ] Same key changed to two DIFFERENT values still conflicts — the driver
      never silently picks a winner for a genuine disagreement.
- [ ] Deletions are honoured: a key removed on one side and untouched on the
      other stays removed, and does not resurrect from the other side.
- [ ] Nested containers in `plan.json` (`deps`, `est`, `pos`, `sizes`, `links`,
      `milestones`) merge per-entry, not as opaque blobs; `milestones` merges
      by milestone `id`.
- [ ] Output is byte-stable (same key ordering and indentation the app writes),
      so the driver does not itself create spurious future diffs.
- [ ] A user with no driver configured (fresh clone, another tool) still gets a
      valid repo — the driver is an optimisation, never a correctness
      requirement.
- [ ] vitest coverage with the temp-repo helpers in `src/app/__tests__/`:
      disjoint archive union, same-key divergence → conflict, key deletion,
      milestone list merge, byte-stability round-trip.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
