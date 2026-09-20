// route.test.js — the address bar ⇄ navigation state mapping (task #105): the
// open task has to survive a refresh, under both prefixes the app answers on.
import { describe, it, expect } from "vitest";
import { parseRoute, routePath, prefixOf } from "../lib/route.js";

// a stand-in for window.location; only the three fields route.js reads.
const loc = (url) => {
  const u = new URL(url);
  return { hostname: u.hostname, pathname: u.pathname, search: u.search };
};
const path = loc("http://localhost:5199/app");          // /app prefix (e2e, electron, prod fallback)
const host = loc("http://app.localhost:5173/");         // app.<host>, no prefix

describe("prefix", () => {
  it("is /app everywhere except an app.<host>", () => {
    expect(prefixOf(path)).toBe("/app");
    expect(prefixOf(host)).toBe("");
    expect(prefixOf(loc("http://127.0.0.1:52341/app/eng"))).toBe("/app");
  });
});

describe("parseRoute", () => {
  it("reads the pipeline and the open task out of the path", () => {
    expect(parseRoute(loc("http://localhost:5199/app/engineering/fix-auth")))
      .toEqual({ pipe: "engineering", task: "fix-auth", view: "" });
    expect(parseRoute(loc("http://app.localhost:5173/engineering/fix-auth")))
      .toEqual({ pipe: "engineering", task: "fix-auth", view: "" });
  });

  it("treats a bare app path as no pipeline, no task", () => {
    expect(parseRoute(path)).toEqual({ pipe: "", task: "", view: "" });
    expect(parseRoute(host)).toEqual({ pipe: "", task: "", view: "" });
    expect(parseRoute(loc("http://localhost:5199/app/"))).toEqual({ pipe: "", task: "", view: "" });
  });

  it("reads the non-board views from ?view, and ignores anything else", () => {
    expect(parseRoute(loc("http://localhost:5199/app?view=inbox")).view).toBe("inbox");
    expect(parseRoute(loc("http://localhost:5199/app/eng?view=flow")))
      .toEqual({ pipe: "eng", task: "", view: "flow" });
    expect(parseRoute(loc("http://localhost:5199/app?view=nonsense")).view).toBe("");
  });

  it("decodes ids, so a slug with escapes round-trips", () => {
    const r = { pipe: "eng ops", task: "a/b", view: "" };
    expect(parseRoute(loc("http://localhost:5199" + routePath(r, path)))).toEqual(r);
  });
});

describe("routePath", () => {
  it("names the open task under the current prefix", () => {
    expect(routePath({ pipe: "engineering", task: "fix-auth" }, path)).toBe("/app/engineering/fix-auth");
    expect(routePath({ pipe: "engineering", task: "fix-auth" }, host)).toBe("/engineering/fix-auth");
  });

  it("falls back to the app root when nothing is open", () => {
    expect(routePath({}, path)).toBe("/app");
    expect(routePath({}, host)).toBe("/");
  });

  it("drops a task with no pipeline to hold it", () => {
    expect(routePath({ task: "fix-auth" }, path)).toBe("/app");
  });

  it("appends only known views", () => {
    expect(routePath({ pipe: "eng", view: "plan" }, path)).toBe("/app/eng?view=plan");
    expect(routePath({ view: "inbox" }, host)).toBe("/?view=inbox");
    expect(routePath({ pipe: "eng", view: "bogus" }, path)).toBe("/app/eng");
  });

  it("round-trips every state parseRoute can produce", () => {
    for (const r of [
      { pipe: "", task: "", view: "" },
      { pipe: "eng", task: "", view: "" },
      { pipe: "eng", task: "t-105", view: "" },
      { pipe: "eng", task: "", view: "flow" },
      { pipe: "", task: "", view: "inbox" },
    ]) {
      for (const base of [path, host]) {
        const p = routePath(r, base);
        const [pathname, search = ""] = p.split("?");
        expect(parseRoute({ hostname: base.hostname, pathname, search: search && "?" + search })).toEqual(r);
      }
    }
  });
});
