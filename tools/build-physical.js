// Physical geography for the blind map: data/physical.txt + Natural Earth physical layers -> data/physical.js
// Called by tools/build-data.js (same projection as the countries). Needs, in <node_modules dir>/natural-earth/:
//   ne_10m_geography_regions_polys.geojson, ne_10m_geography_marine_polys.geojson,
//   ne_50m_rivers_lake_centerlines.geojson, ne_50m_lakes.geojson
// (from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson). Skipped when they are missing.
const path = require('path');
const fs = require('fs');

const TYPES = ['range', 'lowland', 'river', 'lake', 'sea', 'bay', 'peninsula', 'island'];
const SOURCE = { range: 'R', lowland: 'R', peninsula: 'R', island: 'R', sea: 'M', bay: 'M', river: 'V', lake: 'L' };
const FILES = {
  R: 'ne_10m_geography_regions_polys.geojson', M: 'ne_10m_geography_marine_polys.geojson',
  V: 'ne_50m_rivers_lake_centerlines.geojson', L: 'ne_50m_lakes.geojson',
};
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const r1 = (v) => Math.round(v * 10) / 10;

module.exports = function buildPhysical({ nm, OUT, d3, proj, polylabel, countries, geomById }) {
  const dir = path.join(nm, 'natural-earth');
  if (!Object.values(FILES).every((f) => fs.existsSync(path.join(dir, f)))) { console.warn('physical: Natural Earth files missing, data/physical.js not rebuilt'); return; }
  const src = {};
  for (const [k, f] of Object.entries(FILES)) src[k] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).features;
  const nameOf = (k, p) => (k === 'R' ? [p.NAME_EN, p.NAME] : [p.name_en, p.name, p.name_alt]).filter(Boolean);

  /* ---------- the feature list ---------- */
  const lines = fs.readFileSync(path.join(OUT, 'data/physical.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const defs = lines.map((l) => {
    const [lvl, type, name, names, ...opts] = l.split('|').map((x) => x.trim());
    if (!TYPES.includes(type)) throw new Error(`physical: bad type in "${l}"`);
    if (!(+lvl >= 1 && +lvl <= 6)) throw new Error(`physical: bad level in "${l}"`);
    const o = Object.fromEntries(opts.map((x) => x.split('=').map((y) => y.trim())));
    return { lvl: +lvl, type, name, names: names.split(';').map((x) => x.trim()), id: o.id || slug(name), in: o.in ? o.in.split(',') : [], o };
  });
  const ids = new Set();
  defs.forEach((d) => { if (ids.has(d.id)) throw new Error(`physical: duplicate id ${d.id}`); ids.add(d.id); });
  defs.forEach((d) => d.in.forEach((p) => { if (!ids.has(p)) throw new Error(`physical: ${d.id} in=${p}: no such feature`); }));

  /* ---------- geometry helpers ---------- */
  // project (with d3's antimeridian cutting) and collect the rings / lines as flat [x, y, x, y …] arrays
  function capture(geo) {
    const out = [];
    let cur = null;
    d3.geoPath(proj, { moveTo(x, y) { cur = [x, y]; out.push(cur); }, lineTo(x, y) { cur.push(x, y); }, closePath() {}, arc() {} })(geo);
    return out;
  }
  // Douglas–Peucker on a flat array
  function simplify(a, tol) {
    const n = a.length / 2;
    if (n <= 2) return a.slice();
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [i, j] = stack.pop();
      const ax = a[2 * i], ay = a[2 * i + 1], bx = a[2 * j], by = a[2 * j + 1];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
      let best = -1, bd = tol;
      for (let k = i + 1; k < j; k++) {
        const d = L > 1e-6 ? Math.abs(dy * a[2 * k] - dx * a[2 * k + 1] + bx * ay - by * ax) / L : Math.hypot(a[2 * k] - ax, a[2 * k + 1] - ay);
        if (d > bd) { bd = d; best = k; }
      }
      if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
    }
    const out = [];
    for (let k = 0; k < n; k++) if (keep[k]) out.push(a[2 * k], a[2 * k + 1]);
    return out;
  }
  const ringArea = (a) => { let s = 0; for (let i = 0, n = a.length; i < n; i += 2) { const j = (i + 2) % n; s += a[i] * a[j + 1] - a[j] * a[i + 1]; } return s / 2; };
  const lineLen = (a) => { let s = 0; for (let i = 2; i < a.length; i += 2) s += Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]); return s; };
  // a polygon given with the wrong winding would cover the rest of the globe: turn it round
  function rewound(f) {
    const g = f.geometry;
    if (!/Polygon/.test(g.type) || d3.geoArea(f) <= 2 * Math.PI) return f;
    const rev = (poly) => poly.map((ring) => ring.slice().reverse());
    return { ...f, geometry: { type: g.type, coordinates: g.type === 'Polygon' ? rev(g.coordinates) : g.coordinates.map(rev) } };
  }
  // keep the half-plane of a lon/lat ring (Sutherland–Hodgman); test(p) says whether p is kept
  function clipRing(ring, test, cross) {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if (test(p)) out.push(p);
      if (test(p) !== test(q)) out.push(cross(p, q));
    }
    if (out.length) out.push(out[0]);
    return out;
  }
  function countryPart(id, o) {
    const f = geomById.get(id);
    if (!f) throw new Error(`physical: no country ${id}`);
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = polys[0], ba = -1;
    for (const p of polys) { const a = d3.geoArea({ type: 'Polygon', coordinates: p }); if (a > ba) { ba = a; best = p; } }
    let ring = best[0];
    if (o.maxlat) { const m = +o.maxlat; ring = clipRing(ring, (p) => p[1] <= m, (p, q) => [p[0] + (q[0] - p[0]) * (m - p[1]) / (q[1] - p[1]), m]); }
    if (o.minlon) { const m = +o.minlon; ring = clipRing(ring, (p) => p[0] >= m, (p, q) => [m, p[1] + (q[1] - p[1]) * (m - p[0]) / (q[0] - p[0])]); }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
  }

  /* ---------- build ---------- */
  const playable = countries.filter((c) => c.fame && c.d);
  const features = [];
  const missing = [];
  for (const d of defs) {
    let parts = [];
    for (const n of d.names) {
      if (n.startsWith('country:')) { parts.push(countryPart(n.slice(8), d.o)); continue; }
      const k = SOURCE[d.type] === 'M' && d.type === 'sea' && n === 'Caspian Sea' ? 'M' : SOURCE[d.type];
      let hit = src[k].filter((f) => nameOf(k, f.properties).includes(n));
      if (d.o.region) hit = hit.filter((f) => f.properties.REGION === d.o.region);
      if (d.o.box) {
        const [x0, y0, x1, y1] = d.o.box.split(',').map(Number);
        hit = hit.filter((f) => { const [x, y] = d3.geoCentroid(f); return x >= x0 && x <= x1 && y >= y0 && y <= y1; });
      }
      if (!hit.length) missing.push(`${d.id}: "${n}"`);
      parts = parts.concat(hit);
    }
    if (!parts.length) continue;
    const line = d.type === 'river';
    const tol = line ? 0.25 : d.type === 'sea' ? 0.6 : 0.3;
    let g = [];
    for (const f of parts) {
      for (const raw of capture(line ? f : rewound(f))) {
        let s = simplify(raw, tol);
        if (!line && s.length < 6) s = raw.length <= 16 ? raw : simplify(raw, tol / 4); // keep small islands & lakes
        if (s.length >= (line ? 4 : 6)) g.push(s.map(r1));
      }
    }
    if (!g.length) { missing.push(`${d.id}: empty geometry`); continue; }
    // label / marker point: inside the largest ring, or halfway along the longest river line
    let c;
    if (line) {
      const a = g.reduce((m, x) => (lineLen(x) > lineLen(m) ? x : m));
      let half = lineLen(a) / 2;
      c = [a[0], a[1]];
      for (let i = 2; i < a.length; i += 2) {
        const s = Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]);
        if (half <= s) { const t = half / s; c = [a[i - 2] + (a[i] - a[i - 2]) * t, a[i - 1] + (a[i + 1] - a[i - 1]) * t]; break; }
        half -= s;
      }
    } else {
      const a = g.reduce((m, x) => (Math.abs(ringArea(x)) > Math.abs(ringArea(m)) ? x : m));
      const pts = []; for (let i = 0; i < a.length; i += 2) pts.push([a[i], a[i + 1]]);
      c = Math.abs(ringArea(a)) < 2 ? d3.polygonCentroid ? pts[0] : pts[0] : polylabel([pts], 0.3);
      if (Math.abs(ringArea(a)) < 2) { c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]; }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    g.forEach((a) => { for (let i = 0; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1]); } });
    const area = line ? g.reduce((s, a) => s + lineLen(a), 0) * 0.5 : g.reduce((s, a) => s + Math.abs(ringArea(a)), 0);
    // the nearest country, for the "somewhere in …" hint and Training's parts of the world
    const near = playable.reduce((m, x) => (Math.hypot(x.c[0] - c[0], x.c[1] - c[1]) < Math.hypot(m.c[0] - c[0], m.c[1] - c[1]) ? x : m));
    features.push({
      id: d.id, name: d.name, type: d.type, lvl: d.lvl, ...(d.in.length ? { in: d.in } : {}),
      c: c.map(r1), b: [[Math.floor(x0), Math.floor(y0)], [Math.ceil(x1), Math.ceil(y1)]], area: Math.round(area * 10) / 10,
      near: near.id, region: near.region, g,
    });
  }
  if (missing.length) throw new Error('physical: not found in Natural Earth:\n  ' + missing.join('\n  '));
  fs.writeFileSync(path.join(OUT, 'data/physical.js'), '// Generated by tools/build-physical.js (data/physical.txt + Natural Earth physical layers). Do not edit.\nwindow.PHYSICAL = '
    + JSON.stringify({ types: TYPES, features }) + ';\n');
  console.log('physical', features.length, TYPES.map((t) => `${t} ${features.filter((f) => f.type === t).length}`).join(' '),
    'levels', [1, 2, 3, 4, 5, 6].map((l) => features.filter((f) => f.lvl === l).length).join('/'), 'size', fs.statSync(path.join(OUT, 'data/physical.js')).size);
};
