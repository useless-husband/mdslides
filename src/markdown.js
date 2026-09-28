// A small Markdown parser written from scratch (no dependencies).
//
// Supported blocks: headings, paragraphs, block quotes, ordered / unordered /
// nested / task lists, fenced code (with language and {highlight lines}),
// tables (with alignment), horizontal rules.
// Supported inline: bold, italic, strikethrough, inline code, links, images,
// autolinks, hard line breaks, backslash escapes.
//
// Raw HTML is escaped unless options.allowHtml is true.

import fs from 'node:fs';
import path from 'node:path';
import { highlight, parseLineSpec, escapeHtml } from './highlight.js';

export { escapeHtml };

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon'
};
const MAX_INLINE_IMAGE = 8 * 1024 * 1024;

// Private-use characters are used internally as markers, so strip them from input.
const SENTINEL_RE = /[-]/g;
const CHECKED = 'C';
const UNCHECKED = 'U';
const BR = '';

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|$)/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})[ \t]*([^\s`{]*)[ \t]*(\{[^}]*\})?[^`]*$/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const HTML_BLOCK_RE = /^\s{0,3}<\/?[A-Za-z][\w-]*(?:[\s/>]|$)/;

const indentOf = (l) => {
  let n = 0;
  for (const ch of l) { if (ch === ' ') n++; else if (ch === '\t') n += 4; else break; }
  return n;
};
const isBlank = (l) => /^\s*$/.test(l);

// ---------------------------------------------------------------- URLs

export function sanitizeUrl(url, { image = false } = {}) {
  const u = String(url).trim().replace(/[\u0000-\u001f\u007f\s]+/g, '');
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(u);
  if (!m) return String(url).trim();
  const scheme = m[1].toLowerCase();
  if (['http', 'https', 'mailto', 'tel'].includes(scheme)) return String(url).trim();
  if (image && scheme === 'data' && /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i.test(u)) return u;
  return '#';
}

function resolveImage(src, ctx) {
  const url = sanitizeUrl(src, { image: true });
  if (url === '#' && src.trim() !== '#') return url;
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(url)) return url;
  if (ctx.inlineImages === false) return url;
  let rel = url;
  try { rel = decodeURI(url); } catch { /* keep raw */ }
  rel = rel.split(/[?#]/)[0];
  const mime = MIME[path.extname(rel).toLowerCase()];
  if (!mime) return url;
  const file = path.resolve(ctx.baseDir, rel);
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    if (st.size > MAX_INLINE_IMAGE) {
      ctx.warnings.push(`image too large to inline (${st.size} bytes): ${src}`);
      return url;
    }
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    ctx.warnings.push(`image not found: ${src}`);
    return url;
  }
}

// ---------------------------------------------------------------- inline

const PUNCT_RE = /[!-\/:-@\[-`{-~]/;

function skipCode(s, i) {
  // s[i] === '`'; return index after the closing run, or -1
  let j = i;
  while (s[j] === '`') j++;
  const run = j - i;
  const close = findBacktickRun(s, j, run);
  return close < 0 ? -1 : close + run;
}

function findBacktickRun(s, from, run) {
  let i = from;
  while (i < s.length) {
    if (s[i] === '`') {
      let j = i;
      while (s[j] === '`') j++;
      if (j - i === run) return i;
      i = j;
    } else i++;
  }
  return -1;
}

function matchBracket(s, i) {
  // s[i] === '['; return index of matching ']' or -1
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') { const e = skipCode(s, j); if (e > 0) { j = e - 1; continue; } }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

function parseLink(s, i) {
  const close = matchBracket(s, i);
  if (close < 0 || s[close + 1] !== '(') return null;
  let j = close + 2;
  while (s[j] === ' ' || s[j] === '\n' || s[j] === '\t') j++;
  let url = '';
  if (s[j] === '<') {
    const e = s.indexOf('>', j);
    if (e < 0) return null;
    url = s.slice(j + 1, e);
    j = e + 1;
  } else {
    let depth = 0;
    const start = j;
    while (j < s.length) {
      const c = s[j];
      if (c === '\\') { j += 2; continue; }
      if (/\s/.test(c)) break;
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      j++;
    }
    url = s.slice(start, j).replace(/\\([!-\/:-@\[-`{-~])/g, '$1');
  }
  while (s[j] === ' ' || s[j] === '\n' || s[j] === '\t') j++;
  let title = null;
  const q = s[j];
  if (q === '"' || q === "'" || q === '(') {
    const endQ = q === '(' ? ')' : q;
    let e = j + 1;
    while (e < s.length && s[e] !== endQ) { if (s[e] === '\\') e++; e++; }
    if (e >= s.length) return null;
    title = s.slice(j + 1, e);
    j = e + 1;
    while (s[j] === ' ' || s[j] === '\n' || s[j] === '\t') j++;
  }
  if (s[j] !== ')') return null;
  return { text: s.slice(i + 1, close), url, title, end: j + 1 };
}

function findClose(s, from, ch, k) {
  // Find the closing delimiter run for an emphasis opener.
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') { const e = skipCode(s, j); if (e > 0) { j = e - 1; continue; } }
    if (c === ch) {
      let e = j;
      while (s[e] === ch) e++;
      const r = e - j;
      const prev = s[j - 1];
      const ok = j > from && !/\s/.test(prev);
      if (ok) {
        if (ch === '_' && /[\p{L}\p{N}]/u.test(s[e] || '')) { j = e - 1; continue; }
        if (r === k) return j;
        if (k === 2 && r === 3) return j + 1;
        if (k === 1 && r === 1) return j;
      }
      j = e - 1;
    }
  }
  return -1;
}

function parseEmphasis(s, i, ctx) {
  const ch = s[i];
  let run = 0;
  while (s[i + run] === ch) run++;
  const after = s[i + run];
  if (after === undefined || /\s/.test(after)) return null;
  if (ch === '_' && i > 0 && /[\p{L}\p{N}]/u.test(s[i - 1])) return null;
  if (ch === '~') {
    if (run !== 2) return null;
    const c = findClose(s, i + 2, '~', 2);
    if (c < 0) return null;
    return { html: `<del>${inline(s.slice(i + 2, c), ctx)}</del>`, end: c + 2 };
  }
  const k = Math.min(run, 3);
  const start = i + (run > 3 ? run - 3 : 0); // extra leading chars are literal
  const c = findClose(s, i + run, ch, k);
  if (c < 0) return null;
  const inner = inline(s.slice(i + run, c), ctx);
  const lead = s.slice(i, i + run - k);
  void start;
  if (k === 1) return { html: `${lead}<em>${inner}</em>`, end: c + 1 };
  if (k === 2) return { html: `${lead}<strong>${inner}</strong>`, end: c + 2 };
  return { html: `${lead}<strong><em>${inner}</em></strong>`, end: c + 3 };
}

const TAG_RE = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?\/?>/;

export function inline(s, ctx) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '\\') {
      if (i + 1 < n && PUNCT_RE.test(s[i + 1])) { out += escapeHtml(s[i + 1]); i += 2; continue; }
      out += '\\'; i++; continue;
    }
    if (c === '`') {
      let j = i;
      while (s[j] === '`') j++;
      const run = j - i;
      const close = findBacktickRun(s, j, run);
      if (close >= 0) {
        let code = s.slice(j, close).replace(/\n/g, ' ');
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        out += `<code>${escapeHtml(code)}</code>`;
        i = close + run; continue;
      }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      const r = parseLink(s, i + 1);
      if (r) {
        const alt = escapeHtml(r.text.replace(/[*_`~\[\]\\]/g, ''));
        const src = escapeHtml(resolveImage(r.url, ctx));
        out += `<img src="${src}" alt="${alt}"${r.title ? ` title="${escapeHtml(r.title)}"` : ''}>`;
        i = r.end; continue;
      }
    }
    if (c === '[' && !ctx.inLink) {
      const r = parseLink(s, i);
      if (r) {
        const href = sanitizeUrl(r.url);
        const ext = /^https?:/i.test(href);
        const text = inline(r.text, { ...ctx, inLink: true });
        out += `<a href="${escapeHtml(href)}"${r.title ? ` title="${escapeHtml(r.title)}"` : ''}${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
        i = r.end; continue;
      }
    }
    if (c === '<') {
      const rest = s.slice(i, i + 2000);
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) {
        const href = escapeHtml(sanitizeUrl(auto[1]));
        out += `<a href="${href}"${/^https?:/i.test(auto[1]) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(auto[1])}</a>`;
        i += auto[0].length; continue;
      }
      if (ctx.allowHtml) {
        const t = TAG_RE.exec(rest);
        if (t) { out += t[0]; i += t[0].length; continue; }
      }
      out += '&lt;'; i++; continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      const r = parseEmphasis(s, i, ctx);
      if (r) { out += r.html; i = r.end; continue; }
      let j = i;
      while (s[j] === c) j++;
      out += s.slice(i, j); i = j; continue;
    }
    if ((c === 'h') && !ctx.inLink && (s.startsWith('http://', i) || s.startsWith('https://', i)) && (i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1]))) {
      const m = /^https?:\/\/[^\s<>-]+/.exec(s.slice(i, i + 2000));
      if (m) {
        let url = m[0].replace(/[.,;:!?'"，。；：！？、）)\]]+$/, '');
        // keep a closing paren if the URL has a matching opener
        if (m[0].endsWith(')') && (url.match(/\(/g) || []).length > (url.match(/\)/g) || []).length) url = m[0];
        if (url.length > 8) {
          out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
          i += url.length; continue;
        }
      }
    }
    if (c === BR) { out += '<br>'; i++; continue; }
    if (c === '') {
      const t = s[i + 1];
      out += `<input type="checkbox" disabled${t === 'C' ? ' checked' : ''}> `;
      i += 2; continue;
    }
    out += c === '&' ? '&amp;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- blocks

function isBlockStart(line, next) {
  if (FENCE_RE.test(line)) return true;
  if (HEADING_RE.test(line) && /^\s{0,3}#/.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (/^\s{0,3}>/.test(line)) return true;
  if (LIST_RE.test(line) && /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(line)) return true;
  if (/^\s{0,3}<!--/.test(line)) return true;
  if (next !== undefined && line.includes('|') && TABLE_DELIM_RE.test(next) && next.includes('-') && (next.includes('|') || line.trim().startsWith('|'))) return true;
  return false;
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++; }
    else if (t[i] === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

function fenceOpen(l) {
  const m = FENCE_RE.exec(l);
  return m ? m : null;
}

function renderCodeBlock(codeLines, lang, spec, ctx) {
  const code = codeLines.join('\n');
  const lines = spec ? parseLineSpec(spec) : null;
  const cls = lang ? ` class="language-${escapeHtml(lang.toLowerCase().replace(/[^\w+#.-]/g, ''))}"` : '';
  const hl = ctx.highlight === false ? escapeHtml(code) : highlight(code, lang, { lines });
  const has = lines && lines.size ? ' has-hl' : '';
  return `<pre class="code${has}"${lang ? ` data-lang="${escapeHtml(lang.toLowerCase().replace(/[^\w+#.-]/g, ''))}"` : ''}><code${cls}>${hl}</code></pre>`;
}

function parseList(lines, start, ctx) {
  const first = LIST_RE.exec(lines[start]);
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    const marker = m[2];
    const content = m[3] || '';
    const markerWidth = indentOf(m[1]) + marker.length + 1;
    const itemLines = [content];
    let inFence = !!fenceOpen(content);
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j >= lines.length) { i = j; break; }
        const nxt = lines[j];
        const ind = indentOf(nxt);
        if (ind > base + 1 || inFence) {
          if (!inFence) loose = true;
          for (let k = i; k < j; k++) itemLines.push('');
          i = j; continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind > base + 1 || inFence) {
        const strip = Math.min(ind, markerWidth);
        let removed = 0, p = 0;
        while (removed < strip && p < l.length && (l[p] === ' ' || l[p] === '\t')) { removed += l[p] === '\t' ? 4 : 1; p++; }
        const text = l.slice(p);
        if (fenceOpen(text)) inFence = !inFence;
        itemLines.push(text);
        i++; continue;
      }
      if (LIST_RE.test(l) && /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(l)) break;
      const prev = itemLines[itemLines.length - 1];
      if (!isBlank(prev) && !isBlockStart(l, lines[i + 1])) { itemLines.push(l.trim()); i++; continue; }
      break;
    }

    let task = null;
    const tm = /^\[([ xX])\](?:[ \t]+|$)/.exec(itemLines[0]);
    if (tm) {
      task = tm[1] === ' ' ? UNCHECKED : CHECKED;
      itemLines[0] = task + itemLines[0].slice(tm[0].length);
    }
    items.push({ lines: itemLines, fragment: marker === '+', task: !!task });

    // is there a sibling item next?
    let j = i;
    while (j < lines.length && isBlank(lines[j])) j++;
    if (j < lines.length) {
      const nm = LIST_RE.exec(lines[j]);
      if (nm && /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(lines[j]) && indentOf(nm[1]) <= base + 1 && indentOf(nm[1]) >= base - 1 && /\d/.test(nm[2]) === ordered) {
        if (j > i) loose = true;
        i = j; continue;
      }
    }
    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const body = items.map((it) => {
    const cls = [it.fragment ? 'fragment' : '', it.task ? 'task' : ''].filter(Boolean).join(' ');
    const inner = parseBlocks(it.lines, ctx, !loose);
    return `<li${cls ? ` class="${cls}"` : ''}>${inner}</li>`;
  }).join('\n');
  const attrs = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  return { html: `<${tag}${attrs}>\n${body}\n</${tag}>`, next: i };
}

export function parseBlocks(lines, ctx, tight = false) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    // HTML comment: dropped
    if (/^\s{0,3}<!--/.test(line)) {
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
      continue;
    }

    // fenced code
    const fm = fenceOpen(line);
    if (fm) {
      const fence = fm[2];
      const indent = fm[1].length;
      const body = [];
      i++;
      const closeRe = new RegExp('^\\s{0,3}' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}\\s*$');
      while (i < lines.length && !closeRe.test(lines[i])) {
        body.push(indent ? lines[i].replace(new RegExp('^\\s{0,' + indent + '}'), '') : lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(renderCodeBlock(body, fm[3] || '', fm[4] || '', ctx));
      continue;
    }

    // heading
    let m = HEADING_RE.exec(line);
    if (m && /^\s{0,3}#{1,6}(?:\s|$)/.test(line)) {
      const level = m[1].length;
      out.push(`<h${level}>${inline((m[2] || '').trim(), ctx)}</h${level}>`);
      i++; continue;
    }

    // hr
    if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }

    // block quote
    if (/^\s{0,3}>/.test(line)) {
      const inner = [];
      while (i < lines.length) {
        const l = lines[i];
        if (/^\s{0,3}>/.test(l)) inner.push(l.replace(/^\s{0,3}>[ ]?/, ''));
        else if (!isBlank(l) && !isBlockStart(l, lines[i + 1]) && inner.length && !isBlank(inner[inner.length - 1])) inner.push(l);
        else break;
        i++;
      }
      out.push(`<blockquote>\n${parseBlocks(inner, ctx)}\n</blockquote>`);
      continue;
    }

    // list
    if (LIST_RE.test(line) && /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(line)) {
      const r = parseList(lines, i, ctx);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1]) && lines[i + 1].includes('-') && (lines[i + 1].includes('|') || line.trim().startsWith('|'))) {
      const head = splitRow(line);
      const delim = splitRow(lines[i + 1]);
      if (delim.every((d) => /^:?-+:?$/.test(d)) && delim.length === head.length) {
        const align = delim.map((d) => (d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : d.startsWith(':') ? 'left' : null));
        const cell = (tag, t, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(t, ctx)}</${tag}>`;
        const rows = [];
        i += 2;
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
          const cells = splitRow(lines[i]);
          while (cells.length < head.length) cells.push('');
          rows.push(`<tr>${cells.slice(0, head.length).map((t, k) => cell('td', t, k)).join('')}</tr>`);
          i++;
        }
        out.push(`<table>\n<thead><tr>${head.map((t, k) => cell('th', t, k)).join('')}</tr></thead>\n<tbody>\n${rows.join('\n')}\n</tbody>\n</table>`);
        continue;
      }
    }

    // raw HTML block
    if (ctx.allowHtml && HTML_BLOCK_RE.test(line)) {
      const html = [];
      while (i < lines.length && !isBlank(lines[i])) { html.push(lines[i]); i++; }
      out.push(html.join('\n'));
      continue;
    }

    // paragraph
    const para = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i], lines[i + 1]) && !(ctx.allowHtml && HTML_BLOCK_RE.test(lines[i]))) {
      para.push(lines[i]);
      i++;
    }
    const text = para.map((l, k) => (k === 0 ? l.trimStart() : l.trim().length ? l.trimStart() : l)).join('\n')
      .replace(/(?: {2,}|\\)\n/g, BR)
      .replace(/[ \t]+\n/g, '\n')
      .trim();
    const html = inline(text, ctx);
    out.push(tight ? html : `<p>${html}</p>`);
  }
  return tight ? out.join('\n') : out.join('\n');
}

/**
 * Render a Markdown string to HTML.
 * options: { allowHtml, baseDir, inlineImages, highlight, warnings }
 */
export function renderMarkdown(md, options = {}) {
  const ctx = {
    allowHtml: !!options.allowHtml,
    baseDir: options.baseDir || process.cwd(),
    inlineImages: options.inlineImages !== false,
    highlight: options.highlight !== false,
    warnings: options.warnings || []
  };
  const src = String(md).replace(/\r\n?/g, '\n').replace(SENTINEL_RE, '');
  return parseBlocks(src.split('\n'), ctx);
}

export function renderInline(md, options = {}) {
  const ctx = {
    allowHtml: !!options.allowHtml,
    baseDir: options.baseDir || process.cwd(),
    inlineImages: options.inlineImages !== false,
    warnings: options.warnings || []
  };
  return inline(String(md).replace(SENTINEL_RE, ''), ctx);
}
