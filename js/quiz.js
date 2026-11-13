/* Question generation. Dice 1-2 → easy, 3-4 → medium, 5-6 → hard. */
(function () {
  const LEVELS = {
    easy: { label: 'Easy', tier: 1, weights: { name: 5, flag: 3, capital: 2 } },
    medium: { label: 'Medium', tier: 2, weights: { name: 4, flag: 3, capital: 3 } },
    hard: { label: 'Hard', tier: 3, weights: { name: 3, flag: 3, capital: 4 } },
  };
  const levelForRoll = (n) => (n <= 2 ? 'easy' : n <= 4 ? 'medium' : 'hard');

  const pool = window.WORLD.countries.filter((c) => c.tier);
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // A capital question is pointless if the capital gives the country away (e.g. "Kuwait City").
  const capitalGivesAway = (c) => {
    const a = norm(c.capital), b = norm(c.name);
    return a.includes(b) || b.includes(a) || a.split(/[\s-]/)[0] === b.split(/[\s-]/)[0];
  };

  const used = new Set();
  let lastType = null;

  function weightedType(weights, c) {
    const opts = Object.entries(weights).filter(([t]) => !(t === 'capital' && capitalGivesAway(c)));
    // gently avoid repeating the same question type twice in a row
    const adj = opts.map(([t, w]) => [t, t === lastType ? w * 0.5 : w]);
    let r = Math.random() * adj.reduce((s, [, w]) => s + w, 0);
    for (const [t, w] of adj) { if ((r -= w) <= 0) return t; }
    return adj[0][0];
  }

  function next(level) {
    const L = LEVELS[level];
    let candidates = pool.filter((c) => c.tier === L.tier && !used.has(c.id));
    if (!candidates.length) {
      pool.filter((c) => c.tier === L.tier).forEach((c) => used.delete(c.id));
      candidates = pool.filter((c) => c.tier === L.tier);
    }
    const country = candidates[(Math.random() * candidates.length) | 0];
    used.add(country.id);
    const type = weightedType(L.weights, country);
    lastType = type;
    const q = { level, levelLabel: L.label, country, type };
    if (type === 'name') { q.kind = 'Find this country on the map'; q.prompt = country.name; }
    else if (type === 'capital') { q.kind = 'Which country has this capital city?'; q.prompt = country.capital; }
    else { q.kind = 'Which country does this flag belong to?'; q.prompt = 'Find its country'; q.flag = `flags/${country.flag}.svg`; }
    return q;
  }

  function resetUsed() { used.clear(); lastType = null; }

  window.Quiz = { next, levelForRoll, LEVELS, resetUsed };
})();
