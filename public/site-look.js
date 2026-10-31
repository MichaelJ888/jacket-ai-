/*
 * Site look & feel: Light/Dark mode, background color, background image with opacity fade,
 * and CSS scroll-driven section reveals. Pure CSS + ~4 KB JS; no per-frame loops.
 * Loaded synchronously in <head> so the saved theme applies before first paint.
 */
(function () {
  'use strict';
  var KEY = 'mji_look_v1';
  var DEFAULTS = { mode: 'light', color: '', image: '', opacity: 15 };
  var cfg = DEFAULTS;
  try { cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { cfg = DEFAULTS; }

  var root = document.documentElement;
  var style = document.createElement('style');
  style.id = 'mji-look-css';
  style.textContent = [
    /* Scroll-driven section reveal (Chromium/Edge/Safari 26+; other browsers simply skip it) */
    '@keyframes mjiRise{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}',
    '@supports (animation-timeline:view()){section{animation:mjiRise linear both;animation-timeline:view();animation-range:entry 0% entry 30%;}}',
    '@media (prefers-reduced-motion:reduce){section{animation:none!important}}',

    /* Dark mode: remaps the Tailwind palette classes used site-wide */
    'html.dark body{background-color:#0A1426;color:#D7E0EE}',
    'html.dark .bg-white{background-color:#0F1C33!important}',
    'html.dark .bg-navy-50,html.dark .bg-navy-50\\/60{background-color:#13223D!important}',
    'html.dark .text-navy,html.dark .text-navy-700{color:#E6EDF8!important}',
    'html.dark .text-navy-400{color:#9FB2CE!important}',
    'html.dark .hairline{border-color:rgba(160,185,220,.22)!important}',
    'html.dark .border-navy{border-color:#7F97BA!important}',
    'html.dark .bg-gold.text-navy,html.dark .bg-gold .text-navy{color:#0B1E3D!important}',
    'html.dark input,html.dark select,html.dark textarea{background-color:#0C182C!important;color:#E6EDF8!important;border-color:rgba(160,185,220,.3)!important}',
    'html.dark section[style*="background-image"]{background-image:linear-gradient(rgba(10,20,38,.94),rgba(10,20,38,.94)),url(/images/sports/nba-3.svg)!important}',

    /* Custom background color (applies to light surfaces only; navy brand sections keep their color) */
    'html.mji-custom-bg .bg-white,html.mji-custom-bg .bg-navy-50,html.mji-custom-bg .bg-navy-50\\/60{background-color:var(--mji-bg-color)!important}',

    /* Background image with fade: fixed layer behind content, opacity controlled by slider */
    'html.mji-has-img .bg-white,html.mji-has-img .bg-navy-50,html.mji-has-img .bg-navy-50\\/60{background-color:transparent!important}',
    'html.mji-has-img::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:var(--mji-bg-image) center/cover no-repeat fixed;opacity:var(--mji-bg-opacity)}',

    /* Floating Look & feel control */
    '#mji-look-btn{position:fixed;left:16px;bottom:16px;z-index:60;display:flex;align-items:center;gap:6px;padding:10px 14px;border-radius:999px;background:#0B1E3D;color:#E0A458;font:600 13px Inter,sans-serif;box-shadow:0 8px 24px rgba(11,30,61,.35);border:0;cursor:pointer;transition:transform .2s}',
    '#mji-look-btn:hover{transform:translateY(-2px)}',
    '#mji-look-panel{position:fixed;left:16px;bottom:64px;z-index:61;width:min(320px,calc(100vw - 32px));background:#fff;color:#0B1E3D;border:1px solid rgba(11,30,61,.15);border-radius:14px;box-shadow:0 18px 50px rgba(11,30,61,.25);padding:16px;font:500 13px Inter,sans-serif}',
    'html.dark #mji-look-panel{background:#0F1C33;color:#E6EDF8;border-color:rgba(160,185,220,.25)}',
    '#mji-look-panel .row{margin-top:12px}',
    '#mji-look-panel label.t{display:block;font-size:11px;font-weight:600;opacity:.7;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}',
    '#mji-look-panel button{font:600 12px Inter,sans-serif;border:1px solid rgba(11,30,61,.25);border-radius:8px;padding:7px 12px;background:transparent;color:inherit;cursor:pointer}',
    '#mji-look-panel button[aria-pressed="true"]{background:#0B1E3D;color:#E0A458;border-color:#0B1E3D}',
    '#mji-look-panel select,#mji-look-panel input[type=color]{width:100%;border:1px solid rgba(11,30,61,.25);border-radius:8px;padding:6px 8px;font:500 13px Inter,sans-serif;background:#fff;color:#0B1E3D}',
    '#mji-look-panel input[type=range]{width:100%}'
  ].join('\n');
  (document.head || root).appendChild(style);

  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked: keep in-memory */ } }

  function apply() {
    root.classList.toggle('dark', cfg.mode === 'dark');
    root.classList.toggle('mji-custom-bg', !!(cfg.color || cfg.image));
    root.classList.toggle('mji-has-img', !!cfg.image);
    root.style.setProperty('--mji-bg-color', cfg.color || '#FFFFFF');
    root.style.setProperty('--mji-bg-image', cfg.image ? 'url("' + cfg.image.replace(/"/g, '%22') + '")' : 'none');
    root.style.setProperty('--mji-bg-opacity', String(cfg.opacity / 100));
    var btns = document.querySelectorAll('[data-mji-mode]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-mji-mode') === cfg.mode));
  }

  function el(tag, props, text) {
    var n = document.createElement(tag);
    if (props) for (var k in props) { if (k === 'on') n.addEventListener(props.on[0], props.on[1]); else n.setAttribute(k, props[k]); }
    if (text) n.textContent = text;
    return n;
  }

  var panel = null;
  var libLoaded = false;

  function loadLibrary(select) {
    if (libLoaded) return;
    libLoaded = true;
    fetch('/image-library.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (lib) {
        (lib.items || []).forEach(function (it) {
          select.appendChild(el('option', { value: it.src }, it.label));
        });
        select.value = cfg.image;
      })
      .catch(function () { /* library optional */ });
  }

  function buildPanel() {
    var btn = el('button', { id: 'mji-look-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'mji-look-panel' }, 'Look & Feel');
    panel = el('div', { id: 'mji-look-panel', hidden: '' });

    var head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center' });
    head.appendChild(el('strong', null, 'Look & Feel'));
    var close = el('button', { type: 'button', 'aria-label': 'Close' }, '✕');
    head.appendChild(close);
    panel.appendChild(head);

    var modeRow = el('div', { class: 'row' });
    modeRow.appendChild(el('label', { class: 't' }, 'Theme mode'));
    var light = el('button', { type: 'button', 'data-mji-mode': 'light' }, 'Light');
    var dark = el('button', { type: 'button', 'data-mji-mode': 'dark' }, 'Dark');
    modeRow.appendChild(light); modeRow.appendChild(document.createTextNode(' ')); modeRow.appendChild(dark);
    panel.appendChild(modeRow);

    var colorRow = el('div', { class: 'row' });
    colorRow.appendChild(el('label', { class: 't' }, 'Background color'));
    var color = el('input', { type: 'color', value: cfg.color || '#ffffff', 'aria-label': 'Background color' });
    var colorReset = el('button', { type: 'button', style: 'margin-top:6px' }, 'Reset color');
    colorRow.appendChild(color); colorRow.appendChild(colorReset);
    panel.appendChild(colorRow);

    var imgRow = el('div', { class: 'row' });
    imgRow.appendChild(el('label', { class: 't' }, 'Background image'));
    var select = el('select', { 'aria-label': 'Background image' });
    select.appendChild(el('option', { value: '' }, 'No image'));
    imgRow.appendChild(select);
    panel.appendChild(imgRow);

    var opRow = el('div', { class: 'row' });
    var opLabel = el('label', { class: 't' }, 'Image opacity (fade): ' + cfg.opacity + '%');
    var opacity = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(cfg.opacity), 'aria-label': 'Image opacity' });
    opRow.appendChild(opLabel); opRow.appendChild(opacity);
    panel.appendChild(opRow);

    var resetAll = el('button', { type: 'button', style: 'margin-top:14px;width:100%' }, 'Reset to defaults');
    panel.appendChild(resetAll);

    document.body.appendChild(panel);
    document.body.appendChild(btn);

    btn.addEventListener('click', function () {
      var open = panel.hasAttribute('hidden');
      if (open) { panel.removeAttribute('hidden'); loadLibrary(select); } else { panel.setAttribute('hidden', ''); }
      btn.setAttribute('aria-expanded', String(open));
    });
    close.addEventListener('click', function () { panel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); });
    light.setAttribute('data-mji-mode', 'light'); dark.setAttribute('data-mji-mode', 'dark');
    [light, dark].forEach(function (b) {
      b.addEventListener('click', function () { cfg.mode = b.getAttribute('data-mji-mode'); save(); apply(); });
    });
    color.addEventListener('input', function () { cfg.color = color.value; save(); apply(); });
    colorReset.addEventListener('click', function () { cfg.color = ''; color.value = '#ffffff'; save(); apply(); });
    select.addEventListener('change', function () { cfg.image = select.value; save(); apply(); });
    opacity.addEventListener('input', function () {
      cfg.opacity = Number(opacity.value); opLabel.textContent = 'Image opacity (fade): ' + cfg.opacity + '%';
      save(); apply();
    });
    resetAll.addEventListener('click', function () {
      cfg = Object.assign({}, DEFAULTS); color.value = '#ffffff'; select.value = ''; opacity.value = String(cfg.opacity);
      opLabel.textContent = 'Image opacity (fade): ' + cfg.opacity + '%';
      save(); apply();
    });
    apply();
  }

  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
