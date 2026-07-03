# Deploying to Cloudflare Pages

How the three erluxman sites go live and stay automated. Same process for all
three repos; only the **project name** differs:

| Repo | Cloudflare Pages project | Domain |
|------|--------------------------|--------|
| erluxman.dev | `erluxman-dev` | erluxman.dev (+ www) |
| bridza       | `bridza`       | bridza.erluxman.dev |
| gitcrystal   | `gitcrystal`   | gitcrystal.erluxman.dev |

Hosting: **Cloudflare Pages (direct upload)**. CI/CD: **GitHub Actions + Wrangler**
(`.github/workflows/deploy.yml`) — PRs get a preview deploy + URL comment, merges
to `main` deploy to production. The same `pnpm deploy` works from the PC.

---

## Part A — Put erluxman.dev on Cloudflare  *(one-time, you)*

The domain is registered at **Namecheap** and currently served by GitHub Pages.
Moving its DNS to Cloudflare lets Pages manage the domains + TLS.

1. Log in to https://dash.cloudflare.com → **Add a site** → `erluxman.dev` → **Free** plan.
2. Cloudflare scans and imports existing DNS records (GitHub Pages records, any MX). Review them.
3. Copy the **2 nameservers** Cloudflare shows (e.g. `xena.ns.cloudflare.com`, `rob.ns.cloudflare.com`).
4. **Namecheap** → Domain List → *Manage* erluxman.dev → **Nameservers** → **Custom DNS** →
   paste both Cloudflare nameservers → save (green ✓).
5. Wait until the zone shows **Active** in Cloudflare (5 min – 24 h). Nothing below works until then.

> The new main landing page will replace the GitHub Pages site at the apex `erluxman.dev`
> (intended). Other records (email, subdomains) are preserved by the import in step 2.

## Part B — Credentials  *(one-time, you)*

6. **Account ID:** Cloudflare → erluxman.dev → Overview → right sidebar → copy **Account ID**.
7. **API token:** profile → **My Profile → API Tokens → Create Token → Custom Token**:
   - `Account` → `Cloudflare Pages` → **Edit**
   - `Zone` → `DNS` → **Edit**, Zone Resources = `erluxman.dev`  *(optional; only needed to script custom-domain attach)*
   - Create → **copy the token** (shown once). This is secret — never commit it.

## Part C — Wire it up  *(once Active; per repo)*

Run from each repo directory (or pass `--repo erluxman/<name>`):

```bash
# authenticate the CLI locally (OAuth — no token stored in the repo)
wrangler login

# create the Pages project (direct-upload). project name per the table above
wrangler pages project create erluxman-dev --production-branch main

# store CI secrets on GitHub (never written into the repo)
gh secret set CLOUDFLARE_API_TOKEN  --body "<token>"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account-id>"

# first production deploy (CI also does this automatically on push to main)
pnpm deploy
```

### Attach custom domains (one-time, after first deploy)
Dashboard → the Pages project → **Custom domains** → *Set up a domain*:
- `erluxman-dev` → `erluxman.dev` **and** `www.erluxman.dev`
- `bridza` → `bridza.erluxman.dev`
- `gitcrystal` → `gitcrystal.erluxman.dev`

DNS + TLS are auto-provisioned because the zone is in the same Cloudflare account.
Pick a canonical host (apex vs www) and add a redirect rule for the other.

## Part D — Verify the automation

1. `git checkout -b test-deploy && git commit --allow-empty -m "ci: test" && git push -u origin test-deploy`
2. `gh pr create --fill` → Actions builds and **comments a `*.pages.dev` preview URL**.
3. `gh pr merge` → push to `main` → **production deploy** runs automatically.
4. After Part A is Active + domains attached, the real domains serve over HTTPS.

---

## Secret hygiene
- Local deploys use `wrangler login` (OAuth, cached in `~/.config`) — no token on disk in the repo.
- CI uses the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` GitHub secrets.
- `.env`, `.env.*`, `.dev.vars`, `.wrangler/` are gitignored. Verify nothing leaked:
  `git ls-files | grep -iE '\.env$|token|secret'` → should be empty.

## Daily workflow (after setup)
- **From the PC:** `pnpm deploy` (prod) or `pnpm deploy:preview`.
- **From GitHub:** open a PR → preview; merge → production. Fully automated.

---

## app.bridza.erluxman.dev — the app on a subdomain

This repo ships ONE build containing both surfaces; `src/main.tsx` routes by
hostname (`app.*` → the Bridza app, anything else → the landing; `/app` also
works, which is what local dev uses). To serve the app at
**app.bridza.erluxman.dev**, attach it as a second custom domain on the SAME
Pages project — no extra CI, project, or build:

1. Cloudflare dash → Workers & Pages → **bridza** → **Custom domains** → *Add*.
2. Enter `app.bridza.erluxman.dev` → Cloudflare creates the DNS record itself.

The deployed app is a static shell: it has no local bridge, so it shows "clone
and run locally" instructions. The real tool is `pnpm dev` on your machine
(landing on `localhost:5173`, app on `localhost:5173/app`).
