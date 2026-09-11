# Examples — check-test-id.js + html-tree.py

Two scripts, two folders. Run each example standalone.

## check-test-id.js (`examples/check-test-ids/`)

| file | purpose | expected |
|------|---------|----------|
| `01_valid.html` | All interactive + containers have correct `data-testid` | ✅ PASS |
| `02_missing-interactive.html` | 4 interactive without id | ❌ 4 errors |
| `03_missing-container.html` | 4 containers without id | ⚠️ 4 warnings (fail only with `--strict`) |
| `04_duplicate-a.html` + `04_duplicate-b.html` | Same ids in 2 files | ❌ duplicate `shared:btn-save` + `shared:card-profile` |
| `05_convention-violation.html` | `btn-*` / `th-*` desc doesn't match visible text | ⚠️ 3 convention violations |
| `06_ignores.html` | `ignore-next-line` + `data-testid-ignore` | ✅ PASS |
| `07_file-ignore.html` | `<!-- check-test-ids-ignore -->` whole file | ✅ PASS |
| `08_edge-cases.html` | single quotes, dynamic `[attr.data-testid]`, href exempt, comments, `>` in attr | ✅ PASS |

```bash
# whole suite (9 files — expect fail due to 02/04)
node check-test-id.js --src examples/check-test-ids --no-color
node check-test-id.js --src examples/check-test-ids --strict --no-color   # also fails on 03 + 05
node check-test-id.js --src examples/check-test-ids --json | jq

# single-file isolation (copy to temp dir)
tmp=$(mktemp -d); cp examples/check-test-ids/01_valid.html $tmp/; node check-test-id.js --src $tmp --no-color; echo $?
tmp=$(mktemp -d); cp examples/check-test-ids/02_missing-interactive.html $tmp/; node check-test-id.js --src $tmp --no-color; echo $?

# excludes
node check-test-id.js --src examples/check-test-ids --exclude "**/04_duplicate-*" --no-color
```

## html-tree.py (`examples/html-tree/`)

| file | tests |
|------|-------|
| `01_simple.html` | `id` > `class` > `tag` naming, parent/child `P-xx/C-yy` scores, text leaves |
| `02_colors.html` | `data-color`, `style` hex/rgb, `tw-bg-*` map, `[no-color]` if missing |
| `03_mixed-content.html` | interleaved text + elements (`--no-mixed-content` to hide) |
| `04_complex-page.html` | realistic page (nav/main/section/card), duplicate colors, `--root`, `--similarity-score` |
| `05_edge-cases.html` | `data-component` priority, hidden `script/style` (`--include-hidden`), 80-char truncation |

```bash
python3 html-tree.py examples/html-tree/01_simple.html
python3 html-tree.py examples/html-tree/02_colors.html
python3 html-tree.py examples/html-tree/02_colors.html --color-mode style
python3 html-tree.py examples/html-tree/03_mixed-content.html --no-mixed-content
python3 html-tree.py examples/html-tree/04_complex-page.html --similarity-score
python3 html-tree.py examples/html-tree/04_complex-page.html --root "#hero"
python3 html-tree.py examples/html-tree/05_edge-cases.html --include-hidden
cat examples/html-tree/01_simple.html | python3 html-tree.py --stdin
python3 html-tree.py --demo
python3 html-tree.py --demo --similarity-score
python3 html-tree.py examples/html-tree/04_complex-page.html -o /tmp/tree.txt
```
