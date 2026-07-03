import { useState } from "react";
import { FEATURES } from "../data/content";
import ThemeToggle from "../components/ThemeToggle";

export default function App() {
  return (
    <div className="bg-aura min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6">
        <Header />
        <main className="flex flex-1 flex-col">
          <Hero />
          <Features />
        </main>
        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between py-6">
      <a href="/" className="flex items-center gap-2">
        <Logo />
        <span className="text-ink text-lg font-semibold tracking-tight">
          Bridza
        </span>
      </a>
      <div className="flex items-center gap-3">
        {/* the app lives on the app. subdomain of wherever the landing is:
            bridza.erluxman.dev → app.bridza.erluxman.dev,
            localhost:5173 → app.localhost:5173 (browsers resolve *.localhost) */}
        <a
          href={`//app.${location.host}/`}
          className="border-accent-soft text-accent bg-surface/60 hover:border-accent rounded-full border px-3 py-1 text-sm font-medium transition-colors"
        >
          Open the app
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
  return (
    <section className="animate-in flex flex-col items-center pt-16 pb-20 text-center sm:pt-24">
      <span className="border-accent-soft text-accent bg-surface/60 rounded-full border px-3 py-1 text-xs font-medium">
        Coming soon
      </span>
      <h1 className="text-ink mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
        AI automation flows,{" "}
        <span className="text-accent">visually managed.</span>
      </h1>
      <p className="text-ink-dim mt-5 max-w-xl text-base text-pretty sm:text-lg">
        Bridza is one canvas to design, run, and manage your AI automations.
        Wire up tools and AI steps, then ship automations you can actually trust.
      </p>
      <Waitlist />
    </section>
  );
}

function Waitlist() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  // Placeholder — wired to a real backend in a later phase.
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setDone(true);
  }

  if (done) {
    return (
      <p className="text-accent mt-9 text-sm">
        Thanks — you’re on the list. We’ll be in touch. ✦
      </p>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-9 flex w-full max-w-md flex-col gap-2.5 sm:flex-row"
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        aria-label="Email address"
        className="border-line bg-surface/70 text-ink placeholder:text-ink-faint focus:border-accent flex-1 rounded-full border px-5 py-3 text-sm outline-none transition-colors"
      />
      <button
        type="submit"
        className="bg-accent text-on-accent rounded-full px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
      >
        Join waitlist
      </button>
    </form>
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

function Footer() {
  return (
    <footer className="border-line/60 text-ink-faint flex flex-wrap items-center justify-between gap-3 border-t py-6 text-xs">
      <span>© {YEAR} Bridza · a tool by erluxman</span>
      <div className="flex gap-4">
        <a href="https://gitcrystal.erluxman.dev" className="hover:text-ink">
          GitCrystal
        </a>
        <a href="https://github.com/erluxman" className="hover:text-ink">
          GitHub
        </a>
      </div>
    </footer>
  );
}

// Build year is fixed at compile time; fine for a static footer.
const YEAR = new Date().getFullYear();

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="6" r="3" fill="var(--color-accent)" />
      <circle cx="18" cy="12" r="3" fill="var(--color-accent)" />
      <circle cx="6" cy="18" r="3" fill="var(--color-ink-faint)" />
      <path
        d="M6 6 L18 12 L6 18"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        opacity="0.7"
      />
    </svg>
  );
}
