/* Interactive world map: rendering, pan / zoom / pinch, picking and answer reveal. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = window.WORLD;
  const svg = document.getElementById('map');
  const wrap = document.getElementById('map-wrap');
  const byId = new Map(W.countries.map((c) => [c.id, c]));
  const nodes = new Map(); // id -> { path, dot }

  const LAND = ['#f6d58e', '#b9e3a1', '#f7b9a8', '#cdbdf2', '#a9dde0', '#f9cf8c', '#d9e8a3', '#f3c4de'];
  const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

  const full = { x: -10, y: -10, w: W.w + 20, h: W.h + 20 };
  let vb = { ...full };
  let locked = true;
  let onPick = null;
  let anim = null;

  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ---------- Render ---------- */
  const defs = el('defs', {}, svg);
  defs.innerHTML = `
    <radialGradient id="ocean" cx=".5" cy=".45" r=".7">
      <stop offset="0" stop-color="#2a6fb8"/><stop offset=".7" stop-color="#174d8f"/><stop offset="1" stop-color="#0f3466"/>
    </radialGradient>
    <filter id="landshadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#00112a" flood-opacity=".55"/>
    </filter>`;
  el('path', { d: W.outline, class: 'sphere', 'vector-effect': 'non-scaling-stroke', 'stroke-width': 1.5 }, svg);
  el('path', { d: W.graticule, class: 'graticule', 'vector-effect': 'non-scaling-stroke', 'stroke-width': 0.7 }, svg);
  const land = el('g', { filter: 'url(#landshadow)' }, svg);
  const dotLayer = el('g', {}, svg);
  const fxLayer = el('g', {}, svg);
  const labelLayer = el('g', {}, svg);

  for (const c of W.countries) {
    const fill = c.fame ? LAND[hash(c.id) % LAND.length] : '#c7d0dc';
    const p = el('path', {
      d: c.d, class: 'country' + (c.fame ? '' : ' np'), fill, 'data-id': c.id,
      'vector-effect': 'non-scaling-stroke', 'stroke-width': 0.6,
    }, land);
    const n = { path: p, dot: null };
    // Clickable dots only for tiny countries that can be an answer (territories get none).
    if (c.small && c.fame) {
      n.dot = el('circle', { cx: c.c[0], cy: c.c[1], r: 2, class: 'dot', 'data-id': c.id, 'vector-effect': 'non-scaling-stroke', 'stroke-width': 1 }, dotLayer);
    }
    nodes.set(c.id, n);
  }

  /* ---------- View box handling ---------- */
  function unitsPerPx() {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return vb.w / 1000;
    return Math.max(vb.w / r.width, vb.h / r.height);
  }
  function clampVB(v) {
    const minW = W.w / 60;
    const maxW = full.w * 1.05;
    const k = Math.min(Math.max(v.w, minW), maxW) / v.w;
    let w = v.w * k, h = v.h * k;
    let cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    cx = Math.min(Math.max(cx, 0), W.w);
    cy = Math.min(Math.max(cy, 0), W.h);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  function apply() {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const u = unitsPerPx();
    nodes.forEach((n) => { if (n.dot) n.dot.setAttribute('r', 4 * u); });
    labelLayer.querySelectorAll('text').forEach((t) => {
      t.setAttribute('font-size', 15 * u);
      t.setAttribute('stroke-width', 4 * u);
    });
    fxLayer.querySelectorAll('.ping').forEach((c) => c.setAttribute('stroke-width', 3 * u));
    fxLayer.querySelectorAll('.citypin').forEach((c) => { c.setAttribute('r', 6 * u); c.setAttribute('stroke-width', 2.5 * u); });
  }
  function setVB(v) { vb = clampVB(v); apply(); }

  // Make the viewBox match the container's aspect ratio so pan/zoom math stays simple.
  function fitAspect(v) {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return v;
    const ar = r.width / r.height;
    let { x, y, w, h } = v;
    if (w / h > ar) { const nh = w / ar; y -= (nh - h) / 2; h = nh; }
    else { const nw = h * ar; x -= (nw - w) / 2; w = nw; }
    return { x, y, w, h };
  }

  function animateTo(target, ms = 700) {
    cancelAnimationFrame(anim);
    const from = { ...vb };
    const to = clampVB(fitAspect(target));
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    return new Promise((res) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = ease(t);
        vb = {
          x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e,
          w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e,
        };
        apply();
        if (t < 1) anim = requestAnimationFrame(step); else res();
      };
      anim = requestAnimationFrame(step);
    });
  }

  function reset(animated = false) {
    const target = fitAspect(full);
    if (animated) return animateTo(full, 600);
    cancelAnimationFrame(anim);
    vb = target; apply();
  }

  function toSvg(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return { x: vb.x + ((clientX - r.left) / r.width) * vb.w, y: vb.y + ((clientY - r.top) / r.height) * vb.h };
  }
  function zoomAt(clientX, clientY, k) {
    cancelAnimationFrame(anim);
    const p = toSvg(clientX, clientY);
    const nw = vb.w / k, nh = vb.h / k;
    const minW = W.w / 60, maxW = full.w * 1.05 * Math.max(1, vb.w / vb.h / (full.w / full.h));
    if ((k > 1 && vb.w <= minW) || (k < 1 && vb.w >= maxW)) return;
    setVB({ x: p.x - (p.x - vb.x) / k, y: p.y - (p.y - vb.y) / k, w: nw, h: nh });
  }

  /* ---------- Input: wheel, drag, pinch, click ---------- */
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
    zoomAt(e.clientX, e.clientY, k);
  }, { passive: false });

  const pointers = new Map();
  let drag = null;
  let pinch = null;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      drag = { sx: e.clientX, sy: e.clientY, vb: { ...vb }, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      if (drag) drag.moved = true;
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      hover(e);
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
      pinch.d = d;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; svg.classList.add('dragging'); }
    if (drag.moved) {
      cancelAnimationFrame(anim);
      const r = svg.getBoundingClientRect();
      setVB({ ...drag.vb, x: drag.vb.x - (dx / r.width) * drag.vb.w, y: drag.vb.y - (dy / r.height) * drag.vb.h });
    }
  });
  function endPointer(e) {
    const wasDrag = drag && drag.moved;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      svg.classList.remove('dragging');
      if (drag && !wasDrag && e.type === 'pointerup') pick(e.clientX, e.clientY);
      drag = null;
    } else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      drag = { sx: p.x, sy: p.y, vb: { ...vb }, moved: true };
    }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  let hovered = null;
  function hover(e) {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const id = t && t.getAttribute && t.getAttribute('data-id');
    const n = id && !locked ? nodes.get(id) : null;
    if (hovered && hovered !== n) { hovered.path.classList.remove('hover'); hovered.dot && hovered.dot.classList.remove('hover'); }
    hovered = n;
    if (n) { n.path.classList.add('hover'); }
  }
  svg.addEventListener('pointerleave', () => { if (hovered) hovered.path.classList.remove('hover'); hovered = null; });

  function pick(x, y) {
    if (locked) return;
    const stack = document.elementsFromPoint(x, y);
    let t = stack[0];
    let onDot = t && t.classList && t.classList.contains('dot');
    if (onDot) {
      // A dot only wins near its centre; on its rim, prefer the country outline underneath
      // (e.g. Luxembourg's dot overlaps Belgium at world zoom).
      const r = t.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      const under = stack.find((e) => e.classList && e.classList.contains('country'));
      if (d > r.width * 0.3 && under) { t = under; onDot = false; }
    }
    let id = t && t.getAttribute && t.getAttribute('data-id');
    // Over the ocean or on a dot: choose the nearest dot centre (dots overlap where islands cluster).
    if (!id || onDot) {
      // Generous hit test for tiny nations: nearest dot within 14px.
      const u = unitsPerPx();
      const p = toSvg(x, y);
      let best = onDot ? id : null, bd = 14 * u;
      nodes.forEach((n, nid) => {
        if (!n.dot) return;
        const c = byId.get(nid).c;
        const d = Math.hypot(c[0] - p.x, c[1] - p.y);
        if (d < bd) { bd = d; best = nid; }
      });
      id = best;
    }
    // Only countries in the game's database (name + flag + capital) can be picked; the ocean and
    // territories such as Greenland or New Caledonia are ignored.
    if (!id || !(byId.get(id) || {}).fame) return;
    if (onPick) onPick(id);
  }

  wrap.querySelectorAll('.map-controls button').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.zoom === 'in') animateTo({ x: vb.x + vb.w * 0.2, y: vb.y + vb.h * 0.2, w: vb.w * 0.6, h: vb.h * 0.6 }, 300);
      else if (b.dataset.zoom === 'out') animateTo({ x: vb.x - vb.w * 0.333, y: vb.y - vb.h * 0.333, w: vb.w * 1.666, h: vb.h * 1.666 }, 300);
      else reset(true);
    });
  });

  new ResizeObserver(() => { vb = clampVB(fitAspect(vb)); apply(); }).observe(svg);

  /* ---------- Answer reveal ---------- */
  function clearMarks() {
    nodes.forEach((n) => {
      n.path.classList.remove('correct', 'wrong', 'dim', 'hover', 'hinted');
      n.dot && n.dot.classList.remove('correct', 'wrong');
    });
    labelLayer.innerHTML = '';
    fxLayer.innerHTML = '';
  }
  function label(id) {
    const c = byId.get(id);
    const [x, y] = c.c;
    const t = el('text', { x, y: c.small ? y - 4 * unitsPerPx() * 2.5 : y, class: 'label' }, labelLayer);
    t.textContent = c.name;
    apply();
  }
  function bbox(id) {
    const c = byId.get(id);
    let [[x0, y0], [x1, y1]] = c.b;
    // Countries spanning the antimeridian / with far-flung islands: fall back to centroid area.
    if (x1 - x0 > W.w * 0.5) { x0 = c.c[0] - 60; x1 = c.c[0] + 60; }
    return { x0, y0, x1, y1 };
  }
  function focusBox(ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ids.forEach((id) => {
      const b = bbox(id);
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    });
    const pad = Math.max(30, (x1 - x0) * 0.35, (y1 - y0) * 0.35);
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  /** Reveal the answer. pin (optional): { p: [x, y], name } marks a city's real location. */
  async function reveal(correctId, clickedId, pin) {
    locked = true;
    svg.classList.add('locked');
    const ok = correctId === clickedId;
    const cn = nodes.get(correctId);
    cn.path.classList.add('correct');
    cn.dot && cn.dot.classList.add('correct');
    if (!ok && clickedId) {
      const wn = nodes.get(clickedId);
      wn.path.classList.add('wrong');
      wn.dot && wn.dot.classList.add('wrong');
    }
    const ids = clickedId && !ok ? [correctId, clickedId] : [correctId];
    // ping ring around the correct country
    const c = byId.get(correctId);
    const ring = el('circle', { cx: c.c[0], cy: c.c[1], r: 1, class: 'ping' }, fxLayer);
    const box = focusBox(ids);
    if (pin) {
      // make sure the city is inside the view too
      const [px, py] = pin.p;
      const x0 = Math.min(box.x, px - 20), y0 = Math.min(box.y, py - 20);
      box.w = Math.max(box.x + box.w, px + 20) - x0; box.h = Math.max(box.y + box.h, py + 20) - y0;
      box.x = x0; box.y = y0;
    }
    await animateTo(box, 900);
    ids.forEach(label);
    if (pin) {
      el('circle', { cx: pin.p[0], cy: pin.p[1], r: 1, class: 'citypin' }, fxLayer);
      const t = el('text', { x: pin.p[0], y: pin.p[1], class: 'label citylabel', dy: '-0.9em' }, labelLayer);
      t.textContent = '📍 ' + pin.name;
      apply();
    }
    const u = unitsPerPx();
    const t0 = performance.now();
    (function grow(now) {
      const t = ((now - t0) % 1400) / 1400;
      ring.setAttribute('r', (6 + t * 40) * u);
      ring.setAttribute('opacity', 1 - t);
      if (ring.isConnected) requestAnimationFrame(grow);
    })(t0);
  }

  function prepare(handler) {
    clearMarks();
    reset(false);
    onPick = handler;
    locked = false;
    svg.classList.remove('locked');
  }
  function lock() { locked = true; svg.classList.add('locked'); }

  /** Hint: dim every country outside the given set and zoom to it. */
  async function hint(ids) {
    const set = new Set(ids);
    nodes.forEach((n, id) => {
      const inside = set.has(id);
      n.path.classList.toggle('dim', !inside);
      n.path.classList.toggle('hinted', inside);
    });
    await animateTo(focusBox(ids), 800);
  }

  /** Mark a wrong pick without revealing the answer (the map stays clickable, e.g. for a steal). */
  function markWrong(id) {
    const n = nodes.get(id);
    if (!n) return;
    n.path.classList.add('wrong');
    n.dot && n.dot.classList.add('wrong');
  }

  /** Screen position of a country's marker (used to show where a bot clicks). */
  function centerOf(id) {
    const c = byId.get(id);
    const r = svg.getBoundingClientRect();
    return { x: r.left + ((c.c[0] - vb.x) / vb.w) * r.width, y: r.top + ((c.c[1] - vb.y) / vb.h) * r.height };
  }

  window.WorldMap = { prepare, reveal, lock, reset, hint, markWrong, centerOf, byId };
})();
