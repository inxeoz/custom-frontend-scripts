#!/usr/bin/env python3
# html-tree — ponytail-lean: explicit colors only, P/C via math.dist; compat flags kept but lean impl
import argparse, math, re, sys
from pathlib import Path
from bs4 import BeautifulSoup, Tag, NavigableString, Comment

HEX=re.compile(r"#([0-9a-fA-F]{3,8})\b")
RGB=re.compile(r"rgba?\(\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})")
TW={"tw-bg-white":"#FFFFFF","tw-bg-slate-50":"#F8FAFC","tw-bg-slate-100":"#F1F5F9","tw-bg-slate-200":"#E2E8F0","tw-bg-gray-50":"#F9FAFB","tw-bg-gray-100":"#F3F4F6","tw-bg-emerald-50":"#ECFDF5","tw-bg-emerald-100":"#D1FAE5","tw-bg-sky-50":"#F0F9FF","tw-bg-amber-50":"#FFFBEB","tw-bg-rose-50":"#FFF1F2","tw-bg-brand-50":"#EFF6FF","tw-bg-transparent":"#FFFFFF"}
SC=re.compile(r"(?:background-color|background|color)\s*:\s*([^;]+)",re.I)
SKIP={"script","style","meta","link","title","noscript"}

def col_of(s):
    if not s: return None
    for m in SC.finditer(s):
        v=m.group(1).strip()
        h=HEX.search(v); r=RGB.search(v)
        if h:
            hv=h.group(0).upper()
            return hv[:7] if len(hv)!=4 else "#"+ "".join(c*2 for c in hv[1:]).upper()[:7]
        if r: return f"#{int(r.group(1)):02X}{int(r.group(2)):02X}{int(r.group(3)):02X}"
    h=HEX.search(s)
    if h:
        hv=h.group(0).upper()
        return hv[:7] if len(hv)!=4 else "#"+ "".join(c*2 for c in hv[1:]).upper()[:7]
    r=RGB.search(s)
    if r: return f"#{int(r.group(1)):02X}{int(r.group(2)):02X}{int(r.group(3)):02X}"
    return None

def name_of(e):
    for a in ("data-component","data-component-id","data-id","data-testid"):
        if e.has_attr(a) and e[a]: return str(e[a]).strip().split()[0]
    if e.has_attr("id") and e["id"]: return str(e["id"] if isinstance(e["id"],str) else e["id"][0]).strip()
    if e.has_attr("class") and e["class"]: return str(e["class"][0]).strip()
    return e.name.lower()

def tag_hint(e):
    n=name_of(e)
    return f"{e.name}.{n}" if n!=e.name.lower() else n

def color_of(e, mode="auto"):
    if e.has_attr("data-color"):
        c=col_of(str(e["data-color"]))
        if c: return c
    if e.has_attr("style"):
        c=col_of(e["style"])
        if c: return c
    if mode=="auto" and e.has_attr("class"):
        for cl in e["class"]:
            if cl in TW: return TW[cl]
    return None

def sim(a,b):
    if not a or not b: return None
    try:
        h=lambda x: (int(x[1:3],16),int(x[3:5],16),int(x[5:7],16))
        r1,g1,b1=h(a); r2,g2,b2=h(b)
        d=math.dist((r1,g1,b1),(r2,g2,b2)); m=math.dist((0,0,0),(255,255,255))
        return int(round(100*(1-d/m)))
    except: return None

def kids(e, include_text=True, skip_hidden=True):
    for c in e.children:
        if isinstance(c,Tag):
            if skip_hidden and c.name.lower() in SKIP: continue
            yield ("tag",c)
        elif include_text and isinstance(c,NavigableString) and not isinstance(c,Comment):
            t=re.sub(r"\s+"," ",str(c)).strip()
            if not t: continue
            if len(t)>80: t=t[:77]+"..."
            yield ("text",t.replace('"',"'"))

def build_lines(root, parent_col=None, prefix="", last=True, is_root=True, show_sim=True, verbose=False, color_mode="auto", include_text=True, skip_hidden=True):
    n=tag_hint(root) if verbose else name_of(root)
    col=color_of(root, color_mode)
    childs=list(kids(root, include_text, skip_hidden))
    has_c=len(childs)>0
    suf="/" if has_c else ""
    cs=[]
    for k,c in childs:
        if k=="tag":
            s=sim(col, color_of(c, color_mode))
            if s is not None: cs.append(s)
    c_sc=round(sum(cs)/len(cs)) if cs else None
    cp=col or "no-color"
    if show_sim:
        if is_root:
            cs_s=f"C-{c_sc}" if c_sc is not None else "C--"
            ln=f"{n}[{cp}/P--/{cs_s}]{suf}"
        else:
            p=sim(parent_col,col); ps=f"P-{p}" if p is not None else "P--"; cs2=f"C-{c_sc}" if c_sc is not None else "C--"
            ln=f"{n}[{cp}/{ps}/{cs2}]{suf}"
    else:
        ln=f"{n}[{cp}]{suf}" if col else f"{n}[no-color]{suf}" if verbose else f"{n}{suf}" if not col else f"{n}[{cp}]{suf}"
    out=[ln] if is_root else [f"{prefix}{'└── ' if last else '├── '}{ln}"]
    npre=prefix+("    " if last else "│   ") if not is_root else ""
    for i,(k,v) in enumerate(childs):
        is_last=i==len(childs)-1
        if k=="tag":
            out+=build_lines(v, col, npre, is_last, False, show_sim, verbose, color_mode, include_text, skip_hidden)
        else:
            if show_sim:
                ps="P-100" if col else "P--"
                out.append(f"{npre}{'└── ' if is_last else '├── '}\"{v}\"[{cp}/{ps}/C--]")
            else:
                out.append(f"{npre}{'└── ' if is_last else '├── '}\"{v}\"[{cp}]" if col else f"{npre}{'└── ' if is_last else '├── '}\"{v}\"")
    return out

def render(src, root_sel=None, show_sim=True, verbose=False, color_mode="auto", include_text=True, skip_hidden=True):
    s=BeautifulSoup(src,"html.parser")
    roots=s.select(root_sel) if root_sel else []
    if not roots:
        if root_sel:
            r=s.find(id=root_sel.lstrip("#.")) or s.find(class_=root_sel.lstrip("."))
            if r: roots=[r]
            else: roots=[s.find("html") or s.find("body")] if s.find("html") or s.find("body") else [c for c in s.children if isinstance(c,Tag)]
        else:
            roots=[s.find("html") or s.find("body")] if s.find("html") or s.find("body") else [c for c in s.children if isinstance(c,Tag)]
    a=[]
    for i,r in enumerate(roots):
        if r: a+=build_lines(r, show_sim=show_sim, verbose=verbose, color_mode=color_mode, include_text=include_text, skip_hidden=skip_hidden)
        if i!=len(roots)-1: a.append("")
    return "\n".join(a)

def summary(out):
    total=len([l for l in out.splitlines() if "[" in l and '"' not in l])
    col=len([l for l in out.splitlines() if re.search(r"\[#",l) and '"' not in l])
    noc=total-col
    ps=[]; cs=[]
    for l in out.splitlines():
        if '"' in l: continue
        m=re.search(r"\[#(?:[0-9A-Fa-f]{6})/P-(\d+)/C-(\d+)\]",l)
        if m: ps.append(int(m.group(1))); cs.append(int(m.group(2)))
    overall=round(sum(p+c for p,c in zip(ps,cs))/len(ps)/2) if ps else 0
    warn=" ⚠ >50% no-color — add data-color/style" if total and noc/total>0.5 else ""
    return f"# nodes:{total} colored:{col} no-color:{noc} overall:{overall}/100{warn}"

def main():
    ap=argparse.ArgumentParser(description="Generate component tree with colors from HTML")
    ap.add_argument("html", nargs="?", help="HTML file path (or omit with --stdin)")
    ap.add_argument("-o","--output", help="Write tree to file instead of stdout")
    ap.add_argument("--stdin", action="store_true", help="Read HTML from stdin")
    ap.add_argument("--color-mode", choices=["auto","style"], default="auto", help="auto: style+tw-bg, style: only inline style")
    ap.add_argument("--include-hidden", action="store_true", help="Include script/style/meta tags")
    ap.add_argument("--root", dest="root_selector", help="CSS selector for subtree root")
    ap.add_argument("--demo", action="store_true", help="Run demo on built-in sample and exit")
    ap.add_argument("--with-text", action="store_true", help="Include text nodes (default on)")
    ap.add_argument("--mixed-content", dest="mixed_content", action=argparse.BooleanOptionalAction, default=True, help="Include text interleaved (default: enabled)")
    ap.add_argument("--no-text", action="store_true", help="Disable text nodes")
    ap.add_argument("--similarity-score", action="store_true", help="Only print Overall XX/100")
    ap.add_argument("--no-similarity", action="store_true", help="Hide P-xx/C-yy, show clean tree")
    ap.add_argument("--verbose", action="store_true", help="Show tag.name hint (div.card)")
    args=ap.parse_args()
    include_text=(args.mixed_content or args.with_text) and not args.no_text
    if args.with_text: include_text=True
    skip_hidden=not args.include_hidden
    show_sim=not args.no_similarity
    if args.demo:
        demo_html='<div id="root" style="background:#0F172A"><div class="html-container" style="background:#1E293B"><div class="head-metadata" style="background:#334155"><div class="theme-provider" style="background:#475569">dark</div></div><div class="body-wrapper" style="background:#090D16"><div class="app-layout" style="background:#020617">hello <span style="background:#1E293B">world</span>!</div></div></div></div>'
        out=render(demo_html, show_sim=True, verbose=args.verbose, color_mode=args.color_mode, include_text=include_text, skip_hidden=skip_hidden, root_sel=args.root_selector)
        if args.similarity_score:
            m=re.search(r"overall:(\d+/100)",summary(out)); print(f"Overall similarity: {m.group(1) if m else '0/100'}"); return
        print(out); return
    source=None
    if args.stdin or (not args.html and not sys.stdin.isatty()):
        try: source=sys.stdin.read()
        except: pass
    if not source:
        if not args.html: ap.print_help(); sys.exit(1)
        p=Path(args.html)
        if not p.exists(): print(f"File not found: {p}", file=sys.stderr); sys.exit(1)
        source=p.read_text(encoding="utf-8", errors="ignore")
    if not source or not source.strip():
        if args.html: source=Path(args.html).read_text(encoding="utf-8", errors="ignore")
    out=render(source, root_sel=args.root_selector, show_sim=show_sim, verbose=args.verbose, color_mode=args.color_mode, include_text=include_text, skip_hidden=skip_hidden)
    if args.similarity_score:
        hdr=summary(out); m=re.search(r"overall:(\d+/100)",hdr); result=f"Overall similarity: {m.group(1) if m else '0/100'}"
        if args.output: Path(args.output).write_text(result+"\n", encoding="utf-8"); print(f"Wrote tree to {args.output}"); print(result)
        else: print(result)
        return
    if args.output: Path(args.output).write_text(out+"\n", encoding="utf-8"); print(f"Wrote tree to {args.output}")
    else: print(out)

if __name__=="__main__": main()
