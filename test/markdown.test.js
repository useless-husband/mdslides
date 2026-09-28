import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderMarkdown as md, renderInline, sanitizeUrl } from '../src/markdown.js';

const one = (s, o) => md(s, o).trim();

test('heading levels 1-6', () => {
  for (let i = 1; i <= 6; i++) assert.equal(one('#'.repeat(i) + ' Title'), `<h${i}>Title</h${i}>`);
});

test('seven hashes is not a heading', () => {
  assert.match(one('####### x'), /^<p>/);
});

test('heading with closing hashes and inline markup', () => {
  assert.equal(one('## **Hi** there ##'), '<h2><strong>Hi</strong> there</h2>');
});

test('hash without space is a paragraph', () => {
  assert.equal(one('#tag'), '<p>#tag</p>');
});

test('paragraphs are separated by blank lines', () => {
  assert.equal(md('a\n\nb'), '<p>a</p>\n<p>b</p>');
});

test('soft line break is kept, hard break becomes <br>', () => {
  assert.equal(one('a\nb'), '<p>a\nb</p>');
  assert.equal(one('a  \nb'), '<p>a<br>b</p>');
  assert.equal(one('a\\\nb'), '<p>a<br>b</p>');
});

test('bold, italic, strike, code', () => {
  assert.equal(one('**b**'), '<p><strong>b</strong></p>');
  assert.equal(one('__b__'), '<p><strong>b</strong></p>');
  assert.equal(one('*i*'), '<p><em>i</em></p>');
  assert.equal(one('_i_'), '<p><em>i</em></p>');
  assert.equal(one('~~s~~'), '<p><del>s</del></p>');
  assert.equal(one('`c`'), '<p><code>c</code></p>');
});

test('bold + italic combined and nested', () => {
  assert.equal(one('***x***'), '<p><strong><em>x</em></strong></p>');
  assert.equal(one('**a *b* c**'), '<p><strong>a <em>b</em> c</strong></p>');
  assert.equal(one('*a **b** c*'), '<p><em>a <strong>b</strong> c</em></p>');
});

test('underscores inside words are not emphasis', () => {
  assert.equal(one('snake_case_name'), '<p>snake_case_name</p>');
});

test('lone asterisks and spaced operators stay literal', () => {
  assert.equal(one('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
  assert.equal(one('a ** b'), '<p>a ** b</p>');
});

test('emphasis works inside CJK text', () => {
  assert.equal(one('這是**重點**喔'), '<p>這是<strong>重點</strong>喔</p>');
});

test('inline code escapes HTML and ignores markup inside', () => {
  assert.equal(one('`<b>*x*</b>`'), '<p><code>&lt;b&gt;*x*&lt;/b&gt;</code></p>');
});

test('double backtick inline code may contain a backtick', () => {
  assert.equal(one('`` a`b ``'), '<p><code>a`b</code></p>');
});

test('backslash escapes punctuation', () => {
  assert.equal(one('\\*not em\\*'), '<p>*not em*</p>');
});

test('links with title and external target', () => {
  assert.equal(one('[x](https://a.b "T")'), '<p><a href="https://a.b" title="T" target="_blank" rel="noopener noreferrer">x</a></p>');
});

test('relative links have no target', () => {
  assert.equal(one('[x](page.html)'), '<p><a href="page.html">x</a></p>');
});

test('link URL may contain balanced parentheses', () => {
  assert.match(one('[w](https://en.wikipedia.org/wiki/A_(b))'), /href="https:\/\/en\.wikipedia\.org\/wiki\/A_\(b\)"/);
});

test('link text can hold formatting', () => {
  assert.match(one('[**bold** link](x.html)'), /<a href="x.html"><strong>bold<\/strong> link<\/a>/);
});

test('autolinks: <url> and bare urls', () => {
  assert.match(one('<https://a.b/c>'), /<a href="https:\/\/a\.b\/c"[^>]*>https:\/\/a\.b\/c<\/a>/);
  assert.match(one('see https://a.b/c.'), /<a href="https:\/\/a\.b\/c"[^>]*>https:\/\/a\.b\/c<\/a>\.<\/p>/);
});

test('unordered list', () => {
  assert.equal(one('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(one('* a\n* b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
});

test('ordered list keeps start number', () => {
  assert.equal(one('1. a\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  assert.match(one('3. a\n4. b'), /^<ol start="3">/);
});

test('nested lists (2 and 4 space indent, mixed types)', () => {
  const two = one('- a\n  - b\n    - c');
  assert.equal((two.match(/<ul>/g) || []).length, 3);
  const four = one('- a\n    - b');
  assert.equal((four.match(/<ul>/g) || []).length, 2);
  const mixed = one('1. a\n   - b\n2. c');
  assert.match(mixed, /<ol>[\s\S]*<ul>[\s\S]*<\/ul>[\s\S]*<\/ol>/);
  assert.equal((mixed.match(/<li>/g) || []).length, 3);
});

test('changing list type starts a new list', () => {
  const html = one('- a\n\n1. b');
  assert.match(html, /<\/ul>\s*<ol>/);
});

test('loose list wraps items in paragraphs', () => {
  assert.equal(one('- a\n\n- b'), '<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>');
});

test('task lists', () => {
  const html = one('- [x] done\n- [ ] todo');
  assert.match(html, /<li class="task"><input type="checkbox" disabled checked> done<\/li>/);
  assert.match(html, /<li class="task"><input type="checkbox" disabled> todo<\/li>/);
});

test('a "+" list item becomes a fragment (step by step)', () => {
  const html = one('+ a\n+ b\n- c');
  assert.match(html, /<li class="fragment">a<\/li>/);
  assert.match(html, /<li class="fragment">b<\/li>/);
  assert.match(html, /<li>c<\/li>/);
});

test('list item with code fence inside keeps blank lines', () => {
  const html = one('- a\n  ```js\n  let x\n\n  let y\n  ```\n- b');
  assert.match(html, /<pre class="code"[^>]*><code class="language-js">/);
  assert.equal((html.match(/<li>/g) || []).length, 2);
});

test('block quote, nested quote and lazy continuation', () => {
  assert.equal(one('> a'), '<blockquote>\n<p>a</p>\n</blockquote>');
  assert.match(one('> a\n> > b'), /<blockquote>[\s\S]*<blockquote>[\s\S]*<p>b<\/p>/);
  assert.match(one('> a\nb'), /<p>a\nb<\/p>/);
});

test('block quote containing a list', () => {
  assert.match(one('> - a\n> - b'), /<blockquote>\s*<ul>/);
});

test('fenced code with language', () => {
  const html = one('```python\nprint("hi")\n```');
  assert.match(html, /<pre class="code" data-lang="python"><code class="language-python">/);
  assert.match(html, /<span class="t-fn">print<\/span>/);
});

test('fenced code without language is escaped, not highlighted', () => {
  assert.equal(one('```\n<b>&</b>\n```'), '<pre class="code"><code>&lt;b&gt;&amp;&lt;/b&gt;</code></pre>');
});

test('tilde fences and longer fences containing shorter ones', () => {
  assert.match(one('~~~\nx\n~~~'), /<pre/);
  const html = one('````md\n```js\nx\n```\n````');
  assert.equal((html.match(/<pre/g) || []).length, 1);
  assert.match(html, /```js/);
});

test('unclosed fence runs to the end', () => {
  assert.match(one('```js\nlet a = 1'), /<pre[\s\S]*let[\s\S]*<\/pre>/);
});

test('highlight line spec wraps every line', () => {
  const html = one('```js {2,4-5}\na\nb\nc\nd\ne\n```');
  assert.match(html, /class="code has-hl"/);
  assert.equal((html.match(/class="ln hl"/g) || []).length, 3);
  assert.equal((html.match(/class="ln"/g) || []).length, 2);
});

test('horizontal rules', () => {
  assert.equal(one('***'), '<hr>');
  assert.equal(one('___'), '<hr>');
  assert.equal(one('- - -'), '<hr>');
});

test('table with alignment', () => {
  const html = one('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
  assert.match(html, /<th style="text-align:left">a<\/th>/);
  assert.match(html, /<th style="text-align:center">b<\/th>/);
  assert.match(html, /<td style="text-align:right">3<\/td>/);
});

test('table without outer pipes, short rows padded', () => {
  const html = one('a | b\n--|--\n1 |');
  assert.match(html, /<th>a<\/th><th>b<\/th>/);
  assert.match(html, /<td>1<\/td><td><\/td>/);
});

test('table cell can contain escaped pipe and inline markup', () => {
  const html = one('| a |\n|---|\n| x \\| **y** |');
  assert.match(html, /<td>x \| <strong>y<\/strong><\/td>/);
});

test('a line with a pipe but no delimiter row is a paragraph', () => {
  assert.equal(one('a | b'), '<p>a | b</p>');
});

test('HTML comments are dropped', () => {
  assert.equal(one('<!-- hidden -->\n\ntext'), '<p>text</p>');
});

test('empty and whitespace-only input', () => {
  assert.equal(md(''), '');
  assert.equal(md('  \n\n \n'), '');
});

test('CRLF line endings', () => {
  assert.equal(md('# a\r\n\r\nb\r\n'), '<h1>a</h1>\n<p>b</p>');
});

test('Chinese text and punctuation pass through', () => {
  assert.equal(one('# 你好，世界'), '<h1>你好，世界</h1>');
});

// ---- XSS ----

test('raw HTML is escaped by default', () => {
  const html = one('<script>alert(1)</script>');
  assert.ok(!html.includes('<script'));
  assert.match(html, /&lt;script&gt;/);
});

test('inline HTML and event handlers are escaped by default', () => {
  const html = one('hello <img src=x onerror=alert(1)> world');
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('raw HTML block passes through with allowHtml', () => {
  assert.equal(one('<div class="x">hi</div>', { allowHtml: true }), '<div class="x">hi</div>');
  assert.match(one('a <b>b</b>', { allowHtml: true }), /<b>b<\/b>/);
});

test('javascript: links are neutralised', () => {
  assert.match(one('[x](javascript:alert(1))'), /href="#"/);
  assert.match(one('[x](JaVaScRiPt:alert(1))'), /href="#"/);
  assert.ok(!/<a /.test(one('[x](  java\tscript:alert(1))')));
  assert.match(one('[x](java&#9;script:alert(1))'), /href="#"|href="java&amp;/);
  assert.match(one('[x](vbscript:msgbox)'), /href="#"/);
  assert.match(one('[x](data:text/html;base64,PHNjcmlwdD4=)'), /href="#"/);
});

test('javascript: neutralised even with allowHtml', () => {
  assert.match(one('[x](javascript:alert(1))', { allowHtml: true }), /href="#"/);
});

test('image src cannot be javascript: or svg data', () => {
  assert.match(one('![x](javascript:alert(1))'), /src="#"/);
  assert.match(one('![x](data:image/svg+xml;base64,AAAA)'), /src="#"/);
});

test('quotes in alt, title and URL cannot break out of attributes', () => {
  const html = one('![a" onerror="x](p.png "t\\" onload=\\"y")', { inlineImages: false });
  assert.ok(!/<img[^>]* onerror="/.test(html));
  assert.ok(!/<img[^>]* onload="/.test(html));
  const link = one('[x](<a" onclick="z>)');
  assert.ok(!/<a[^>]* onclick="/.test(link));
});

test('code content is escaped', () => {
  assert.ok(!one('```html\n<script>x</script>\n```').includes('<script>'));
});

test('sanitizeUrl allows normal schemes', () => {
  assert.equal(sanitizeUrl('https://a.b'), 'https://a.b');
  assert.equal(sanitizeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(sanitizeUrl('./x.png'), './x.png');
  assert.equal(sanitizeUrl('#/3'), '#/3');
  assert.equal(sanitizeUrl('file:///etc/passwd'), '#');
});

test('private-use marker characters in input cannot forge checkboxes', () => {
  assert.ok(!one('C forged').includes('<input'));
});

// ---- images ----

test('local image is embedded as a base64 data URI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdslides-'));
  fs.writeFileSync(path.join(dir, 'a.png'), Buffer.from([137, 80, 78, 71]));
  const html = one('![alt](a.png)', { baseDir: dir });
  assert.match(html, /<img src="data:image\/png;base64,iVBORw==" alt="alt">/);
  fs.rmSync(dir, { recursive: true });
});

test('svg images are embedded with the right mime type', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdslides-'));
  fs.writeFileSync(path.join(dir, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.match(one('![](a.svg)', { baseDir: dir }), /src="data:image\/svg\+xml;base64,/);
  fs.rmSync(dir, { recursive: true });
});

test('missing image is kept as a path and produces a warning', () => {
  const warnings = [];
  const html = one('![](nope.png)', { baseDir: os.tmpdir(), warnings });
  assert.match(html, /src="nope\.png"/);
  assert.equal(warnings.length, 1);
});

test('remote images are not fetched or altered', () => {
  assert.match(one('![](https://a.b/c.png)'), /src="https:\/\/a\.b\/c\.png"/);
});

test('non-image files are never embedded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdslides-'));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'top secret');
  const html = one('![](secret.txt)', { baseDir: dir });
  assert.ok(!html.includes('data:'));
  fs.rmSync(dir, { recursive: true });
});

test('inlineImages: false leaves the path alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdslides-'));
  fs.writeFileSync(path.join(dir, 'a.png'), 'x');
  assert.match(one('![](a.png)', { baseDir: dir, inlineImages: false }), /src="a\.png"/);
  fs.rmSync(dir, { recursive: true });
});

test('renderInline renders without block wrappers', () => {
  assert.equal(renderInline('**a** b'), '<strong>a</strong> b');
});
