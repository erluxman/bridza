# Good-luck greeting adapts to time of day

## WHAT & WHY

Make the welcome feel written for "the work I am doing for the day": the greeting line changes with the time of day (morning / afternoon / evening buckets) while the good-luck wish is always included. Keeps the message personal and fresh without any copy framework — a single small deterministic lookup.

## ACCEPTANCE CRITERIA

- The dialog's greeting line differs by time-of-day bucket: morning, afternoon, evening.
- The good-luck wish appears in every bucket.
- The current hour is injectable/deterministic for tests (no wall-clock monkeypatching races).
- No new dependencies; reuses the dialog's existing copy style and tokens.
- Parameterized unit tests inject each bucket's hour and assert the expected greeting; `pnpm test` passes.