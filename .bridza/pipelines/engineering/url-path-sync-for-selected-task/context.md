# Sync URL path with selected task or view state

## What
Update the browser URL path or hash when navigating between pipelines, tasks, inbox, and plan views, and restore view state on load from the URL.

## Why
Enables bookmarking, browser back/forward navigation, and deep linking directly to specific tasks or views within Bridza.

## Acceptance Criteria
- Navigating to a task or view updates the URL path/hash cleanly without reloading the app shell.
- Opening the app with a specific URL hash/path correctly restores the active pipeline, task, inbox, or plan view.
