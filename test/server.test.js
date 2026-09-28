import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../src/server.js';
import { main } from '../src/cli.js';

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// Open the SSE stream and resolve helpers to wait for text.
function openEvents(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buf = '';
      const waiters = [];
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        for (const w of [...waiters]) if (buf.includes(w.text)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(buf); }
      });
      resolve({
        res, req,
        waitFor(text, ms = 4000) {
          if (buf.includes(text)) return Promise.resolve(buf);
          return new Promise((ok, no) => {
            const w = { text, resolve: ok };
            waiters.push(w);
            setTimeout(() => no(new Error(`timeout waiting for "${text}", got ${JSON.stringify(buf)}`)), ms).unref();
          });
        },
        close() { req.destroy(); }
      });
    });
    req.on('error', reject);
  });
}

function setup(content = '# Hello\n---\n# World') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdslides-srv-'));
  const file = path.join(dir, 'talk.md');
  fs.writeFileSync(file, content);
  return { dir, file };
}

test('serve: responds with the deck HTML on /', async () => {
  const { dir, file } = setup();
  const srv = await startServer({ file, port: 0 });
  try {
    assert.ok(srv.port > 0);
    const r = await get(srv.url);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /<h1>Hello<\/h1>/);
    assert.match(r.body, /EventSource\('\/__events'\)/);
    assert.equal((r.body.match(/<div class="frame"/g) || []).length, 2);
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('serve: binds to loopback by default', async () => {
  const { dir, file } = setup();
  const srv = await startServer({ file, port: 0 });
  try { assert.equal(srv.server.address().address, '127.0.0.1'); }
  finally { await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('serve: unknown path is 404', async () => {
  const { dir, file } = setup();
  const srv = await startServer({ file, port: 0 });
  try { assert.equal((await get(srv.url + 'etc/passwd')).status, 404); }
  finally { await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('serve: each request rebuilds from the current file contents', async () => {
  const { dir, file } = setup('# First');
  const srv = await startServer({ file, port: 0 });
  try {
    assert.match((await get(srv.url)).body, /<h1>First<\/h1>/);
    fs.writeFileSync(file, '# Second');
    assert.match((await get(srv.url)).body, /<h1>Second<\/h1>/);
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('serve: SSE stream sends a reload event when the file changes', async () => {
  const { dir, file } = setup();
  const srv = await startServer({ file, port: 0 });
  const ev = await openEvents(srv.url + '__events');
  try {
    assert.match(ev.res.headers['content-type'], /text\/event-stream/);
    await ev.waitFor(': connected');
    fs.writeFileSync(file, '# Changed');
    const text = await ev.waitFor('event: reload');
    assert.match(text, /event: reload\ndata: \d+/);
  } finally { ev.close(); await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('serve: editing a --css file also triggers reload', async () => {
  const { dir, file } = setup();
  const css = path.join(dir, 'x.css');
  fs.writeFileSync(css, 'a{}');
  const srv = await startServer({ file, port: 0, cssFiles: [css] });
  const ev = await openEvents(srv.url + '__events');
  try {
    await ev.waitFor(': connected');
    fs.writeFileSync(css, 'a{color:red}');
    await ev.waitFor('event: reload');
    assert.match((await get(srv.url)).body, /a\{color:red\}/);
  } finally { ev.close(); await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('serve: a broken file shows an error page instead of crashing', async () => {
  const { dir, file } = setup();
  const srv = await startServer({ file, port: 0, onLog: () => {} });
  try {
    fs.rmSync(file);
    const r = await get(srv.url);
    assert.equal(r.status, 200);
    assert.match(r.body, /Cannot build deck/);
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('serve: relative --css and theme options are used', async () => {
  const { dir, file } = setup();
  const srv = await startServer({ file, port: 0, theme: 'dark' });
  try { assert.match((await get(srv.url)).body, /theme-dark/); }
  finally { await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('CLI serve: starts on port 0 and answers', async () => {
  const { dir, file } = setup();
  let srv, out = '';
  const code = await main(['serve', file, '--port', '0'], {
    out: (s) => { out += s; }, err: () => {}, noWait: true, onServer: (s) => { srv = s; }
  });
  try {
    assert.equal(code, 0);
    assert.match(out, /serving .*http:\/\/127\.0\.0\.1:\d+\//);
    assert.equal((await get(srv.url)).status, 200);
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true }); }
});

test('CLI serve: rejects a bad port and a missing file', async () => {
  const { dir, file } = setup();
  let err = '';
  assert.equal(await main(['serve', file, '--port', 'abc'], { out() {}, err: (s) => { err += s; }, noWait: true }), 1);
  assert.match(err, /invalid port/);
  assert.equal(await main(['serve', path.join(dir, 'nope.md')], { out() {}, err() {}, noWait: true }), 1);
  fs.rmSync(dir, { recursive: true });
});
