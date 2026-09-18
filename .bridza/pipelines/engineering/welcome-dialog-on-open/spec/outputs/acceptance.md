# Acceptance — Welcome dialog appears when the app opens

- A modal dialog renders over the dashboard on app open, containing a welcome greeting and a good-luck-for-today message.
- The dialog dismisses via each of: the close button, clicking the backdrop, and pressing `Esc`.
- After dismissal the dialog is gone and the dashboard remains fully usable.
- The dialog uses the existing modal pattern and CSS tokens in `src/app/bridza.css`; no new dialog library is added.
- The landing page (`src/pages/App.tsx`) is unchanged.
- A unit/component test proves the dialog renders on mount and closes on each dismissal action; `pnpm test` passes.