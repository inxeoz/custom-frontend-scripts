# custom-frontend-scripts

Lean scripts for better frontend development — enforce testability and visualize UI structure without heavy tooling.

| Script | Purpose |
|--------|---------|
| [`check-test-id.js`](#check-test-idjs--data-testid-linter) | Lint HTML for missing / duplicate / convention-violating `data-testid` |
| [`html-tree.py`](#html-treepy--visual-component-tree) | Render an HTML file as a colored component tree with parent/child similarity |

---

## Prerequisites

- **Node.js** >= 18 (for `check-test-id.js` — zero dependencies)
- **Python** >= 3.10 + `beautifulsoup4` (for `html-tree.py`)

```bash
pip install beautifulsoup4
```

---

## check-test-id.js — `data-testid` linter

Ensures every interactive element is selectable in tests and every `data-testid` follows a consistent convention. Fails CI on real errors, warns on style issues.

### What it checks

| Check | Severity | Details |
|-------|----------|---------|
| Missing `data-testid` on interactive elements | **Error** (exit 1) | `<button>`, `<input>`, `<select>`, `<textarea>`, `<form>`, plus any element with `role="button"` |
| Missing `data-testid` on containers | **Warning** (exit 1 only with `--strict`) | `<table>`, `<nav>`, `<section>`, `<dialog>`, `<article>`, `<aside>`, `<header>`, `<footer>`, `<main>` |
| Duplicate `data-testid` across files | **Error** | Same id in 2+ files |
| Convention violation | **Warning** (exit 1 only with `--strict`) | `<filename>:<scope>-<kebab>` where scope like `btn`/`link`/`th` must derive from visible text (e.g. `<button>Save</button>` → `btn-save`, not `btn-foo`) |

**Auto-exempt:** external links (`href="https://…"`, `mailto:`, `tel:`, `#`), dynamic `[attr.data-testid]`, `index.html`.

### Usage

```bash
# default src dir is ./src
node check-test-id.js --src src
node check-test-id.js --src src --strict        # also fail on warnings
node check-test-id.js --src src --json | jq     # CI-friendly JSON
node check-test-id.js --src src --no-color      # plain text (CI logs)
node check-test-id.js --src src --exclude "**/generated/**" --exclude "**/*.stories.html"

# help
node check-test-id.js --help
```

### Options

```
--src <dir>        Source directory (default: src)
--json             Output JSON instead of pretty text
--no-color         Disable ANSI colors (also auto-disabled when piped / NO_COLOR=1)
--strict           Fail on warnings & convention violations too
--exclude <glob>   Exclude paths, repeatable (glob: **, *, ?)
-h, --help         Show help
```

### Ignore directives

```html
<!-- check-test-ids-ignore -->              <!-- top of file: skip entire file -->
<!-- check-test-ids-ignore-next-line -->    <!-- next line only -->
<button data-testid-ignore>Skip me</button> <!-- this element only -->
```

### Naming convention

```
data-testid="<filename>:<scope>-<kebab-from-visible-text>"

examples:
  login.html  →  login:btn-sign-in    (from <button>Sign In</button>)
  users.html  →  users:th-user-name   (from <th>User Name</th>)
  card.html   →  card:card-profile    (container scopes like card/section/modal are exempt from text check)
```

Scopes derived from text: `btn`, `link`, `heading`, `th`, `label`, `option`, `tab`, `li`, `sort-column`.
Container scopes (exempt): `card`, `section`, `modal`, `dialog`, `table`, `form`, `nav`, `page`, `wrapper`, `container`, `body`, `header`, `footer`, `overlay`, `sidebar`, `strip`, `list`, `group`, `row`.

### Firefox addon — Copy UI Path Lite

Use with [Copy UI Path Lite](https://addons.mozilla.org/en-US/firefox/addon/copy-ui-path-lite/) to generate correct `data-testid` values without guessing:

1. Install the addon in Firefox: https://addons.mozilla.org/en-US/firefox/addon/copy-ui-path-lite/
2. Open your page, right-click any element → **Copy UI Path** → copies a `data-testid`-style selector.
3. Paste that value as `data-testid` on the element in source — it already follows the `filename:scope-kebab` shape.
4. Run `check-test-id.js` to verify: no duplicates, no naming drift from visible text, no missing interactive elements.

Workflow: **addon copies the path → you add the attribute → linter confirms it**.

### CI example

```yaml
# GitHub Actions
- run: node check-test-id.js --src src --json > report.json
- run: node check-test-id.js --src src --strict --no-color
```

---

## html-tree.py — visual component tree

Parses any HTML file and prints a tree with color and parent/child similarity scores. Useful for catching unstyled sections, auditing design-system drift, and reviewing page structure in code review.

```
app[#FFFFFF/P--/C-72]/
├── header[#F8FAFC/P-94/C--]
│   └── "Header"[#F8FAFC/P-100/C--]
├── main-content[#FFFFFF/P-94/C-88]/
│   ├── hero[#EFF6FF/P-96/C--]
│   │   └── "Welcome"[#EFF6FF/P-100/C--]
│   └── features[#FFFFFF/P-100/C-100]/
│       ├── card[#FFFFFF/P-100/C--]
│       └── card[#FFFFFF/P-100/C--]
└── footer[no-color/P--/C--]
```

- `[#RRGGBB/P-xx/C-yy]` — node's color / similarity to **P**arent / avg similarity to **C**hildren (0–100 via `math.dist` in RGB space).
- `[no-color]` — no explicit `data-color`/`style`/Tailwind bg found → flag for missing design tokens.
- Text leaves shown as `"…"` (truncated at 80 chars).

### Usage

```bash
python3 html-tree.py examples/html-tree/01_simple.html
python3 html-tree.py examples/html-tree/02_colors.html --color-mode style
python3 html-tree.py examples/html-tree/03_mixed-content.html --no-mixed-content
python3 html-tree.py examples/html-tree/04_complex-page.html --similarity-score
python3 html-tree.py examples/html-tree/04_complex-page.html --root "#hero"
python3 html-tree.py examples/html-tree/05_edge-cases.html --include-hidden
cat page.html | python3 html-tree.py --stdin
python3 html-tree.py --demo
python3 html-tree.py page.html -o /tmp/tree.txt

# slim wrapper (identical)
python3 html-tree.slim.py page.html
```

### Options

```
html                  HTML file path (or omit with --stdin)
-o, --output          Write tree to file instead of stdout
--stdin               Read HTML from stdin
--color-mode {auto,style}  auto: style + tw-bg-* map (default), style: inline style only
--include-hidden      Include script/style/meta/link/title/noscript tags
--root <selector>     Render subtree only (CSS selector, e.g. "#hero" or ".card")
--demo                Render built-in sample and exit
--mixed-content / --no-mixed-content  Include interleaved text nodes (default: on)
--no-text             Disable text nodes entirely
--similarity-score    Only print "Overall XX/100"
--no-similarity       Hide P-xx/C-yy, show clean tree
--verbose             Show tag.name hint (div.card)
```

### Color sources (priority)

1. `data-color="#RRGGBB"` attribute
2. Inline `style="background: #RRGGBB"` / `background-color` / `color` (hex or `rgb()`)
3. Tailwind `tw-bg-*` class map — only in `--color-mode auto` (default). Recognized: `tw-bg-white`, `tw-bg-slate-50/100/200`, `tw-bg-gray-50/100`, `tw-bg-emerald-50/100`, `tw-bg-sky-50`, `tw-bg-amber-50`, `tw-bg-rose-50`, `tw-bg-brand-50`, `tw-bg-transparent`.

Name resolution: `data-component` > `data-component-id` > `data-id` > `data-testid` > `id` > first `class` > tag name.

---

## For better frontend development

| Practice | How these scripts help |
|----------|------------------------|
| **Testability first** | `check-test-id.js` guarantees every button/input is reachable via `getByTestId` — no more `querySelector` hacks in e2e tests. |
| **Naming consistency** | Convention check ties `data-testid` to visible text, so renames are caught and ids stay searchable. |
| **Copy-paste correctness** | **Copy UI Path Lite** addon + linter = generate the id in the browser, verify it in CI. No manual kebab-casing. |
| **Design drift detection** | `html-tree.py` similarity scores surface color mismatches (`P-40` = child clashes with parent). Overall score < 70 → audit needed. |
| **Structure review** | Tree view makes nesting/sprawl obvious in PRs; `--root` scopes review to the changed component. |
| **CI gate** | Both scripts exit non-zero on failure — drop them into pre-commit or CI with `--strict` / `--similarity-score`. |

Suggested pre-commit:

```bash
node check-test-id.js --src src --strict --no-color
python3 html-tree.py src/index.html --similarity-score  # track over time
```

---

## Examples

Each script has isolated fixtures under `examples/`:

- `examples/check-test-ids/` — 9 HTML files covering valid, missing ids, duplicates, convention violations, ignores, edge cases. See [`examples/check-test-ids/README.md`](examples/check-test-ids/README.md).
- `examples/html-tree/` — 5 HTML files covering naming, colors, mixed content, complex page, edge cases. See [`examples/html-tree/README.md`](examples/html-tree/README.md).
- [`examples/README.md`](examples/README.md) — combined runbook.
- `examples/run-all.sh` — runs the full suite:

```bash
bash examples/run-all.sh
```

---

## License

MIT — do what you want, no warranty.
