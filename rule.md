# ALIS Frontend — Style & Engineering Rules

> Single source of truth for every UI/style decision in this repo.  
> If code disagrees with this file, code is wrong. Update code or amend this file — same PR.

---

## 0. Workflow & Branching

- **Do not commit without asking.** `git commit` / `git push` only after explicit user approval.
- **Main is merge of role branches.** `main = admin + dm + citizen + dealer` (merged). After any change in `main`, verify if it is needed in role branches `[admin, dm, citizen, dealer]` and cherry-pick.
- **Package manager:** Use `bun` (and `bun.lock`), not `npm`. `bun install`, `bun run build`, `bun run lint`. `package-lock.json` is legacy — keep in sync only if needed.
- **Default credentials (dev only):** `admin@1234` for local/demo.

---

## 1. Testing & Automation

- **Every interactive/important UI element must have `data-testid`.** Naming: `filename:scope-kebab-from-text` (e.g., `material-approval:btn-refresh`, `dealer-list:card-licensee-profile`).
- **Validate:** `node scripts/check-test-ids.js` (or `bun run lint:test-ids`) must pass — `69` files, `~3880` IDs, `0` missing, `0` duplicates. CI fails otherwise.
- **Playwright:** Use `data-testid` for navigation/assertions, not CSS/XPath. Example `page.getByTestId('material-approval:btn-refresh')`.
- **Directives to skip:** `<!-- check-test-ids-ignore -->` (file) / `<!-- check-test-ids-ignore-next-line -->` / `data-testid-ignore` (element).

---

## 2. Stack — Tailwind Only

- **Only Tailwind (`tw-*` with `prefix: 'tw-'`)** is allowed. No new UI libraries. Existing `bootstrap` SCSS is legacy and must not be extended — new code uses `tw-*` only.
- **No `ux4g` / `ux4g-web-components`.** Package `ux4g-web-components@1.0.13` removed from `package.json`/`bun.lock`/`angular.json` (`styles: [src/styles.scss]` only, `scripts: [apexcharts]` only). Every `ux4g-*` class has been converted to `tw-*` (6354 tokens). `grep -R 'ux4g' src` must be `0`.
- **Mapping example:** `ux4g-d-flex`→`tw-flex`, `ux4g-bg-neutral`→`tw-bg-white`, `ux4g-card`→`tw-bg-white tw-border… tw-rounded-xl`, `ux4g-btn`→`tw-inline-flex … tw-border`.
- **Tailwind config** `tailwind.config.js` with `brand` palette (`50:#eff6ff … 900:#0f2d52`) is single source — mirrors `src/scss/themes/_app-ui.scss` `--app-brand-*`.

---

## 3. Theme — Vars, Not Hardcodes

- **No hardcoded theme values.** `#hex`, `rgba()`, `px` for theme, `font-size` for theme must be `var(--app-*)`.
- **Canonical tokens in `src/scss/themes/_app-ui.scss` `:root` (32 vars, consolidated):**
  ```
  Surfaces: --app-bg #f8fafc, --app-surface #ffffff, --app-border #e2e8f0, --app-border-strong #cbd5e1
  Text: --app-text #0f172a, --app-muted #475569, --app-slate-400 #94a3b8, --app-slate-500 #64748b, --app-slate-700 #334155, --app-slate-800 #1e293b
  Brand: --app-primary #1d4ed8, --app-primary-hover #1e40af, --app-primary-soft #eff6ff, --app-primary-border #bfdbfe, --app-brand-100 #dbeafe … 900
  Semantic: --app-success #059669 + soft #ecfdf5, --app-warning #d97706 + soft #fffbeb, --app-danger #dc2626 + soft #fef2f2, --app-info #0284c7 + soft #f0f9ff, --app-violet #7c3aed + soft #f5f3ff, --app-indigo #4f46e5
  Shape: --app-radius 10px, --app-radius-sm 6px, --app-radius-lg 14px
  Elevation: --app-shadow-sm, --app-shadow, --app-shadow-lg (but see §7: shadows disabled → box-shadow: none)
  ```
- **Consolidated:** Exact duplicates removed (`--app-slate-50→--app-bg`, `--app-header-bg→--app-surface`, `--app-brand-700→--app-primary`, `--app-brand-50→--app-primary-soft`, etc. — 16 vars removed). Near-identical lights (`#f8fafc` vs `#f1f5f9` distance <10) unified to `--app-bg`.
- **Usage:** `grep '#[0-9a-f]{3,6}' src/app --include='*.scss' | grep -v 'var('` must be `0` (except `settings` where SCSS `color.adjust()` needs real hex).
- **Spacing/typography:** Use `tw-*` utilities or `var(--app-radius)` / `var(--app-space-*)` if defined; do not hardcode `6px`/`10px`/`0.85rem` outside tokens.

---

## 4. No Duplicates / No Redundancy

- **One definition per selector.** `353` duplicate selectors (`.card`, `.form-control`, `.filter-strip`) deduped. Global `_app-ui.scss` is canonical; component SCSS must not redeclare it.
- **One class per intent in HTML.** `tw-bg-white tw-bg-white` exact dups → deduplicated (keep last). Conflicting `tw-px-4` + `tw-px-3` → keep `tw-px-3` (last wins). `tw-border-slate-200` + `tw-border-0` → `tw-border-0` only.
- **One button system.** `btn btn-sm btn-outline-primary rounded-pill` (bootstrap) → `tw-inline-flex … tw-bg-white tw-border-slate-200 … tw-rounded-full` (Tailwind). `50` bootstrap `btn` variants → `0`.
- **Check:** `grep 'tw-bg-white tw-bg-white' src --include='*.html'` → `0`, `grep 'class="btn ' src` → `0`.

---

## 5. No Hover Background

- **No `hover:tw-bg-*` / `group-hover:tw-bg-*` / `tw-hover:bg-*` and no SCSS `:hover { background: … }`.**
- All `:hover` in SCSS renamed to `:hover-disabled` (215 occurrences) or stripped. `hover:tw-bg-*` 243 → 0. `grep 'hover:tw-bg' src` → `0`, `grep ':hover' src --include='*.scss' | grep background` → `0` (only `color` left, not bg).
- `tw-transition-colors` kept only if needed for non-bg transitions; otherwise removed.

---
Inner/Outer Visibility — Root → Leaf Fix (Two-Score, Existing Color Only)

│ Every component must be distinct from immediate parent and immediate children only. l1→l2→l3:
│ l1==l3 allowed, l2 must differ from both. Similarity should be minimum (100=identical bad,
│ 0=opposite good).

Run on every src/ html:

  python3 scripts/html_tree.py src/app/app-pages/*/*.component.html  # [#HEX/P-xx/C-yy]
  python3 scripts/html_tree.py path/to/page.html --similarity-score  # Overall similarity: XX/100
  find src -name "*.html" -exec python3 scripts/html_tree.py {} --similarity-score \;

Scores: P vs parent, C avg vs immediate children. Overall = ( Σ(P+C) / count ) / 2.

Fix Root → Leaf (per file):

  queue=[root]
  for parent in queue:
    for child where similar to parent or to its children:
      1. Palette = all [#HEX] already in file
      2. Use ONLY existing color → pick distinct from parent and child’s children, similarity
minimum
      3. Do NOT add new HEX. If none fits → ask user what color to use in what component
      4. Apply, enqueue child

Verify: each P and C minimum, Overall minimum per file.


---

## 7. No Transparent

- **No `tw-bg-transparent`, `tw-border-transparent`, `tw-text-transparent`, `background: transparent`, `color: transparent`, `rgba(… , 0.x)`, `bg-white/80`, `tw-bg-black/50`.**
- `tw-bg-transparent` → `tw-bg-white`, `tw-border-transparent` → `tw-border-slate-200`, `background: transparent` → `var(--app-surface)`, `rgba(255,255,255,0.4)` → `var(--app-surface)`, `bg-white/80` → `bg-white` (strip `/xx`).
- Remaining `transparent` is only for functional CSS (`scrollbar-color: #cbd5e1 transparent`, `border-color: transparent` for arrow triangles, `$table-bg: transparent` in settings where SCSS needs it) — not for component bg/text.

---

## 8. No Gradient / No Shadow

- **No `linear-gradient`, `radial-gradient`, `box-shadow` (except `none`), `tw-shadow*`, `drop-shadow`.**
- `background: linear-gradient(135deg, var(--app-brand-800)→var(--app-brand-600))` (page-header `alis-page-banner`, `material-request`, `sign-in`) → `background: var(--app-primary)` solid.
- `tw-shadow-sm`/`tw-shadow`/`shadow` (55 → 0) stripped from `tw-bg-white … tw-shadow-sm` cards → `tw-bg-white …` flat. `box-shadow: 0 1px 3px …` → `box-shadow: none;`.
- `grep 'linear-gradient' src | grep -v "style*=" | grep -v "//" → 0` (except disabled `settings`); `grep tw-shadow` → `0`; `grep 'box-shadow:' | grep -v none` → `0`.

---

## 9. Ponytail / Minimalism

- **Shortest diff that works.** No speculative abstractions, no “for later” scaffolding. One line fix beats 50-line factory.
- **Mark deliberate simplifications** with `/* ponytail: … */` (e.g., `ponytail: tw conversion (6354 tokens)`, `ponytail: global lock`).
- **Ladder:** reuse existing helper → stdlib → native platform → installed dep → one-liner → minimal code.

---

## 11. No `console.log` (deterministic)

- `grep -R 'console\.log' src --include='*.ts' | wc -l` → `0`

## 12. No Inline `style=` (deterministic)

- `grep -R 'style=' src --include='*.html' | grep -v 'style*=' | wc -l` → `0` (single escape `style*="gradient"` excluded in §8)

## 13. Deterministic Baselines (tracked, no increase in PR)

- `grep -R ': any' src/app --include='*.ts' | grep -v 'api-adapter' | wc -l` → `~1166` (no new `: any` in PR)
- `grep -R '!important' src/app --include='*.scss' | wc -l` → `~447` (no new `!important` in PR)
- `grep -R '\.subscribe(' src/app --include='*.ts' | wc -l` → `~296` (new `subscribe` requires `takeUntilDestroyed()` or `async` pipe)

## 14. No New Dependency (deterministic)

- `git diff main -- package.json bun.lock | wc -l` → `0` unless PR notes package + size + stdlib alternative
- `bun run build` must pass `angular.json` budgets (initial 500kb warn / 700kb error)

---

## 15. Verification — Full (copy-paste)

```bash
bun run build  # → dist/, only Sass @import deprecations, budgets OK
node scripts/check-test-ids.js  # 69 files, ~3880 IDs, 0 missing, 0 duplicates

# Stack / theme
grep -R 'ux4g' src --include='*.html' --include='*.ts' --include='*.scss' | wc -l  # 0
grep -R '#[0-9a-f]\{3,6\}' src/app --include='*.scss' | grep -v 'var(' | wc -l  # 0
grep -R 'style=' src --include='*.html' | grep -v 'style*=' | wc -l  # 0  (§12)
grep -R '!important' src/app --include='*.scss' | wc -l  # baseline ~447 — no increase (§13)

# Visual bans
grep -R 'hover:tw-bg' src --include='*.html' | wc -l  # 0
grep -R 'tw-shadow' src --include='*.html' | wc -l  # 0
grep -R 'linear-gradient' src --include='*.scss' --include='*.html' | grep -v "style*=" | wc -l  # 0
grep -R 'tw-bg-transparent\|tw-border-transparent' src --include='*.html' | wc -l  # 0
grep -R 'bg-white/' src --include='*.html' | wc -l  # 0
grep -R 'box-shadow:' src --include='*.scss' | grep -v 'none' | grep -v '//' | grep -v '\$' | wc -l  # 0

# Redundancy
grep -R 'tw-bg-white tw-bg-white' src --include='*.html' | wc -l  # 0
grep -R 'class="btn ' src --include='*.html' | wc -l  # 0
grep -R ':hover' src --include='*.scss' | grep background | wc -l  # 0

# Code hygiene (§11)
grep -R 'console\.log' src --include='*.ts' | wc -l  # 0
# grep -R ': any' src/app --include='*.ts' | grep -v 'api-adapter' | wc -l  # baseline ~1166 — no new : any (§13)
```

If any check fails, fix before commit. Ask user before `git commit`.

---

*Generated from user instructions across this session — 2026-08-31 → tw-only, var-only, no hover/transparent/gradient/shadow, inner/outer visibility. Updated — §§11-14 deterministic (console.log, style=, baselines, deps). No generic prose.*
