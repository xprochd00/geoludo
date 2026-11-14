/* Question generation.
 * Every question has a difficulty level 1-6 (the dice value, or the rescue level of a threatened piece).
 *  - Geography: country fame level (1-5) + an offset for the question type; cities use their own tier.
 *  - History & Geopolitics and Sports & Culture: the difficulty ratings from the question files.
 * Questions are drawn at random without repeats until a level's pool is used up. */
(function () {
  const LEVELS = {
    1: { label: 'Very easy' }, 2: { label: 'Easy' }, 3: { label: 'Moderate' },
    4: { label: 'Tricky' }, 5: { label: 'Hard' }, 6: { label: 'Expert' },
  };
  const MODES = {
    geo: { label: 'Geography' },
    history: { label: 'History & Geopolitics' },
    culture: { label: 'Sports & Culture' },
    mixed: { label: 'Mixed' },
  };
  const CATEGORIES = ['geo', 'history', 'culture'];
  const CULTURE_TAGS = { music: 'Music', film: 'Film & TV', art: 'Art', sport: 'Sport', games: 'Games', literature: 'Literature' };

  const W = window.WORLD;
  const countries = W.countries.filter((c) => c.fame);
  const byId = new Map(W.countries.map((c) => [c.id, c]));
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // A capital / city question is pointless if the place name gives the country away (e.g. "Kuwait City").
  const givesAway = (place, c) => {
    const a = norm(place), b = norm(c.name);
    return a.includes(b) || b.includes(a) || a.split(/[\s-]/)[0] === b.split(/[\s-]/)[0];
  };
  const emptyPools = () => ({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

  /* ---------- Pools ---------- */
  const POOLS = { geo: emptyPools(), history: emptyPools(), culture: emptyPools() };
  const add = (cat, lvl, q) => { if (lvl >= 1 && lvl <= 6) POOLS[cat][lvl].push(q); };

  for (const c of countries) {
    add('geo', c.fame, { type: 'name', c, key: 'n:' + c.id });
    add('geo', c.fame + 1, { type: 'flag', c, key: 'f:' + c.id });
    if (!c.noCap && !givesAway(c.capital, c)) add('geo', c.fame + 1, { type: 'capital', c, key: 'c:' + c.id });
  }
  const skippedCities = [];
  for (const city of W.cities || []) {
    const c = byId.get(city.country);
    if (givesAway(city.name, c)) { skippedCities.push(city.name); continue; }
    add('geo', city.tier, { type: 'city', c, city, key: 'y:' + city.id });
  }
  for (const h of window.HISTORY_QUESTIONS || []) {
    if (byId.has(h.a)) add('history', h.lvl, { type: 'history', c: byId.get(h.a), h, key: 'h:' + h.id });
  }
  for (const h of window.CULTURE_QUESTIONS || []) {
    if (byId.has(h.a)) add('culture', h.lvl, { type: 'culture', c: byId.get(h.a), h, key: 'k:' + h.id });
  }

  /* ---------- Drawing ---------- */
  const used = new Set();
  const catCount = { geo: 0, history: 0, culture: 0 };
  let lastCountry = null;
  let lastType = null;

  function draw(pool) {
    let fresh = pool.filter((q) => !used.has(q.key));
    if (!fresh.length) { pool.forEach((q) => used.delete(q.key)); fresh = pool.slice(); }
    // Prefer a different country (and, for geography, a different question type) than last time.
    const varied = fresh.filter((q) => q.c.id !== lastCountry && (q.type !== lastType || !['name', 'flag', 'capital', 'city'].includes(q.type)));
    const list = varied.length ? varied : fresh;
    const q = list[(Math.random() * list.length) | 0];
    used.add(q.key);
    lastCountry = q.c.id;
    lastType = q.type;
    return q;
  }

  /** Mixed mode: pick randomly among the categories asked least so far, so each gets about a third. */
  function pickCategory(level) {
    const avail = CATEGORIES.filter((cat) => POOLS[cat][level].length);
    const min = Math.min(...avail.map((cat) => catCount[cat]));
    const behind = avail.filter((cat) => catCount[cat] === min);
    return behind[(Math.random() * behind.length) | 0];
  }

  function next(level, mode) {
    const cat = mode === 'mixed' ? pickCategory(level) : (POOLS[mode] ? mode : 'geo');
    catCount[cat]++;
    const pick = draw(POOLS[cat][level]);
    const c = pick.c;
    const q = { level, levelLabel: LEVELS[level].label, country: c, type: pick.type, category: cat };
    switch (pick.type) {
      case 'name':
        q.kind = 'Find this country on the map'; q.prompt = c.name; q.tag = 'Country'; break;
      case 'capital':
        q.kind = 'Which country has this capital city?'; q.prompt = c.capital; q.tag = 'Capital'; break;
      case 'city':
        q.kind = 'In which country is this city?'; q.prompt = pick.city.name; q.city = pick.city.name;
        q.pin = pick.city.p; q.tag = 'City'; break;
      case 'flag':
        q.kind = 'Which country does this flag belong to?'; q.prompt = 'Click its country'; q.flag = `flags/${c.flag}.svg`; q.tag = 'Flag'; break;
      case 'history':
        q.tag = pick.h.cat === 'geopolitics' ? 'Geopolitics' : 'History';
        q.kind = 'Click the answer on the map'; q.prompt = pick.h.q; q.ref = pick.h; break;
      case 'culture':
        q.tag = CULTURE_TAGS[pick.h.cat] || 'Culture';
        q.kind = 'Click the answer on the map'; q.prompt = pick.h.q; q.ref = pick.h; break;
    }
    return q;
  }

  function resetUsed() {
    used.clear();
    lastCountry = lastType = null;
    CATEGORIES.forEach((cat) => { catCount[cat] = 0; });
  }
  const poolSizes = () => [1, 2, 3, 4, 5, 6].map((l) => ({ level: l, geo: POOLS.geo[l].length, history: POOLS.history[l].length, culture: POOLS.culture[l].length }));
  const stats = () => ({ ...catCount });

  window.Quiz = { next, LEVELS, MODES, resetUsed, poolSizes, stats, skippedCities };
})();
