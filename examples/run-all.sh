#!/usr/bin/env bash
set -e
echo "=== check-test-id.js ==="
echo "--- whole dir (expected FAIL) ---"
node check-test-id.js --src examples/check-test-ids --no-color || true
echo ""
echo "--- 01_valid in isolation (expected PASS) ---"
tmp=$(mktemp -d); cp examples/check-test-ids/01_valid.html $tmp/; node check-test-id.js --src $tmp --no-color
echo ""
echo "--- 06_ignores + 07_file-ignore + 08_edge-cases (expected PASS) ---"
tmp=$(mktemp -d); cp examples/check-test-ids/06_ignores.html examples/check-test-ids/07_file-ignore.html examples/check-test-ids/08_edge-cases.html $tmp/; node check-test-id.js --src $tmp --no-color
echo ""
echo "=== html-tree.py ==="
for f in examples/html-tree/*.html; do
  echo "--- $f ---"
  python3 html-tree.py "$f"
  echo ""
done
echo "--- similarity ---"
python3 html-tree.py examples/html-tree/04_complex-page.html --similarity-score
