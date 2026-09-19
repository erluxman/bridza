# Long press and drag to create boundary in Plan mode

## What

Add a lasso/selection-box gesture to the Plan view: long press (or right-click drag) on empty canvas space to draw a rectangle, then drag all tasks within that boundary together as a group.

## Why

Users need to reposition multiple tasks simultaneously without individually dragging each one. This is a common pattern in diagramming tools (Figma, Miro) that improves workflow效率 for reorganizing the plan board.

## How

1. **Trigger**: On `plan.jsx`, add selection-box state: `selBox` (null or `{x, y, w, h}`).
2. **Draw gesture**: Right-click (or Shift+click) on empty canvas starts drawing a selection box. Drag to expand. Release to finalize.
3. **Multi-drag**: When dragging starts, if the mouse is over any selected tasks (from a prior selection box), drag them all together. Otherwise, begin single-task drag.
4. **Visual feedback**: Selection box renders as a dashed rectangle overlay. Selected tasks get a highlight/border.
5. **Persist**: Selected state is transient (clears on mouse up elsewhere). Positions of dragged tasks save together to `plan.pos`.

Implementation in `src/app/features/plan.jsx`:

- Add `selBox` state and `selectedKeys` (Set of task keys)
- Add `boxDown` handler: right-click + drag creates selection box
- Add `boxMove` handler: updates box dimensions
- Add `boxUp` handler: finalizes box, computes which tasks intersect, updates `selectedKeys`
- In `startDrag`: if task is in `selectedKeys`, drag all of them; otherwise single task
- Render selection box as `<rect className="sel-box" .../>`
- Add `.sel-box` styles to `bridza.css`

## Verification

- Right-click and drag on empty canvas → dashed rectangle appears
- Release → tasks inside are highlighted/selected
- Click and drag a selected task → all selected tasks move together
- Click outside selection → clears selection
- Single-click on unselected task → selects only that task
- `pnpm test`, `pnpm lint`, `pnpm build` pass