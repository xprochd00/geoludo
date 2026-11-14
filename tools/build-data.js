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

// Well-known non-capital cities (most famous first).
const CITIES = {
  USA: ['New York', 'Los Angeles', 'Chicago'], CAN: ['Toronto', 'Montreal', 'Vancouver'], MEX: ['Guadalajara', 'Monterrey', 'Cancún'],
  BRA: ['Rio de Janeiro', 'São Paulo', 'Salvador'], ARG: ['Córdoba', 'Rosario', 'Mendoza'], GBR: ['Manchester', 'Liverpool', 'Edinburgh'],
  FRA: ['Marseille', 'Lyon', 'Nice'], DEU: ['Munich', 'Hamburg', 'Frankfurt'], ITA: ['Milan', 'Venice', 'Naples'],
  ESP: ['Barcelona', 'Seville', 'Bilbao'], RUS: ['Saint Petersburg', 'Novosibirsk', 'Vladivostok'], CHN: ['Shanghai', 'Guangzhou', 'Shenzhen'],
  JPN: ['Osaka', 'Kyoto', 'Hiroshima'], IND: ['Mumbai', 'Kolkata', 'Bengaluru'], AUS: ['Sydney', 'Melbourne', 'Perth'],
  EGY: ['Alexandria', 'Luxor', 'Aswan'], ZAF: ['Cape Town', 'Johannesburg', 'Durban'], TUR: ['Istanbul', 'Izmir', 'Antalya'],
  GRC: ['Thessaloniki', 'Patras'], PRT: ['Porto', 'Coimbra'], NOR: ['Bergen', 'Trondheim'], SWE: ['Gothenburg', 'Malmö'],
  POL: ['Kraków', 'Gdańsk', 'Wrocław'], UKR: ['Odesa', 'Kharkiv', 'Lviv'], SAU: ['Jeddah', 'Mecca', 'Medina'],
  CHL: ['Valparaíso', 'Antofagasta'], PER: ['Cusco', 'Arequipa'], COL: ['Medellín', 'Cartagena', 'Cali'], VEN: ['Maracaibo', 'Valencia'],
  CUB: ['Santiago de Cuba'], IRL: ['Cork', 'Galway'], FIN: ['Tampere', 'Turku'], NLD: ['Rotterdam', 'The Hague', 'Utrecht'],
  BEL: ['Antwerp', 'Bruges', 'Ghent'], CHE: ['Zurich', 'Geneva', 'Basel'], AUT: ['Salzburg', 'Innsbruck', 'Graz'],
  DNK: ['Aarhus', 'Odense'], CZE: ['Brno', 'Ostrava'], HUN: ['Debrecen', 'Szeged'], ROU: ['Cluj-Napoca', 'Timișoara', 'Constanța'],
  NGA: ['Lagos', 'Kano', 'Ibadan'], KEN: ['Mombasa', 'Kisumu'], MAR: ['Casablanca', 'Marrakesh', 'Fez'], ETH: ['Dire Dawa', 'Gondar'],
  DZA: ['Oran', 'Constantine'], IRN: ['Isfahan', 'Shiraz', 'Tabriz'], IRQ: ['Basra', 'Mosul', 'Erbil'], ISR: ['Tel Aviv', 'Haifa'],
  KAZ: ['Almaty', 'Shymkent'], THA: ['Chiang Mai', 'Phuket'], KOR: ['Busan', 'Incheon'], PAK: ['Karachi', 'Lahore', 'Peshawar'],
  IDN: ['Surabaya', 'Bandung', 'Denpasar'], NZL: ['Auckland', 'Christchurch'], PHL: ['Cebu City', 'Davao City'],
  VNM: ['Ho Chi Minh City', 'Da Nang'], AFG: ['Kandahar', 'Herat'], BOL: ['Santa Cruz de la Sierra', 'La Paz'],
  ECU: ['Guayaquil', 'Cuenca'], URY: ['Punta del Este'], SVK: ['Košice', 'Žilina'], BGR: ['Plovdiv', 'Varna'], SRB: ['Novi Sad', 'Niš'],
  HRV: ['Split', 'Dubrovnik'], BIH: ['Mostar', 'Banja Luka'], SVN: ['Maribor'], LTU: ['Kaunas', 'Klaipėda'], LVA: ['Daugavpils'],
  EST: ['Tartu'], GEO: ['Batumi', 'Kutaisi'], SYR: ['Aleppo', 'Homs'], JOR: ['Aqaba', 'Petra'], ARE: ['Dubai', 'Sharjah'],
  UZB: ['Samarkand', 'Bukhara'], MYS: ['George Town', 'Malacca'], MMR: ['Yangon', 'Mandalay'], BGD: ['Chittagong'],
  LKA: ['Kandy', 'Galle'], LBY: ['Benghazi'], TUN: ['Sfax', 'Kairouan'], SDN: ['Omdurman', 'Port Sudan'], COD: ['Lubumbashi', 'Goma'],
  AGO: ['Huambo', 'Benguela'], TZA: ['Dar es Salaam', 'Zanzibar City', 'Arusha'], GHA: ['Kumasi'], CMR: ['Douala'],
  CIV: ['Abidjan'], SEN: ['Saint-Louis', 'Touba'], ZWE: ['Bulawayo'], ZMB: ['Livingstone', 'Ndola'], MOZ: ['Beira'],
  NAM: ['Swakopmund'], BEN: ['Cotonou'], MLI: ['Timbuktu'], BLR: ['Brest', 'Grodno'], MDA: ['Bălți'], CYP: ['Limassol'],
  YEM: ['Aden'], NPL: ['Pokhara'], KHM: ['Siem Reap'], TWN: ['Kaohsiung'], PNG: ['Lae'],
};

const byNum = new Map(countries.filter(c => c.ccn3).map(c => [c.ccn3, c]));
const byName = new Map(countries.map(c => [c.name.common, c]));
const NAME_FIX = { 'Kosovo': 'Kosovo' };
const MERGE = { 'Somaliland': '706', 'N. Cyprus': '196' };

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
    small: area < 6 ? 1 : 0,
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
    if (CITIES[c.cca3]) rec.cities = CITIES[c.cca3];
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
for (const id of Object.keys(CITIES)) if (!fameOf[id]) console.warn('cities for unknown', id);
out.sort((a, b) => a.name.localeCompare(b.name));
const data = { w: W, h: H, graticule, outline, countries: out };
fs.writeFileSync(path.join(OUT, 'data/world.js'), '// Generated by tools/build-data.js from world-atlas (Natural Earth) + world-countries. Do not edit.\nwindow.WORLD = ' + JSON.stringify(data) + ';\n');
const tiers = [1, 2, 3, 4, 5].map(n => out.filter(o => o.fame === n).length);
console.log('countries', out.length, 'playable tiers', tiers, 'H', H, 'size', fs.statSync(path.join(OUT, 'data/world.js')).size);
console.log('non-playable:', out.filter(o => !o.fame).map(o => o.name).join(', '));
