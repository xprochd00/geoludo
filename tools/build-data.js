// Generates data/world.js (projected SVG country paths + quiz metadata) and copies flags.
// Usage: npm i world-atlas@2 topojson-client topojson-simplify d3-geo d3-geo-projection world-countries flag-icons polylabel@1
//        node tools/build-data.js <node_modules dir>
const path = require('path');
const fs = require('fs');
const nm = process.argv[2] || path.join(process.cwd(), 'node_modules');
const req = (m) => require(path.join(nm, m));
const topo = req('topojson-client');
const simp = req('topojson-simplify');
const d3 = req('d3-geo');
const d3p = req('d3-geo-projection');
const countries = req('world-countries');
const polylabel = req('polylabel');
const atlas = JSON.parse(fs.readFileSync(path.join(nm, 'world-atlas/countries-50m.json')));

const OUT = path.join(__dirname, '..');

// Fame level of each country (1 = everybody knows it ... 5 = obscure micro-state).
// A question's difficulty (1-6) = fame level + an offset for the question type
// (name +0, flag +1, capital +1) + per-country CAP_ADJ / FLAG_ADJ below. Non-capital city questions
// take their difficulty from the tier in data/cities.json. Unlisted countries default to 4.
const FAME = {
  1: `USA CAN MEX BRA ARG GBR FRA DEU ITA ESP RUS CHN JPN IND AUS EGY ZAF TUR GRC PRT NOR SWE POL UKR SAU`,
  2: `CHL PER COL VEN CUB IRL FIN NLD BEL CHE AUT DNK ISL CZE HUN ROU NGA KEN MAR ETH DZA IRN IRQ ISR
      MNG THA KOR PRK PAK IDN NZL PHL VNM AFG BGD TWN QAT ARE SYR KAZ`,
  3: `BOL ECU PRY URY PAN CRI GTM JAM HTI DOM SVK BGR SRB HRV BIH SVN ALB MKD MNE BLR LTU LVA EST MDA GEO
      ARM AZE CYP LUX JOR LBN KWT OMN YEM UZB TKM MYS SGP MMR NPL LKA LBY TUN SDN SSD SOM
      COD AGO NAM BWA ZWE ZMB MOZ MDG TZA UGA GHA SEN CMR CIV KHM LAO PNG`,
  4: `GUY SUR BLZ HND NIC SLV BHS TTO KGZ TJK BTN BRN TLS MRT MLI NER TCD CAF COG GAB GNQ BEN TGO BFA GIN
      GMB GNB SLE LBR ERI DJI RWA BDI MWI LSO SWZ FJI BHR MLT MCO VAT AND LIE SMR PSE UNK`,
  5: `CPV COM STP SYC MUS MDV ATG BRB DMA GRD KNA LCA VCT KIR MHL FSM NRU PLW SLB TON TUV VUT WSM`,
};

// Per-country adjustments on top of the question-type offset (name +0, flag +1, capital +1).
// Negative = easier than the type default, positive = harder. js/quiz.js computes
//   difficulty = clamp(fame + typeOffset + adjustment, 1, 6)
// Capitals everybody knows (Paris, London, Tokyo...) are -1; capitals that are traps because a bigger
// or more famous city exists, or because the country has several capitals, are +1.
const CAP_ADJ = {
  USA: -1, GBR: -1, FRA: -1, ITA: -1, ESP: -1, RUS: -1, JPN: -1, CHN: -1, EGY: -1, DEU: -1, GRC: -1, PRT: -1,
  ARG: -1, MEX: -1, CUB: -1, AUT: -1, IRL: -1, THA: -1, KOR: -1,
  CAN: 1, AUS: 1, BRA: 1, ZAF: 1, TUR: 1, CHE: 1, NGA: 1, TZA: 1, CIV: 1, MMR: 1, PAK: 1, MAR: 1, LKA: 1,
};
// Flags: iconic ones are easier; flags with close look-alikes are harder.
const FLAG_ADJ = {
  USA: -1, GBR: -1, JPN: -1, CAN: -1, BRA: -1, CHN: -1, KOR: -1,
  ROU: 1, TCD: 1, AND: 1,            // blue-yellow-red
  IDN: 1, MCO: 1, POL: 1,            // red-white
  IRL: 1, CIV: 1,                    // green-white-orange
  NLD: 1, LUX: 1,                    // red-white-blue / light blue
  MLI: 1, GIN: 1, SEN: 1, CMR: 1, GHA: 1, // pan-African tricolours
  COL: 1, ECU: 1, VEN: 1,            // yellow-blue-red
  AUS: 1, NZL: 1,                    // Southern Cross + Union Jack
  NOR: 1, ISL: 1, FIN: 1, DNK: 1,    // Nordic crosses
  SVN: 1, SVK: 1,                    // white-blue-red with a coat of arms
};
for (const m of [CAP_ADJ, FLAG_ADJ]) for (const k of Object.keys(m)) if (m[k] === 0) delete m[k];
const fameOf = {};
for (const [lvl, list] of Object.entries(FAME)) for (const id of list.trim().split(/\s+/)) fameOf[id] = +lvl;

// Capitals that are contested or ambiguous are never asked about.
const NO_CAPITAL = new Set(['ISR', 'PSE', 'BOL', 'SWZ']);
// Also playable although world-countries does not flag them as independent.
const EXTRA_PLAYABLE = new Set(['TWN', 'PSE', 'UNK']);

// Non-capital cities come from data/cities.json (city, iso2, lat, lon, tier 1-6).
const CITY_FILE = path.join(__dirname, '..', 'data/cities.json');

const byNum = new Map(countries.filter(c => c.ccn3).map(c => [c.ccn3, c]));
const byName = new Map(countries.map(c => [c.name.common, c]));
const NAME_FIX = { 'Kosovo': 'Kosovo' };
// Merged into their parent state: de-facto regions into the UN-recognised state, and China's special
// administrative regions (the city list puts Hong Kong and Macau in China).
const MERGE = { 'Somaliland': '706', 'N. Cyprus': '196', 'Hong Kong': '156', 'Macao': '156' };

// Presimplify
let t = simp.presimplify(atlas);
t = simp.simplify(t, simp.quantile(t, 0.35));

// Crimea: Natural Earth draws it as Russian (de facto). Assign it to Ukraine, as recognised under
// international law (and as the history questions expect).
{
  const geoms = t.objects.countries.geometries;
  const rus = geoms.find(g => g.id === '643');
  const simferopol = [34.1, 44.95];
  const idx = rus.arcs.findIndex(poly => d3.geoContains(topo.feature(t, { type: 'Polygon', arcs: poly }), simferopol));
  if (idx < 0) throw new Error('Crimea polygon not found');
  const [crimea] = rus.arcs.splice(idx, 1);
  geoms.push({ type: 'Polygon', arcs: crimea, id: '804', properties: { name: 'Ukraine' } });
}

// Group geometries by target id (merging de-facto regions into their UN-recognised state)
const geoms = t.objects.countries.geometries;
const groups = new Map();
for (const g of geoms) {
  let key = g.id;
  const nm = g.properties.name;
  if (MERGE[nm]) key = MERGE[nm];
  if (!key) key = 'name:' + nm;
  if (key === '010') continue; // Antarctica - drop
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(g);
}

const W = 1000;
const features = [];
for (const [key, gs] of groups) {
  const f = gs.length === 1 ? topo.feature(t, gs[0]) : { type: 'Feature', geometry: topo.merge(t, gs), properties: gs[0].properties };
  f.key = key;
  f.atlasName = gs[0].properties.name;
  features.push(f);
}
const proj = d3p.geoRobinson().fitWidth(W, { type: 'FeatureCollection', features });
const pathGen = d3.geoPath(proj).digits(1);
const bounds = pathGen.bounds({ type: 'FeatureCollection', features });
const H = Math.ceil(bounds[1][1]) + 2;
const graticule = d3.geoPath(proj).digits(1)(d3.geoGraticule10());
const outline = d3.geoPath(proj).digits(1)({ type: 'Sphere' });

const flagsDir = path.join(nm, 'flag-icons/flags/4x3');
const geomById = new Map(); // country id -> its outline (for the physical map's peninsulas)
const out = [];
for (const f of features) {
  let c = null;
  if (f.key.startsWith('name:')) c = byName.get(NAME_FIX[f.atlasName] || f.atlasName);
  else c = byNum.get(f.key);
  const d = pathGen(f);
  if (!d) continue;
  const area = pathGen.area(f);
  // Label / marker point: the visual centre of the largest polygon (a centroid can fall outside
  // concave countries, e.g. Vietnam's lands in Laos).
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null, bestA = -1;
  for (const poly of polys) {
    const a = pathGen.area({ type: 'Polygon', coordinates: poly });
    if (a > bestA) { bestA = a; best = poly; }
  }
  const projected = best.map(ring => ring.map(pt => proj(pt)));
  const [cx, cy] = area < 6 ? pathGen.centroid(f) : polylabel(projected, 0.5);
  const b = pathGen.bounds(f);
  // Main territory, for zooming: the largest polygon plus every part within MAIN_GAP of it (grown step
  // by step, so island chains stay together); far-flung parts like French Guiana are left out.
  const MAIN_GAP = 25; // map units (the map is 1000 wide, so about 9 degrees)
  const pb = polys.map((poly) => ({ poly, bb: pathGen.bounds({ type: 'Polygon', coordinates: poly }) }));
  let mb = pathGen.bounds({ type: 'Polygon', coordinates: best });
  const rest = pb.filter((x) => x.poly !== best);
  for (let grew = true; grew;) {
    grew = false;
    for (let i = rest.length - 1; i >= 0; i--) {
      const q = rest[i].bb;
      const gx = Math.max(0, q[0][0] - mb[1][0], mb[0][0] - q[1][0]);
      const gy = Math.max(0, q[0][1] - mb[1][1], mb[0][1] - q[1][1]);
      if (Math.max(gx, gy) <= MAIN_GAP) {
        mb = [[Math.min(mb[0][0], q[0][0]), Math.min(mb[0][1], q[0][1])], [Math.max(mb[1][0], q[1][0]), Math.max(mb[1][1], q[1][1])]];
        rest.splice(i, 1);
        grew = true;
      }
    }
  }
  const rec = {
    id: c ? c.cca3 : 'X' + f.key.replace(/\W/g, ''),
    name: c ? c.name.common : f.atlasName,
    d,
    c: [Math.round(cx * 10) / 10, Math.round(cy * 10) / 10],
    b: b.map(p => p.map(v => Math.round(v))),
    ...(rest.length ? { mb: mb.map(p => p.map(v => Math.round(v))) } : {}), // only when parts were left out
    // Marked with a clickable dot: tiny countries, and archipelagos whose islands are all small
    // (Solomon Islands, Bahamas, Vanuatu, New Caledonia ...), which are hard to hit at world zoom.
    small: area < 10 || (bestA < 15 && polys.length >= 3) ? 1 : 0,
  };
  const playable = c && (c.independent || EXTRA_PLAYABLE.has(c.cca3)) && c.capital && c.capital.length;
  if (playable) {
    const code = c.cca2.toLowerCase();
    if (!fs.existsSync(path.join(flagsDir, code + '.svg'))) throw new Error('no flag ' + code);
    fs.copyFileSync(path.join(flagsDir, code + '.svg'), path.join(OUT, 'flags', code + '.svg'));
    rec.capital = c.capital[0];
    if (NO_CAPITAL.has(c.cca3)) rec.noCap = 1;
    rec.flag = code;
    rec.iso2 = c.cca2;
    rec.region = c.subregion || c.region;
    rec.fame = fameOf[c.cca3] || 4;
    if (CAP_ADJ[c.cca3]) rec.capAdj = CAP_ADJ[c.cca3];
    if (FLAG_ADJ[c.cca3]) rec.flagAdj = FLAG_ADJ[c.cca3];
    if (!fameOf[c.cca3]) console.warn('defaulted fame 4:', c.cca3, c.name.common);
  }
  out.push(rec);
  geomById.set(rec.id, f);
}
// Independent countries with no outline at this resolution (e.g. Tuvalu): a clickable dot at their coordinates.
for (const c of countries) {
  if (!c.independent || out.find(o => o.id === c.cca3)) continue;
  const [x, y] = proj([c.latlng[1], c.latlng[0]]);
  const code = c.cca2.toLowerCase();
  fs.copyFileSync(path.join(flagsDir, code + '.svg'), path.join(OUT, 'flags', code + '.svg'));
  out.push({ id: c.cca3, name: c.name.common, d: '', c: [Math.round(x * 10) / 10, Math.round(y * 10) / 10],
    b: [[Math.round(x), Math.round(y)], [Math.round(x), Math.round(y)]], small: 1, capital: c.capital[0], flag: code,
    iso2: c.cca2, region: c.subregion || c.region, fame: fameOf[c.cca3] || 4 });
}
for (const id of Object.keys(fameOf)) if (!out.find(o => o.id === id && o.fame)) console.warn('fame list entry not on map', id);
for (const [name, m] of [['CAP_ADJ', CAP_ADJ], ['FLAG_ADJ', FLAG_ADJ]]) {
  for (const id of Object.keys(m)) if (!out.find(o => o.id === id && o.fame)) console.warn(`${name} entry is not a playable country:`, id);
}
// Cities: projected position + the country they belong to.
const byIso2 = new Map(out.filter(o => o.iso2).map(o => [o.iso2, o]));
const cityList = [];
for (const c of JSON.parse(fs.readFileSync(CITY_FILE, 'utf8'))) {
  const country = byIso2.get(c.iso2);
  if (!country) throw new Error(`city ${c.city}: no playable country with ISO code ${c.iso2}`);
  if (!(c.tier >= 1 && c.tier <= 6)) throw new Error(`city ${c.city}: tier must be 1-6`);
  const [x, y] = proj([c.lon, c.lat]);
  const rec = { id: c.id, name: c.city, country: country.id, tier: c.tier, p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10] };
  if (c.note) rec.note = c.note;
  cityList.push(rec);
}
// Capitals: projected position, shown as a pin when a capital question is revealed.
// data/capitals.json (lat/lon per country) was made once from GeoNames (all-the-cities, featureCode PPLC).
const CAPITAL_FILE = path.join(__dirname, '..', 'data/capitals.json');
const capitals = JSON.parse(fs.readFileSync(CAPITAL_FILE, 'utf8'));
for (const o of out.filter((x) => x.fame)) {
  const cap = capitals[o.id];
  if (!cap) { console.warn('no capital position:', o.id); continue; }
  const [x, y] = proj([cap.lon, cap.lat]);
  o.cp = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}
// Voyage route (data/route.json): ports plus sea waypoints, densified and projected.
// legs[i] is the path from port i to port i+1 as a list of [x, y] points; a null entry marks a jump
// where the route leaves one edge of the map and re-enters on the other (crossing the date line).
const ROUTE_FILE = path.join(__dirname, '..', 'data/route.json');
let route = null;
if (fs.existsSync(ROUTE_FILE)) route = buildRoute(ROUTE_FILE);
function buildRoute(file) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byIso = new Map(out.filter(o => o.iso2).map(o => [o.iso2, o]));
  const round = ([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  const ports = r.ports.map((pt) => {
    const country = byIso.get(pt.iso2);
    if (!country && pt.iso2 !== 'FR') throw new Error(`route port ${pt.name}: unknown country ${pt.iso2}`);
    return { name: pt.name, country: country ? country.id : null, p: round(proj([pt.lon, pt.lat])) };
  });
  const legs = [];
  for (let i = 1; i < r.ports.length; i++) {
    const stops = [[r.ports[i - 1].lat, r.ports[i - 1].lon], ...(r.ports[i].via || []), [r.ports[i].lat, r.ports[i].lon]];
    const pts = [];
    let prevX = null;
    for (let k = 1; k < stops.length; k++) {
      let [la1, lo1] = stops[k - 1];
      let [la2, lo2] = stops[k];
      if (lo2 - lo1 > 180) lo2 -= 360; else if (lo1 - lo2 > 180) lo2 += 360; // take the short way round
      const steps = Math.max(1, Math.ceil(Math.hypot(la2 - la1, lo2 - lo1) / 2));
      for (let j = k === 1 ? 0 : 1; j <= steps; j++) {
        const t = j / steps;
        let lo = lo1 + (lo2 - lo1) * t;
        if (lo > 180) lo -= 360; if (lo < -180) lo += 360;
        const xy = round(proj([lo, la1 + (la2 - la1) * t]));
        if (prevX !== null && Math.abs(xy[0] - prevX) > W / 2) pts.push(null);
        pts.push(xy);
        prevX = xy[0];
      }
    }
    legs.push(pts);
  }
  return { name: r.name, ports, legs };
}
out.sort((a, b) => a.name.localeCompare(b.name));
const data = { w: W, h: H, graticule, outline, countries: out, cities: cityList, route };

/* ---------- US states, Canadian provinces & territories -> data/regions.js ----------
 * Outlines: Natural Earth admin-1 (ne_50m_admin_1_states_provinces_lakes.geojson, put it in
 * <node_modules dir>/natural-earth/), projected exactly like the countries.
 * Names, capitals (+ positions from GeoNames) and fame: data/na-regions.json.
 * Cities: data/na-cities.json · landmarks & facts: data/na-questions.json · flags: flags/regions/<code>.svg
 * (public domain, from the region-flags package, optimised with svgo). */
const NA_FILE = path.join(nm, 'natural-earth/ne_50m_admin_1_states_provinces_lakes.geojson');
if (fs.existsSync(NA_FILE)) {
  const info = JSON.parse(fs.readFileSync(path.join(OUT, 'data/na-regions.json'), 'utf8'));
  const admin1 = JSON.parse(fs.readFileSync(NA_FILE, 'utf8')).features.filter((f) => ['US', 'CA'].includes(f.properties.iso_a2));
  const regions = [];
  for (const f of admin1) {
    const code = f.properties.iso_3166_2;
    const meta = info[code];
    const parent = f.properties.iso_a2 === 'US' ? 'USA' : 'CAN';
    const d = pathGen(f);
    const area = pathGen.area(f);
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null, bestA = -1;
    for (const poly of polys) { const a = pathGen.area({ type: 'Polygon', coordinates: poly }); if (a > bestA) { bestA = a; best = poly; } }
    const [cx, cy] = area < 3 ? pathGen.centroid(f) : polylabel(best.map((ring) => ring.map((pt) => proj(pt))), 0.3);
    const b = pathGen.bounds(f);
    const bm = pathGen.bounds({ type: 'Polygon', coordinates: best });
    const r = {
      id: code, name: meta ? meta.name : f.properties.name, parent, d,
      c: [Math.round(cx * 10) / 10, Math.round(cy * 10) / 10], b: b.map((p) => p.map((v) => Math.round(v * 10) / 10)),
      small: area < 3 ? 1 : 0, region: 'North America',
      kind: f.properties.type_en === 'Federal District' ? 'district' : f.properties.type_en.toLowerCase(),
    };
    // Alaska: zoom to the main part (without the Aleutian chain)
    if (code === 'US-AK') r.mb = bm.map((p) => p.map((v) => Math.round(v * 10) / 10));
    if (meta) {
      const [x, y] = proj([meta.lon, meta.lat]);
      Object.assign(r, { fame: meta.fame, capital: meta.capital, cp: [Math.round(x * 10) / 10, Math.round(y * 10) / 10], flag: `regions/${code}`, iso2: code });
      if (meta.capAdj) r.capAdj = meta.capAdj;
      if (!fs.existsSync(path.join(OUT, `flags/regions/${code}.svg`))) throw new Error(`no flag for ${code}`);
    }
    regions.push(r);
  }
  const byCode = new Map(regions.map((r) => [r.id, r]));
  const naCities = JSON.parse(fs.readFileSync(path.join(OUT, 'data/na-cities.json'), 'utf8')).map((c) => {
    if (!byCode.get(c.code) || !byCode.get(c.code).fame) throw new Error(`city ${c.city}: unknown region ${c.code}`);
    const [x, y] = proj([c.lon, c.lat]);
    return { id: c.id, name: c.city, region: c.code, country: byCode.get(c.code).parent, tier: c.tier, p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10], ...(c.note ? { note: c.note } : {}) };
  });
  // landmarks & facts (geography), history, culture, sports: [category, file]
  const ids = new Set();
  const naQuestions = [['geo', 'na-questions.json'], ['history', 'na-history.json'], ['culture', 'na-culture.json'], ['sports', 'na-sports.json']]
    .filter(([, file]) => fs.existsSync(path.join(OUT, 'data', file)))
    .flatMap(([cat, file]) => JSON.parse(fs.readFileSync(path.join(OUT, 'data', file), 'utf8')).map((q) => {
      if (ids.has(q.id)) throw new Error(`${file}: duplicate id ${q.id}`);
      ids.add(q.id);
      if (!byCode.get(q.answer.code) || !byCode.get(q.answer.code).fame) throw new Error(`${q.id}: unknown region ${q.answer.code}`);
      if (!(q.difficulty >= 1 && q.difficulty <= 6)) throw new Error(`${q.id}: difficulty 1-6`);
      return { id: q.id, cat, lvl: q.difficulty, q: q.question.trim(), a: q.answer.code };
    }));
  fs.writeFileSync(path.join(OUT, 'data/regions.js'), '// Generated by tools/build-data.js (Natural Earth admin-1 + data/na-*.json). Do not edit.\nwindow.REGIONS = '
    + JSON.stringify({ regions, cities: naCities, questions: naQuestions, route: buildRoute(path.join(OUT, 'data/route-na.json')) }) + ';\n');
  console.log('regions', regions.length, 'playable', regions.filter((r) => r.fame).length, 'cities', naCities.length, 'questions', naQuestions.length,
    ['geo', 'history', 'culture', 'sports'].map((c) => `${c} ${naQuestions.filter((q) => q.cat === c).length}`).join(' '),
    'size', fs.statSync(path.join(OUT, 'data/regions.js')).size);
}
// Physical geography for the blind map -> data/physical.js (needs the Natural Earth physical files)
require('./build-physical.js')({ nm, OUT, d3, proj, polylabel, countries: out, geomById });
fs.writeFileSync(path.join(OUT, 'data/world.js'), '// Generated by tools/build-data.js from world-atlas (Natural Earth) + world-countries. Do not edit.\nwindow.WORLD = ' + JSON.stringify(data) + ';\n');
const tiers = [1, 2, 3, 4, 5].map(n => out.filter(o => o.fame === n).length);
console.log('route ports', route ? route.ports.length : 0, 'cities', cityList.length, 'countries', out.length, 'playable tiers', tiers, 'H', H, 'size', fs.statSync(path.join(OUT, 'data/world.js')).size);
console.log('non-playable:', out.filter(o => !o.fame).map(o => o.name).join(', '));
