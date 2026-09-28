// Local preview server: serves the deck and pushes a reload event (SSE) when files change.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { buildDeck } from './render.js';
import { escapeHtml } from './highlight.js';

const LIVE_SCRIPT = "(function(){if(!window.EventSource)return;var es=new EventSource('/__events');es.addEventListener('reload',function(){location.reload();});})();";

/**
 * Start the preview server.
 * options: { file, port, host, cssFiles, theme, aspect, printNotes, allowHtml, onLog }
 * Resolves to { server, port, host, url, close() }.
 */
export function startServer(options) {
  const file = path.resolve(options.file);
  const cssFiles = (options.cssFiles || []).map((f) => path.resolve(f));
  const host = options.host || '127.0.0.1';
  const log = options.onLog || (() => {});
  const clients = new Set();

  function render() {
    try {
      const source = fs.readFileSync(file, 'utf8');
      const css = cssFiles.map((f) => fs.readFileSync(f, 'utf8'));
      const r = buildDeck(source, {
        theme: options.theme, aspect: options.aspect, printNotes: options.printNotes,
        allowHtml: options.allowHtml, css, baseDir: path.dirname(file), live: LIVE_SCRIPT
      });
      for (const w of r.warnings) log(`warning: ${w}`);
      return r.html;
    } catch (err) {
      log(`error: ${err.message}`);
      return `<!doctype html><meta charset="utf-8"><title>mdslides error</title>` +
        `<body style="font:16px/1.6 -apple-system,sans-serif;padding:32px"><h1>Cannot build deck</h1>` +
        `<pre>${escapeHtml(err.message)}</pre><script>${LIVE_SCRIPT}</script></body>`;
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      });
      res.write('retry: 500\n: connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(render());
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  // file watching (directory level, so editors that save via rename still work)
  const watchers = [];
  let timer = null;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      log('changed, reloading');
      for (const c of clients) c.write(`event: reload\ndata: ${Date.now()}\n\n`);
    }, 60);
  };
  const dirs = [...new Set([file, ...cssFiles].map((f) => path.dirname(f)))];
  for (const dir of dirs) {
    const onEvent = (_ev, name) => {
      const base = name ? path.basename(String(name)) : '';
      if (base.startsWith('.') || base.endsWith('~') || /\.(?:html|swp|tmp)$/i.test(base) || base === '4913') return;
      notify();
    };
    try { watchers.push(fs.watch(dir, { recursive: true }, onEvent)); }
    catch { try { watchers.push(fs.watch(dir, onEvent)); } catch { /* cannot watch */ } }
  }
  const heartbeat = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000);
  heartbeat.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const port = server.address().port;
      resolve({
        server, port, host,
        url: `http://${host}:${port}/`,
        close() {
          clearTimeout(timer);
          clearInterval(heartbeat);
          for (const w of watchers) w.close();
          for (const c of clients) c.end();
          clients.clear();
          return new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
        }
      });
    });
  });
}
