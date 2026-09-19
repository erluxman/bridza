# Kanban search shortcut — Acceptance

## Search activation

- [ ] Press `/` → search input appears in topbar, input is focused
- [ ] Press `Cmd+K` (Mac) or `Ctrl+K` (non-Mac) → same as above
- [ ] Press `Escape` → search input closes, query cleared

## Search functionality

- [ ] Type in search input → only tasks matching query are visible
- [ ] Match is case-insensitive
- [ ] Matches against task title
- [ ] Matches against task ref (e.g., `#17`)
- [ ] Matches against task branch (e.g., `bridza/engineering/my-task`)
- [ ] Non-matching tasks are hidden (not shown in any column)
- [ ] Clearing the query → all tasks visible again

## Empty state

- [ ] When no tasks match the query → "No matching tasks" message shown
- [ ] When search is active but empty → all tasks visible (no filter applied)

## Visual

- [ ] Search input appears in topbar, next to other buttons
- [ ] Placeholder text: "Search tasks..."
- [ ] Search input visible only when activated (not always shown)

## Verification commands

- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes