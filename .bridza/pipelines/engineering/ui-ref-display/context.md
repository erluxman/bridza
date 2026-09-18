# Implement UI display of task refs (truncated, no padding)

## WHAT & WHY

Throughout the UI (task cards, lists, board, headers), task refs must be displayed as plain integers without leading zeros (e.g., `#17`, never `#00000017`). Use the `displayRef(ref)` helper from the contract to ensure consistency across all UI layers.

Update all refs displayed in the UI to call `displayRef()` from `core/domain.js`. This is a read-only change to UI rendering, not business logic.

## ACCEPTANCE CRITERIA

- All task ref displays in the UI use `displayRef(ref)` from the contract.
- `#17` is rendered for a task with ref 17 (no padding).
- Refs are displayed in task cards, lists, board view, headers, and anywhere else they appear.
- Tests verify correct truncation and display format.
- `pnpm test` passes, `pnpm lint` passes.

## DEPENDENCIES

- Depends on: `engineering/number-prefix-contract` (the display helper must exist first)
