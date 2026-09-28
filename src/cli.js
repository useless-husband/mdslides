// Command line interface.

import fs from 'node:fs';
import path from 'node:path';
import { buildDeck, VERSION, THEMES } from './render.js';
import { startServer } from './server.js';
import { INIT_TEMPLATE } from './templates.js';

const HELP = `mdslides ${VERSION} - turn one Markdown file into a single-file HTML slide deck

Usage:
  mdslides <talk.md> [-o talk.html] [options]   build a deck
  mdslides serve <talk.md> [--port 18080]        preview with live reload
  mdslides init [talk.md] [--force]              write a sample deck

Options:
  -o, --out <file>      output file (default: same name with .html, "-" for stdout)
  --theme <name>        ${THEMES.join(' | ')} (overrides front matter)
  --aspect <ratio>      16:9 | 16:10 | 4:3
  --css <file>          append a custom CSS file (can be repeated)
  --print-notes         print speaker notes under each slide when saving as PDF
  --allow-html          let raw HTML in the Markdown through (default: escaped)
  --no-inline-images    keep local image paths instead of embedding base64
  --port <n>            serve: port (default 8080, 0 = pick a free one)
  --host <addr>         serve: bind address (default 127.0.0.1)
  -h, --help            show this help
  -v, --version         show version
`;

const VALUE_FLAGS = new Set(['out', 'o', 'theme', 'aspect', 'css', 'port', 'host']);

export function parseArgs(argv) {
  const opts = { _: [], css: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '-v' || a === '--version') { opts.version = true; continue; }
    if (a === '-o') { opts.out = argv[++i]; if (opts.out === undefined) throw new Error('-o needs a value'); continue; }
    if (a === '-') { opts._.push(a); continue; }
    if (a.startsWith('--')) {
      let [name, val] = a.slice(2).split(/=(.*)/s, 2);
      if (VALUE_FLAGS.has(name)) {
        if (val === undefined) { val = argv[++i]; if (val === undefined) throw new Error(`--${name} needs a value`); }
        if (name === 'css') opts.css.push(val);
        else opts[name] = val;
        continue;
      }
      const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (['printNotes', 'allowHtml', 'noInlineImages', 'force'].includes(camel)) { opts[camel] = true; continue; }
      throw new Error(`unknown option: --${name}`);
    }
    if (a.startsWith('-') && a.length > 1) throw new Error(`unknown option: ${a}`);
    opts._.push(a);
  }
  return opts;
}

/** Run the CLI. Returns an exit code. io = { out, err } writer functions (for tests). */
export async function main(argv, io = {}) {
  const out = io.out || ((s) => process.stdout.write(s));
  const err = io.err || ((s) => process.stderr.write(s));
  let opts;
  try { opts = parseArgs(argv); } catch (e) { err(`mdslides: ${e.message}\n`); return 2; }

  if (opts.version) { out(`${VERSION}\n`); return 0; }
  if (opts.help || opts._.length === 0) { out(HELP); return opts.help ? 0 : 2; }

  const cmd = opts._[0];
  try {
    if (cmd === 'init') return init(opts, out, err);
    if (cmd === 'serve') return await serve(opts, out, err, io);
    return build(opts, out, err);
  } catch (e) {
    err(`mdslides: ${e.message}\n`);
    return 1;
  }
}

function readCss(files) {
  return files.map((f) => {
    try { return fs.readFileSync(f, 'utf8'); } catch { throw new Error(`cannot read CSS file: ${f}`); }
  });
}

function readSource(file) {
  if (!file) throw new Error('no input file given');
  try { return fs.readFileSync(file, 'utf8'); } catch { throw new Error(`cannot read file: ${file}`); }
}

function build(opts, out, err) {
  const file = opts._[0] === 'build' ? opts._[1] : opts._[0];
  const source = readSource(file);
  const result = buildDeck(source, {
    theme: opts.theme, aspect: opts.aspect, css: readCss(opts.css), printNotes: opts.printNotes,
    allowHtml: opts.allowHtml, inlineImages: !opts.noInlineImages, baseDir: path.dirname(path.resolve(file))
  });
  for (const w of result.warnings) err(`warning: ${w}\n`);
  if (opts.out === '-') { out(result.html); return 0; }
  const target = opts.out || file.replace(/\.(?:md|markdown|txt)$/i, '') + '.html';
  fs.writeFileSync(target, result.html);
  out(`${target}  (${result.slideCount} slides, ${(Buffer.byteLength(result.html) / 1024).toFixed(1)} KB)\n`);
  return 0;
}

function init(opts, out, err) {
  const target = opts._[1] || 'talk.md';
  if (fs.existsSync(target) && !opts.force) {
    err(`mdslides: ${target} already exists (use --force to overwrite)\n`);
    return 1;
  }
  fs.writeFileSync(target, INIT_TEMPLATE);
  out(`created ${target}\nnext: mdslides serve ${target}\n`);
  return 0;
}

async function serve(opts, out, err, io) {
  const file = opts._[1];
  readSource(file);
  const port = opts.port === undefined ? 8080 : Number(opts.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid port: ${opts.port}`);
  const srv = await startServer({
    file, port, host: opts.host, cssFiles: opts.css, theme: opts.theme, aspect: opts.aspect,
    printNotes: opts.printNotes, allowHtml: opts.allowHtml, onLog: (m) => err(`${m}\n`)
  });
  out(`serving ${file} at ${srv.url}\nwatching for changes, press Ctrl+C to stop\n`);
  if (io.onServer) io.onServer(srv);
  if (io.noWait) return 0;
  await new Promise((resolve) => {
    const stop = () => { srv.close().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}
