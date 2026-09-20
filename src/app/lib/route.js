// lib/route.js — the mapping between the address bar and the app's navigation
// state (open pipeline, open task, which non-board view). Pure: the Location is
// passed in, so this unit-tests without a browser.
//
// The app answers under two prefixes — `app.<host>/…` (no prefix) and
// `<host>/app/…` (the fallback path; electron and e2e drive that one) — so
// paths are built and parsed against whichever one this document loaded under.
//
//   /app                       no pipeline resolved yet (fresh load, no project)
//   /app/engineering           that pipeline's board
//   /app/engineering/fix-auth  task `fix-auth` open
//   …?view=inbox|plan|flow     the non-board screens. A query param, not a path
//                              segment, so no pipeline or task id can collide
//                              with a view name.
export const VIEWS = ["inbox", "plan", "flow"];

// Same test as main.tsx uses to admit the app bundle, in the same order: on an
// `app.` host the path has no prefix, everywhere else the app lives under /app.
export const prefixOf = (loc) => (loc.hostname.startsWith("app.") ? "" : "/app");

export function parseRoute(loc = window.location) {
  const prefix = prefixOf(loc);
  const rest = prefix && loc.pathname.startsWith(prefix) ? loc.pathname.slice(prefix.length) : loc.pathname;
  const [pipe = "", task = ""] = rest.split("/").filter(Boolean).map(decodeURIComponent);
  const view = new URLSearchParams(loc.search).get("view") || "";
  return { pipe, task, view: VIEWS.includes(view) ? view : "" };
}

export function routePath({ pipe = "", task = "", view = "" } = {}, loc = window.location) {
  // a task is only addressable inside its pipeline — no pipe, no task segment.
  const segs = [pipe, pipe && task].filter(Boolean).map(encodeURIComponent);
  const path = prefixOf(loc) + (segs.length ? "/" + segs.join("/") : "");
  return (path || "/") + (VIEWS.includes(view) ? "?view=" + view : "");
}

export const currentPath = (loc = window.location) => loc.pathname + loc.search;
