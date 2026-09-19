# Long press and drag to create boundary — Acceptance

## Selection box gesture

- [ ] Right-click and drag on empty canvas → dashed selection rectangle appears while dragging
- [ ] Releasing the mouse → box finalizes, tasks inside become selected (highlighted)
- [ ] Clicking outside selection → clears selected state

## Multi-select behavior

- [ ] Tasks inside selection box are visually highlighted/indicated as selected
- [ ] Single-click on an unselected task → selects only that task
- [ ] Shift+click on canvas → deselects all

## Multi-drag behavior

- [ ] Clicking and dragging any selected task → all selected tasks move together
- [ ] All dragged tasks maintain their relative positions during drag
- [ ] On mouse up → all dragged task positions are saved together
- [ ] Dragging an unselected task → only that single task moves

## Visual feedback

- [ ] Selection box renders as dashed rectangle overlay
- [ ] Selected tasks have visible highlight/border
- [ ] Dragging multiple tasks shows live position update

## Edge cases

- [ ] Selecting zero tasks (empty box) → no selection
- [ ] Selecting all tasks → all can be dragged together
- [ ] Selection box does not interfere with existing pan/zoom behavior

## Verification commands

- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes