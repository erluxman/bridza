# Acceptance — Welcome dialog shows at most once per calendar day

- [ ] Dismissing the dialog (close button, backdrop, Escape), then reloading/reopening the app the same calendar day, does not show the dialog again.
- [ ] The dismissal is persisted in `localStorage` keyed by calendar date, following the existing `LS` conventions in `src/app/App.jsx` (`LS.welcome`, value = today's date). No new dependency or storage library.
- [ ] A new calendar day resets the record: the dialog appears again on load until dismissed that day.
- [ ] Tests deterministically cover both cases — dismiss + same-day reload = hidden, new date = shown — and `pnpm test` passes.