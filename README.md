# Bridza

**AI automation flow management** — design, run, and manage AI automations on a
single visual canvas. Landing page (the product is in progress).

- **Stack:** Vite + React 19 + TypeScript + Tailwind CSS v4
- **Hosting:** Cloudflare Pages (project `bridza`) → bridza.erluxman.dev
- **CI/CD:** GitHub Actions — PRs get preview deploys, `main` deploys to production

## Develop

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

## Build & verify

```bash
pnpm lint
pnpm build
pnpm preview:local
```

## Deploy

```bash
pnpm deploy         # production (needs `wrangler login` or CLOUDFLARE_API_TOKEN)
pnpm deploy:preview # preview channel
```

Secrets are never committed — local deploys use `wrangler login` (OAuth); CI uses
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` GitHub secrets.
