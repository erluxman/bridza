import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./pages/App.tsx";

// The Bridza APP (agentic project management on git) is a lazy chunk so the
// landing page payload stays unchanged. It answers on:
//   app.bridza.erluxman.dev  (attach as an extra custom domain on the same
//                             Cloudflare Pages project — one build, one deploy)
//   app.localhost:5173       (local dev — browsers resolve *.localhost)
//   /app                     (kept as a fallback path; e2e drives this)
const Bridza = lazy(() => import("./app/App.jsx"));
// The download page is a lazy chunk too — the landing payload stays lean.
const Download = lazy(() => import("./pages/Download.tsx"));

const isApp =
  location.hostname.startsWith("app.") ||
  location.pathname === "/app" ||
  location.pathname.startsWith("/app/");
const isDownload =
  location.pathname === "/download" || location.pathname.startsWith("/download/");

createRoot(document.getElementById("root")!).render(
  isApp ? (
    // no StrictMode here: Bridza streams NDJSON runs + keeps wall-clock timers;
    // double-invoked dev effects would double the clocks and the API calls.
    <Suspense fallback={null}>
      <Bridza />
    </Suspense>
  ) : isDownload ? (
    <StrictMode>
      <Suspense fallback={null}>
        <Download />
      </Suspense>
    </StrictMode>
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
