# html-tree.py examples

```bash
# basic tree (mixed-content + similarity scores on by default)
python3 html-tree.py examples/html-tree/01_simple.html
python3 html-tree.py examples/html-tree/02_colors.html
python3 html-tree.py examples/html-tree/03_mixed-content.html

# toggles
python3 html-tree.py examples/html-tree/03_mixed-content.html --no-mixed-content
python3 html-tree.py examples/html-tree/02_colors.html --color-mode style
python3 html-tree.py examples/html-tree/05_edge-cases.html --include-hidden

# similarity
python3 html-tree.py examples/html-tree/04_complex-page.html --similarity-score
python3 html-tree.py examples/html-tree/04_complex-page.html --root "#hero"

# stdin / output
cat examples/html-tree/01_simple.html | python3 html-tree.py --stdin
python3 html-tree.py examples/html-tree/04_complex-page.html -o /tmp/tree.txt

# demo built-in
python3 html-tree.py --demo
python3 html-tree.py --demo --similarity-score
```
