import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildDeck } from '../src/render.js';

const count = (s, re) => (s.match(re) || []).length;

test('one frame per slide, single self-contained file', () => {
  const { html, slideCount } = buildDeck('# a\n---\n# b\n---\n# c');
  assert.equal(slideCount, 3);
  assert.equal(count(html, /<div class="frame"/g), 3);
  assert.match(html, /^<!doctype html>/);
  assert.ok(!/<link /.test(html));
  assert.ok(!/<script[^>]* src=/.test(html));
  assert.ok(!/https?:\/\/(?:cdn|unpkg|fonts)/.test(html));
});

test('title comes from front matter, then first h1, then a default', () => {
  assert.match(buildDeck('---\ntitle: FM\n---\n# H1').html, /<title>FM<\/title>/);
  assert.match(buildDeck('# **Hello** `x`').html, /<title>Hello x<\/title>/);
  assert.match(buildDeck('just text').html, /<title>Slides<\/title>/);
});

test('title is HTML-escaped', () => {
  const { html } = buildDeck('---\ntitle: <script>x</script>\n---\na');
  assert.ok(!html.includes('<title><script>'));
  assert.match(html, /<title>&lt;script&gt;/);
});

test('theme: default light, front matter, option overrides, unknown falls back', () => {
  assert.match(buildDeck('a').html, /<body class="theme-light"/);
  assert.match(buildDeck('---\ntheme: paper\n---\na').html, /<body class="theme-paper"/);
  assert.match(buildDeck('---\ntheme: paper\n---\na', { theme: 'dark' }).html, /<body class="theme-dark"/);
  const r = buildDeck('a', { theme: 'neon' });
  assert.match(r.html, /theme-light/);
  assert.equal(r.warnings.length, 1);
});

test('aspect ratio sets logical slide size', () => {
  assert.match(buildDeck('a').html, /data-w="1280" data-h="720"/);
  assert.match(buildDeck('---\naspect: 4:3\n---\na').html, /data-w="1024" data-h="768"/);
  assert.match(buildDeck('a', { aspect: '16:10' }).html, /data-h="800"/);
  assert.equal(buildDeck('a', { aspect: '99:1' }).warnings.length, 1);
});

test('speaker notes are rendered into aside.notes, not into the slide', () => {
  const { html } = buildDeck('# a\nNote: **secret** words');
  assert.match(html, /<aside class="notes"><p><strong>secret<\/strong> words<\/p><\/aside>/);
  assert.ok(!/<section[^>]*>[^]*secret[^]*<\/section><aside/.test(html));
});

test('slide directive adds classes, id and style to the section', () => {
  const { html } = buildDeck('<!-- .slide: class="center" id="intro" bg="#123456" -->\n# a');
  assert.match(html, /<section class="slide center" id="intro" style="background:#123456">/);
});

test('slide attribute values are escaped', () => {
  const { html } = buildDeck('<!-- .slide: class="x&quot; onclick=&quot;evil" -->\na');
  assert.ok(!/<section[^>]* onclick="/.test(html));
});

test('fragments appear in the output', () => {
  const { html } = buildDeck('+ one\n+ two');
  assert.equal(count(html, /<li class="fragment">/g), 2);
});

test('custom css is appended, and cannot close the style tag', () => {
  const { html } = buildDeck('a', { css: ['.slide{color:red}', 'x</style><script>alert(1)</script>'] });
  assert.match(html, /\.slide\{color:red\}/);
  assert.ok(!html.includes('</style><script>alert(1)'));
});

test('printNotes switches to portrait page with notes visible', () => {
  assert.match(buildDeck('a').html, /@page \{ size: 1280px 720px; margin: 0; \}/);
  const p = buildDeck('a', { printNotes: true }).html;
  assert.match(p, /@page \{ size: A4 portrait/);
  assert.match(p, /\.notes \{ display: block/);
});

test('print CSS has one page per slide', () => {
  const { html } = buildDeck('a');
  assert.match(html, /break-after: page/);
  assert.match(html, /@media print/);
});

test('raw HTML in Markdown is escaped unless allowHtml', () => {
  assert.ok(!buildDeck('<b>x</b>').html.includes('<b>x</b>'));
  assert.ok(buildDeck('<b>x</b>', { allowHtml: true }).html.includes('<b>x</b>'));
});

test('empty input still produces a valid single-slide deck', () => {
  const r = buildDeck('');
  assert.equal(r.slideCount, 1);
  assert.match(r.html, /<\/html>\s*$/);
});

test('live script is injected only when requested', () => {
  assert.ok(!buildDeck('a').html.includes('EventSource'));
  assert.ok(buildDeck('a', { live: 'new EventSource("/e")' }).html.includes('EventSource'));
});

test('generated HTML has no absolute local paths', () => {
  const { html } = buildDeck('a');
  assert.ok(!/\/Users\/|C:\\Users/.test(html));
});

test('inline player script parses and has no </script> inside', () => {
  const src = fs.readFileSync(new URL('../src/assets/player.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src));
  assert.ok(!/<\/script/i.test(src));
});

test('player script supports the documented keys and hash format', () => {
  const src = fs.readFileSync(new URL('../src/assets/player.js', import.meta.url), 'utf8');
  for (const k of ['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', 'Home', 'End', "' '"]) assert.ok(src.includes(k), k);
  assert.ok(src.includes('BroadcastChannel'));
  assert.ok(src.includes('touchstart') && src.includes('touchend'));
  assert.ok(src.includes('#/'));
});
