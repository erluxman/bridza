# Acceptance — Good-luck greeting adapts to time of day

- The dialog's greeting line differs by time-of-day bucket: morning (hours 5–11 → "Good morning"), afternoon (12–16 → "Good afternoon"), evening (17–23 and 0–4 → "Good evening").
- The good-luck wish appears in every bucket, unchanged.
- Greetings come from a pure, exported `greetingForHour(hour)` helper: the hour is injected, so tests set it deterministically — no wall-clock monkeypatching; the dialog renders the bucket for the current hour in production.
- Parameterized unit tests inject each bucket's hours (including boundaries 5, 11, 12, 16, 17, 0, 4) and assert the expected greeting; `pnpm test` passes (all greeting tests pass; the suite keeps main's single pre-existing, unrelated `ux-views` rendering failure).
- No new dependencies; the dialog reuses its existing modal markup, CSS tokens, and copy style.
