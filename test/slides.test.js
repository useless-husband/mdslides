import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontMatter, splitSlides, parseSlideAttrs, parseDeck, ASPECTS } from '../src/slides.js';

test('front matter: key/value pairs, quotes stripped, keys lowercased', () => {
  const { meta, body } = parseFrontMatter('---\nTitle: "Hello: World"\nauthor: me\naspect: 4:3\n---\n# x');
  assert.deepEqual(meta, { title: 'Hello: World', author: 'me', aspect: '4:3' });
  assert.equal(body, '# x');
});

test('front matter: absent', () => {
  const { meta, body } = parseFrontMatter('# x\n\ntext');
  assert.deepEqual(meta, {});
  assert.equal(body, '# x\n\ntext');
});

test('front matter: empty block', () => {
  const { meta, body } = parseFrontMatter('---\n---\n# x');
  assert.deepEqual(meta, {});
  assert.equal(body, '# x');
});

test('front matter: comments and blank lines allowed', () => {
  const { meta } = parseFrontMatter('---\n# comment\n\ntheme: dark\n---\nx');
  assert.equal(meta.theme, 'dark');
});

test('a leading --- that encloses slide content is not front matter', () => {
  const src = '---\n# Slide one\n---\n# Slide two';
  const { meta, body } = parseFrontMatter(src);
  assert.deepEqual(meta, {});
  assert.equal(body, src);
});

test('front matter: BOM and CRLF', () => {
  const { meta } = parseFrontMatter('﻿---\r\ntitle: a\r\n---\r\nx');
  assert.equal(meta.title, 'a');
});

test('splitSlides splits on ---', () => {
  assert.deepEqual(splitSlides('a\n---\nb\n----\nc'), [['a'], ['b'], ['c']]);
});

test('--- inside a code fence does not split', () => {
  const parts = splitSlides('a\n```\n---\n```\nb\n---\nc');
  assert.equal(parts.length, 2);
});

test('--- inside a four-backtick fence with an inner fence does not split', () => {
  const parts = splitSlides('````md\n```js\n---\n```\n---\n````\n---\nz');
  assert.equal(parts.length, 2);
});

test('table delimiter rows are not slide separators', () => {
  assert.equal(splitSlides('| a | b |\n|---|---|\n| 1 | 2 |').length, 1);
});

test('parseDeck: slides, empty slides dropped', () => {
  const d = parseDeck('# a\n---\n\n---\n# b\n---\n');
  assert.deepEqual(d.slides.map((s) => s.markdown), ['# a', '# b']);
});

test('notes: everything after Note: goes to notes', () => {
  const d = parseDeck('# a\n\ntext\n\nNote: first line\nsecond line\n\n- item');
  assert.equal(d.slides[0].markdown, '# a\n\ntext');
  assert.equal(d.slides[0].notes, 'first line\nsecond line\n\n- item');
});

test('notes: Notes: and Chinese labels, case-insensitive', () => {
  assert.equal(parseDeck('x\nNOTES: hi').slides[0].notes, 'hi');
  assert.equal(parseDeck('x\n備註：你好').slides[0].notes, '你好');
  assert.equal(parseDeck('x\n講者備註: 你好').slides[0].notes, '你好');
});

test('Note: inside a code fence stays code', () => {
  const d = parseDeck('```\nNote: not a note\n```');
  assert.equal(d.slides[0].notes, '');
  assert.match(d.slides[0].markdown, /Note: not a note/);
});

test('"Note:" in the middle of a sentence is not a note', () => {
  const d = parseDeck('Please Note: this is text');
  assert.equal(d.slides[0].notes, '');
});

test('notes are per slide', () => {
  const d = parseDeck('a\nNote: n1\n---\nb\nNote: n2');
  assert.deepEqual(d.slides.map((s) => s.notes), ['n1', 'n2']);
});

test('slide directive: class, id, style, background, data-*', () => {
  const a = parseSlideAttrs('class="center dark" id="x" style="color:red" bg="#fff" data-foo="1" onclick="evil()"');
  assert.deepEqual(a, { class: 'center dark', id: 'x', style: 'color:red', background: '#fff', data: { 'data-foo': '1' } });
});

test('slide directive is removed from the content', () => {
  const d = parseDeck('<!-- .slide: class="center" -->\n\n# T');
  assert.equal(d.slides[0].markdown, '# T');
  assert.equal(d.slides[0].attrs.class, 'center');
});

test('slide directive inside a code fence is left alone', () => {
  const d = parseDeck('```html\n<!-- .slide: class="center" -->\n```');
  assert.deepEqual(d.slides[0].attrs, {});
  assert.match(d.slides[0].markdown, /\.slide:/);
});

test('ASPECTS table', () => {
  assert.deepEqual(ASPECTS['16:9'], [1280, 720]);
  assert.deepEqual(ASPECTS['4:3'], [1024, 768]);
});
