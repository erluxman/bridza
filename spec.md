# Kanban search shortcut

## What

Add a quick-search feature to the Kanban board that lets users filter visible tasks by typing a search query. Activated via keyboard shortcut (`/` or `Cmd+K`), hides non-matching tasks in-place without navigating away.

## Why

Users with many tasks across columns need to quickly locate a specific task without scrolling or opening each card. A global search shortcut is a standard Kanban pattern that improves discoverability.

## How

Add search state to the Board component:

- **Shortcut**: Press `/` or `Cmd+K` (Ctrl+K on non-Mac) to focus the search input. Press `Escape` to clear and close.
- **Search input**: A minimal input field in the topbar, visible only when search is active. Placeholder: "Search tasks..."
- **Filter logic**: Case-insensitive substring match against task `title`, `ref` (e.g., `#17`), and `branch`. Tasks not matching are hidden (display: none) in their column.
- **Empty state**: When search yields no results, show "No matching tasks" in the board area.
- **Persistence**: Search state is transient (clears on page refresh or navigation).

The implementation lives in `src/app/features/board.jsx`:

- Add `searchOpen` and `searchQuery` state vars
- Add keyboard listener for `/` and `Cmd+K` in the Board component
- Filter `byCol` (the tasks per column) based on `searchQuery`
- Add search input to the topbar (next to the other buttons)
- Add empty-result message when all columns are empty after filtering

## Verification

- Press `/` → search input appears focused
- Type a query → non-matching tasks disappear from all columns
- Matching ref (e.g., `#17`) → tasks with that ref shown
- Press Escape → search clears, all tasks visible
- `pnpm test`, `pnpm lint`, `pnpm build` pass
