// Deck-level parsing: front matter, slide splitting, speaker notes, per-slide directives.

const NOTES_RE = /^\s*(?:Notes?|備註|講者備註)\s*[:：]\s?(.*)$/i;
const SLIDE_ATTR_RE = /<!--\s*\.slide:\s*([\s\S]*?)\s*-->/;
const SEPARATOR_RE = /^-{3,}\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

export const ASPECTS = {
  '16:9': [1280, 720],
  '16:10': [1280, 800],
  '4:3': [1024, 768]
};

/** Split `---` front matter off the top of the source. */
export function parseFrontMatter(source) {
  const src = String(source).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { meta: {}, body: src };
  const lines = (m[1] || '').split('\n');
  const meta = {};
  const hasContent = lines.some((l) => l.trim());
  for (const line of lines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) return { meta: {}, body: src }; // not real front matter (probably slides)
    let v = kv[2];
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    meta[kv[1].toLowerCase()] = v;
  }
  if (hasContent && Object.keys(meta).length === 0) return { meta: {}, body: src }; // only comments: probably a slide
  return { meta, body: src.slice(m[0].length) };
}

/** Parse `key="value"` pairs from a `<!-- .slide: ... -->` directive. */
export function parseSlideAttrs(text) {
  const attrs = {};
  const re = /([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text))) {
    const key = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2] : m[3];
    if (key === 'class' || key === 'id' || key === 'style') attrs[key] = val;
    else if (key === 'background' || key === 'bg') attrs.background = val;
    else if (/^data-[\w-]+$/.test(key)) (attrs.data ||= {})[key] = val;
  }
  return attrs;
}

/** Split into slides on lines of `---`, ignoring those inside code fences. */
export function splitSlides(body) {
  const raw = [[]];
  let fence = null;
  for (const line of body.split('\n')) {
    const fm = FENCE_RE.exec(line);
    if (fm) {
      if (!fence) fence = fm[1];
      else if (fm[1][0] === fence[0] && fm[1].length >= fence.length && /^\s{0,3}[`~]+\s*$/.test(line)) fence = null;
    }
    if (!fence && SEPARATOR_RE.test(line)) raw.push([]);
    else raw[raw.length - 1].push(line);
  }
  return raw;
}

function parseSlide(lines) {
  const md = [];
  const notes = [];
  let attrs = {};
  let inNotes = false;
  let fence = null;
  for (let line of lines) {
    const fm = FENCE_RE.exec(line);
    if (fm) {
      if (!fence) fence = fm[1];
      else if (fm[1][0] === fence[0] && fm[1].length >= fence.length && /^\s{0,3}[`~]+\s*$/.test(line)) fence = null;
    }
    if (!fence && !fm) {
      const am = SLIDE_ATTR_RE.exec(line);
      if (am) {
        attrs = { ...attrs, ...parseSlideAttrs(am[1]) };
        line = line.replace(SLIDE_ATTR_RE, '');
        if (!line.trim()) continue;
      }
      if (!inNotes) {
        const nm = NOTES_RE.exec(line);
        if (nm) { inNotes = true; notes.push(nm[1]); continue; }
      }
    }
    (inNotes ? notes : md).push(line);
  }
  return {
    markdown: md.join('\n').trim(),
    notes: notes.join('\n').trim(),
    attrs
  };
}

/** Parse a whole deck source into { meta, slides: [{ markdown, notes, attrs }] }. */
export function parseDeck(source) {
  const { meta, body } = parseFrontMatter(source);
  const slides = splitSlides(body)
    .map(parseSlide)
    .filter((s) => s.markdown || s.notes || Object.keys(s.attrs).length);
  return { meta, slides };
}
