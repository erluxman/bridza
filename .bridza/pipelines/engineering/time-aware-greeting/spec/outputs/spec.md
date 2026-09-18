# Spec — Good-luck greeting adapts to time of day

## What

The `WelcomeDialog` in `src/app/App.jsx` greets the user by time of day. Its greeting line is chosen by a small deterministic lookup from the current hour — one of three buckets: morning, afternoon, evening. The good-luck wish already in the dialog stays, unchanged, in every bucket.

## Why

The welcome should feel written for the work being done that day: the greeting line acknowledges when the user opened the app, and the good-luck wish always follows. A fixed 3-bucket lookup keeps the message personal and fresh with no copy framework.

## Buckets

Local hour (0–23) → bucket → greeting line:

- Hours 5–11 → morning → "Good morning"
- Hours 12–16 → afternoon → "Good afternoon"
- Hours 17–23 and 0–4 → evening → "Good evening"

The greeting line replaces the dialog's current heading ("Welcome"), reusing its tone and emoji treatment. The body's good-luck wish is untouched.

## Scope

- In scope: `src/app/App.jsx` — a pure exported helper `greetingForHour(hour)` that maps an hour to a greeting, plus `WelcomeDialog` using it; test coverage for the helper in `src/app/__tests__/welcome-dialog.test.jsx`.
- Determinism: the hour is injected into the pure helper (`WelcomeDialog` passes `new Date().getHours()`). Tests call the helper with fixed hours — no wall-clock monkeypatching.
- Reuses the existing modal markup/CSS and copy tokens; no new dependencies.
- Out of scope: persistence, per-day/per-session logic, extra buckets (night, holidays, etc.), and the dialog's dismissal behavior — all unchanged.