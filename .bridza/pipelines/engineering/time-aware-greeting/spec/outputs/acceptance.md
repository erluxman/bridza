# Acceptance — Good-luck greeting adapts to time of day

- The welcome dialog's greeting line comes from a pure, exported `greetingForHour(hour)` helper with exactly three buckets: morning (hours 5–11), afternoon (12–16), evening (17–23 and 0–4).
- Each bucket renders a distinct greeting line; the good-luck wish appears in every bucket.
- The hour is injected into the helper — no wall-clock monkeypatching; `WelcomeDialog` renders the greeting for the current hour in production.
- Parameterized unit tests assert the expected greeting for each bucket's hours, including the boundaries (5, 11, 12, 16, 17, 4); `pnpm test` passes.
- No new dependencies; the dialog reuses its existing modal markup, CSS tokens, and copy tone.