import { useEffect, useMemo, useState } from "react";
import ThemeToggle from "../components/ThemeToggle";

// The download page reads the LATEST GitHub Release of erluxman/bridza and lays
// out per-OS installers + the one-line terminal installers. Both paths are
// first-class (UI download button and `curl | sh` / `irm | iex`).
const REPO = "erluxman/bridza";
const SITE = "https://bridza.erluxman.dev";

type Asset = { name: string; browser_download_url: string; size: number };
type Release = { tag_name: string; html_url: string; assets: Asset[]; published_at: string };

type OS = "mac" | "win" | "linux" | "other";

function detectOS(): OS {
  const s = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (/mac|iphone|ipad/.test(s)) return "mac";
  if (/win/.test(s)) return "win";
  if (/linux|android/.test(s)) return "linux";
  return "other";
}

const fmtSize = (n: number) => (n ? `${(n / 1e6).toFixed(1)} MB` : "");

export default function Download() {
  const [rel, setRel] = useState<Release | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none" | "error">("loading");
  const os = useMemo(detectOS, []);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Release) => {
        setRel(data);
        setState(data.assets?.length ? "ready" : "none");
      })
      .catch((e) => setState(e === 404 ? "none" : "error"));
  }, []);

  const pick = (test: (name: string) => boolean) =>
    rel?.assets.find((a) => test(a.name.toLowerCase())) || null;

  const platforms = [
    {
      id: "mac" as OS,
      label: "macOS",
      note: "macOS 11+ · Apple Silicon & Intel",
      downloads: [
        { label: "Apple Silicon (.dmg)", asset: pick((n) => n.includes("mac") && n.includes("arm64") && n.endsWith(".dmg")) },
        { label: "Intel (.dmg)", asset: pick((n) => n.includes("mac") && n.includes("x64") && n.endsWith(".dmg")) },
      ],
      cli: `curl -fsSL ${SITE}/install.sh | sh`,
    },
    {
      id: "win" as OS,
      label: "Windows",
      note: "Windows 10/11 · x64",
      downloads: [
        { label: "Installer (.exe)", asset: pick((n) => n.includes("win") && n.endsWith(".exe")) },
      ],
      cli: `irm ${SITE}/install.ps1 | iex`,
    },
    {
      id: "linux" as OS,
      label: "Linux",
      note: "x64 · AppImage or Debian",
      downloads: [
        { label: "AppImage", asset: pick((n) => n.endsWith(".appimage")) },
        { label: "Debian (.deb)", asset: pick((n) => n.endsWith(".deb")) },
      ],
      cli: `curl -fsSL ${SITE}/install.sh | sh`,
    },
  ];
  // Detected platform first, then the rest.
  const ordered = [...platforms].sort((a, b) => (a.id === os ? -1 : b.id === os ? 1 : 0));

  return (
    <div className="bg-aura min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-6">
        <header className="flex items-center justify-between py-6">
          <a href="/" className="text-ink text-lg font-semibold tracking-tight">
            Bridza
          </a>
          <div className="flex items-center gap-3">
            <a href="/app" className="text-ink-dim hover:text-ink text-sm transition-colors">
              Open the app
            </a>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex flex-1 flex-col pb-16">
          <section className="animate-in flex flex-col items-center pt-10 pb-12 text-center sm:pt-16">
            <span className="border-accent-soft text-accent bg-surface/60 rounded-full border px-3 py-1 text-xs font-medium">
              {state === "ready" && rel ? rel.tag_name : "Desktop app"}
            </span>
            <h1 className="text-ink mt-6 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Download <span className="text-accent">Bridza</span>
            </h1>
            <p className="text-ink-dim mt-5 max-w-xl text-balance">
              A conveyor belt for knowledge work — running on your machine, on your repos.
              Install with a click, or one line in the terminal.
            </p>
          </section>

          {state === "loading" && (
            <p className="text-ink-dim text-center text-sm">Fetching the latest release…</p>
          )}

          {state === "none" && (
            <div className="border-accent-soft bg-surface/60 mx-auto max-w-xl rounded-2xl border p-6 text-center">
              <p className="text-ink font-medium">No published build yet.</p>
              <p className="text-ink-dim mt-2 text-sm">
                Installers appear here the moment the first release is cut. Until then, run it from
                source:{" "}
                <code className="text-accent">git clone github.com/{REPO}</code> →{" "}
                <code className="text-accent">pnpm install &amp;&amp; pnpm dev</code>.
              </p>
            </div>
          )}

          {state === "error" && (
            <p className="text-ink-dim text-center text-sm">
              Couldn’t reach GitHub. See{" "}
              <a className="text-accent underline" href={`https://github.com/${REPO}/releases/latest`}>
                the releases page
              </a>
              .
            </p>
          )}

          {state === "ready" && (
            <div className="grid gap-5 sm:grid-cols-3">
              {ordered.map((p) => (
                <PlatformCard key={p.label} platform={p} highlighted={p.id === os} />
              ))}
            </div>
          )}

          {state === "ready" && rel && (
            <p className="text-ink-dim mt-8 text-center text-xs">
              All builds:{" "}
              <a className="text-accent underline" href={rel.html_url}>
                github.com/{REPO}/releases
              </a>{" "}
              · unsigned — first launch may need a right-click → Open (macOS) or “More info → Run
              anyway” (Windows).
            </p>
          )}
        </main>
      </div>
    </div>
  );
}

function PlatformCard({
  platform,
  highlighted,
}: {
  platform: {
    label: string;
    note: string;
    downloads: { label: string; asset: Asset | null }[];
    cli: string;
  };
  highlighted: boolean;
}) {
  return (
    <div
      className={`bg-surface/60 flex flex-col rounded-2xl border p-5 ${
        highlighted ? "border-accent" : "border-accent-soft"
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-ink font-semibold">{platform.label}</h2>
        {highlighted && (
          <span className="text-accent bg-surface rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            Your OS
          </span>
        )}
      </div>
      <p className="text-ink-dim mt-1 text-xs">{platform.note}</p>

      <div className="mt-4 flex flex-col gap-2">
        {platform.downloads.map((d) =>
          d.asset ? (
            <a
              key={d.label}
              href={d.asset.browser_download_url}
              className="border-accent-soft text-accent hover:border-accent flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
            >
              <span>{d.label}</span>
              <span className="text-ink-dim text-xs">{fmtSize(d.asset.size)}</span>
            </a>
          ) : (
            <span
              key={d.label}
              className="border-accent-soft text-ink-dim flex items-center rounded-lg border border-dashed px-3 py-2 text-sm"
            >
              {d.label} — n/a
            </span>
          ),
        )}
      </div>

      <div className="mt-4">
        <p className="text-ink-dim mb-1 text-[10px] font-medium uppercase tracking-wide">
          or from the terminal
        </p>
        <CopyLine text={platform.cli} />
      </div>
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
      title="Copy"
      className="border-accent-soft bg-surface hover:border-accent group flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
    >
      <code className="text-ink flex-1 overflow-x-auto whitespace-nowrap text-xs">{text}</code>
      <span className="text-ink-dim group-hover:text-accent text-[10px] shrink-0">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}
