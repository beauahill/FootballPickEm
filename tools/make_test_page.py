"""Build wyo-test/index.html: the current wyo/index.html pointed at a TEST Apps Script deployment.
Usage: python3 tools/make_test_page.py https://script.google.com/macros/s/XXXX/exec
The test page shows a TEST tag next to the league name and keeps its own browser storage (pickemtest.*),
so it can't mix sign-ins or cached data with the real page."""
import json, os, re, sys

LIVE_API = 'https://script.google.com/macros/s/AKfycbzwnssr1Kj5g7213JUOhgDwweKhtyhKm8LMkTeCvCeo6fcfwzLSZmzCGvhIfMhAWeFTgw/exec'
TPL = re.compile(r'(<script type="__bundler/template">\n)(.*?)(\n  </script>)', re.S)

def main(test_api):
    if not re.fullmatch(r'https://script\.google\.com/macros/s/[\w-]+/exec', test_api): sys.exit('Expected a https://script.google.com/macros/s/.../exec URL')
    if test_api == LIVE_API: sys.exit('That is the LIVE league URL. Use the test deployment URL.')
    html = open('wyo/index.html', encoding='utf-8').read()
    m = TPL.search(html); raw = m.group(2); t = json.loads(raw)
    enc = (lambda x: json.dumps(x, ensure_ascii=False).replace('</', '<\\u002F'))
    if enc(t) != raw: enc = (lambda x: json.dumps(x).replace('</', '<\\u002F'))
    assert enc(t) == raw and t.count(LIVE_API) == 1, 'live API URL not found exactly once'
    t = t.replace(LIVE_API, test_api)
    t = t.replace("'pickem.", "'pickemtest.").replace('pickem.wyo.v1', 'pickemtest.wyo.v1')
    tag = '{{ leagueName }} <span style="font-size:16px;vertical-align:middle;background:#b42318;color:#fff;padding:3px 8px;letter-spacing:.1em">TEST</span></h1>'
    assert t.count('{{ leagueName }}</h1>') == 1; t = t.replace('{{ leagueName }}</h1>', tag)
    os.makedirs('wyo-test', exist_ok=True)
    open('wyo-test/index.html', 'w', encoding='utf-8').write(html[:m.start(2)] + enc(t) + html[m.end(2):])
    print('wrote wyo-test/index.html →', test_api)

if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1].strip())
