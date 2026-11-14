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
// (name +0, flag +1, capital +1, major city +1/+2). Unlisted countries default to 4.
const FAME = {
  1: `USA CAN MEX BRA ARG GBR FRA DEU ITA ESP RUS CHN JPN IND AUS EGY ZAF TUR GRC PRT NOR SWE POL UKR SAU`,
  2: `CHL PER COL VEN CUB IRL FIN NLD BEL CHE AUT DNK ISL CZE HUN ROU NGA KEN MAR ETH DZA IRN IRQ ISR KAZ
      MNG THA KOR PRK PAK IDN NZL PHL VNM AFG`,
  3: `BOL ECU PRY URY PAN CRI GTM JAM HTI DOM SVK BGR SRB HRV BIH SVN ALB MKD MNE BLR LTU LVA EST MDA GEO
      ARM AZE CYP LUX SYR JOR LBN KWT QAT ARE OMN YEM UZB TKM MYS SGP MMR BGD NPL LKA LBY TUN SDN SSD SOM
      COD AGO NAM BWA ZWE ZMB MOZ MDG TZA UGA GHA SEN CMR CIV KHM LAO PNG TWN`,
  4: `GUY SUR BLZ HND NIC SLV BHS TTO KGZ TJK BTN BRN TLS MRT MLI NER TCD CAF COG GAB GNQ BEN TGO BFA GIN
      GMB GNB SLE LBR ERI DJI RWA BDI MWI LSO SWZ FJI BHR MLT MCO VAT AND LIE SMR PSE UNK`,
  5: `CPV COM STP SYC MUS MDV ATG BRB DMA GRD KNA LCA VCT KIR MHL FSM NRU PLW SLB TON TUV VUT WSM`,
};
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
  const rec = {
    id: c ? c.cca3 : 'X' + f.key.replace(/\W/g, ''),
    name: c ? c.name.common : f.atlasName,
    d,
    c: [Math.round(cx * 10) / 10, Math.round(cy * 10) / 10],
    b: b.map(p => p.map(v => Math.round(v))),
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
    if (!fameOf[c.cca3]) console.warn('defaulted fame 4:', c.cca3, c.name.common);
  }
  out.push(rec);
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
out.sort((a, b) => a.name.localeCompare(b.name));
const data = { w: W, h: H, graticule, outline, countries: out, cities: cityList };
fs.writeFileSync(path.join(OUT, 'data/world.js'), '// Generated by tools/build-data.js from world-atlas (Natural Earth) + world-countries. Do not edit.\nwindow.WORLD = ' + JSON.stringify(data) + ';\n');
const tiers = [1, 2, 3, 4, 5].map(n => out.filter(o => o.fame === n).length);
console.log('cities', cityList.length, 'countries', out.length, 'playable tiers', tiers, 'H', H, 'size', fs.statSync(path.join(OUT, 'data/world.js')).size);
console.log('non-playable:', out.filter(o => !o.fame).map(o => o.name).join(', '));
