# Spec — Welcome dialog appears when the app opens

## What

When the Bridza app opens (`src/app/App.jsx`, served at `/app` or the `app.` host), a modal welcome dialog renders over the dashboard. It greets the user and wishes them good luck for the day's work. It can be dismissed without blocking the dashboard.

## Why

The user asked for a welcome screen: "when I open this freezer it shows a welcome screen and wish you a good luck." It gives a short, friendly touchpoint at the start of each session.

## Scope

- In scope: `src/app/App.jsx` — render the dialog on mount, add dismissal.
- Out of scope: landing page (`src/pages/App.tsx`) stays untouched.
- Reuse the existing modal pattern (`.modal-bg` / `.modal` in `src/app/bridza.css`) and the existing modal state in `App.jsx`. No new dialog library.
- No persistence, no "only once per day", no timing/greeting logic — that is separate work.

## Dismissal

The dialog must close via all three:
- Close button inside the dialog
- Clicking the backdrop
- Pressing `Esc`

Dismissal removes the dialog; the dashboard behind remains fully usable.