// A small hand-written syntax highlighter.
// tokenize(code, lang) -> [[type|null, text], ...]
// highlight(code, lang, { lines }) -> HTML string

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

const JS_KW = set(`break case catch class const continue debugger default delete do else export extends finally for
  function if import in instanceof let new of return super switch this throw try typeof var void while with yield
  async await static get set from as`);
const TS_KW = set(`interface type enum implements namespace declare readonly abstract keyof infer is satisfies
  public private protected override module`);
const TS_TYPES = set('string number boolean any unknown never void object symbol bigint');
const JS_LIT = set('true false null undefined NaN Infinity');

const PY_KW = set(`and as assert async await break class continue def del elif else except finally for from global if
  import in is lambda nonlocal not or pass raise return try while with yield match case`);
const PY_LIT = set('True False None');
const PY_BUILTIN = set(`print len range int str float bool list dict set tuple open input type isinstance enumerate zip
  map filter sorted sum min max abs any all super self cls`);

const GO_KW = set(`break case chan const continue default defer else fallthrough for func go goto if import interface
  map package range return select struct switch type var`);
const GO_TYPES = set(`string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 bool
  byte rune error any complex64 complex128`);
const GO_LIT = set('true false nil iota');

const SH_KW = set(`if then else elif fi for while until do done case esac function in select return exit local export
  readonly declare unset source alias set shift break continue time`);

const TYPE_AFTER = set('class interface type enum new extends implements struct');

const NUM_RE = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;

const LANGS = {
  js: { name: 'js', keywords: JS_KW, literals: JS_LIT, lineComments: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'], multi: ['`'], regex: true },
  ts: { name: 'ts', keywords: new Set([...JS_KW, ...TS_KW]), types: TS_TYPES, literals: JS_LIT, lineComments: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'], multi: ['`'], regex: true },
  python: { name: 'python', keywords: PY_KW, literals: PY_LIT, builtins: PY_BUILTIN, lineComments: ['#'], quotes: ['"', "'"], triple: ['"""', "'''"], decorators: true, strPrefix: /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/ },
  go: { name: 'go', keywords: GO_KW, types: GO_TYPES, literals: GO_LIT, lineComments: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'], multi: ['`'] },
  json: { name: 'json', keywords: new Set(), literals: set('true false null'), lineComments: ['//'], block: ['/*', '*/'], quotes: ['"'], jsonKeys: true, plainIdents: true },
  bash: { name: 'bash', keywords: SH_KW, lineComments: ['#'], quotes: ['"', "'"], multi: ['"', "'"], shell: true }
};

const ALIASES = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  ts: 'ts', typescript: 'ts', tsx: 'ts',
  py: 'python', python: 'python', python3: 'python',
  go: 'go', golang: 'go',
  json: 'json', jsonc: 'json', json5: 'json',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html',
  css: 'css', scss: 'css'
};

export function normalizeLang(lang) {
  if (!lang) return null;
  return ALIASES[String(lang).toLowerCase()] || null;
}

const isIdStart = (c) => /[A-Za-z_$ -￿]/.test(c);
const isIdPart = (c) => /[\w$ -￿]/.test(c);

function pushTok(out, type, text) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last[0] === type) last[1] += text;
  else out.push([type, text]);
}

function scanGeneric(code, cfg) {
  const out = [];
  const n = code.length;
  let i = 0;
  let lastSig = ''; // last significant char (for regex detection)
  let lastWord = '';
  let cmdPos = true; // bash: at start of a command

  const startsWith = (s) => code.startsWith(s, i);

  while (i < n) {
    const c = code[i];

    // whitespace
    if (c === ' ' || c === '\t' || c === '\r') { pushTok(out, null, c); i++; continue; }
    if (c === '\n') { pushTok(out, null, c); i++; if (cfg.shell) cmdPos = true; continue; }

    // comments
    let matched = false;
    for (const lc of cfg.lineComments || []) {
      if (startsWith(lc)) {
        if (cfg.shell && i > 0 && !/[\s;&|(]/.test(code[i - 1])) break;
        let e = code.indexOf('\n', i);
        if (e < 0) e = n;
        pushTok(out, 'com', code.slice(i, e));
        i = e; matched = true; break;
      }
    }
    if (matched) continue;
    if (cfg.block && startsWith(cfg.block[0])) {
      let e = code.indexOf(cfg.block[1], i + cfg.block[0].length);
      e = e < 0 ? n : e + cfg.block[1].length;
      pushTok(out, 'com', code.slice(i, e));
      i = e; continue;
    }

    // triple quoted strings (python)
    if (cfg.triple) {
      const t = cfg.triple.find((q) => startsWith(q));
      if (t) {
        let e = code.indexOf(t, i + 3);
        e = e < 0 ? n : e + 3;
        pushTok(out, 'str', code.slice(i, e));
        i = e; lastSig = '"'; continue;
      }
    }

    // strings
    if ((cfg.quotes || []).includes(c)) {
      const multi = (cfg.multi || []).includes(c);
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\' && !(cfg.shell && c === "'")) { j += 2; continue; }
        if (code[j] === c) { j++; break; }
        if (code[j] === '\n' && !multi) break;
        j++;
      }
      if (j > n) j = n;
      const text = code.slice(i, j);
      let type = 'str';
      if (cfg.jsonKeys) {
        let k = j;
        while (k < n && /\s/.test(code[k])) k++;
        if (code[k] === ':') type = 'attr';
      }
      pushTok(out, type, text);
      i = j; lastSig = '"'; lastWord = ''; cmdPos = false; continue;
    }

    // JS regex literal
    if (cfg.regex && c === '/') {
      const prevOk = lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig) || ['return', 'typeof', 'case', 'in', 'of'].includes(lastWord);
      if (prevOk) {
        let j = i + 1, inClass = false, ok = false;
        while (j < n && code[j] !== '\n') {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === '[') inClass = true;
          else if (code[j] === ']') inClass = false;
          else if (code[j] === '/' && !inClass) { ok = true; j++; break; }
          j++;
        }
        if (ok) {
          while (j < n && /[a-z]/.test(code[j])) j++;
          pushTok(out, 'str', code.slice(i, j));
          i = j; lastSig = '"'; lastWord = ''; continue;
        }
      }
    }

    // shell specifics
    if (cfg.shell) {
      if (c === '$') {
        const m = /^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?$!*-])/.exec(code.slice(i, i + 80));
        if (m) { pushTok(out, 'var', m[0]); i += m[0].length; cmdPos = false; continue; }
      }
      if (/[|;&(]/.test(c)) { pushTok(out, null, c); i++; cmdPos = true; continue; }
      const wm = /^[A-Za-z0-9_.\/~:@%+=,-]+/.exec(code.slice(i, i + 200));
      if (wm) {
        const w = wm[0];
        i += w.length;
        if (/^--?[A-Za-z]/.test(w)) pushTok(out, 'attr', w);
        else if (/^\d+$/.test(w)) pushTok(out, 'num', w);
        else if (cfg.keywords.has(w)) { pushTok(out, 'kw', w); cmdPos = w !== 'in'; continue; }
        else if (cmdPos && /^[A-Za-z_]\w*=/.test(w)) {
          const eq = w.indexOf('=');
          pushTok(out, 'var', w.slice(0, eq));
          pushTok(out, null, w.slice(eq));
          continue;
        } else if (cmdPos) pushTok(out, 'fn', w);
        else pushTok(out, null, w);
        cmdPos = false;
        continue;
      }
      pushTok(out, null, c); i++; continue;
    }

    // decorators
    if (cfg.decorators && c === '@' && i + 1 < n && isIdStart(code[i + 1])) {
      let j = i + 1;
      while (j < n && (isIdPart(code[j]) || code[j] === '.')) j++;
      pushTok(out, 'attr', code.slice(i, j));
      i = j; lastSig = 'a'; continue;
    }

    // numbers
    if (/\d/.test(c) || (c === '.' && /\d/.test(code[i + 1] || ''))) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(code);
      if (m && m.index === i) {
        pushTok(out, 'num', m[0]);
        i += m[0].length; lastSig = '0'; lastWord = ''; continue;
      }
    }

    // identifiers
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(code[j])) j++;
      const w = code.slice(i, j);
      // python string prefixes: f"..." r'...'
      if (cfg.strPrefix && cfg.strPrefix.test(w) && (code[j] === '"' || code[j] === "'")) {
        pushTok(out, 'str', w);
        i = j; continue;
      }
      let k = j;
      while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
      let type = null;
      if (cfg.keywords.has(w)) type = 'kw';
      else if (cfg.literals && cfg.literals.has(w)) type = 'lit';
      else if (cfg.types && cfg.types.has(w)) type = 'type';
      else if (!cfg.plainIdents && !cfg.shell && TYPE_AFTER.has(lastWord)) type = 'type';
      else if (cfg.builtins && cfg.builtins.has(w) && code[k] === '(') type = 'fn';
      else if (!cfg.plainIdents && code[k] === '(') type = 'fn';
      else if (!cfg.plainIdents && /^[A-Z][A-Za-z0-9]*$/.test(w) && w.length > 1) type = 'type';
      // a keyword used as a property name (obj.default) is not a keyword
      if (type === 'kw' && lastSig === '.') type = null;
      pushTok(out, type, w);
      i = j; lastSig = 'a'; lastWord = w; continue;
    }

    // punctuation / everything else
    pushTok(out, null, c);
    lastSig = c; lastWord = '';
    i++;
  }
  return out;
}

function scanCss(code) {
  const out = [];
  const n = code.length;
  let i = 0;
  let mode = null; // 'selector' | 'prop' | 'value'
  let depth = 0;

  const decide = () => {
    let j = i;
    let inStr = null;
    while (j < n) {
      const ch = code[j];
      if (inStr) { if (ch === '\\') j++; else if (ch === inStr) inStr = null; }
      else if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === '/' && code[j + 1] === '*') { const e = code.indexOf('*/', j + 2); j = e < 0 ? n : e + 1; }
      else if (ch === '{') return 'selector';
      else if (ch === ';' || ch === '}') return 'prop';
      j++;
    }
    return 'prop';
  };

  while (i < n) {
    const c = code[i];
    if (/\s/.test(c)) { pushTok(out, null, c); i++; continue; }
    if (c === '/' && code[i + 1] === '*') {
      let e = code.indexOf('*/', i + 2);
      e = e < 0 ? n : e + 2;
      pushTok(out, 'com', code.slice(i, e)); i = e; continue;
    }
    if (mode === null) mode = depth >= 0 ? decide() : 'selector';
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== '\n') { if (code[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1);
      pushTok(out, 'str', code.slice(i, j)); i = j; continue;
    }
    if (c === '{') { pushTok(out, null, c); depth++; mode = null; i++; continue; }
    if (c === '}') { pushTok(out, null, c); depth = Math.max(0, depth - 1); mode = null; i++; continue; }
    if (c === ';') { pushTok(out, null, c); mode = null; i++; continue; }
    if (c === ':' && mode === 'prop') { pushTok(out, null, c); mode = 'value'; i++; continue; }
    if (c === '@') {
      const m = /^@[\w-]+/.exec(code.slice(i, i + 60));
      if (m) { pushTok(out, 'kw', m[0]); i += m[0].length; continue; }
    }
    if (mode === 'selector') {
      const m = /^(?:[.#]|::?)?[\w-]+/.exec(code.slice(i, i + 200));
      if (m) {
        const t = m[0];
        pushTok(out, t[0] === '.' || t[0] === '#' ? 'type' : (t[0] === ':' ? 'fn' : 'tag'), t);
        i += t.length; continue;
      }
      pushTok(out, null, c); i++; continue;
    }
    if (mode === 'prop') {
      const m = /^-{0,2}[\w-]+/.exec(code.slice(i, i + 200));
      if (m) { pushTok(out, m[0].startsWith('--') ? 'var' : 'attr', m[0]); i += m[0].length; continue; }
      pushTok(out, null, c); i++; continue;
    }
    // value
    if (c === '#') {
      const m = /^#[0-9a-fA-F]{3,8}\b/.exec(code.slice(i, i + 12));
      if (m) { pushTok(out, 'num', m[0]); i += m[0].length; continue; }
    }
    const nm = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/.exec(code.slice(i, i + 40));
    if (nm && (i === 0 || !/[\w-]/.test(code[i - 1]))) { pushTok(out, 'num', nm[0]); i += nm[0].length; continue; }
    const im = /^-{0,2}[A-Za-z_][\w-]*/.exec(code.slice(i, i + 200));
    if (im) {
      const w = im[0];
      const type = w.startsWith('--') ? 'var' : (code[i + w.length] === '(' ? 'fn' : (w === 'important' ? 'kw' : null));
      pushTok(out, type, w); i += w.length; continue;
    }
    pushTok(out, null, c); i++;
  }
  return out;
}

function scanHtml(code) {
  const out = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    if (code.startsWith('<!--', i)) {
      let e = code.indexOf('-->', i + 4);
      e = e < 0 ? n : e + 3;
      pushTok(out, 'com', code.slice(i, e)); i = e; continue;
    }
    if (code.startsWith('<!', i) || code.startsWith('<?', i)) {
      let e = code.indexOf('>', i);
      e = e < 0 ? n : e + 1;
      pushTok(out, 'kw', code.slice(i, e)); i = e; continue;
    }
    const tm = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(code.slice(i, i + 100));
    if (code[i] === '<' && tm) {
      pushTok(out, null, '<' + tm[1]);
      pushTok(out, 'tag', tm[2]);
      i += tm[0].length;
      const name = tm[2].toLowerCase();
      // attributes
      while (i < n && code[i] !== '>') {
        const c = code[i];
        if (/\s/.test(c)) { pushTok(out, null, c); i++; continue; }
        if (c === '/' ) { pushTok(out, null, c); i++; continue; }
        if (c === '=') { pushTok(out, null, c); i++; continue; }
        if (c === '"' || c === "'") {
          let e = code.indexOf(c, i + 1);
          e = e < 0 ? n : e + 1;
          pushTok(out, 'str', code.slice(i, e)); i = e; continue;
        }
        const am = /^[^\s=>\/"']+/.exec(code.slice(i, i + 200));
        if (am) {
          const isValue = out.length && out[out.length - 1][1].endsWith('=');
          pushTok(out, isValue ? 'str' : 'attr', am[0]); i += am[0].length; continue;
        }
        pushTok(out, null, c); i++;
      }
      if (i < n) { pushTok(out, null, '>'); i++; }
      if (!tm[1] && (name === 'script' || name === 'style')) {
        const close = code.toLowerCase().indexOf('</' + name, i);
        const e = close < 0 ? n : close;
        const inner = code.slice(i, e);
        const sub = name === 'script' ? scanGeneric(inner, LANGS.js) : scanCss(inner);
        for (const [t, s] of sub) pushTok(out, t, s);
        i = e;
      }
      continue;
    }
    // plain text up to next tag
    let e = code.indexOf('<', i + 1);
    if (e < 0) e = n;
    pushTok(out, null, code.slice(i, e));
    i = e;
  }
  return out;
}

export function tokenize(code, lang) {
  const l = normalizeLang(lang);
  code = String(code);
  if (!l) return [[null, code]];
  if (l === 'html') return scanHtml(code);
  if (l === 'css') return scanCss(code);
  return scanGeneric(code, LANGS[l]);
}

/** "2,4-5" -> Set{2,4,5}. Invalid parts are ignored. */
export function parseLineSpec(spec) {
  const s = new Set();
  if (!spec) return s;
  for (const part of String(spec).replace(/[{}\s]/g, '').split(',')) {
    let m;
    if ((m = /^(\d+)$/.exec(part))) s.add(+m[1]);
    else if ((m = /^(\d+)-(\d+)$/.exec(part))) {
      let a = +m[1], b = +m[2];
      if (a > b) [a, b] = [b, a];
      for (let k = a; k <= b && k - a < 10000; k++) s.add(k);
    }
  }
  return s;
}

function renderTok([type, text]) {
  const t = escapeHtml(text);
  return type ? `<span class="t-${type}">${t}</span>` : t;
}

/** Split a token stream into per-line HTML strings. */
export function highlightLines(code, lang) {
  const tokens = tokenize(code, lang);
  const lines = [[]];
  for (const [type, text] of tokens) {
    const parts = text.split('\n');
    parts.forEach((p, idx) => {
      if (idx > 0) lines.push([]);
      if (p) lines[lines.length - 1].push([type, p]);
    });
  }
  return lines.map((toks) => toks.map(renderTok).join(''));
}

export function highlight(code, lang, opts = {}) {
  const lines = highlightLines(code, lang);
  const hl = opts.lines instanceof Set ? opts.lines : null;
  if (hl && hl.size) {
    return lines.map((l, i) => `<span class="ln${hl.has(i + 1) ? ' hl' : ''}">${l}</span>`).join('');
  }
  return lines.join('\n');
}
