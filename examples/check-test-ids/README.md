# check-test-id.js examples

Run against a single category:

```bash
node check-test-id.js --src examples/check-test-ids --json | jq
node check-test-id.js --src examples/check-test-ids --no-color
node check-test-id.js --src examples/check-test-ids --strict   # also fails on warnings
```

Expected results per file:

| file | expected |
|------|----------|
| `01_valid.html` | PASS |
| `02_missing-interactive.html` | FAIL — 4 errors |
| `03_missing-container.html` | WARN (FAIL with --strict) — 4 warnings |
| `04_duplicate-a/b.html` | FAIL — duplicate `shared:btn-save` + `shared:card-profile` |
| `05_convention-violation.html` | WARN — 3 convention violations |
| `06_ignores.html` | PASS — ignores respected |
| `07_file-ignore.html` | PASS — whole file ignored |
| `08_edge-cases.html` | PASS — single quotes, dynamic attr, href exempt, comments, `>` in attr |
