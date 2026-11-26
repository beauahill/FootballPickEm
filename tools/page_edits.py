"""Apply the same text edits to the page source (WYO Pick Em.dc.html) and to the template embedded in the
built bundle (wyo/index.html), so both stay in step without re-exporting from the design tool.
Usage: python3 tools/page_edits.py            (applies EDITS; each must match exactly once in each file)"""
import json, re, sys, time

SRC, BUNDLE = 'WYO Pick Em.dc.html', 'wyo/index.html'
TPL = re.compile(r'(<script type="__bundler/template">\n)(.*?)(\n  </script>)', re.S)

def load_template(html):
    m = TPL.search(html); raw = m.group(2); t = json.loads(raw)
    for enc in (lambda x: json.dumps(x, ensure_ascii=False).replace('</', '<\\u002F'), lambda x: json.dumps(x).replace('</', '<\\u002F')):
        if enc(t) == raw: return m, t, enc
    sys.exit('bundle template encoding not recognised')

# The bundle stores camelCase markup attributes as sc-camel-kebab (onClick -> sc-camel-on-click).
CAMEL = re.compile(r' (onClick|onChange|onSubmit|onBlur|autoComplete|defaultValue|inputMode)="')
# It also renames <select> and table tags to <sc-raw-*> so the browser's HTML parser keeps template tags inside them
# (a plain <select> in the bundle loses its <sc-for> options in Safari).
RAW = re.compile(r'<(/?)(select|table|thead|tbody|tr|td|th)(?=[\s>])')
def bundled(s):
    s = CAMEL.sub(lambda m: ' sc-camel-' + re.sub(r'[A-Z]', lambda c: '-' + c.group().lower(), m.group(1)) + '="', s)
    return RAW.sub(lambda m: '<' + m.group(1) + 'sc-raw-' + m.group(2), s)

def apply(text, edits, label, xform=lambda s: s):
    for old, new in edits:
        old, new = xform(old), xform(new)
        n = text.count(old)
        if n != 1: sys.exit(f'{label}: expected 1 match, found {n}: {old[:90]!r}')
        text = text.replace(old, new)
    return text

def run(edits, replace_all=()):
    src = open(SRC, encoding='utf-8').read()
    src = apply(src, edits, SRC)
    for a, b in replace_all: src = src.replace(a, b)
    html = open(BUNDLE, encoding='utf-8').read()
    m, t, enc = load_template(html)
    t = apply(t, edits, BUNDLE, bundled)
    for a, b in replace_all: t = t.replace(a, b)
    html = html[:m.start(2)] + enc(t) + html[m.end(2):]
    for a, b in replace_all: html = html.replace(a, b)
    open(SRC, 'w', encoding='utf-8').write(src)
    open(BUNDLE, 'w', encoding='utf-8').write(html)
    print('applied', len(edits), 'edits to both files')

if __name__ == '__main__':
    import importlib.util
    spec = importlib.util.spec_from_file_location('e', sys.argv[1]); e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)
    run(e.EDITS, getattr(e, 'REPLACE_ALL', ()))
