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
  let home = full; // the view of reset(): the whole world, or North America (setScope)
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
  const seaLayer = el('g', { class: 'phys-seas' }, svg); // physical map: seas & bays (seen only when lit up)
  const land = el('g', { filter: 'url(#landshadow)' }, svg);
  const physLayer = el('g', { class: 'phys-land' }, svg); // physical map: lowlands, ranges, lakes, rivers …
  const dotLayer = el('g', {}, svg);
  // Game overlay (route, ships …): drawn above the countries, never catches clicks.
  const overlay = el('g', { class: 'overlay', 'pointer-events': 'none' }, svg);
  const scaleListeners = [];
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

  /* US states, Canadian provinces & territories (data/regions.js, when the page loads it). They are drawn
   * over the USA and Canada and shown only when the game's scope includes them (setScope). */
  const REG = (window.REGIONS && window.REGIONS.regions) || [];
  const regionLayer = el('g', { class: 'regions' }, land);
  for (const r of REG) {
    byId.set(r.id, r);
    const p = el('path', {
      d: r.d, class: 'country region' + (r.fame ? '' : ' np'), fill: r.fame ? LAND[hash(r.id) % LAND.length] : '#c7d0dc', 'data-id': r.id,
      'vector-effect': 'non-scaling-stroke', 'stroke-width': 0.5,
    }, regionLayer);
    const n = { path: p, dot: null };
    if (r.small && r.fame) n.dot = el('circle', { cx: r.c[0], cy: r.c[1], r: 2, class: 'dot region-dot', 'data-id': r.id, 'vector-effect': 'non-scaling-stroke', 'stroke-width': 1 }, dotLayer);
    nodes.set(r.id, n);
  }
  /* Physical geography (data/physical.js, when the page loads it): mountain ranges, lowlands, rivers, lakes,
   * seas, bays, peninsulas and islands, for the blind map (scope 'phys'). Ranges, lowlands, lakes and rivers
   * are drawn; seas, bays, peninsulas and islands only show when lit up (the coastline is the clue). */
  const PHYS = (window.PHYSICAL && window.PHYSICAL.features) || [];
  const flatD = (g, closed) => g.map((a) => {
    let d = `M${a[0]} ${a[1]}`;
    for (let i = 2; i < a.length; i += 2) d += `L${a[i]} ${a[i + 1]}`;
    return closed ? d + 'Z' : d;
  }).join('');
  const PHYS_ORDER = ['lowland', 'range', 'peninsula', 'island', 'lake', 'river'];
  const physGroups = Object.fromEntries(PHYS_ORDER.map((t) => [t, el('g', { class: 'pg-' + t }, physLayer)]));
  for (const f of PHYS.slice().sort((a, b) => b.area - a.area)) { // big ones first, small ones on top
    byId.set(f.id, f);
    const line = f.type === 'river';
    const parent = f.type === 'sea' || f.type === 'bay' ? seaLayer : physGroups[f.type];
    const p = el('path', { d: flatD(f.g, !line), class: `pf pf-${f.type}`, 'vector-effect': 'non-scaling-stroke' }, parent);
    nodes.set(f.id, { path: p, dot: null, phys: 1 });
  }
  if (PHYS.length) wrap.insertAdjacentHTML('beforeend', '<div class="phys-legend" aria-hidden="true"><span><i style="background:#b9845a"></i>Mountains</span>'
    + '<span><i style="background:#a6d08a"></i>Lowlands</span><span><i style="background:#2b72bd"></i>Rivers &amp; lakes</span></div>');
  // A click on the physical map can fall on several features (an island in a sea, a range on a peninsula):
  // it is passed on as their ids joined by "~", the most likely meant first; a click on nothing named is "miss@x,y".
  const MISS = 'miss@';
  const baseGet = byId.get.bind(byId);
  byId.get = (k) => {
    const v = baseGet(k);
    if (v || typeof k !== 'string') return v;
    if (k.includes('~')) return baseGet(k.split('~')[0]);
    if (k.startsWith(MISS)) {
      const [x, y] = k.slice(MISS.length).split(',').map(Number);
      return { id: k, name: 'an empty spot', c: [x, y], b: [[x, y], [x, y]], miss: 1 };
    }
    return undefined;
  };
  const firstId = (id) => (typeof id === 'string' && id.includes('~') ? id.split('~')[0] : id);
  /** Is feature f (or a feature it is part of, e.g. the Adriatic in the Mediterranean) the answer? */
  const partOf = (f, answer, depth = 0) => !!f && (f.id === answer || (depth < 4 && (f.in || []).some((p) => partOf(baseGet(p), answer, depth + 1))));

  // 'world' (countries only) · 'world+na' (countries, with the USA and Canada split into states and provinces) · 'na' (only those)
  // · 'phys' (the blind physical map)
  let scope = 'world';
  const PARENTS = ['USA', 'CAN'];
  /** Can this place be an answer in the current scope? */
  function pickable(id) {
    if (scope === 'phys') return true;
    const c = byId.get(id);
    if (!c || !c.fame) return false;
    if (c.parent) return scope !== 'world';
    if (scope === 'na') return false;
    return !(scope !== 'world' && PARENTS.includes(id));
  }
  /** The shapes that stand for a place: the USA / Canada are their states and provinces when those are shown. */
  const nodesFor = (id) => (scope !== 'world' && scope !== 'phys' && PARENTS.includes(id) ? REG.filter((r) => r.parent === id).map((r) => nodes.get(r.id)) : [nodes.get(id)]).filter(Boolean);
  /** Is a click on `clicked` the right answer for `answer`? (A state counts for its country.) */
  const matches = (clicked, answer) => !!clicked && (clicked === answer || (typeof clicked === 'string' && clicked.includes('~')
    ? clicked.split('~').some((id) => partOf(baseGet(id), answer)) : (baseGet(clicked) || {}).parent === answer || partOf(baseGet(clicked), answer)));
  // Hint areas for states and provinces: the US census regions, and the parts of Canada.
  const AREA = {
    Northeast: 'CT ME MA NH RI VT NJ NY PA', Midwest: 'IL IN MI OH WI IA KS MN MO NE ND SD',
    South: 'DE FL GA MD NC SC VA WV AL KY MS TN AR LA OK TX', West: 'AZ CO ID MT NV NM UT WY AK CA HI OR WA',
    'Western Canada': 'BC AB SK MB', 'Central Canada': 'ON QC', 'Atlantic Canada': 'NB NS PE NL', 'Northern Canada': 'YT NT NU',
  };
  const areaOf = (r) => Object.keys(AREA).find((k) => AREA[k].split(' ').includes(r.id.slice(3)) && (k.includes('Canada') === (r.parent === 'CAN')));
  /** The places a "show the region" hint lights up for this answer, and the region's name. */
  function hintFor(id) {
    const c = byId.get(id);
    if (c && c.near) { // a physical feature: the countries of the part of the world it lies in
      const ids = W.countries.filter((x) => x.fame && x.region === c.region).map((x) => x.id);
      return { name: c.region, ids: ids.length ? ids : [c.near] };
    }
    if (c && c.parent) {
      const a = areaOf(c);
      return { name: a ? (a.includes('Canada') ? a : `the ${a} of the USA`) : (c.parent === 'USA' ? 'the USA' : 'Canada'), ids: REG.filter((r) => r.fame && areaOf(r) === a).map((r) => r.id) };
    }
    const ids = W.countries.filter((x) => x.fame && c && x.region === c.region).map((x) => x.id);
    return { name: c ? c.region : '', ids: ids.length > 1 ? ids : [id] };
  }
  function setScope(s) {
    scope = s === 'phys' && PHYS.length ? s : ['world', 'world+na', 'na'].includes(s) && REG.length ? s : 'world';
    svg.classList.toggle('phys', scope === 'phys');
    svg.classList.toggle('show-regions', scope !== 'world' && scope !== 'phys');
    svg.classList.toggle('na-only', scope === 'na');
    if (scope === 'na') { // North America, without Hawaii far out in the Pacific
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      REG.filter((r) => r.fame && r.id !== 'US-HI').forEach((r) => { const [[a, b], [c, d]] = r.mb || r.b; x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); });
      home = { x: x0 - 10, y: y0 - 6, w: x1 - x0 + 20, h: y1 - y0 + 12 };
    } else home = full;
    reset(false);
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
    fxLayer.querySelectorAll('.citypin, .misspin').forEach((c) => { c.setAttribute('r', 6 * u); c.setAttribute('stroke-width', 2.5 * u); });
    scaleListeners.forEach((fn) => fn(u));
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
        const t = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
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
    const target = fitAspect(home);
    if (animated) return animateTo(home, 600);
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
      if (drag && !wasDrag && e.type === 'pointerup') pick(e.clientX, e.clientY, e.pointerType);
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
    if (scope === 'phys') return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const id = t && t.getAttribute && t.getAttribute('data-id');
    const n = id && !locked ? nodes.get(id) : null;
    if (hovered && hovered !== n) { hovered.path.classList.remove('hover'); hovered.dot && hovered.dot.classList.remove('hover'); }
    hovered = n;
    if (n) { n.path.classList.add('hover'); }
  }
  svg.addEventListener('pointerleave', () => { if (hovered) hovered.path.classList.remove('hover'); hovered = null; });

  /* ---------- Physical map picking (geometry tests in map units) ---------- */
  function segDist(px, py, a) {
    let best = Infinity;
    for (let i = 2; i < a.length; i += 2) {
      const x1 = a[i - 2], y1 = a[i - 1], dx = a[i] - x1, dy = a[i + 1] - y1;
      const l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
      const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
      if (d < best) best = d;
    }
    return best;
  }
  function winding(px, py, a) { // non-zero winding number of a closed ring around the point
    let w = 0;
    for (let i = 0, n = a.length; i < n; i += 2) {
      const x1 = a[i], y1 = a[i + 1], j = (i + 2) % n, x2 = a[j], y2 = a[j + 1];
      if (y1 <= py) { if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) w++; }
      else if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) w--;
    }
    return w;
  }
  let expectType = null; // the type of feature the question asks for: preferred when a click falls on several
  function physPick(x, y, pointerType) {
    const touch = pointerType && pointerType !== 'mouse';
    const u = unitsPerPx();
    const p = toSvg(x, y);
    const reach = (touch ? 16 : 9) * u;
    const hits = [];
    for (const f of PHYS) {
      if (p.x < f.b[0][0] - reach || p.x > f.b[1][0] + reach || p.y < f.b[0][1] - reach || p.y > f.b[1][1] + reach) continue;
      let inside = false, d = Infinity;
      if (f.type === 'river') f.g.forEach((a) => { d = Math.min(d, segDist(p.x, p.y, a)); });
      else {
        inside = f.g.reduce((w, a) => w + winding(p.x, p.y, a), 0) !== 0;
        if (!inside) f.g.forEach((a) => { d = Math.min(d, segDist(p.x, p.y, a.concat(a[0], a[1]))); });
      }
      // rivers count within the reach; areas count inside, or near their edge (small islands and lakes)
      if (inside || d <= reach) hits.push({ f, inside, d });
    }
    if (!hits.length) return MISS + `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;
    // the most likely meant first: the asked-for type, then rivers & lakes (drawn on top), then the smallest area
    const rank = (h) => [h.f.type === expectType ? 0 : 1, h.f.type === 'river' || h.f.type === 'lake' ? 0 : 1, h.inside ? 0 : 1, h.inside ? h.f.area : h.d];
    hits.sort((a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]; return 0; });
    return hits.map((h) => h.f.id).join('~');
  }

  function pick(x, y, pointerType) {
    if (locked) return;
    if (scope === 'phys') { if (onPick) onPick(physPick(x, y, pointerType)); return; }
    // Tiny nations (Vatican City, San Marino, Liechtenstein, island states …) get an invisible hit
    // area larger than their dot, bigger for fingers than for a mouse. Inside a bigger country the
    // area scales with that country's size on screen, so Italy stays clickable at world zoom.
    const touch = pointerType && pointerType !== 'mouse';
    const stack = document.elementsFromPoint(x, y);
    const under = stack.find((e) => e.classList && e.classList.contains('country'));
    const underId = under && under.getAttribute('data-id');
    const underTiny = underId && nodes.get(underId) && nodes.get(underId).dot;
    let reach; // px around a dot centre that still counts as that dot
    if (!underId) reach = touch ? 26 : 14; // ocean: generous
    else if (underTiny) reach = 0; // on a tiny country's own outline: take it
    else {
      const r = under.getBoundingClientRect();
      reach = Math.max(3.5, Math.min(touch ? 22 : 9, Math.min(r.width, r.height) * (touch ? 0.25 : 0.12)));
    }
    let id = underId;
    if (reach) {
      const u = unitsPerPx();
      const p = toSvg(x, y);
      let best = null, bd = reach * u;
      nodes.forEach((n, nid) => {
        if (!n.dot || nid === underId || !pickable(nid)) return;
        const c = byId.get(nid).c;
        const d = Math.hypot(c[0] - p.x, c[1] - p.y);
        if (d < bd) { bd = d; best = nid; }
      });
      if (best) id = best;
    }
    // Only countries in the game's database (name + flag + capital) can be picked; the ocean and
    // territories such as Greenland or New Caledonia are ignored.
    if (!id || !pickable(id)) return;
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
      n.path.classList.remove('correct', 'wrong', 'dim', 'hover', 'hinted', 'picked');
      n.dot && n.dot.classList.remove('correct', 'wrong', 'picked');
    });
    labelLayer.innerHTML = '';
    fxLayer.innerHTML = '';
  }
  function label(id) {
    const c = byId.get(id);
    const [x, y] = c.c;
    const t = el('text', { x, y: c.small ? y - 4 * unitsPerPx() * 2.5 : y, class: 'label', ...(c.miss ? { dy: '-1em' } : {}) }, labelLayer);
    t.textContent = c.miss ? '✕' : c.name;
    apply();
  }
  function bbox(id) {
    const c = byId.get(id);
    // the main territory when the country has far-off parts (France without French Guiana …)
    let [[x0, y0], [x1, y1]] = c.mb || c.b;
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
    const ok = matches(clickedId, correctId);
    nodesFor(correctId).forEach((cn) => {
      cn.path.classList.add('correct');
      cn.dot && cn.dot.classList.add('correct');
    });
    const shown = firstId(clickedId); // a click on several physical features: the one most likely meant
    if (!ok && shown && nodes.has(shown)) {
      const wn = nodes.get(shown);
      wn.path.classList.add('wrong');
      wn.dot && wn.dot.classList.add('wrong');
    }
    const missed = !ok && typeof shown === 'string' && shown.startsWith(MISS);
    const ids = shown && !ok && (nodes.has(shown) || missed) ? [correctId, shown] : [correctId];
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
    if (missed) { const m = byId.get(shown); el('circle', { cx: m.c[0], cy: m.c[1], r: 1, class: 'misspin' }, fxLayer); apply(); }
    if (pin) {
      el('circle', { cx: pin.p[0], cy: pin.p[1], r: 1, class: 'citypin' }, fxLayer);
      const t = el('text', { x: pin.p[0], y: pin.p[1], class: 'label citylabel', dy: '-0.9em' }, labelLayer);
      t.textContent = '📍 ' + pin.name;
      // close to the country's own label (Moscow and Russia, Amsterdam and the Netherlands): stack them,
      // the city's name on the far side of the pin from the country's label
      if (Math.hypot(c.c[0] - pin.p[0], c.c[1] - pin.p[1]) / unitsPerPx() < 70) {
        t.setAttribute('dy', c.c[1] > pin.p[1] ? '-1.2em' : '1.6em');
        t.textContent = pin.name; // the pin's dot marks the spot
      }
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

  function prepare(handler, q) {
    expectType = q && q.physType || null;
    clearMarks();
    reset(false);
    onPick = handler;
    locked = false;
    svg.classList.remove('locked');
  }
  function lock() { locked = true; svg.classList.add('locked'); }

  /** Hint: dim every country outside the given set and zoom to it. */
  async function hint(ids) {
    const set = new Set(ids.flatMap((id) => (scope !== 'world' && PARENTS.includes(id) ? REG.filter((r) => r.parent === id).map((r) => r.id) : [id])));
    nodes.forEach((n, id) => {
      const inside = set.has(id);
      n.path.classList.toggle('dim', !inside);
      n.path.classList.toggle('hinted', inside);
    });
    await animateTo(focusBox(ids), 800);
  }

  /** Mark a wrong pick without revealing the answer (the map stays clickable, e.g. for a steal). */
  function markWrong(id) {
    const n = nodesFor(firstId(id))[0];
    if (!n) return;
    n.path.classList.add('wrong');
    n.dot && n.dot.classList.add('wrong');
  }

  /** Neutral highlight of a pick (e.g. a guest's guess before the reveal). */
  function markPicked(id) {
    const n = nodes.get(firstId(id));
    if (!n) return;
    n.path.classList.add('picked');
    n.dot && n.dot.classList.add('picked');
  }

  /** Screen position of a country's marker (used to show where a bot clicks). */
  function centerOf(id) {
    const c = byId.get(id);
    const r = svg.getBoundingClientRect();
    return { x: r.left + ((c.c[0] - vb.x) / vb.w) * r.width, y: r.top + ((c.c[1] - vb.y) / vb.h) * r.height };
  }

  /** Register a callback run whenever the zoom changes, with the size of one screen pixel in map units. */
  function onScale(fn) { scaleListeners.push(fn); fn(unitsPerPx()); }
  /** Zoom to fit the given map points (with padding). */
  function focusPoints(points, ms = 800, pad = 60) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return animateTo({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }, ms);
  }
  /** Clear answer marks (colours, labels) without changing the view. */
  function clear() { clearMarks(); }

  /** Name of what a click picked (a country, a state, a physical feature … or nothing named). */
  const nameOf = (id) => { const c = byId.get(id); return c ? c.name : ''; };
  /** Physical features of the same type, nearest first (for a computer player's plausible mistakes). */
  const physNear = (id) => { const f = baseGet(id); return f ? PHYS.filter((x) => x.type === f.type && x.id !== id).sort((a, b) => Math.hypot(a.c[0] - f.c[0], a.c[1] - f.c[1]) - Math.hypot(b.c[0] - f.c[0], b.c[1] - f.c[1])) : []; };
  window.WorldMap = { nameOf, physNear, physPickAt: (x, y, t) => physPick(x, y, t), toSvg: (x, y) => toSvg(x, y), setScope, get scope() { return scope; }, matches, hintFor, prepare, reveal, lock, reset, hint, markWrong, markPicked, centerOf, byId, overlay, onScale, focusPoints, clear, unitsPerPx: () => unitsPerPx() };
})();
