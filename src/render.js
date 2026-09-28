// Build a complete single-file HTML deck from Markdown source.

import fs from 'node:fs';
import { parseDeck, ASPECTS } from './slides.js';
import { renderMarkdown, escapeHtml } from './markdown.js';

const asset = (name) => fs.readFileSync(new URL(`./assets/${name}`, import.meta.url), 'utf8');

export const THEMES = ['light', 'dark', 'paper'];
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const safeCss = (css) => String(css).replace(/<\/style/gi, '<\\/style');
const safeAttr = (v) => escapeHtml(String(v));

function printCss(W, H, printNotes) {
  const base = `
@media print {
  html, body { height: auto; overflow: visible; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #deck { position: static; width: auto; height: auto; transform: none !important; display: block; }
  #hud, #progress, #blackout, #pv { display: none !important; }
  .frame { display: block !important; position: relative; break-after: page; page-break-after: always; }
  .frame:last-child { break-after: auto; page-break-after: auto; }
  .slide .fragment { visibility: visible !important; opacity: 1 !important; }
  .slide pre.code { break-inside: avoid; }
}`;
  if (!printNotes) {
    return `@page { size: ${W}px ${H}px; margin: 0; }${base}`;
  }
  const k = Math.floor((690 / W) * 100) / 100;
  return `@page { size: A4 portrait; margin: 12mm; }${base}
@media print {
  .frame { width: ${Math.round(W * k)}px; height: auto; overflow: hidden; }
  .frame .slide { margin-bottom: ${Math.round((k - 1) * H)}px; transform: scale(${k}); transform-origin: 0 0; outline: 1px solid #999; }
  .notes { display: block; margin-top: 14px; padding-top: 8px; font-size: 11pt; line-height: 1.6; color: #000; font-family: inherit; }
  .notes::before { content: "Notes"; display: block; font-size: 9pt; color: #555; text-transform: uppercase; letter-spacing: .05em; }
  .notes pre { white-space: pre-wrap; }
}`;
}

/**
 * Build a deck.
 * options: { theme, aspect, css (string|string[]), printNotes, allowHtml, baseDir, inlineImages, live, title }
 * Returns { html, warnings, meta, slideCount }.
 */
export function buildDeck(source, options = {}) {
  const warnings = [];
  const { meta, slides } = parseDeck(source);

  let theme = String(options.theme || meta.theme || 'light').toLowerCase();
  if (!THEMES.includes(theme)) {
    warnings.push(`unknown theme "${theme}", using "light"`);
    theme = 'light';
  }
  let aspect = String(options.aspect || meta.aspect || '16:9').replace(/\s+/g, '');
  if (!ASPECTS[aspect]) {
    warnings.push(`unknown aspect "${aspect}", using "16:9"`);
    aspect = '16:9';
  }
  const [W, H] = ASPECTS[aspect];

  const mdOpts = {
    allowHtml: !!options.allowHtml,
    baseDir: options.baseDir || process.cwd(),
    inlineImages: options.inlineImages !== false,
    warnings
  };

  if (slides.length === 0) slides.push({ markdown: '', notes: '', attrs: {} });

  let title = options.title || meta.title;
  if (!title) {
    const h1 = /^#\s+(.+)$/m.exec(slides[0].markdown);
    title = h1 ? h1[1].replace(/[*_`~]/g, '') : 'Slides';
  }

  const frames = slides.map((s, idx) => {
    const a = s.attrs;
    const cls = ['slide', a.class].filter(Boolean).join(' ');
    const styles = [a.background ? `background:${a.background}` : '', a.style || ''].filter(Boolean).join(';');
    const extra = Object.entries(a.data || {}).map(([k, v]) => ` ${k}="${safeAttr(v)}"`).join('');
    const body = renderMarkdown(s.markdown, mdOpts);
    const notes = s.notes ? renderMarkdown(s.notes, mdOpts) : '';
    return `<div class="frame" data-n="${idx + 1}"><section class="${safeAttr(cls)}"${a.id ? ` id="${safeAttr(a.id)}"` : ''}${styles ? ` style="${safeAttr(styles)}"` : ''}${extra}>\n${body}\n</section><aside class="notes">${notes}</aside></div>`;
  });

  const css = [options.css].flat().filter(Boolean).map(safeCss).join('\n');
  const author = meta.author ? `<meta name="author" content="${safeAttr(meta.author)}">\n` : '';
  const date = meta.date ? `<meta name="date" content="${safeAttr(meta.date)}">\n` : '';
  const live = options.live ? `<script>${options.live}</script>\n` : '';

  const html = `<!doctype html>
<html lang="${safeAttr(meta.lang || 'zh-Hant')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${author}${date}<meta name="generator" content="mdslides ${VERSION}">
<style>
${asset('themes.css')}
${asset('base.css')}
${printCss(W, H, !!options.printNotes)}
${css ? `/* custom */\n${css}\n` : ''}</style>
</head>
<body class="theme-${theme}" data-w="${W}" data-h="${H}" data-aspect="${aspect}" style="--W:${W}px;--H:${H}px;--W-n:${W};--H-n:${H};--k:.25">
<main id="deck">
${frames.join('\n')}
</main>
<div id="progress"></div>
<div id="hud"><button id="btn-prev" tabindex="-1" aria-label="上一頁">&lsaquo;</button><span id="counter"></span><button id="btn-next" tabindex="-1" aria-label="下一頁">&rsaquo;</button></div>
<div id="blackout"></div>
<script>
${asset('player.js')}
</script>
${live}</body>
</html>
`;
  return { html, warnings, meta: { ...meta, title, theme, aspect }, slideCount: slides.length };
}
