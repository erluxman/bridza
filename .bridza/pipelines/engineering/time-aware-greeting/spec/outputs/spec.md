# Spec — Good-luck greeting adapts to time of day

## What

The `WelcomeDialog` (in `src/app/features/onboarding.jsx`) picks its greeting line from the current hour via a single deterministic lookup — three buckets: morning, afternoon, evening. The good-luck wish already in the dialog stays, unchanged, in every bucket.

## Why

The welcome should feel written for the work being done that day: the greeting line acknowledges when the user opened the app, and the good-luck wish always follows. A fixed 3-bucket lookup keeps the message personal and fresh with no copy framework.

## Buckets

Local hour (0–23) → bucket → greeting line:

- Hours 5–11 → morning → "Good morning"
- Hours 12–16 → afternoon → "Good afternoon"
- Hours 17–23 and 0–4 → evening → "Good evening"

## Scope

- In scope: the dialog's greeting line becomes the bucket-driven greeting, reusing the dialog's existing copy tone and emoji treatment.
- Determinism: the hour is injected into a pure, exported helper (`greetingForHour(hour)`); the dialog passes `new Date().getHours()`, and tests call the helper with fixed hours — no wall-clock monkeypatching.
- Test coverage: parameterized unit tests in `src/app/__tests__/welcome-dialog.test.jsx` cover each bucket and its boundaries.
- Reuses the existing modal markup/CSS and copy tokens; no new dependencies.
- Out of scope: dismissal behavior, persistence/per-day logic, and extra buckets — all unchanged.
