# Colour + type tokens — ready to paste (source: brand-guidelines §5, §6)

## `src/index.css` — replace inside `@theme` and `:root[data-theme="light"]`

```css
/* dark (default) */
--color-ink: #F8FAFC;  --color-ink-dim: #94A3B8;  --color-ink-faint: #64748B;
--color-base: #0B1120; --color-surface: #111A2E;  --color-line: #1E293B;
--color-accent: #4F7BFF; --color-accent-2: #8B5CF6; --color-accent-soft: #1E2A5A;
--color-on-accent: #FFFFFF; --color-success: #06D6A0;

/* light (data-theme="light") */
--color-ink: #0B1120;  --color-ink-dim: #475569;  --color-ink-faint: #94A3B8;
--color-base: #FFFFFF; --color-surface: #F8FAFC;  --color-line: #E2E8F0;
--color-accent: #4F7BFF; --color-accent-2: #8B5CF6; --color-accent-soft: #DBE4FF;
--color-on-accent: #FFFFFF; --color-success: #06D6A0;
```

`--color-accent-2` and `--color-success` are new tokens — add them, don't just rename existing ones.

## Brand gradient
`linear-gradient(90deg, #4F7BFF 0%, #8B5CF6 100%)` — primary buttons, `.bg-aura`, hero highlight word, wave motif. 135° on large surfaces.

## Full 6-colour palette (for reference / illustrations / OG image)
| Name | Hex |
|---|---|
| Primary Blue | `#4F7BFF` |
| Purple | `#8B5CF6` |
| Cyan (success / "AI ready") | `#06D6A0` |
| Dark Navy (product default ground) | `#0B1120` |
| Slate | `#64748B` |
| Light (marketing ground) | `#F8FAFC` |

## Semantic tag colours (board tags — leave unless a tag-color ticket says otherwise)
| Tag | Text | Background |
|---|---|---|
| AI | `#1D4ED8` | `#DBE4FF` |
| Bug | `#B91C1C` | `#FEE2E2` |
| Feature | `#047857` | `#D1FAE5` |
| Task | `#1D4ED8` | `#DBEAFE` |

## Accessibility
Primary Blue on white = 4.6:1 (AA for text ≥14pt bold / 18pt). Body-size links on white → use `#3B63E6` instead. Light on Dark Navy = 17:1. Never set body text in Purple or Cyan.

## Typography
- Headings: Inter 700/600, tracking −0.02em to −0.03em.
- Body: Inter 400/500.
- Code/UI: JetBrains Mono 400/500.
- Wordmark: Inter 700 at −3% tracking.
- Load via Google Fonts (`Inter:wght@400;500;600;700` + `JetBrains+Mono:wght@400;500`) or self-host under `public/fonts/`. `--font-sans` / `--font-mono` in `src/index.css` already point at them — just make sure the `<link>`/`@font-face` in `index.html` actually loads these weights.

## Radii / spacing / elevation
| Token | Value |
|---|---|
| Radius: control / card / modal / pill | 8px / 12px / 16px / 999px |
| Spacing scale | 4, 8, 12, 16, 24, 32, 48, 64 px |
| Shadow (light only) | `0 1px 2px rgb(11 17 32 / .06), 0 8px 24px rgb(11 17 32 / .08)`; dark mode uses borders, not shadows |

## Buttons
- Primary: brand gradient fill, white text, 600 weight, radius 8px, padding 10×18px. Hover +6% brightness. Focus: 2px Primary Blue ring at 40%.
- Secondary: 1px Slate/30 border, transparent fill, ink text. Hover: border → Primary Blue.
- Text link: Primary Blue, 500 weight, arrow suffix, underline on hover only.
