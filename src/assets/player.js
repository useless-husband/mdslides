(function () {
  'use strict';
  var body = document.body;
  var deck = document.getElementById('deck');
  var W = +body.dataset.w, H = +body.dataset.h;
  var frames = Array.prototype.slice.call(deck.querySelectorAll('.frame'));
  var n = frames.length;
  var frags = frames.map(function (f) { return Array.prototype.slice.call(f.querySelectorAll('.fragment')); });
  var isPresenter = /[?&]presenter=1/.test(location.search);
  var THEMES = ['light', 'dark', 'paper'];
  var cur = 0, step = 0, cols = 3;
  var hud = document.getElementById('hud');
  var counter = document.getElementById('counter');
  var progress = document.getElementById('progress');
  var channel = null;
  try { if (window.BroadcastChannel) channel = new BroadcastChannel('mdslides:' + location.pathname + ':' + n); } catch (e) { channel = null; }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---- state -------------------------------------------------------------
  function show(i, s, remote) {
    i = clamp(i, 0, n - 1);
    s = clamp(s || 0, 0, frags[i].length);
    if (frames[cur]) frames[cur].classList.remove('active');
    cur = i; step = s;
    frames[cur].classList.add('active');
    frags[cur].forEach(function (el, k) { el.classList.toggle('visible', k < step); });
    if (counter) counter.textContent = (cur + 1) + ' / ' + n;
    if (progress) progress.style.width = (n > 1 ? cur / (n - 1) * 100 : 100) + '%';
    try { history.replaceState(null, '', location.pathname + location.search + '#/' + (cur + 1) + (step ? '/' + step : '')); } catch (e) { /* file: or sandbox */ }
    if (body.classList.contains('overview')) frames[cur].scrollIntoView({ block: 'nearest' });
    if (body.classList.contains('black')) body.classList.remove('black');
    if (isPresenter) renderPresenter();
    if (channel && !remote) channel.postMessage({ t: 'go', i: cur, s: step });
  }
  function next() {
    if (step < frags[cur].length) show(cur, step + 1);
    else if (cur < n - 1) show(cur + 1, 0);
  }
  function prev() {
    if (step > 0) show(cur, step - 1);
    else if (cur > 0) show(cur - 1, frags[cur - 1].length);
  }
  function readHash() {
    var m = /^#\/(\d+)(?:\/(\d+))?/.exec(location.hash);
    if (!m) return null;
    return [parseInt(m[1], 10) - 1, m[2] ? parseInt(m[2], 10) : 0];
  }

  // ---- layout ------------------------------------------------------------
  function fit() {
    if (body.classList.contains('overview')) { layoutOverview(); return; }
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    var x = (window.innerWidth - W * s) / 2, y = (window.innerHeight - H * s) / 2;
    deck.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
    if (isPresenter) layoutPresenter();
  }
  function layoutOverview() {
    var vw = window.innerWidth;
    cols = vw < 700 ? 2 : vw < 1100 ? 3 : 4;
    var k = (vw - 56 - 24 * (cols - 1) - 17) / cols / W;
    body.style.setProperty('--k', String(k));
    deck.style.transform = '';
  }
  function toggleOverview(force) {
    var on = typeof force === 'boolean' ? force : !body.classList.contains('overview');
    body.classList.toggle('overview', on);
    fit();
    if (on) frames[cur].scrollIntoView({ block: 'center' });
  }
  function toggleFull() {
    var d = document;
    if (d.fullscreenElement) { d.exitFullscreen(); return; }
    var el = d.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
  }
  function toggleBlack() { body.classList.toggle('black'); }
  function cycleTheme() {
    var idx = 0;
    THEMES.forEach(function (t, k) { if (body.classList.contains('theme-' + t)) idx = k; });
    body.classList.remove('theme-' + THEMES[idx]);
    body.classList.add('theme-' + THEMES[(idx + 1) % THEMES.length]);
  }

  // ---- presenter ---------------------------------------------------------
  var pv = null, startTime = Date.now();
  function fmt(ms) {
    var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    var p = function (v) { return (v < 10 ? '0' : '') + v; };
    return (h ? h + ':' : '') + p(m) + ':' + p(s);
  }
  function buildPresenter() {
    body.classList.add('presenter');
    pv = document.createElement('div');
    pv.id = 'pv';
    pv.innerHTML =
      '<div class="col">' +
        '<div><p class="label">目前</p><div class="box" id="pv-cur"></div></div>' +
        '<p class="label" style="margin:0">講者備註</p><div id="pv-notes"></div>' +
      '</div>' +
      '<div class="col">' +
        '<div><p class="label">下一頁</p><div class="box" id="pv-next"></div></div>' +
        '<div class="info">' +
          '<div><p class="label">已用時間 (點一下歸零)</p><button class="v" id="pv-timer" title="歸零">00:00</button></div>' +
          '<div><p class="label">目前時間</p><div class="v" id="pv-clock"></div></div>' +
          '<div class="pos" id="pv-pos"></div>' +
        '</div>' +
        '<div class="nav"><button id="pv-prev">上一步</button><button id="pv-next-btn">下一步</button></div>' +
      '</div>';
    body.appendChild(pv);
    document.getElementById('pv-timer').addEventListener('click', function () { startTime = Date.now(); });
    document.getElementById('pv-prev').addEventListener('click', prev);
    document.getElementById('pv-next-btn').addEventListener('click', next);
    setInterval(function () {
      document.getElementById('pv-timer').textContent = fmt(Date.now() - startTime);
      document.getElementById('pv-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }, 500);
  }
  function cloneInto(box, i, s) {
    box.textContent = '';
    if (i < 0 || i >= n) return;
    var c = frames[i].cloneNode(true);
    c.classList.add('active');
    c.removeAttribute('id');
    var fr = c.querySelectorAll('.fragment');
    Array.prototype.forEach.call(fr, function (el, k) { el.classList.toggle('visible', k < s); });
    box.appendChild(c);
    var sc = box.clientWidth / W;
    c.style.transform = 'scale(' + sc + ')';
  }
  function renderPresenter() {
    var ni = cur, ns = step + 1;
    if (step >= frags[cur].length) { ni = cur + 1; ns = 0; }
    cloneInto(document.getElementById('pv-cur'), cur, step);
    var nx = document.getElementById('pv-next');
    if (ni >= n) { nx.textContent = ''; nx.innerHTML = '<div style="padding:24px;color:var(--muted)">(最後一頁)</div>'; }
    else cloneInto(nx, ni, ns);
    var notes = frames[cur].querySelector('.notes');
    document.getElementById('pv-notes').innerHTML = notes ? notes.innerHTML : '';
    document.getElementById('pv-pos').textContent = '第 ' + (cur + 1) + ' / ' + n + ' 頁' + (frags[cur].length ? '，步驟 ' + step + ' / ' + frags[cur].length : '');
  }
  function layoutPresenter() {
    if (pv) renderPresenter();
  }
  function openPresenter() {
    if (isPresenter) return;
    var u = new URL(location.href);
    u.hash = '';
    u.searchParams.set('presenter', '1');
    window.open(u.toString(), 'mdslides-presenter', 'width=1180,height=760');
  }

  // ---- input -------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    var k = e.key, ov = body.classList.contains('overview'), handled = true;
    if (ov && !isPresenter && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
      var d = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : k === 'ArrowUp' ? -cols : cols;
      show(cur + d, 0);
    } else if (ov && (k === 'Enter' || k === ' ' || k === 'Escape')) toggleOverview(false);
    else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') next();
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') prev();
    else if (k === 'Home') show(0, 0);
    else if (k === 'End') show(n - 1, frags[n - 1].length);
    else if (isPresenter) handled = false;
    else if (k === 'o' || k === 'O' || k === 'Escape') toggleOverview(k === 'Escape' ? false : undefined);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'b' || k === 'B' || k === '.') toggleBlack();
    else if (k === 's' || k === 'S') openPresenter();
    else if (k === 't' || k === 'T') cycleTheme();
    else handled = false;
    if (handled) { e.preventDefault(); if (e.target && e.target.blur && e.target.tagName === 'BUTTON') e.target.blur(); }
  });

  var tx = 0, ty = 0;
  document.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0]; tx = t.clientX; ty = t.clientY;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (body.classList.contains('overview')) return;
    var t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else prev(); }
  }, { passive: true });

  deck.addEventListener('click', function (e) {
    if (!body.classList.contains('overview')) return;
    var f = e.target.closest ? e.target.closest('.frame') : null;
    if (!f) return;
    show(frames.indexOf(f), 0);
    toggleOverview(false);
  });

  var b1 = document.getElementById('btn-prev'), b2 = document.getElementById('btn-next');
  if (b1) b1.addEventListener('click', function () { prev(); b1.blur(); });
  if (b2) b2.addEventListener('click', function () { next(); b2.blur(); });

  var idleTimer = null;
  document.addEventListener('mousemove', function () {
    if (!hud) return;
    hud.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { hud.classList.add('idle'); }, 2500);
  });

  window.addEventListener('resize', fit);
  window.addEventListener('hashchange', function () {
    var h = readHash();
    if (h && (h[0] !== cur || h[1] !== step)) show(h[0], h[1]);
  });

  if (channel) {
    channel.onmessage = function (e) {
      var m = e.data || {};
      if (m.t === 'go') show(m.i, m.s, true);
      else if (m.t === 'hello' && !isPresenter) channel.postMessage({ t: 'go', i: cur, s: step });
    };
  }

  // ---- start -------------------------------------------------------------
  if (isPresenter) buildPresenter();
  var h0 = readHash();
  fit();
  show(h0 ? h0[0] : 0, h0 ? h0[1] : 0, true);
  if (isPresenter && channel) channel.postMessage({ t: 'hello' });
  window.mdslides = { next: next, prev: prev, show: show, get index() { return cur; }, get step() { return step; }, count: n };
})();
