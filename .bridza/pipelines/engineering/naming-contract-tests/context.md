# Complete unit tests for numbered-prefix naming contract

## WHAT & WHY

The `core/domain.js` naming contract is the single source of truth for all ref numbering and formatting. Comprehensive unit tests ensure correctness for the entire system:
- Zero-padding at exactly 8 digits
- Round-trip parse/format (e.g., ref 17 → folder `00000017-slug` → parsed back to ref 17)
- 10-million scale upper bound
- Legacy un-prefixed folder fallback
- Leading-digit slug edge cases

These tests are the "specification by example" for the contract.

## ACCEPTANCE CRITERIA

- `src/app/__tests__/bridza-model.test.js` (or similar) includes:
  - `REF_WIDTH` constant is 8
  - `padRef(17)` returns `"00000017"`
  - `taskDirName("engineering", "my-task", 17)` returns `"00000017-my-task"`
  - `parseTaskDir("00000017-my-task")` returns `{ ref: 17, id: "my-task" }`
  - `parseTaskDir("my-task")` (no prefix) returns `{ ref: null, id: "my-task" }`
  - `parseTaskDir("2fa-rollout")` (leading digits, no padding) returns `{ ref: null, id: "2fa-rollout" }`
  - `displayRef(17)` returns `"17"` (leading zeros removed)
  - `displayRef(10000000)` still works (10 million case)
- All tests pass: `pnpm test`
- Coverage includes all helpers and edge cases.

## DEPENDENCIES

- Depends on: `engineering/number-prefix-contract` (tests are written after the helpers exist)
