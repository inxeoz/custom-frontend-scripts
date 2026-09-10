#!/usr/bin/env python3
"""html_tree.py — generate component tree with color annotations from an HTML file.

Usage:
  python scripts/html_tree.py index.html
  python scripts/html_tree.py index.html -o tree.txt
  python scripts/html_tree.py index.html --root body
  cat index.html | python scripts/html_tree.py --stdin
  python scripts/html_tree.py page.html --with-text
  python scripts/html_tree.py page.html --mixed-content      # default: on
  python scripts/html_tree.py page.html --no-mixed-content    # disable text

Format:
  root[#0F172A]/
  └── html-container[#1E293B]/
      ├── head-metadata[#334155]/
      ...

  With --with-text / --mixed-content (default) text appears as leaf:
  p[#9CA3AF]/
  └── "Hello world"[#9CA3AF]

  Mixed content keeps text interleaved with elements:
  div[#1E293B]/
  ├── "Hi "[#1E293B]
  ├── span[#334155]/
  │   └── "there"[#334155]
  └── "!"[#1E293B]

Name resolution (first match wins):
  1. data-component / data-component-id / data-id
  2. id attribute
  3. first class token
  4. tag name

Color resolution (auto):
  1. data-color attribute
  2. inline style background-color / background / color (hex or rgb)
  3. tw-bg-* Tailwind class (mapped via TW_BG_MAP)
  4. deterministic hash color derived from name (so every node has a color)

Text nodes inherit parent color.
Override with --color-mode {auto,style,hash}
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

try:
    from bs4 import BeautifulSoup, Tag, NavigableString, Comment
except ImportError:
    print("Missing dependency: beautifulsoup4. Install with: pip install beautifulsoup4 lxml", file=sys.stderr)
    sys.exit(1)

HEX_RE = re.compile(r"#([0-9a-fA-F]{3,8})\b")
RGB_RE = re.compile(r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})")
TW_BG_MAP = {
    "tw-bg-white": "#FFFFFF",
    "tw-bg-slate-50": "#F8FAFC",
    "tw-bg-slate-100": "#F1F5F9",
    "tw-bg-slate-200": "#E2E8F0",
    "tw-bg-gray-50": "#F9FAFB",
    "tw-bg-gray-100": "#F3F4F6",
    "tw-bg-emerald-50": "#ECFDF5",
    "tw-bg-emerald-100": "#D1FAE5",
    "tw-bg-sky-50": "#F0F9FF",
    "tw-bg-amber-50": "#FFFBEB",
    "tw-bg-rose-50": "#FFF1F2",
    "tw-bg-brand-50": "#EFF6FF",
    "tw-bg-transparent": "#FFFFFF",
}
STYLE_COLOR_RE = re.compile(r"(?:background-color|background|color)\s*:\s*([^;]+)", re.I)

def rgb_to_hex(r, g, b):
    return f"#{int(r):02X}{int(g):02X}{int(b):02X}"

def extract_color_from_style(style: str):
    if not style:
        return None
    for m in STYLE_COLOR_RE.finditer(style):
        val = m.group(1).strip()
        hex_m = HEX_RE.search(val)
        if hex_m:
            h = hex_m.group(0).upper()
            if len(h) == 4:
                h = "#" + "".join(c*2 for c in h[1:])
            return h[:7].upper()
        rgb_m = RGB_RE.search(val)
        if rgb_m:
            return rgb_to_hex(*rgb_m.groups())
    hex_m = HEX_RE.search(style)
    if hex_m:
        h = hex_m.group(0).upper()
        if len(h) == 4:
            h = "#" + "".join(c*2 for c in h[1:])
        return h[:7].upper()
    rgb_m = RGB_RE.search(style)
    if rgb_m:
        return rgb_to_hex(*rgb_m.groups())
    return None

def hash_color(name: str) -> str:
    h = int(hashlib.md5(name.encode()).hexdigest()[:8], 16) % 360
    s = 60
    l = 28 + (int(hashlib.md5((name+"s").encode()).hexdigest()[:2], 16) % 12)
    return hsl_to_hex(h, s, l)

def hsl_to_hex(h, s, l):
    s /= 100
    l /= 100
    c = (1 - abs(2*l - 1)) * s
    x = c * (1 - abs((h/60) % 2 - 1))
    m = l - c/2
    if h < 60:
        r, g, b = c, x, 0
    elif h < 120:
        r, g, b = x, c, 0
    elif h < 180:
        r, g, b = 0, c, x
    elif h < 240:
        r, g, b = 0, x, c
    elif h < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    r, g, b = (r+m)*255, (g+m)*255, (b+m)*255
    return rgb_to_hex(r, g, b)

def hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c*2 for c in h)
    return int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)

def similarity_score(hex1, hex2):
    try:
        r1,g1,b1 = hex_to_rgb(hex1)
        r2,g2,b2 = hex_to_rgb(hex2)
        d = ((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2) ** 0.5
        max_d = (3*255*255) ** 0.5
        sim = 100 * (1 - d / max_d)
        return int(round(max(0, min(100, sim))))
    except Exception:
        return 0

def node_name(el):
    for attr in ("data-component", "data-component-id", "data-id", "data-testid"):
        if el.has_attr(attr) and el[attr]:
            return str(el[attr]).strip().split()[0]
    if el.has_attr("id") and el["id"]:
        v = el["id"]
        if isinstance(v, list): v = v[0]
        return str(v).strip()
    if el.has_attr("class") and el["class"]:
        cls = el["class"]
        if isinstance(cls, list) and cls:
            return str(cls[0]).strip()
        return str(cls).strip().split()[0]
    return el.name.lower()

def node_color(el, name, mode="auto"):
    if mode in ("auto","style"):
        if el.has_attr("data-color"):
            v = str(el["data-color"]).strip()
            if HEX_RE.search(v): return HEX_RE.search(v).group(0).upper()[:7]
            if RGB_RE.search(v):
                m=RGB_RE.search(v); return rgb_to_hex(*m.groups())
            if v.startswith("#"): return v[:7].upper()
        if el.has_attr("style"):
            c = extract_color_from_style(el["style"])
            if c: return c
        # tw-bg tailwind fallback
        if el.has_attr("class") and mode == "auto":
            for cls in el["class"]:
                if cls in TW_BG_MAP:
                    return TW_BG_MAP[cls]
        for a in ("data-bg","data-background","data-theme-color"):
            if el.has_attr(a):
                c = extract_color_from_style(str(el[a]))
                if c: return c
                if HEX_RE.search(str(el[a])): return HEX_RE.search(str(el[a])).group(0).upper()[:7]
        if mode == "style":
            return "#64748B"
    return hash_color(name + "|" + el.name)

SKIP_TAGS = {"script","style","meta","link","title","noscript"}

def children_of(el, skip_hidden=True):
    for c in el.children:
        if isinstance(c, Tag):
            if skip_hidden and c.name.lower() in SKIP_TAGS:
                continue
            yield c

def mixed_children(el, include_text=True, skip_hidden=True):
    for c in el.children:
        if isinstance(c, Tag):
            if skip_hidden and c.name.lower() in SKIP_TAGS:
                continue
            yield ("tag", c)
        elif include_text and isinstance(c, NavigableString) and not isinstance(c, Comment):
            txt = str(c)
            # collapse whitespace, trim
            txt = re.sub(r"\s+", " ", txt).strip()
            if not txt:
                continue
            # truncate long text for tree readability
            if len(txt) > 80:
                txt = txt[:77] + "..."
            # escape internal double quotes
            txt = txt.replace('"', "'")
            yield ("text", txt)

def build_lines(root, color_mode="auto", skip_hidden=True, include_text=True, show_similarity=False, parent_color=None, prefix="", is_last=True, is_root=True):
    name = node_name(root)
    color = node_color(root, name, color_mode)
    # mixed children for has_children check
    if include_text:
        has_children = any(True for _ in mixed_children(root, True, skip_hidden))
    else:
        has_children = any(True for _ in children_of(root, skip_hidden))
    suffix = "/" if has_children else ""
    # compute C = avg similarity to immediate element children
    c_score = None
    if show_similarity:
        child_colors = []
        # collect immediate element children colors
        if include_text:
            kids_for_c = [c for kind,c in mixed_children(root, True, skip_hidden) if kind=="tag"]
        else:
            kids_for_c = list(children_of(root, skip_hidden))
        for ch in kids_for_c:
            ch_name = node_name(ch)
            ch_color = node_color(ch, ch_name, color_mode)
            child_colors.append(similarity_score(color, ch_color))
        if child_colors:
            c_score = int(round(sum(child_colors)/len(child_colors)))
        else:
            c_score = 0
    if show_similarity:
        if is_root:
            # root has no parent, show P-0
            line = f"{name}[{color}/P-0/C-{c_score}]{suffix}"
        else:
            p_score = similarity_score(parent_color, color) if parent_color else 0
            line = f"{name}[{color}/P-{p_score}/C-{c_score}]{suffix}"
    else:
        line = f"{name}[{color}]{suffix}"
    if is_root:
        lines = [line]
    else:
        branch = "└── " if is_last else "├── "
        lines = [f"{prefix}{branch}{line}"]
        prefix = prefix + ("    " if is_last else "│   ")
    # iterate children
    if include_text:
        kids = list(mixed_children(root, True, skip_hidden))
    else:
        kids = [("tag", c) for c in children_of(root, skip_hidden)]
    for i, (kind, kid) in enumerate(kids):
        last = i == len(kids)-1
        if kind == "tag":
            lines.extend(build_lines(kid, color_mode, skip_hidden, include_text, show_similarity, color, prefix, last, False))
        else:
            # text leaf
            branch = "└── " if last else "├── "
            if show_similarity:
                # text inherits parent color -> P=100, C=0 (leaf)
                tline = f'"{kid}"[{color}/P-100/C-0]'
            else:
                tline = f'"{kid}"[{color}]'
            lines.append(f"{prefix}{branch}{tline}")
    return lines

def parse_html(source: str):
    soup = BeautifulSoup(source, "html.parser")
    if soup.find("html"):
        return [soup.find("html")]
    if soup.find("body"):
        return [soup.find("body")]
    tops = [c for c in soup.children if isinstance(c, Tag)]
    if tops:
        return tops
    return []

def render(source: str, color_mode="auto", skip_hidden=True, include_text=True, show_similarity=False, root_selector=None):
    soup = BeautifulSoup(source, "html.parser")
    if root_selector:
        sel = soup.select(root_selector)
        if sel:
            roots = sel
        else:
            el = soup.find(id=root_selector) or soup.find(class_=root_selector)
            roots = [el] if el else parse_html(source)
    else:
        roots = parse_html(source)
    all_lines=[]
    for idx, r in enumerate(roots):
        lines = build_lines(r, color_mode, skip_hidden, include_text, show_similarity)
        all_lines.extend(lines)
        if idx != len(roots)-1:
            all_lines.append("")
    return "\n".join(all_lines)

def main():
    ap = argparse.ArgumentParser(description="Generate component tree with colors from HTML")
    ap.add_argument("html", nargs="?", help="HTML file path (or omit with --stdin)")
    ap.add_argument("-o","--output", help="Write tree to file instead of stdout")
    ap.add_argument("--stdin", action="store_true", help="Read HTML from stdin")
    ap.add_argument("--color-mode", choices=["auto","style","hash"], default="auto", help="auto: style then hash, style: only inline style, hash: only hash")
    ap.add_argument("--include-hidden", action="store_true", help="Include script/style/meta tags")
    ap.add_argument("--root", dest="root_selector", help="CSS selector for subtree root (e.g. #app or .main)")
    ap.add_argument("--demo", action="store_true", help="Run demo on built-in sample and exit")
    # text / mixed-content options
    ap.add_argument("--with-text", action="store_true", help="Include text nodes as leaves (alias for --mixed-content)")
    ap.add_argument("--mixed-content", dest="mixed_content", action=argparse.BooleanOptionalAction, default=True, help="Include text interleaved with elements in document order (default: enabled, use --no-mixed-content to disable)")
    ap.add_argument("--no-text", action="store_true", help="Disable text nodes (same as --no-mixed-content)")
    ap.add_argument("--similarity-score", action="store_true", help="Show overall page similarity score 0-100 (average of parent-child similarities); per-node [#HEX/score] is now default")
    args = ap.parse_args()
    include_text = (args.mixed_content or args.with_text) and not args.no_text
    # --with-text explicitly enables even if --no-mixed-content was passed? --with-text wins
    if args.with_text:
        include_text = True
        if args.no_text:
            include_text = True  # --with-text overrides --no-text
    if args.demo:
        demo_html = """
<div id="root" style="background:#0F172A">
  <div class="html-container" style="background:#1E293B">
    <div class="head-metadata" style="background:#334155"><div class="theme-provider" style="background:#475569">dark</div></div>
    <div class="body-wrapper" style="background:#090D16"><div class="app-layout" style="background:#020617">hello <span style="background:#1E293B">world</span>!</div></div>
  </div>
</div>
"""
        demo_out = render(demo_html, color_mode=args.color_mode, skip_hidden=not args.include_hidden, include_text=include_text, show_similarity=True, root_selector=args.root_selector)
        if args.similarity_score:
            import re as _re
            # parse P and C from [#HEX/P-xx/C-yy]
            scores_P = []
            scores_C = []
            for _line in demo_out.splitlines():
                if '"' in _line: continue  # text leaf excluded from overall (or included as 0)
                _m = _re.search(r"\[#(?:[0-9A-Fa-f]{6})/P-(\d+)/C-(\d+)\]", _line)
                if _m:
                    scores_P.append(int(_m.group(1)))
                    scores_C.append(int(_m.group(2)))
            # two-score per component: score = P+C, sum over components, final = sum / count /2
            if scores_P:
                total = sum(p+c for p,c in zip(scores_P, scores_C))
                count = len(scores_P)
                overall = int(round(total / count / 2))
            else:
                overall = 0
            print(f"Overall similarity: {overall}/100")
            return
        print(demo_out)
        return
    source=None
    if args.stdin or (not args.html and not sys.stdin.isatty()):
        if not sys.stdin.isatty():
            source = sys.stdin.read()
    if source is None:
        if not args.html:
            ap.print_help()
            sys.exit(1)
        p = Path(args.html)
        if not p.exists():
            print(f"File not found: {p}", file=sys.stderr); sys.exit(1)
        source = p.read_text(encoding="utf-8", errors="ignore")
    if not source or not source.strip():
        if args.html:
            source = Path(args.html).read_text(encoding="utf-8", errors="ignore")
    out = render(source, color_mode=args.color_mode, skip_hidden=not args.include_hidden, include_text=include_text, show_similarity=True, root_selector=args.root_selector)
    # overall score: (sum(P+C)/count)/2  per user formula, text excluded
    if args.similarity_score:
        import re as _re
        scores_P = []
        scores_C = []
        for _line in out.splitlines():
            if '"' in _line: continue
            _m = _re.search(r"\[#(?:[0-9A-Fa-f]{6})/P-(\d+)/C-(\d+)\]", _line)
            if _m:
                scores_P.append(int(_m.group(1)))
                scores_C.append(int(_m.group(2)))
        if scores_P:
            total = sum(p+c for p,c in zip(scores_P, scores_C))
            count = len(scores_P)
            overall = int(round(total / count / 2))
        else:
            overall = 0
        result = f"Overall similarity: {overall}/100"
        if args.output:
            Path(args.output).write_text(result + "\n", encoding="utf-8")
            print(f"Wrote tree to {args.output}")
            print(result)
        else:
            print(result)
        return
    if args.output:
        Path(args.output).write_text(out + "\n", encoding="utf-8")
        print(f"Wrote tree to {args.output}")
    else:
        print(out)

if __name__ == "__main__":
    main()
