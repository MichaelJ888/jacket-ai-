/*
 * Live order ticker — DISPLAY ONLY.
 * Entirely client-side: no fetch, no API calls, nothing is written to the CRM/backend.
 * Orders are fictional and generated locally. Item rules mirror the quote creator in index.html
 * (category MOQs, free first logo, extra-logo/add-on options, Class A/B fabrics).
 */
(function () {
  'use strict';
  if (window.__mjicLiveTicker) return;
  window.__mjicLiveTicker = true;

  var START_ID = 125;
  var TOTAL = 1000;
  var MIN_MS = 2 * 60 * 1000;
  var MAX_MS = 5 * 60 * 1000;
  var FIRST_DELAY_MS = 12 * 1000;
  var SHOW_MS = 12 * 1000;
  var KEY = 'mjic_live_ticker_v1';

  // Quantities are >= the quote creator MOQ for each category (jackets/uniforms 20, small lines 10, giveaways 50).
  var CATALOG = [
    { w: 5, item: 'Varsity Jackets', min: 20, kind: 'jacket' },
    { w: 4, item: 'Corporate Jackets', min: 20, kind: 'jacket' },
    { w: 3, item: 'Windbreakers', min: 20, kind: 'jacket' },
    { w: 2, item: 'High-Vis Reflector Jackets', min: 20, kind: 'hivis' },
    { w: 2, item: 'Sublimation Bomber Jackets', min: 20, kind: 'sublimation' },
    { w: 2, item: 'Coverall Uniforms', min: 20, kind: 'uniform' },
    { w: 4, item: 'Corporate Polo Shirts', min: 20, kind: 'uniform' },
    { w: 2, item: 'Polo Jackets', min: 20, kind: 'uniform' },
    { w: 2, item: 'Scrub Suits', min: 20, kind: 'uniform' },
    { w: 2, item: 'School Uniforms', min: 20, kind: 'uniform' },
    { w: 1, item: 'P.E. Uniforms', min: 20, kind: 'uniform' },
    { w: 1, item: 'Chef Uniforms', min: 20, kind: 'uniform' },
    { w: 1, item: 'Security Uniforms', min: 20, kind: 'uniform' },
    { w: 2, item: 'Enamel Pins', min: 20, kind: 'small' },
    { w: 3, item: 'Custom Lanyards', min: 20, kind: 'small' },
    { w: 2, item: 'Eco / Tote Bags', min: 50, kind: 'giveaway' },
    { w: 2, item: 'Custom Mugs', min: 50, kind: 'giveaway' }
  ];

  var QTY_STEPS = [20, 25, 30, 40, 50, 60, 75, 100, 120, 150, 200, 250, 300, 500];
  var CLASS_B = ['Microfiber', 'Michael Angelo', 'Diamond Ripstop'];

  // Deterministic PRNG so the 1000-order cycle is stable between page loads.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

  function pickWeighted(r) {
    var sum = 0, i;
    for (i = 0; i < CATALOG.length; i++) sum += CATALOG[i].w;
    var n = r() * sum;
    for (i = 0; i < CATALOG.length; i++) { n -= CATALOG[i].w; if (n < 0) return CATALOG[i]; }
    return CATALOG[0];
  }

  function logoText(r, method) {
    var extra = r() < 0.3 ? (r() < 0.75 ? 1 : 2) : 0; // first logo is free in the quote creator
    var base = method + ' logo';
    return extra ? base + ' + ' + extra + ' extra logo' + (extra > 1 ? 's' : '') : base;
  }

  function buildOrder(r) {
    var c = pickWeighted(r);
    var steps = QTY_STEPS.filter(function (q) { return q >= c.min; });
    if (c.kind === 'giveaway') steps = [50, 100, 150, 200, 300, 500, 1000];
    if (c.kind === 'small') steps = [20, 50, 100, 200, 300, 500, 1000];
    var qty = steps[Math.floor(Math.pow(r(), 1.6) * steps.length)];
    var method = r() < 0.75 ? 'embroidered' : 'DTF';
    var parts = [];

    if (c.kind === 'jacket') {
      parts.push(logoText(r, method));
      parts.push(r() < 0.2 ? 'premium Class A fabric' : pick(r, CLASS_B));
      if (r() < 0.15) parts.push('reversible');
      if (r() < 0.12) parts.push('hood');
    } else if (c.kind === 'hivis') {
      parts.push(logoText(r, method));
      parts.push('reflector');
      if (r() < 0.2) parts.push('hood');
    } else if (c.kind === 'sublimation') {
      parts.push('full sublimation print');
      parts.push(pick(r, CLASS_B));
    } else if (c.kind === 'uniform') {
      parts.push(logoText(r, method));
      if (r() < 0.25) parts.push('individual names');
    } else if (c.kind === 'small') {
      parts.push('custom logo');
    } else {
      parts.push('custom logo print');
    }
    return { qty: qty, item: c.item, details: '(' + parts.join(', ') + ')' };
  }

  function buildOrders() {
    var r = rng(20260125);
    var out = [];
    for (var i = 0; i < TOTAL; i++) out.push(buildOrder(r));
    // Shuffle so the 1000 orders cycle in a randomized order.
    for (var j = out.length - 1; j > 0; j--) {
      var k = Math.floor(r() * (j + 1));
      var t = out[j]; out[j] = out[k]; out[k] = t;
    }
    return out;
  }

  var orders = buildOrders();

  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s.n === 'number') return s; } catch (e) {}
    return { n: 0, muted: false };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  var state = load();

  // Soft two-note chime; browsers only allow audio after a user gesture, so it arms on first interaction.
  var audioCtx = null;
  function armAudio() {
    if (audioCtx) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, armAudio, { once: true, passive: true });
  });

  function chime() {
    if (state.muted || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var now = audioCtx.currentTime;
      [880, 1318.5].forEach(function (f, i) {
        var o = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.04, now + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.45);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now + i * 0.12);
        o.stop(now + i * 0.12 + 0.5);
      });
    } catch (e) {}
  }

  var css = document.createElement('style');
  css.textContent =
    '#mjic-live-ticker{position:fixed;left:16px;bottom:16px;z-index:2147483000;max-width:340px;display:flex;gap:10px;align-items:flex-start;' +
    'background:#fff;color:#0f1b3d;border:1px solid rgba(15,27,61,.12);border-left:4px solid #10b981;border-radius:10px;padding:10px 12px;' +
    'box-shadow:0 8px 24px rgba(15,27,61,.18);font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'opacity:0;transform:translateY(14px);pointer-events:none;transition:opacity .35s ease,transform .35s ease}' +
    '#mjic-live-ticker.show{opacity:1;transform:none;pointer-events:auto}' +
    '#mjic-live-ticker .mjt-tag{display:block;margin-top:3px;font-size:10px;font-weight:700;letter-spacing:.08em;color:#059669}' +
    '#mjic-live-ticker button{background:none;border:0;cursor:pointer;color:#64748b;font-size:14px;line-height:1;padding:2px}' +
    '#mjic-live-ticker button:hover{color:#0f1b3d}' +
    '@media(max-width:480px){#mjic-live-ticker{left:8px;right:8px;max-width:none;bottom:8px}}' +
    '@media print{#mjic-live-ticker{display:none!important}}';
  document.head.appendChild(css);

  var box = document.createElement('div');
  box.id = 'mjic-live-ticker';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  var text = document.createElement('div');
  text.style.flex = '1';
  var msg = document.createElement('span');
  var tag = document.createElement('span');
  tag.className = 'mjt-tag';
  tag.textContent = '\u25CF JUST NOW';
  text.appendChild(msg); text.appendChild(tag);
  var mute = document.createElement('button');
  mute.type = 'button';
  var close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '\u2715';
  box.appendChild(text); box.appendChild(mute); box.appendChild(close);
  document.body.appendChild(box);

  function paintMute() {
    mute.textContent = state.muted ? '\uD83D\uDD07' : '\uD83D\uDD14';
    mute.setAttribute('aria-label', state.muted ? 'Unmute notification sound' : 'Mute notification sound');
  }
  paintMute();
  mute.addEventListener('click', function () { armAudio(); state.muted = !state.muted; save(); paintMute(); });

  var hideTimer = null;
  close.addEventListener('click', function () { box.classList.remove('show'); });

  function showNext() {
    var o = orders[state.n % TOTAL];
    var id = START_ID + state.n;
    state.n += 1;
    save();
    msg.textContent = 'Client ' + id + ' ordered ' + o.qty.toLocaleString('en-US') + ' ' + o.item + ' ' + o.details;
    box.classList.add('show');
    chime();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { box.classList.remove('show'); }, SHOW_MS);
    schedule(MIN_MS + Math.random() * (MAX_MS - MIN_MS));
  }

  function schedule(ms) { setTimeout(showNext, ms); }
  schedule(FIRST_DELAY_MS);
})();
