/* Ludo board: geometry, rendering and piece animation. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const C = 40; // cell size in SVG units (board is 15 x 15 cells = 600)
  const { sleep, Sound } = FX;

  // Player colours, clockwise from top-left.
  const COLORS = [
    { key: 'red', name: 'Red', hex: '#ef476f', dark: '#b8234a', light: '#ffc2d1' },
    { key: 'green', name: 'Green', hex: '#06c167', dark: '#04874a', light: '#b6f2d2' },
    { key: 'yellow', name: 'Yellow', hex: '#ffb703', dark: '#c98a00', light: '#ffe7a6' },
    { key: 'blue', name: 'Blue', hex: '#3a86ff', dark: '#1d5fd0', light: '#c3dafe' },
  ];

  // The 52-cell loop, starting from red's start square, going clockwise.
  const TRACK = [];
  const push = (c, r) => TRACK.push([c, r]);
  for (let c = 1; c <= 5; c++) push(c, 6);
  for (let r = 5; r >= 0; r--) push(6, r);
  push(7, 0);
  for (let r = 0; r <= 5; r++) push(8, r);
  for (let c = 9; c <= 14; c++) push(c, 6);
  push(14, 7);
  for (let c = 14; c >= 9; c--) push(c, 8);
  for (let r = 9; r <= 14; r++) push(8, r);
  push(7, 14);
  for (let r = 14; r >= 9; r--) push(6, r);
  for (let c = 5; c >= 0; c--) push(c, 8);
  push(0, 7);
  push(0, 6);

  const START = [0, 13, 26, 39];
  const HOME_COL = [
    [1, 2, 3, 4, 5].map((c) => [c, 7]),
    [1, 2, 3, 4, 5].map((r) => [7, r]),
    [13, 12, 11, 10, 9].map((c) => [c, 7]),
    [13, 12, 11, 10, 9].map((r) => [7, r]),
  ];
  const YARD = [[120, 120], [480, 120], [480, 480], [120, 480]];
  const FINISH = [[264, 300], [300, 264], [336, 300], [300, 336]];
  // Yard spots relative to the yard centre, for 1-4 pieces.
  const SLOTS = {
    1: [[0, 0]], 2: [[-30, 0], [30, 0]], 3: [[-30, -26], [30, -26], [0, 28]],
    4: [[-30, -30], [30, -30], [-30, 30], [30, 30]],
  };

  const TRACK_LEN = 51; // squares travelled on the loop
  const FINISH_POS = TRACK_LEN + 5 + 1; // 57

  const cellCenter = ([c, r]) => [c * C + C / 2, r * C + C / 2];

  /** Absolute loop index for a given seat/progress (1..51), else -1. */
  function trackIndex(seat, pos) {
    if (pos < 1 || pos > TRACK_LEN) return -1;
    return (START[seat] + pos - 1) % 52;
  }
  /** SVG coordinates for a seat at a progress value (0 = yard, 57 = finish). */
  function coords(seat, pos) {
    if (pos <= 0) return YARD[seat];
    if (pos <= TRACK_LEN) return cellCenter(TRACK[trackIndex(seat, pos)]);
    if (pos < FINISH_POS) return cellCenter(HOME_COL[seat][pos - TRACK_LEN - 1]);
    return FINISH[seat];
  }

  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  let svg, pieceLayer, highlightLayer;
  const pieces = new Map(); // seat -> <g>

  function render(players) {
    svg = document.getElementById('board');
    svg.innerHTML = '';
    const activeSeats = new Set(players.map((p) => p.seat));
    const defs = el('defs', {}, svg);
    defs.innerHTML = `
      <linearGradient id="bframe" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#efe4cf"/>
      </linearGradient>
      <linearGradient id="cellg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1f3fa"/>
      </linearGradient>
      <radialGradient id="globeg" cx=".35" cy=".3" r=".8">
        <stop offset="0" stop-color="#9ad1ff"/><stop offset=".6" stop-color="#2f6fd6"/><stop offset="1" stop-color="#173a7a"/>
      </radialGradient>
      <filter id="pshadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".35"/>
      </filter>
      <pattern id="dots" width="10" height="10" patternUnits="userSpaceOnUse">
        <circle cx="5" cy="5" r="1.2" fill="rgba(255,255,255,.35)"/>
      </pattern>
      ${COLORS.map((c) => `
        <radialGradient id="pg-${c.key}" cx=".35" cy=".3" r=".9">
          <stop offset="0" stop-color="#fff" stop-opacity=".95"/>
          <stop offset=".25" stop-color="${c.light}"/>
          <stop offset=".6" stop-color="${c.hex}"/>
          <stop offset="1" stop-color="${c.dark}"/>
        </radialGradient>
        <linearGradient id="yg-${c.key}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${c.hex}"/><stop offset="1" stop-color="${c.dark}"/>
        </linearGradient>`).join('')}
    `;

    // Frame
    el('rect', { x: -14, y: -14, width: 628, height: 628, rx: 30, fill: '#2b2140' }, svg);
    el('rect', { x: -8, y: -8, width: 616, height: 616, rx: 26, fill: 'url(#bframe)' }, svg);

    // Yards
    COLORS.forEach((col, seat) => {
      const [yx, yy] = [seat === 1 || seat === 2 ? 9 * C : 0, seat >= 2 ? 9 * C : 0];
      const inactive = !activeSeats.has(seat);
      const g = el('g', { opacity: inactive ? 0.35 : 1 }, svg);
      el('rect', { x: yx + 4, y: yy + 4, width: 6 * C - 8, height: 6 * C - 8, rx: 22, fill: `url(#yg-${col.key})` }, g);
      el('rect', { x: yx + 4, y: yy + 4, width: 6 * C - 8, height: 6 * C - 8, rx: 22, fill: 'url(#dots)' }, g);
      el('rect', { x: yx + 34, y: yy + 34, width: 6 * C - 68, height: 6 * C - 68, rx: 20, fill: '#fffdf8', stroke: 'rgba(0,0,0,.08)' }, g);
      const [cx, cy] = YARD[seat];
      el('circle', { cx, cy, r: 62, fill: col.light, opacity: 0.4 }, g);
      const player = players.find((p) => p.seat === seat);
      const n = player ? player.pieces.length : 4;
      for (let i = 0; i < n; i++) {
        const [dx, dy] = SLOTS[n][i];
        el('circle', { cx: cx + dx, cy: cy + dy + 6, r: 19, fill: '#fff', stroke: col.hex, 'stroke-width': 2.5, 'stroke-dasharray': '5 4', opacity: 0.9 }, g);
      }
      const label = el('text', {
        x: cx, y: yy + (seat >= 2 ? 6 * C - 12 : 26), 'text-anchor': 'middle', 'font-family': 'Fredoka, sans-serif',
        'font-size': 17, 'font-weight': 600, fill: '#fff',
      }, g);
      label.textContent = player ? player.name : '';
    });

    // Track cells
    const cells = el('g', {}, svg);
    TRACK.forEach(([c, r], i) => {
      const seat = START.indexOf(i);
      const fill = seat >= 0 ? `url(#yg-${COLORS[seat].key})` : 'url(#cellg)';
      el('rect', { x: c * C + 1.5, y: r * C + 1.5, width: C - 3, height: C - 3, rx: 7, fill, stroke: 'rgba(40,30,70,.18)' }, cells);
      if (seat >= 0) {
        // start arrow
        const [x, y] = cellCenter([c, r]);
        const rot = [0, 90, 180, 270][seat];
        el('path', { d: 'M-8,-7 L8,0 L-8,7 L-4,0 Z', fill: '#fff', transform: `translate(${x},${y}) rotate(${rot})`, opacity: 0.95 }, cells);
      }
    });
    // Home columns
    HOME_COL.forEach((col, seat) => {
      col.forEach(([c, r], i) => {
        el('rect', {
          x: c * C + 1.5, y: r * C + 1.5, width: C - 3, height: C - 3, rx: 7, fill: COLORS[seat].hex,
          opacity: 0.55 + i * 0.09, stroke: 'rgba(40,30,70,.18)',
        }, cells);
      });
    });
    // Entry arrows into home columns (on the cell before the column)
    const entries = [[0, 7, 0], [7, 0, 90], [14, 7, 180], [7, 14, 270]];
    entries.forEach(([c, r, rot], seat) => {
      const [x, y] = cellCenter([c, r]);
      el('path', { d: 'M-6,-8 L6,0 L-6,8', fill: 'none', stroke: COLORS[seat].hex, 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', transform: `translate(${x},${y}) rotate(${rot})` }, cells);
    });

    // Centre: finish triangles + globe
    const tri = [
      [[240, 240], [240, 360], [300, 300]],
      [[240, 240], [360, 240], [300, 300]],
      [[360, 240], [360, 360], [300, 300]],
      [[240, 360], [360, 360], [300, 300]],
    ];
    tri.forEach((pts, seat) => {
      el('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: `url(#yg-${COLORS[seat].key})`, stroke: '#fffaf0', 'stroke-width': 2 }, svg);
    });
    const globe = el('g', { class: 'center-globe' }, svg);
    el('circle', { cx: 300, cy: 300, r: 24, fill: 'url(#globeg)', stroke: '#fff', 'stroke-width': 3 }, globe);
    // tiny continents
    el('path', { d: 'M290,288 q6,-4 10,0 q4,6 -2,10 q-6,2 -8,-4 z M304,300 q6,-2 8,4 q0,8 -6,10 q-4,-6 -2,-14 z M284,302 q4,0 4,6 q-2,4 -5,0 z', fill: '#7ee2a8', opacity: 0.9 }, globe);
    el('ellipse', { cx: 300, cy: 300, rx: 24, ry: 9, fill: 'none', stroke: 'rgba(255,255,255,.4)', 'stroke-width': 1 }, globe);

    highlightLayer = el('g', {}, svg);
    pieceLayer = el('g', {}, svg);
    pieces.clear();
    players.forEach((p) => {
      p.pieces.forEach((pc, i) => {
        const g = makePiece(p.seat, i);
        pieceLayer.appendChild(g);
        pieces.set(key(p.seat, i), g);
      });
    });
    layout(players, false);
  }

  const key = (seat, idx) => seat * 10 + idx;

  function makePiece(seat, idx) {
    const col = COLORS[seat];
    const g = el('g', { class: 'piece', 'data-seat': seat, 'data-idx': idx });
    el('circle', { class: 'halo', cx: 0, cy: 8, r: 16, fill: 'none', stroke: col.hex, 'stroke-width': 3 }, g);
    el('circle', { class: 'ring', cx: 0, cy: 0, r: 20, fill: 'rgba(255,209,102,.28)', stroke: '#ffb703', 'stroke-width': 3.5 }, g);
    el('ellipse', { cx: 0, cy: 10, rx: 13, ry: 5, fill: 'rgba(0,0,0,.28)' }, g);
    const bob = el('g', { class: 'bob' }, g);
    const body = el('g', { filter: 'url(#pshadow)' }, bob);
    el('ellipse', { cx: 0, cy: 8, rx: 13, ry: 5.5, fill: col.dark }, body);
    el('path', { d: 'M-11,7 C-10,-2 -6,-6 -5,-9 L5,-9 C6,-6 10,-2 11,7 Z', fill: `url(#pg-${col.key})` }, body);
    el('ellipse', { cx: 0, cy: -9, rx: 7, ry: 2.5, fill: col.dark }, body);
    el('circle', { cx: 0, cy: -16, r: 8.5, fill: `url(#pg-${col.key})`, stroke: col.dark, 'stroke-width': 0.8 }, body);
    el('circle', { cx: -2.8, cy: -19, r: 2.4, fill: '#fff', opacity: 0.85 }, body);
    const num = el('text', { class: 'pnum', x: 0, y: 4, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, 'font-family': 'Inter, sans-serif', fill: '#fff' }, body);
    num.textContent = idx + 1;
    // generous invisible hit area
    el('circle', { class: 'hit', cx: 0, cy: -2, r: 20, fill: 'transparent' }, g);
    return g;
  }

  /** Board coordinates of one piece, ignoring stacking. */
  function spot(seat, idx, pos, count) {
    if (pos <= 0) {
      const [cx, cy] = YARD[seat];
      const [dx, dy] = SLOTS[count][idx];
      return [cx + dx, cy + dy];
    }
    return coords(seat, pos);
  }

  const STACK = {
    1: [[0, 0]], 2: [[-8, 0], [8, 0]], 3: [[-8, 5], [8, 5], [0, -7]], 4: [[-8, -6], [8, -6], [-8, 6], [8, 6]],
  };

  function setXY(g, x, y, s, animate) {
    const t = `translate(${x}px, ${y - 4}px) scale(${s})`;
    if (!animate) {
      g.style.transition = 'none';
      g.style.transform = t;
      void g.getBoundingClientRect();
      g.style.transition = '';
    } else g.style.transform = t;
    g.dataset.y = y;
  }

  /** Position every piece, spreading out pieces that share a square. */
  function layout(players, animate = true) {
    const groups = new Map();
    players.forEach((p) => p.pieces.forEach((pc, i) => {
      const [x, y] = spot(p.seat, i, pc.pos, p.pieces.length);
      const k = pc.pos >= FINISH_POS ? 'fin' + p.seat : pc.pos <= 0 ? `y${p.seat}-${i}` : `${x},${y}`;
      if (!groups.has(k)) groups.set(k, { x, y, list: [] });
      groups.get(k).list.push(key(p.seat, i));
    }));
    groups.forEach(({ x, y, list }) => {
      const n = Math.min(list.length, 4);
      const offs = STACK[n] || STACK[4];
      const s = n === 1 ? 1 : n === 2 ? 0.82 : 0.7;
      list.forEach((k, j) => {
        const [dx, dy] = offs[j % offs.length];
        setXY(pieces.get(k), x + dx, y + dy, s, animate);
      });
    });
    restack();
  }

  // Keep pieces lower on the board drawn on top.
  function restack() {
    [...pieces.values()].sort((a, b) => (+a.dataset.y || 0) - (+b.dataset.y || 0)).forEach((g) => pieceLayer.appendChild(g));
  }

  async function walk(seat, idx, from, to, players) {
    const g = pieces.get(key(seat, idx));
    g.classList.add('moving');
    pieceLayer.appendChild(g);
    for (let p = from + 1; p <= to; p++) {
      g.classList.remove('hop');
      void g.getBoundingClientRect();
      g.classList.add('hop');
      const [x, y] = coords(seat, p);
      setXY(g, x, y, 1, true);
      Sound.step();
      await sleep(260);
    }
    g.classList.remove('hop', 'moving');
    layout(players);
  }

  async function sendHome(seat, idx, players) {
    const g = pieces.get(key(seat, idx));
    g.classList.add('captured');
    Sound.capture();
    await sleep(400);
    g.classList.add('flying');
    layout(players);
    await sleep(850);
    g.classList.remove('flying', 'captured');
  }

  /* ---------- Selection ---------- */
  let selectHandler = null;
  let selectable = [];

  function onPieceActivate(e) {
    const g = e.target.closest && e.target.closest('.piece.selectable');
    if (!g || !selectHandler) return;
    const choice = selectable.find((o) => o.seat === +g.dataset.seat && o.idx === +g.dataset.idx);
    if (choice) { e.preventDefault(); selectHandler(choice); }
  }

  /** Make the given pieces glow and clickable. options: [{seat, idx, target, label}] */
  function setSelectable(options, handler) {
    selectable = options || [];
    selectHandler = handler || null;
    pieces.forEach((g) => {
      g.classList.remove('selectable');
      g.removeAttribute('tabindex');
      g.removeAttribute('role');
      g.removeAttribute('aria-label');
    });
    showTarget(null);
    selectable.forEach((o) => {
      const g = pieces.get(key(o.seat, o.idx));
      g.classList.add('selectable');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', o.label);
      pieceLayer.appendChild(g);
    });
  }

  function initEvents() {
    svg.addEventListener('click', onPieceActivate);
    svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onPieceActivate(e); });
    const preview = (e) => {
      const g = e.target.closest && e.target.closest('.piece.selectable');
      const o = g && selectable.find((s) => s.seat === +g.dataset.seat && s.idx === +g.dataset.idx);
      showTarget(o ? o.seat : null, o ? o.target : null);
    };
    svg.addEventListener('pointerover', preview);
    svg.addEventListener('focusin', preview);
    svg.addEventListener('pointerleave', () => showTarget(null));
  }

  /** Pulsing marker at the square a piece would land on. */
  function showTarget(seat, pos) {
    if (!highlightLayer) return;
    highlightLayer.innerHTML = '';
    if (seat == null || pos == null) return;
    const [x, y] = coords(seat, pos);
    el('circle', { cx: x, cy: y, r: 17, fill: 'none', stroke: COLORS[seat].hex, 'stroke-width': 4, class: 'cell-target', 'stroke-dasharray': '5 4' }, highlightLayer);
  }

  let eventsReady = false;
  function renderBoard(players) {
    render(players);
    if (!eventsReady) { initEvents(); eventsReady = true; }
  }

  window.Board = {
    COLORS, TRACK_LEN, FINISH_POS, render: renderBoard, layout, walk, sendHome, setSelectable, showTarget, trackIndex,
  };
})();
