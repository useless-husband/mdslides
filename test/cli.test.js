import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, parseArgs } from '../src/cli.js';

const BIN = new URL('../bin/mdslides.js', import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdslides-cli-'));
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

test('parseArgs: flags, values, repeated --css', () => {
  const o = parseArgs(['talk.md', '-o', 'x.html', '--theme=dark', '--css', 'a.css', '--css=b.css', '--print-notes', '--allow-html']);
  assert.deepEqual(o._, ['talk.md']);
  assert.equal(o.out, 'x.html');
  assert.equal(o.theme, 'dark');
  assert.deepEqual(o.css, ['a.css', 'b.css']);
  assert.equal(o.printNotes, true);
  assert.equal(o.allowHtml, true);
});

test('parseArgs: unknown options and missing values throw', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.throws(() => parseArgs(['-x']), /unknown option/);
  assert.throws(() => parseArgs(['--theme']), /needs a value/);
  assert.throws(() => parseArgs(['-o']), /needs a value/);
});

test('end to end: mdslides talk.md -o talk.html', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'talk.md'), '---\ntitle: T\n---\n# One\n\nNote: hi\n---\n## Two\n\n```js\nlet a = 1\n```\n');
  const r = run(['talk.md', '-o', 'talk.html'], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'talk.html'), 'utf8');
  assert.match(html, /<title>T<\/title>/);
  assert.equal((html.match(/<div class="frame"/g) || []).length, 2);
  assert.match(html, /<h1>One<\/h1>/);
  assert.match(html, /class="t-kw">let</);
  assert.match(r.stdout, /2 slides/);
  fs.rmSync(dir, { recursive: true });
});

test('default output name is <input>.html next to the input', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.md'), '# a');
  const r = run(['deck.md'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'deck.html')));
  fs.rmSync(dir, { recursive: true });
});

test('-o - writes HTML to stdout', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.md'), '# a');
  const r = run(['deck.md', '-o', '-'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^<!doctype html>/);
  assert.ok(!fs.existsSync(path.join(dir, 'deck.html')));
  fs.rmSync(dir, { recursive: true });
});

test('local images are embedded so the output is one file', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'p.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  fs.writeFileSync(path.join(dir, 'deck.md'), '![pic](p.png)');
  run(['deck.md'], dir);
  const html = fs.readFileSync(path.join(dir, 'deck.html'), 'utf8');
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.ok(!html.includes('src="p.png"'));
  fs.rmSync(dir, { recursive: true });
});

test('--theme, --aspect and --css are applied', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.md'), '# a');
  fs.writeFileSync(path.join(dir, 'my.css'), '.slide { letter-spacing: 3px; }');
  const r = run(['deck.md', '--theme', 'paper', '--aspect', '4:3', '--css', 'my.css'], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'deck.html'), 'utf8');
  assert.match(html, /theme-paper/);
  assert.match(html, /data-w="1024"/);
  assert.match(html, /letter-spacing: 3px/);
  fs.rmSync(dir, { recursive: true });
});

test('--print-notes and --allow-html', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.md'), '<b>bold</b>\nNote: n');
  run(['deck.md', '--print-notes', '--allow-html'], dir);
  const html = fs.readFileSync(path.join(dir, 'deck.html'), 'utf8');
  assert.match(html, /A4 portrait/);
  assert.match(html, /<b>bold<\/b>/);
  fs.rmSync(dir, { recursive: true });
});

test('missing input file: exit 1 with a message', () => {
  const r = run(['nope.md'], os.tmpdir());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot read file/);
});

test('missing css file: exit 1', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.md'), '# a');
  const r = run(['deck.md', '--css', 'nope.css'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot read CSS/);
  fs.rmSync(dir, { recursive: true });
});

test('unknown option: exit 2', () => {
  const r = run(['--bogus'], os.tmpdir());
  assert.equal(r.status, 2);
});

test('no arguments prints help; --help exits 0; --version prints a version', () => {
  assert.equal(run([], os.tmpdir()).status, 2);
  const h = run(['--help'], os.tmpdir());
  assert.equal(h.status, 0);
  assert.match(h.stdout, /mdslides serve/);
  assert.match(run(['--version'], os.tmpdir()).stdout, /^\d+\.\d+\.\d+/);
});

test('init writes a sample deck that builds; refuses to overwrite without --force', () => {
  const dir = tmp();
  const r = run(['init'], dir);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(dir, 'talk.md'), 'utf8');
  assert.match(md, /^---\ntitle:/);
  assert.equal(run(['init'], dir).status, 1);
  assert.equal(run(['init', '--force'], dir).status, 0);
  assert.equal(run(['talk.md'], dir).status, 0);
  const html = fs.readFileSync(path.join(dir, 'talk.html'), 'utf8');
  assert.ok((html.match(/<div class="frame"/g) || []).length >= 5);
  fs.rmSync(dir, { recursive: true });
});

test('init accepts a custom file name', () => {
  const dir = tmp();
  assert.equal(run(['init', 'my.md'], dir).status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'my.md')));
  fs.rmSync(dir, { recursive: true });
});

test('main() works in-process with injected output', async () => {
  const dir = tmp();
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, '# a\n---\n# b');
  let out = '';
  const code = await main([file], { out: (s) => { out += s; }, err: () => {} });
  assert.equal(code, 0);
  assert.match(out, /2 slides/);
  fs.rmSync(dir, { recursive: true });
});

test('warnings for missing images go to stderr but do not fail the build', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.md'), '![x](missing.png)');
  const r = run(['deck.md'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /image not found/);
  fs.rmSync(dir, { recursive: true });
});

test('the checked-in example builds to exactly the checked-in HTML', () => {
  const root = path.resolve(path.dirname(BIN), '..');
  const dir = tmp();
  const out = path.join(dir, 'intro.html');
  const r = run([path.join(root, 'examples/intro.md'), '-o', out], root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), fs.readFileSync(path.join(root, 'examples/intro.html'), 'utf8'));
  fs.rmSync(dir, { recursive: true });
});
