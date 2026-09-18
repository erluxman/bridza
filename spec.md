# Welcome dialog shows at most once per calendar day

## What

The welcome dialog — currently shown on every app load — is dismissed at most once per calendar day. Once the user dismisses it, the app remembers for the rest of that day, so reloading or reopening the app stays quiet. On a new calendar day the dialog returns until dismissed again.

## Why

The dialog greets the user for the day's work ("Good luck with today's work — make it count"). Showing it on every reload is noise; one greeting per day matches that intent.

## How

- Gate the welcome dialog's initial visibility in `src/app/App.jsx` on the dismissal record for today's calendar date.
- Dismissal (close button, backdrop click, Escape) records today's date; the dialog's `onClose` path in `App.jsx` (`setWelcomeOpen(false)` / `WelcomeDialog` `onClose`) writes it.
- Store the record in `localStorage` under a new `LS.welcome` key (value: today's date, e.g. `YYYY-MM-DD`), alongside the existing `LS` conventions in `App.jsx`. Reuse the existing `localStorage.getItem`/`setItem` helpers already there.
- On mount, show the dialog only when the stored welcome date is not today; on dismiss, write today's date.
- Calendar day is computed locally in the user's timezone; no server change.
- No new storage library or dependency.

Out of scope: cross-day resets beyond a simple date comparison, analytics of when dismissals happen, or any change to the dialog's content.