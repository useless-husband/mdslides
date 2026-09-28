import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, highlight, highlightLines, parseLineSpec, normalizeLang } from '../src/highlight.js';

const find = (toks, type) => toks.filter(([t]) => t === type).map(([, s]) => s);
const joined = (toks) => toks.map(([, s]) => s).join('');

test('tokens always join back to the original code', () => {
  const samples = {
    js: 'const a = `x${1}`; // c\n/* b */ if (/re[/]/g.test(s)) {}',
    python: 'def f(x):\n    """doc"""\n    return f"{x}" # c',
    bash: 'FOO=1 npm run "a b" | grep -i x # c',
    json: '{"a": [1, 2.5e3, true, null]}',
    html: '<!doctype html><a href="x" b>t</a><script>let a=1</script><style>a{color:#fff}</style>',
    css: '@media (max-width:1px){a:hover{margin:0 -1.5em!important}}',
    go: 'package main\nfunc main() { x := `raw\nstr`; _ = x }'
  };
  for (const [lang, code] of Object.entries(samples)) assert.equal(joined(tokenize(code, lang)), code, lang);
});

test('language aliases', () => {
  assert.equal(normalizeLang('JavaScript'), 'js');
  assert.equal(normalizeLang('tsx'), 'ts');
  assert.equal(normalizeLang('py'), 'python');
  assert.equal(normalizeLang('sh'), 'bash');
  assert.equal(normalizeLang('golang'), 'go');
  assert.equal(normalizeLang('xml'), 'html');
  assert.equal(normalizeLang('klingon'), null);
  assert.equal(normalizeLang(''), null);
});

test('unknown language: single plain token', () => {
  assert.deepEqual(tokenize('let x', 'klingon'), [[null, 'let x']]);
});

test('js keywords, strings, numbers, comments', () => {
  const t = tokenize('const n = 42; // hi\nlet s = "a\\"b";', 'js');
  assert.deepEqual(find(t, 'kw'), ['const', 'let']);
  assert.deepEqual(find(t, 'num'), ['42']);
  assert.deepEqual(find(t, 'com'), ['// hi']);
  assert.deepEqual(find(t, 'str'), ['"a\\"b"']);
});

test('js block comments span lines', () => {
  const t = tokenize('/* a\nb */ x', 'js');
  assert.deepEqual(find(t, 'com'), ['/* a\nb */']);
});

test('js template literals span lines', () => {
  const t = tokenize('`a\nb`', 'js');
  assert.deepEqual(find(t, 'str'), ['`a\nb`']);
});

test('js function calls and class names', () => {
  const t = tokenize('foo(new Map())', 'js');
  assert.deepEqual(find(t, 'fn'), ['foo']);
  assert.ok(find(t, 'type').includes('Map'));
});

test('js regex literal vs division', () => {
  assert.deepEqual(find(tokenize('x = /a+b/gi', 'js'), 'str'), ['/a+b/gi']);
  assert.deepEqual(find(tokenize('x = a / b / c', 'js'), 'str'), []);
});

test('js keyword used as property is not highlighted', () => {
  assert.deepEqual(find(tokenize('obj.default = 1', 'js'), 'kw'), []);
});

test('ts extras: interface, type annotations', () => {
  const t = tokenize('interface A { x: string }', 'ts');
  assert.deepEqual(find(t, 'kw'), ['interface']);
  assert.deepEqual(find(t, 'type'), ['A', 'string']);
});

test('python keywords, triple-quoted strings, decorators, comments', () => {
  const t = tokenize('@app.route("/")\ndef f():\n    """doc\nmore"""\n    # note\n    return None', 'python');
  assert.ok(find(t, 'attr').includes('@app.route'));
  assert.ok(find(t, 'kw').includes('def') && find(t, 'kw').includes('return'));
  assert.deepEqual(find(t, 'str').filter((s) => s.startsWith('"""')), ['"""doc\nmore"""']);
  assert.deepEqual(find(t, 'com'), ['# note']);
  assert.deepEqual(find(t, 'lit'), ['None']);
});

test('python f-string prefix is part of the string', () => {
  assert.deepEqual(find(tokenize('x = f"a{b}"', 'python'), 'str'), ['f', '"a{b}"'].length ? ['f"a{b}"'] : []);
});

test('python builtins only highlighted when called', () => {
  assert.deepEqual(find(tokenize('print(len(x))', 'python'), 'fn'), ['print', 'len']);
  assert.deepEqual(find(tokenize('print = 1', 'python'), 'fn'), []);
});

test('bash: comments, strings, variables, flags, command names', () => {
  const t = tokenize('# c\necho "hi $USER" --flag -v | grep x', 'bash');
  assert.deepEqual(find(t, 'com'), ['# c']);
  assert.deepEqual(find(t, 'fn'), ['echo', 'grep']);
  assert.deepEqual(find(t, 'attr'), ['--flag', '-v']);
  assert.deepEqual(find(t, 'str'), ['"hi $USER"']);
});

test('bash: $VAR outside quotes, keywords, assignment', () => {
  const t = tokenize('X=1\nif [ -f $FILE ]; then echo ok; fi', 'bash');
  assert.deepEqual(find(t, 'kw'), ['if', 'then', 'fi']);
  assert.ok(find(t, 'var').includes('$FILE'));
  assert.ok(find(t, 'var').includes('X'));
});

test('bash: # inside a word is not a comment', () => {
  assert.deepEqual(find(tokenize('echo a#b', 'bash'), 'com'), []);
});

test('json: keys differ from string values', () => {
  const t = tokenize('{"name": "x", "n": -1.5, "ok": true, "z": null}', 'json');
  assert.deepEqual(find(t, 'attr'), ['"name"', '"n"', '"ok"', '"z"']);
  assert.deepEqual(find(t, 'str'), ['"x"']);
  assert.deepEqual(find(t, 'lit'), ['true', 'null']);
  assert.ok(find(t, 'num').includes('1.5'));
});

test('html: tags, attributes, strings, comments', () => {
  const t = tokenize('<!-- c --><div class="a" hidden>x</div>', 'html');
  assert.deepEqual(find(t, 'com'), ['<!-- c -->']);
  assert.deepEqual(find(t, 'tag'), ['div', 'div']);
  assert.deepEqual(find(t, 'attr'), ['class', 'hidden']);
  assert.deepEqual(find(t, 'str'), ['"a"']);
});

test('html: embedded script and style are highlighted with js / css', () => {
  const t = tokenize('<script>const a = 1</script><style>p { color: red; }</style>', 'html');
  assert.ok(find(t, 'kw').includes('const'));
  assert.ok(find(t, 'attr').includes('color'));
});

test('css: selectors, properties, values, at-rules', () => {
  const t = tokenize('@media print { .a > b:hover { margin: 0 -2px; color: #fff; /* c */ } }', 'css');
  assert.ok(find(t, 'kw').includes('@media'));
  assert.ok(find(t, 'type').includes('.a'));
  assert.ok(find(t, 'attr').includes('margin') && find(t, 'attr').includes('color'));
  assert.ok(find(t, 'num').includes('#fff') && find(t, 'num').includes('-2px'));
  assert.deepEqual(find(t, 'com'), ['/* c */']);
});

test('css: variables and functions', () => {
  const t = tokenize(':root { --x: 1; a: var(--x); }', 'css');
  assert.ok(find(t, 'var').includes('--x'));
  assert.deepEqual(find(t, 'fn').filter((s) => s === 'var'), ['var']);
});

test('go: keywords, types, raw strings, literals', () => {
  const t = tokenize('func f(s string) error { return nil } // c', 'go');
  assert.ok(find(t, 'kw').includes('func') && find(t, 'kw').includes('return'));
  assert.ok(find(t, 'type').includes('string') && find(t, 'type').includes('error'));
  assert.deepEqual(find(t, 'lit'), ['nil']);
  assert.deepEqual(find(tokenize('x := `a\nb`', 'go'), 'str'), ['`a\nb`']);
});

test('numbers: hex, float, exponent, underscores', () => {
  const t = tokenize('0xFF 1_000 3.14 2e10 .5', 'js');
  assert.deepEqual(find(t, 'num'), ['0xFF', '1_000', '3.14', '2e10', '.5']);
});

test('identifiers containing digits are not split', () => {
  assert.deepEqual(find(tokenize('abc123', 'js'), 'num'), []);
});

test('unterminated string ends at the line end', () => {
  const t = tokenize('"abc\nlet x', 'js');
  assert.deepEqual(find(t, 'str'), ['"abc']);
  assert.ok(find(t, 'kw').includes('let'));
});

test('highlight escapes HTML in code', () => {
  const html = highlight('a < b && "c"', 'js');
  assert.ok(html.includes('&lt;') && html.includes('&amp;&amp;'));
  assert.ok(!html.includes('<b'));
});

test('highlight of plain text still escapes', () => {
  assert.equal(highlight('<x>', 'nope'), '&lt;x&gt;');
});

test('highlightLines splits multi-line tokens without breaking spans', () => {
  const lines = highlightLines('/* a\nb */', 'js');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '<span class="t-com">/* a</span>');
  assert.equal(lines[1], '<span class="t-com">b */</span>');
});

test('parseLineSpec', () => {
  assert.deepEqual([...parseLineSpec('{2,4-5}')].sort(), [2, 4, 5]);
  assert.deepEqual([...parseLineSpec('5-3')].sort(), [3, 4, 5]);
  assert.deepEqual([...parseLineSpec(' 1 , x , 7 ')].sort(), [1, 7]);
  assert.equal(parseLineSpec('').size, 0);
  assert.equal(parseLineSpec(undefined).size, 0);
});

test('highlight with line set marks the right lines', () => {
  const html = highlight('a\nb\nc', 'js', { lines: new Set([2]) });
  assert.equal((html.match(/class="ln hl"/g) || []).length, 1);
  assert.equal((html.match(/class="ln"/g) || []).length, 2);
});
