import { useMemo } from "react";
import { FEATURES } from "../data/content";
import ThemeToggle from "../components/ThemeToggle";
import Logo from "../components/Logo";
import { detectOS } from "../lib/os";

export default function App() {
  return (
    <div className="bg-aura min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6">
        <Header />
        <main className="flex flex-1 flex-col">
          <Hero />
          <HowItWorks />
          <Features />
          <WhySection />
          <FinalCTA />
        </main>
        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between py-6">
      <a href="/" className="flex items-center">
        <Logo size={26} className="text-ink" />
      </a>
      <div className="flex items-center gap-3">
        {/* the app answers on the /app PATH of wherever the landing is —
            works on localhost, *.pages.dev previews (where an app. subdomain
            can't resolve: the wildcard TLS covers one level only), and the
            custom domain. The app. subdomain still works where DNS has it. */}
        <a
          href="/download"
          className="border-accent-soft text-accent bg-surface/60 hover:border-accent rounded-full border px-3 py-1 text-sm font-medium transition-colors"
        >
          Download
        </a>
        <a
          href="/app"
          className="border-accent-soft text-accent bg-surface/60 hover:border-accent rounded-full border px-3 py-1 text-sm font-medium transition-colors"
        >
          Open the app
        </a>
        <a
          href="https://github.com/erluxman/bridza"
          className="text-ink-dim hover:text-ink text-sm transition-colors"
        >
          GitHub
        </a>
        <a
          href="https://erluxman.dev"
          className="text-ink-dim hover:text-ink text-sm transition-colors"
        >
          by erluxman ↗
        </a>
        <ThemeToggle />
      </div>
    </header>
  );
}

function Hero() {
  const os = useMemo(detectOS, []);
  const cta =
    os === "mac"
      ? "Download for macOS"
      : os === "win"
        ? "Download for Windows"
        : os === "linux"
          ? "Download for Linux"
          : "Download";

  return (
    <section className="animate-in flex flex-col items-center pt-16 pb-20 text-center sm:pt-24">
      <span className="border-accent-soft text-accent bg-surface/60 rounded-full border px-3 py-1 text-xs font-medium">
        Jira for the AI era
      </span>
      <h1 className="text-ink mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
        From ideas to{" "}
        <span className="from-accent to-accent-2 bg-gradient-to-r bg-clip-text text-transparent">
          impact.
        </span>
      </h1>
      <p className="text-ink-dim mt-5 max-w-xl text-base text-pretty sm:text-lg">
        Aira is project management for the AI era. Agents do the work in
        small, git-backed stages. You approve every handoff.
      </p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <a
          href="/download"
          className="btn-gradient px-5 py-3 text-sm font-semibold"
        >
          {cta}
        </a>
        <a
          href="/app"
          className="border-accent-soft text-accent bg-surface/60 hover:border-accent rounded-full border px-5 py-3 text-sm font-medium transition-colors"
        >
          Open the app
        </a>
      </div>
      <p className="text-ink-faint mt-4 text-xs">
        macOS · Windows · Linux · Free and open source (MIT)
      </p>
      <p className="text-ink-dim mt-10 text-sm font-medium tracking-wide">
        Plan · Track · Ship
      </p>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      step: "Plan",
      title: "Describe the task.",
      body: "Drop an idea in the inbox. Aira gives it a ref, a branch and a pipeline: engineering, brand, video, research, or one you define.",
    },
    {
      step: "Track",
      title: "Agents run each stage.",
      body: "Every stage reads only the previous stage's outputs, runs your AI CLI under its own prompt, and commits one small diff.",
    },
    {
      step: "Ship",
      title: "You approve every handoff.",
      body: "Review the diff, flip Automate when you trust a stage, and finalize to merge into main.",
    },
  ];
  return (
    <section className="pb-20">
      <h2 className="text-ink text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        One task. Small stages. Real gates.
      </h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.step}
            className="border-line bg-surface/40 rounded-2xl border p-6"
          >
            <span className="text-accent text-xs font-semibold tracking-wide uppercase">
              {s.step}
            </span>
            <h3 className="text-ink mt-2 text-base font-medium">{s.title}</h3>
            <p className="text-ink-dim mt-2 text-sm leading-relaxed">
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="grid gap-4 pb-20 sm:grid-cols-2">
      {FEATURES.map((f) => (
        <div
          key={f.title}
          className="border-line bg-surface/40 hover:border-accent-soft rounded-2xl border p-6 transition-colors"
        >
          <h3 className="text-ink text-base font-medium">{f.title}</h3>
          <p className="text-ink-dim mt-2 text-sm leading-relaxed">{f.body}</p>
        </div>
      ))}
    </section>
  );
}

function WhySection() {
  return (
    <section className="pb-20">
      <h2 className="text-ink text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        Why Jira for the AI era
      </h2>
      <p className="text-ink-dim mx-auto mt-5 max-w-2xl text-center text-base leading-relaxed">
        Tickets are still tickets. The difference is who does the work and how
        a human signs off on it. Aira borrows what Jira taught everyone:
        tasks, boards, stages, refs and a branch per task. It changes the
        assignee. An agent does the work in stages you can review, and you
        gate every handoff.
      </p>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="flex flex-col items-center pb-24 text-center">
      <h2 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
        Ship work you can actually review.
      </h2>
      <p className="text-ink-dim mt-3 text-base">
        Free, open source, runs on macOS, Windows and Linux.
      </p>
      <a
        href="/download"
        className="btn-gradient mt-7 px-5 py-3 text-sm font-semibold"
      >
        Download Aira
      </a>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-line/60 text-ink-faint flex flex-col gap-3 border-t py-6 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          © {YEAR} Aira · a tool by erluxman
        </span>
        <div className="flex gap-4">
          <a href="https://github.com/erluxman/bridza" className="hover:text-ink">
            GitHub
          </a>
          <a href="https://gitcrystal.erluxman.dev" className="hover:text-ink">
            GitCrystal
          </a>
          <a href="https://erluxman.dev" className="hover:text-ink">
            erluxman.dev
          </a>
        </div>
      </div>
      <p className="text-ink-faint">
        Jira is a trademark of Atlassian Pty Ltd. Aira is not affiliated with
        or endorsed by Atlassian.
      </p>
    </footer>
  );
}

// Build year is fixed at compile time; fine for a static footer.
const YEAR = new Date().getFullYear();
