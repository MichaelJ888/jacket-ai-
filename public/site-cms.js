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
  var dragSection = null;
  var sectionDragging = false;
  var sectionSlots = null;
  var grip = null;
  var hovered = null;
  var drag = null;
  var gripFrame = 0;

  function sectionNodes() {
    return [].slice.call(document.body.children).filter(function (el) { return el.tagName === 'SECTION'; });
  }

  // Keys are taken from the original DOM order once, so later moves never change the keys of the text/images inside a section.
  function stampSections() {
    if (sectionSlots || !document.body) return;
    sectionSlots = [];
    var secs = sectionNodes();
    for (var i = 0; i < secs.length; i++) {
      if (!secs[i].hasAttribute('data-cms-section')) secs[i].setAttribute('data-cms-section', secs[i].id ? '#' + secs[i].id : 'section:' + i);
      var slot = document.createComment('cms-slot');
      secs[i].parentNode.insertBefore(slot, secs[i]);
      sectionSlots.push(slot);
    }
  }

  function applySectionOrder(order) {
    if (!sectionSlots || sectionDragging) return;
    var secs = sectionNodes();
    var byKey = {};
    for (var i = 0; i < secs.length; i++) byKey[secs[i].getAttribute('data-cms-section')] = secs[i];
    var target = [];
    var seen = {};
    for (var j = 0; j < order.length; j++) {
      var s = byKey[order[j]];
      if (s && !seen[order[j]]) { seen[order[j]] = true; target.push(s); }
    }
    for (var k = 0; k < secs.length; k++) {
      if (!seen[secs[k].getAttribute('data-cms-section')]) target.push(secs[k]);
    }
    var same = true;
    for (var m = 0; m < secs.length; m++) if (secs[m] !== target[m]) { same = false; break; }
    if (same) return;
    for (var n = 0; n < target.length && n < sectionSlots.length; n++) {
      if (sectionSlots[n].parentNode) sectionSlots[n].parentNode.insertBefore(target[n], sectionSlots[n]);
    }
  }

  function decorateSections() {
    var secs = sectionNodes();
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].querySelector('[data-cms-handle]')) continue;
      if (getComputedStyle(secs[i]).position === 'static') secs[i].style.position = 'relative';
      var handle = document.createElement('div');
      handle.setAttribute('data-cms-ignore', '');
      handle.setAttribute('data-cms-handle', '');
      handle.setAttribute('draggable', 'true');
      handle.textContent = '\u2630 Move section';
      handle.style.cssText = 'position:absolute;top:8px;right:8px;z-index:60;background:#B8912F;color:#fff;font:600 12px/1 sans-serif;padding:6px 10px;border-radius:6px;cursor:grab;user-select:none;box-shadow:0 2px 6px rgba(0,0,0,.25)';
      secs[i].appendChild(handle);
    }
  }

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
      if (node.hasAttribute('data-cms-section')) { segs.unshift(node.getAttribute('data-cms-section')); break; }
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
    decorateSections();
  }

  // Offsets use translate (keeps Tailwind transforms intact); plain inline text uses relative offsets since translate ignores it.
  function placeEl(el, pos) {
    var x = pos ? pos.x : 0, y = pos ? pos.y : 0;
    if (!x && !y) { resetEl(el); return; }
    var tag = x + ',' + y;
    if (el.getAttribute('data-cms-moved') === tag) return;
    var cs = getComputedStyle(el);
    if (cs.display === 'inline' && cs.position === 'static') {
      el.style.position = 'relative';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.setAttribute('data-cms-rel', '');
    } else {
      el.style.translate = x + 'px ' + y + 'px';
    }
    el.setAttribute('data-cms-moved', tag);
  }

  function resetEl(el) {
    if (el.hasAttribute('data-cms-rel')) {
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.removeAttribute('data-cms-rel');
    }
    el.style.translate = '';
    el.removeAttribute('data-cms-moved');
  }

  function applyPositions(elementsByKey) {
    var positions = doc.positions || {};
    var active = drag ? drag.el : null;
    Object.keys(positions).forEach(function (key) {
      var el = elementsByKey[key];
      if (el && el !== active) placeEl(el, positions[key]);
    });
    var moved = document.querySelectorAll('[data-cms-moved]');
    for (var i = 0; i < moved.length; i++) {
      if (moved[i] === active) continue;
      if (!positions[pathKey(moved[i])]) resetEl(moved[i]);
    }
  }

  function apply() {
    stampCards();
    stampSections();
    if (doc) {
      var active = document.activeElement;
      applyTheme(doc.theme || DEFAULT_THEME);
      applySectionOrder(doc.sectionOrder || []);
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
        if (imgs[k].closest('[data-cms-skip]')) continue;
        var key = pathKey(imgs[k]);
        byKey[key] = imgs[k];
        var url = imageMap[key];
        if (url && imgs[k].getAttribute('src') !== url) imgs[k].setAttribute('src', url);
      }
      applyPositions(byKey);
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
    doc.sectionOrder = doc.sectionOrder || [];
    doc.positions = doc.positions || {};
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

  function setImage(img, url) {
    var key = pathKey(img);
    doc.images[key] = url;
    img.setAttribute('src', url);
    emit({ type: 'image', key: key, url: url });
  }

  var IMAGE_BUDGET = 200 * 1024;

  // Re-encodes oversized uploads to WebP (<= 200 KB) in the browser; falls back to the original file.
  function toBudgetWebp(file) {
    if (file.size <= IMAGE_BUDGET || file.type === 'image/gif') return Promise.resolve(file);
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        var scale = Math.min(1, 1600 / image.naturalWidth);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        var qualities = [0.82, 0.7, 0.58, 0.46];
        (function next(i) {
          if (i >= qualities.length) return resolve(file);
          canvas.toBlob(function (blob) {
            if (blob && blob.type === 'image/webp' && blob.size <= IMAGE_BUDGET) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' }));
            } else next(i + 1);
          }, 'image/webp', qualities[i]);
        })(0);
      };
      image.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      image.src = url;
    });
  }

  function uploadImage(img, file) {
    if (!file || file.type.indexOf('image/') !== 0) { alert('Please choose an image file.'); return; }
    if (file.size > MAX_IMAGE_BYTES) { alert('Image must be 5 MB or smaller.'); return; }
    toBudgetWebp(file).then(function (optimized) {
      var form = new FormData();
      form.append('file', optimized);
      return fetch('/api/admin/editor/media', { method: 'POST', body: form });
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { alert(res.body.error || 'Upload failed'); return; }
        setImage(img, res.body.url);
      })
      .catch(function () { alert('Upload failed'); });
  }

  var libraryItems = null;
  function loadLibrary() {
    if (libraryItems) return Promise.resolve(libraryItems);
    return fetch('/image-library.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (j) { libraryItems = j.items || []; return libraryItems; })
      .catch(function () { libraryItems = []; return libraryItems; });
  }

  // Pairs a slot with an existing local asset (or uploads a new file). Opened by clicking an image.
  function pickImage(img) {
    var overlay = document.createElement('div');
    overlay.setAttribute('data-cms-picker', '');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;font-family:sans-serif';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;color:#111;border-radius:12px;width:min(720px,100%);max-height:88vh;display:flex;flex-direction:column;overflow:hidden';
    panel.innerHTML = '<div style="display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid #e5e7eb;flex-wrap:wrap">' +
      '<strong style="font-size:15px">Choose image for this slot</strong>' +
      '<input data-role="search" placeholder="Search local images" style="flex:1;min-width:160px;border:1px solid #d4d4d8;border-radius:6px;padding:6px 8px;font-size:13px">' +
      '<label style="font-size:13px;background:#0f172a;color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer">Upload new<input type="file" accept="image/*" style="display:none" data-role="upload"></label>' +
      '<button type="button" data-role="close" style="font-size:13px;border:1px solid #d4d4d8;border-radius:6px;padding:6px 10px;background:#fff;cursor:pointer">Close</button>' +
      '</div><div data-role="grid" style="overflow:auto;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;font-size:12px">Loading…</div>';
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    panel.querySelector('[data-role="close"]').onclick = close;
    panel.querySelector('[data-role="upload"]').onchange = function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) { close(); uploadImage(img, file); }
    };

    var grid = panel.querySelector('[data-role="grid"]');
    function render(items, query) {
      grid.innerHTML = '';
      var q = (query || '').toLowerCase();
      items.filter(function (item) { return !q || item.label.toLowerCase().indexOf(q) !== -1; }).forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.title = item.label;
        b.style.cssText = 'border:1px solid #e4e4e7;border-radius:8px;padding:4px;background:#fafafa;cursor:pointer;text-align:left;overflow:hidden';
        b.innerHTML = '<img loading="lazy" src="' + item.src + '" alt="" style="width:100%;height:90px;object-fit:cover;border-radius:4px;display:block"><span style="display:block;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#52525b">' + item.label.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</span>';
        b.onclick = function () { close(); setImage(img, item.src); };
        grid.appendChild(b);
      });
      if (!items.length) grid.textContent = 'No local images found.';
    }
    loadLibrary().then(function (items) {
      render(items, '');
      panel.querySelector('[data-role="search"]').oninput = function (e) { render(items, e.target.value); };
    });
  }

  // Dropping an image file onto a slot replaces it directly.
  function hasFiles(e) {
    return !!(e.dataTransfer && e.dataTransfer.types && [].indexOf.call(e.dataTransfer.types, 'Files') !== -1);
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
      var handle = e.target.closest && e.target.closest('[data-cms-handle]');
      if (handle && handle.parentElement) {
        dragSection = handle.parentElement;
        sectionDragging = true;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragSection.getAttribute('data-cms-section'));
        dragSection.style.opacity = '0.6';
        return;
      }
      var card = cardAt(e.target);
      if (!card) return;
      dragged = card;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.getAttribute('data-cms-card'));
      card.style.opacity = '0.5';
    });

    document.addEventListener('dragover', function (e) {
      if (dragSection) {
        var over = e.target.closest && e.target.closest('body > section');
        if (!over || over === dragSection) return;
        e.preventDefault();
        var box = over.getBoundingClientRect();
        var before = e.clientY < box.top + box.height / 2;
        if (before) over.parentNode.insertBefore(dragSection, over);
        else over.parentNode.insertBefore(dragSection, over.nextSibling);
        return;
      }
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

    document.addEventListener('drop', function (e) { if (dragged || dragSection) e.preventDefault(); });

    document.addEventListener('dragover', function (e) {
      if (dragged || dragSection || !hasFiles(e)) return;
      e.preventDefault();
      if (e.target.closest && e.target.closest('img')) e.dataTransfer.dropEffect = 'copy';
    });

    document.addEventListener('drop', function (e) {
      if (dragged || dragSection || !hasFiles(e)) return;
      e.preventDefault();
      var img = e.target.closest && e.target.closest('img');
      if (img) uploadImage(img, e.dataTransfer.files[0]);
    });

    document.addEventListener('dragend', function () {
      if (dragSection) {
        dragSection.style.opacity = '';
        var order = sectionNodes().map(function (s) { return s.getAttribute('data-cms-section'); });
        dragSection = null;
        sectionDragging = false;
        if (doc) doc.sectionOrder = order;
        emit({ type: 'sections', sectionOrder: order });
        return;
      }
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

    setupFreeDrag();
  }

  // One shared grip follows the hovered text/image, so no per-element DOM is added.
  function candidateAt(target) {
    if (!target || !target.closest) return null;
    if (target.closest('[data-cms-ignore],[data-cms-skip],[data-cms-handle]')) return null;
    if (target.tagName === 'IMG') return target;
    var el = target.closest(TEXT_SELECTOR);
    return el && isTextCandidate(el) ? el : null;
  }

  function placeGrip() {
    if (!hovered || !hovered.isConnected) { grip.style.display = 'none'; hovered = null; return; }
    var r = hovered.getBoundingClientRect();
    grip.style.display = 'block';
    grip.style.transform = 'translate3d(' + Math.max(0, r.left - 10) + 'px,' + Math.max(0, r.top - 10) + 'px,0)';
  }

  function queueGrip() {
    if (gripFrame) return;
    gripFrame = requestAnimationFrame(function () { gripFrame = 0; placeGrip(); });
  }

  function onGripMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = Math.round(drag.bx + e.clientX - drag.sx);
    drag.y = Math.round(drag.by + e.clientY - drag.sy);
    if (!drag.frame) drag.frame = requestAnimationFrame(flushDrag);
  }

  function flushDrag() {
    if (!drag) return;
    drag.frame = 0;
    placeEl(drag.el, { x: drag.x, y: drag.y });
    queueGrip();
  }

  function onGripUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (d.frame) cancelAnimationFrame(d.frame);
    grip.removeEventListener('pointermove', onGripMove);
    grip.removeEventListener('pointerup', onGripUp);
    grip.removeEventListener('pointercancel', onGripUp);
    document.body.style.userSelect = '';
    if (d.x === d.bx && d.y === d.by) return;
    if (!doc) return;
    if (!doc.positions) doc.positions = {};
    if (d.x === 0 && d.y === 0) delete doc.positions[d.key];
    else doc.positions[d.key] = { x: d.x, y: d.y };
    emit({ type: 'position', key: d.key, x: d.x, y: d.y });
  }

  function onGripDown(e) {
    if (e.button !== 0 || !hovered || drag) return;
    e.preventDefault();
    var current = (doc && doc.positions && doc.positions[pathKey(hovered)]) || { x: 0, y: 0 };
    drag = { el: hovered, key: pathKey(hovered), id: e.pointerId, sx: e.clientX, sy: e.clientY, bx: current.x, by: current.y, x: current.x, y: current.y, frame: 0 };
    grip.setPointerCapture(e.pointerId);
    grip.addEventListener('pointermove', onGripMove, { passive: true });
    grip.addEventListener('pointerup', onGripUp);
    grip.addEventListener('pointercancel', onGripUp);
    document.body.style.userSelect = 'none';
  }

  function setupFreeDrag() {
    grip = document.createElement('div');
    grip.setAttribute('data-cms-ignore', '');
    grip.title = 'Drag to move';
    grip.textContent = '\u2725';
    grip.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;display:none;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:#B8912F;color:#fff;font:700 13px/22px sans-serif;cursor:move;user-select:none;touch-action:none;box-shadow:0 2px 6px rgba(0,0,0,.3)';
    grip.addEventListener('pointerdown', onGripDown);
    document.body.appendChild(grip);

    document.addEventListener('pointerover', function (e) {
      if (drag) return;
      var el = candidateAt(e.target);
      if (!el || el === hovered) return;
      hovered = el;
      queueGrip();
    }, { capture: true, passive: true });

    window.addEventListener('scroll', function () { if (hovered) queueGrip(); }, { passive: true });
  }


  var observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  stampSections();
  if (EDITOR) {
    emit({ type: 'ready' });
  } else {
    loadPublished();
    setInterval(loadPublished, POLL_MS);
  }
})();
