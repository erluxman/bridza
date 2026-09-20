# Acceptance — task #113

All checks are against a pipeline that has at least one archived task and at least one live task.

## Board

- [ ] Kanban renders stage columns + Done. No column named `Archived`. `kanban-empty-columns` test updated accordingly and green.
- [ ] No archived task appears in any column, in any column count, or in board search/filter results.
- [ ] Clicking 🗄 on a live card removes it from the board immediately; flash "task archived" shows; archive button count increments by 1.

## Top-bar button

- [ ] An `Archive` button with the archived count is visible in the Kanban top/title bar for the active pipeline.
- [ ] Count reflects only the active pipeline's archived tasks; switching pipeline updates it.
- [ ] With zero archived tasks the button is still present (muted), and opening it shows the empty state.

## Panel

- [ ] Clicking the button opens a floating panel from the right edge, overlaying the board, not inserting a column or shifting board layout.
- [ ] Clicking the button again, the ✕, or pressing `Esc` closes it.
- [ ] Panel lists every archived task of the active pipeline with `#ref` and title. Nothing from other pipelines.
- [ ] Clicking a task's title in the panel opens the task exactly as clicking its board card would.
- [ ] Clicking **Restore** removes the row, the task reappears in its correct board column without a page reload, flash "task restored" shows, button count decrements by 1.
- [ ] Switching pipeline while the panel is open never shows the previous pipeline's archived tasks.
- [ ] Reloading the page: panel is closed; archived tasks still absent from board; count still correct.

## Regression

- [ ] Plan board archive box (task #95) behaviour unchanged.
- [ ] Pipeline archive/unarchive in the sidebar unchanged.
- [ ] Existing unit + e2e suites green; new test covers: archived task absent from board → present in panel → restore → back on board.
