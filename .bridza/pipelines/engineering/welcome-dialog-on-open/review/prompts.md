# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-18T18:39:10.048Z · run 1 · opencode

Task: Welcome dialog appears when the app opens

## WHAT & WHY

When the user opens the Bridza app (`src/app/App.jsx`, reached via the `app.` host or `/app` path), a modal welcome dialog should appear over the dashboard greeting the user and wishing them good luck for the day's work. The dialog must be easy to dismiss without blocking the rest of the dashboard. The landing page (`src/pages/App.tsx`) is untouched.

## ACCEPTANCE CRITERIA

- On app open, a modal dialog renders over the dashboard with a welcome greeting and a good-luck-for-today message.
- Dismissable via: a close button, clicking the backdrop, and pressing `Esc`.
- Dismissal removes the dialog; the dashboard remains fully usable behind it.
- Uses the existing modal pattern and CSS tokens in `bridza.css`; no new dialog library.
- A unit/component test proves the dialog renders on mount and closes on each dismissal action; `pnpm test` passes.

