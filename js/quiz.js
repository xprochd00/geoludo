/* Question generation.
 * The dice value is the difficulty level (1-6).
 * Geography questions: difficulty = country fame level (1-5) + offset for the question type.
 * History / geopolitics questions come from data/history.js with their own difficulty ratings. */
(function () {
  const LEVELS = {
    1: { label: 'Very easy' }, 2: { label: 'Easy' }, 3: { label: 'Moderate' },
    4: { label: 'Tricky' }, 5: { label: 'Hard' }, 6: { label: 'Expert' },
  };
  const MODES = {
    geo: { label: 'Geography' },
    history: { label: 'History & Geopolitics' },
    mixed: { label: 'Mixed' },
  };

  const countries = window.WORLD.countries.filter((c) => c.fame);
  const byId = new Map(window.WORLD.countries.map((c) => [c.id, c]));
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // A capital / city question is pointless if the place name gives the country away (e.g. "Kuwait City").
  const givesAway = (place, c) => {
    const a = norm(place), b = norm(c.name);
    return a.includes(b) || b.includes(a) || a.split(/[\s-]/)[0] === b.split(/[\s-]/)[0];
  };

  /* ---------- Geography pool ---------- */
  const GEO = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const add = (lvl, q) => { if (lvl >= 1 && lvl <= 6) GEO[lvl].push(q); };
  for (const c of countries) {
    add(c.fame, { type: 'name', c, key: 'n:' + c.id });
    add(c.fame + 1, { type: 'flag', c, key: 'f:' + c.id });
    if (!c.noCap && !givesAway(c.capital, c)) add(c.fame + 1, { type: 'capital', c, key: 'c:' + c.id });
    (c.cities || []).forEach((city, i) => {
      if (!givesAway(city, c)) add(c.fame + 1 + i, { type: 'city', c, city, key: 'y:' + city });
    });
  }

  /* ---------- History pool ---------- */
  const HIST = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const h of window.HISTORY_QUESTIONS || []) {
    if (byId.has(h.a)) HIST[h.lvl].push({ type: 'history', c: byId.get(h.a), h, key: 'h:' + h.id });
  }

  const used = new Set();
  let lastCountry = null;
  let lastType = null;

  function draw(pool) {
    let fresh = pool.filter((q) => !used.has(q.key));
    if (!fresh.length) { pool.forEach((q) => used.delete(q.key)); fresh = pool.slice(); }
    // Prefer a different country (and, for geography, a different question type) than last time.
    const varied = fresh.filter((q) => q.c.id !== lastCountry && (q.type === 'history' || q.type !== lastType));
    const list = varied.length ? varied : fresh;
    const q = list[(Math.random() * list.length) | 0];
    used.add(q.key);
    lastCountry = q.c.id;
    lastType = q.type;
    return q;
  }

  function next(level, mode) {
    const useHistory = mode === 'history' || (mode === 'mixed' && Math.random() < 0.5);
    const pick = draw(useHistory && HIST[level].length ? HIST[level] : GEO[level]);
    const c = pick.c;
    const q = { level, levelLabel: LEVELS[level].label, country: c, type: pick.type };
    switch (pick.type) {
      case 'name':
        q.kind = 'Find this country on the map'; q.prompt = c.name; q.tag = 'Country'; break;
      case 'capital':
        q.kind = 'Which country has this capital city?'; q.prompt = c.capital; q.tag = 'Capital'; break;
      case 'city':
        q.kind = 'In which country is this city?'; q.prompt = pick.city; q.city = pick.city; q.tag = 'City'; break;
      case 'flag':
        q.kind = 'Which country does this flag belong to?'; q.prompt = 'Click its country'; q.flag = `flags/${c.flag}.svg`; q.tag = 'Flag'; break;
      case 'history':
        q.tag = pick.h.cat === 'geopolitics' ? 'Geopolitics' : 'History';
        q.kind = 'Click the answer on the map';
        q.prompt = pick.h.q; q.history = pick.h; break;
    }
    return q;
  }

  function resetUsed() { used.clear(); lastCountry = lastType = null; }
  const poolSizes = () => [1, 2, 3, 4, 5, 6].map((l) => ({ level: l, geo: GEO[l].length, history: HIST[l].length }));

  window.Quiz = { next, LEVELS, MODES, resetUsed, poolSizes };
})();
