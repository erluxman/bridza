# Highlight selected task in running now sidebar

## What

When the user selects a task (from the kanban board or task detail) that is still running in the background, the matching item in the "Running now" list of the left sidebar gets an active/selected highlight. Selection is the existing `activePipe` + `activeTask` state in `App.jsx` — only the sidebar's visual state changes.

## Why

Users need immediate visual feedback in the sidebar to know which running task they are currently viewing or inspecting, improving spatial awareness and navigation state.

## How

- Pass the selected task (pipeline id + task id) from `App.jsx` into `Sidebar` (`features/nav.jsx`).
- In the "Running now" list (`liveTasks.map`), add the active/selected class to the `.run-task` button whose `pid`/`tid` match the selected task, following the existing `.on` selected convention (e.g. `run-task on`).
- Add a `.run-task.on` highlight rule in `bridza.css`.
- Non-selected running tasks keep their current standard running style.

Out of scope: URL/route changes, highlighting on other surfaces (plan view, pipeline list), any selection source other than `activePipe`/`activeTask`.