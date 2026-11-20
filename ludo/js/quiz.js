/* Question generation.
 * Every question has a difficulty level 1-6 (the dice value, or the rescue level of a threatened piece).
 *  - Geography: country fame level (1-5) + an offset for the question type (name +0, flag +1, capital +1)
 *    + the per-country adjustments capAdj / flagAdj from tools/build-data.js, clamped to 1-6. Cities use
 *    their tier; the extra geography questions use their own ratings.
 *  - History & Geopolitics, Sports and Culture: the difficulty ratings from the question files.
 * Questions are drawn at random from those not asked yet. The record of asked questions is kept across
 * games (and page reloads, via localStorage); once a level's pool has been used up, new draws come from
 * the least recently asked half, so recent questions never come straight back. */
(function () {
  const LEVELS = {
    1: { label: 'Very easy' }, 2: { label: 'Easy' }, 3: { label: 'Moderate' },
    4: { label: 'Tricky' }, 5: { label: 'Hard' }, 6: { label: 'Expert' },
  };
  const MODES = {
    geo: { label: 'Geography' },
    history: { label: 'History & Geopolitics' },
    sports: { label: 'Sports' },
    culture: { label: 'Culture' },
    mixed: { label: 'Mixed' },
  };
  const CATEGORIES = ['geo', 'history', 'sports', 'culture'];
  // Tag shown on the question card: the culture subcategory, in title case ("art & architecture" -> "Art & Architecture").
  const titleCase = (s) => s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

  const W = window.WORLD;
  const countries = W.countries.filter((c) => c.fame);
  const byId = new Map(W.countries.map((c) => [c.id, c]));
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // A capital / city question is pointless if the place name gives the country away (e.g. "Kuwait City").
  const givesAway = (place, c) => {
    const a = norm(place), b = norm(c.name);
    return a.includes(b) || b.includes(a) || a.split(/[\s-]/)[0] === b.split(/[\s-]/)[0];
  };
  // History and culture questions are keyed by their text, so the same question appearing in both
  // files (e.g. the Taj Mahal) counts as one question.
  const textKey = (q) => 'q:' + norm(q).replace(/[^a-z0-9]/g, '');
  const emptyPools = () => ({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

  /* ---------- Pools ---------- */
  const POOLS = { geo: emptyPools(), history: emptyPools(), sports: emptyPools(), culture: emptyPools() };
  const add = (cat, lvl, q) => { if (lvl >= 1 && lvl <= 6) POOLS[cat][lvl].push(q); };
  const clamp = (lvl) => Math.min(6, Math.max(1, lvl));

  for (const c of countries) {
    add('geo', c.fame, { type: 'name', c, key: 'n:' + c.id });
    add('geo', clamp(c.fame + 1 + (c.flagAdj || 0)), { type: 'flag', c, key: 'f:' + c.id });
    if (!c.noCap && !givesAway(c.capital, c)) add('geo', clamp(c.fame + 1 + (c.capAdj || 0)), { type: 'capital', c, key: 'c:' + c.id });
  }
  const skippedCities = [];
  for (const city of W.cities || []) {
    const c = byId.get(city.country);
    if (givesAway(city.name, c)) { skippedCities.push(city.name); continue; }
    add('geo', city.tier, { type: 'city', c, city, key: 'y:' + city.id });
  }
  /* US states, Canadian provinces & territories (data/regions.js, when the page loads it): the same kinds
   * of geography question, marked na: they are asked only when the game's scope includes them (setScope). */
  const RG = window.REGIONS;
  if (RG) {
    const rById = new Map(RG.regions.map((r) => [r.id, r]));
    for (const r of RG.regions.filter((x) => x.fame)) {
      add('geo', r.fame, { type: 'name', c: r, key: 'n:' + r.id, na: 1 });
      add('geo', clamp(r.fame + 2), { type: 'flag', c: r, key: 'f:' + r.id, na: 1 }); // state flags are hard to tell apart
      if (!givesAway(r.capital, r)) add('geo', clamp(r.fame + 1 + (r.capAdj || 0)), { type: 'capital', c: r, key: 'c:' + r.id, na: 1 });
    }
    for (const city of RG.cities) {
      const r = rById.get(city.region);
      if (givesAway(city.name, r)) { skippedCities.push(city.name); continue; }
      add('geo', city.tier, { type: 'city', c: r, city, key: 'y:' + city.id, na: 1 });
    }
    for (const h of RG.questions) add('geo', h.lvl, { type: 'geoq', c: rById.get(h.a), h, key: textKey(h.q), na: 1 });
  }
  // 'world' (countries) · 'world+na' (countries + states & provinces) · 'na' (states & provinces only)
  let scope = 'world';
  const inScope = (q) => (q.na ? scope !== 'world' : scope !== 'na');
  function setScope(s) { scope = ['world', 'world+na', 'na'].includes(s) && RG ? s : 'world'; }
  /** The map / question scopes a game can offer (shown in a menu on each setup screen). */
  const SCOPES = [
    { value: 'world', label: '🌍 World', note: 'All countries' },
    { value: 'world+na', label: '🌎 World + US states & Canada', note: 'Countries, with the USA and Canada split into states and provinces' },
    { value: 'na', label: '🇺🇸 US states & Canadian provinces', note: 'Only those, on a map of North America (geography questions)' },
  ];

  // Text questions: [category, question type, data]
  for (const [cat, type, list] of [
    ['history', 'history', window.HISTORY_QUESTIONS],
    ['sports', 'sports', window.SPORTS_QUESTIONS],
    ['culture', 'culture', window.CULTURE_QUESTIONS],
    ['geo', 'geoq', window.GEO_EXTRA_QUESTIONS],
  ]) {
    for (const h of list || []) if (byId.has(h.a)) add(cat, h.lvl, { type, c: byId.get(h.a), h, key: textKey(h.q) });
  }

  /* ---------- Asked-question history (persists across games) ---------- */
  const STORE = 'geoludo.asked.v1';
  let history = { seq: 0, keys: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && saved.keys) history = saved;
  } catch (e) { /* storage unavailable: keep the history in memory only */ }
  const save = () => { if (!shared) try { localStorage.setItem(STORE, JSON.stringify(history)); } catch (e) { /* ignore */ } };
  // Online games: every device must draw the same questions, so they use a shared random source and a
  // fresh in-memory history (this device's own record is left untouched and restored afterwards).
  let rand = Math.random;
  let shared = null;
  function setShared(rng) {
    if (rng) { if (!shared) shared = history; history = { seq: 0, keys: {} }; } // every online game starts fresh
    else if (shared) { history = shared; shared = null; }
    rand = rng || Math.random;
  }

  const catCount = { geo: 0, history: 0, sports: 0, culture: 0 };
  const RECENT = 8; // avoid answer countries used in the last few questions
  let recent = [];
  let lastType = null;

  function draw(pool) {
    const seen = (q) => history.keys[q.key];
    let candidates = pool.filter((q) => seen(q) == null);
    if (!candidates.length) {
      // Everything at this level has been asked: draw from the least recently asked half.
      const sorted = pool.slice().sort((a, b) => seen(a) - seen(b));
      candidates = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    }
    // Prefer an answer country not used recently and (for geography) a different question type.
    const geoTypes = ['name', 'flag', 'capital', 'city'];
    const varied = candidates.filter((q) => !recent.includes(q.c.id) && (q.type !== lastType || !geoTypes.includes(q.type)));
    const list = varied.length ? varied : candidates;
    const q = list[Math.floor(rand() * list.length)];
    history.keys[q.key] = ++history.seq;
    save();
    recent = [q.c.id, ...recent].slice(0, RECENT);
    lastType = q.type;
    return q;
  }

  /** Mixed mode: pick randomly among the chosen categories asked least so far, so each gets an equal share. */
  function pickCategory(level, cats) {
    const avail = cats.filter((cat) => POOLS[cat] && POOLS[cat][level].length);
    const min = Math.min(...avail.map((cat) => catCount[cat]));
    const behind = avail.filter((cat) => catCount[cat] === min);
    return behind[Math.floor(rand() * behind.length)];
  }

  /** cats: the categories combined in Mixed mode (default: all three). */
  function next(level, mode, cats = CATEGORIES, geoType = 'all') {
    const cat = mode === 'mixed' ? pickCategory(level, cats) : (POOLS[mode] ? mode : 'geo');
    catCount[cat]++;
    return describe(draw(geoPool(cat, level, geoType)), level, cat);
  }

  /* Geography question types a game can be limited to (one, or all). */
  const GEO_TYPES = { all: 'All types', name: 'Countries', flag: 'Flags', capital: 'Capitals', city: 'Cities', geoq: 'Landmarks & facts' };
  /** The pool to draw from; for one geography type, its questions at this level (or the nearest level that has some). */
  function geoPool(cat, level, geoType) {
    const typed = cat === 'geo' && geoType && geoType !== 'all' && GEO_TYPES[geoType];
    const ok = (q) => inScope(q) && (!typed || q.type === geoType);
    for (let d = 0; d < 6; d++) {
      for (const l of [level - d, level + d]) {
        const pool = l >= 1 && l <= 6 ? POOLS[cat][l].filter(ok) : [];
        if (pool.length) return pool;
      }
    }
    return POOLS[cat][level];
  }

  /** Turn a pool entry into a question object for the UI (also used by the training page). */
  function describe(pick, level, cat) {
    const c = pick.c;
    const q = { level, levelLabel: LEVELS[level].label, country: c, type: pick.type, category: cat, key: pick.key };
    if (c.parent) return describeRegion(q, pick, c);
    switch (pick.type) {
      case 'name':
        q.kind = 'Find this country on the map'; q.prompt = c.name; q.tag = 'Country'; break;
      case 'capital':
        q.kind = 'Which country has this capital city?'; q.prompt = c.capital; q.tag = 'Capital';
        // shown on the map with the answer (not when it lies across the date line from the country's marker)
        if (c.cp && Math.hypot(c.cp[0] - c.c[0], c.cp[1] - c.c[1]) < 250) { q.pin = c.cp; q.city = c.capital; }
        break;
      case 'city':
        q.kind = 'In which country is this city?'; q.prompt = pick.city.name; q.city = pick.city.name;
        q.pin = pick.city.p; q.tag = 'City'; break;
      case 'flag':
        q.kind = 'Which country does this flag belong to?'; q.prompt = 'Click its country'; q.flag = `../flags/${c.flag}.svg`; q.tag = 'Flag'; break;
      case 'history':
        q.tag = pick.h.cat === 'geopolitics' ? 'Geopolitics' : 'History';
        q.kind = 'Click the answer on the map'; q.prompt = pick.h.q; q.ref = pick.h; break;
      case 'sports':
        q.tag = 'Sport';
        q.kind = 'Click the answer on the map'; q.prompt = pick.h.q; q.ref = pick.h; break;
      case 'culture':
        q.tag = pick.h.sub ? titleCase(pick.h.sub) : 'Culture';
        q.kind = 'Click the answer on the map'; q.prompt = pick.h.q; q.ref = pick.h; break;
      case 'geoq':
        q.tag = 'Geography';
        q.kind = 'Click the answer on the map'; q.prompt = pick.h.q; q.ref = pick.h; break;
    }
    return q;
  }

  /** A question about a US state or a Canadian province / territory. */
  function describeRegion(q, pick, c) {
    const what = c.parent === 'USA' ? 'US state' : c.kind === 'territory' ? 'Canadian territory' : 'Canadian province';
    q.tag = c.parent === 'USA' ? 'US state' : 'Canada';
    switch (pick.type) {
      case 'name': q.kind = `Find this ${what} on the map`; q.prompt = c.name; break;
      case 'capital': q.kind = 'Which state or province has this capital?'; q.prompt = c.capital; q.tag += ' · capital'; if (c.cp) { q.pin = c.cp; q.city = c.capital; } break;
      case 'city': q.kind = 'In which state or province is this city?'; q.prompt = pick.city.name; q.city = pick.city.name; q.pin = pick.city.p; q.tag += ' · city'; break;
      case 'flag': q.kind = 'Which state or province has this flag?'; q.prompt = 'Click it on the map'; q.flag = `../flags/${c.flag}.svg`; q.tag += ' · flag'; break;
      default: q.kind = 'Click the answer on the map'; q.prompt = pick.h.q; q.ref = pick.h; break;
    }
    return q;
  }

  /** A new game: reset the category balance, but keep the record of asked questions. */
  function newGame() {
    recent = [];
    lastType = null;
    CATEGORIES.forEach((cat) => { catCount[cat] = 0; });
  }
  /** Forget every asked question (all questions become "new" again). */
  function clearHistory() {
    history = { seq: 0, keys: {} };
    save();
  }
  const allKeys = new Set(CATEGORIES.flatMap((cat) => [1, 2, 3, 4, 5, 6].flatMap((l) => POOLS[cat][l].map((q) => q.key))));
  const unseenCount = () => [...allKeys].filter((k) => history.keys[k] == null).length;
  const totalCount = () => allKeys.size;
  const poolSizes = () => [1, 2, 3, 4, 5, 6].map((l) => ({ level: l, ...Object.fromEntries(CATEGORIES.map((cat) => [cat, POOLS[cat][l].length])) }));
  const stats = () => ({ ...catCount });

  window.Quiz = { SCOPES, setScope, inScope: (q) => inScope(q), get scope() { return scope; }, GEO_TYPES, setShared, next, describe, pools: POOLS, LEVELS, MODES, CATEGORIES, newGame, clearHistory, unseenCount, totalCount, poolSizes, stats, skippedCities };
})();
