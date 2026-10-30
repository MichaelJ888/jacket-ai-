(function () {
  'use strict';

  var EDITOR = new URLSearchParams(location.search).get('cms') === 'editor';
  var IN_FRAME = window.parent !== window;
  var POLL_MS = 20000;
  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  var DEFAULT_THEME = { primary: '#0B1E3D', secondary: '#B8912F', background: '#FFFFFF' };
  var TEXT_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,span,a,li,label,figcaption,strong,em,small,blockquote,td,th,dt,dd';
  var CARD_SELECTOR = '#catalog > div.grid > div[data-cms-card]';
  var doc = null;
  var lastJson = '';
  var scheduled = false;
  var dragged = null;

  function stampCards() {
    var cards = document.querySelectorAll('#catalog > div.grid > div');
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].querySelector('h3');
      if (h && !cards[i].hasAttribute('data-cms-card')) cards[i].setAttribute('data-cms-card', h.textContent.trim());
    }
  }

  // Stable key: nearest card or #id anchor, then tag:index steps. Must match between visitor and editor DOM.
  function pathKey(el) {
    var segs = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (node.hasAttribute('data-cms-card')) { segs.unshift('card:' + node.getAttribute('data-cms-card')); break; }
      if (node.id) { segs.unshift('#' + node.id); break; }
      var parent = node.parentElement;
      if (!parent) break;
      var idx = 0;
      for (var j = 0; j < parent.children.length && parent.children[j] !== node; j++) {
        if (parent.children[j].tagName === node.tagName) idx++;
      }
      segs.unshift(node.tagName.toLowerCase() + ':' + idx);
      node = parent;
    }
    return segs.join('/');
  }

  function isTextCandidate(el) {
    if (el.children.length) return false;
    if (!el.textContent.trim()) return false;
    return !el.closest('script,style,noscript,[data-cms-ignore],button,input,textarea,select');
  }

  function textCandidates() {
    var nodes = document.querySelectorAll(TEXT_SELECTOR);
    var out = [];
    for (var i = 0; i < nodes.length; i++) if (isTextCandidate(nodes[i])) out.push(nodes[i]);
    return out;
  }

  function applyTheme(theme) {
    var p = theme.primary, s = theme.secondary, b = theme.background;
    var css = '';
    if (p !== DEFAULT_THEME.primary) {
      css += '[class~="bg-navy"]{background-color:' + p + ' !important}[class~="text-navy"]{color:' + p + ' !important}[class~="border-navy"]{border-color:' + p + ' !important}';
    }
    if (s !== DEFAULT_THEME.secondary) {
      css += '[class~="bg-gold"]{background-color:' + s + ' !important}[class~="text-gold"],[class~="text-gold-600"]{color:' + s + ' !important}[class~="border-gold"]{border-color:' + s + ' !important}';
    }
    if (b !== DEFAULT_THEME.background) {
      css += 'body,[class~="bg-white"]{background-color:' + b + ' !important}';
    }
    var style = document.getElementById('mjic-cms-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'mjic-cms-theme';
      document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }

  function applyOrder(order) {
    var cards = document.querySelectorAll(CARD_SELECTOR);
    for (var i = 0; i < cards.length; i++) {
      var idx = order.indexOf(cards[i].getAttribute('data-cms-card'));
      var value = idx < 0 ? String(order.length + i) : String(idx);
      if (cards[i].style.order !== value) cards[i].style.order = value;
    }
  }

  function decorateEditor() {
    var texts = textCandidates();
    for (var i = 0; i < texts.length; i++) {
      if (texts[i].getAttribute('contenteditable') !== 'true') texts[i].setAttribute('contenteditable', 'true');
    }
    var cards = document.querySelectorAll('#catalog > div.grid > div[data-cms-card]');
    for (var j = 0; j < cards.length; j++) cards[j].setAttribute('draggable', 'true');
  }

  function apply() {
    stampCards();
    if (doc) {
      var active = document.activeElement;
      applyTheme(doc.theme || DEFAULT_THEME);
      var byKey = {};
      var texts = textCandidates();
      for (var i = 0; i < texts.length; i++) byKey[pathKey(texts[i])] = texts[i];
      var textMap = doc.texts || {};
      Object.keys(textMap).forEach(function (key) {
        var el = byKey[key];
        if (el && el !== active && el.textContent !== textMap[key]) el.textContent = textMap[key];
      });
      var imageMap = doc.images || {};
      var imgs = document.querySelectorAll('img');
      for (var k = 0; k < imgs.length; k++) {
        var url = imageMap[pathKey(imgs[k])];
        if (url && imgs[k].getAttribute('src') !== url) imgs[k].setAttribute('src', url);
      }
      applyOrder(doc.catalogOrder || []);
    }
    if (EDITOR) decorateEditor();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; apply(); }, 60);
  }

  function emit(payload) {
    if (!IN_FRAME) return;
    payload.source = 'mjic-cms-frame';
    window.parent.postMessage(payload, location.origin);
  }

  function setDoc(next) {
    doc = next;
    doc.texts = doc.texts || {};
    doc.images = doc.images || {};
    doc.catalogOrder = doc.catalogOrder || [];
    apply();
  }

  function loadPublished() {
    if (document.visibilityState === 'hidden') return;
    fetch('/api/site', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (next) {
        if (!next) return;
        var json = JSON.stringify(next);
        if (json === lastJson) return;
        lastJson = json;
        setDoc(next);
      })
      .catch(function () {});
  }

  function pickImage(img) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (file.size > MAX_IMAGE_BYTES) { alert('Image must be 5 MB or smaller.'); return; }
      var form = new FormData();
      form.append('file', file);
      fetch('/api/admin/editor/media', { method: 'POST', body: form })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok) { alert(res.body.error || 'Upload failed'); return; }
          var key = pathKey(img);
          doc.images[key] = res.body.url;
          img.setAttribute('src', res.body.url);
          emit({ type: 'image', key: key, url: res.body.url });
        })
        .catch(function () { alert('Upload failed'); });
    };
    input.click();
  }

  function currentCards() {
    var cards = [].slice.call(document.querySelectorAll(CARD_SELECTOR));
    return cards.sort(function (a, b) { return (a.style.order | 0) - (b.style.order | 0); });
  }

  function cardAt(target) {
    return target && target.closest ? target.closest(CARD_SELECTOR) : null;
  }

  if (EDITOR) {
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!doc || !el || el.getAttribute('contenteditable') !== 'true') return;
      var key = pathKey(el);
      var value = el.textContent;
      doc.texts[key] = value;
      emit({ type: 'text', key: key, value: value });
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('contenteditable') === 'true') e.preventDefault();
    }, true);

    document.addEventListener('paste', function (e) {
      if (!e.target.getAttribute || e.target.getAttribute('contenteditable') !== 'true') return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    }, true);

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.tagName === 'IMG') { e.preventDefault(); e.stopPropagation(); pickImage(t); return; }
      if (t.closest && t.closest('a,button')) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    document.addEventListener('dragstart', function (e) {
      var card = cardAt(e.target);
      if (!card) return;
      dragged = card;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.getAttribute('data-cms-card'));
      card.style.opacity = '0.5';
    });

    document.addEventListener('dragover', function (e) {
      if (!dragged) return;
      var target = cardAt(e.target);
      if (!target || target === dragged) return;
      e.preventDefault();
      var rect = target.getBoundingClientRect();
      var after = (e.clientY - rect.top) / rect.height + (e.clientX - rect.left) / rect.width > 1;
      var list = currentCards().filter(function (c) { return c !== dragged; });
      var at = list.indexOf(target) + (after ? 1 : 0);
      list.splice(at, 0, dragged);
      list.forEach(function (c, i) { c.style.order = String(i); });
    });

    document.addEventListener('drop', function (e) { if (dragged) e.preventDefault(); });

    document.addEventListener('dragend', function () {
      if (!dragged) return;
      dragged.style.opacity = '';
      var keys = currentCards().map(function (c) { return c.getAttribute('data-cms-card'); });
      doc.catalogOrder = keys;
      dragged = null;
      emit({ type: 'order', catalogOrder: keys });
    });

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.source !== 'mjic-cms-editor') return;
      if (e.data.type === 'render' && e.data.doc) setDoc(e.data.doc);
    });
  }

  var observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  if (EDITOR) {
    emit({ type: 'ready' });
  } else {
    loadPublished();
    setInterval(loadPublished, POLL_MS);
  }
})();
