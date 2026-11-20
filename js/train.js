/* Training mode: questions + map only, for solo practice.
 * Progress is kept in its own storage key, so training never changes which questions the real game asks.
 *
 * Selection order for the next question:
 *   1. a missed question that is due again (missed questions come back after a few others, never at once),
 *   2. every 6th question: a mastered question, the one practised longest ago (review),
 *   3. a question never practised,
 *   4. a practised but not yet mastered question,
 *   5. the mastered question practised longest ago.
 * Questions from the last few turns are avoided while there is any alternative.
 * Mastered = last answer correct without a hint, and (if it was ever missed) correct twice in a row. */
(function () {
  const { Sound, Confetti } = FX;
  const $ = (id) => document.getElementById(id);
  const TIMER_SECS = 30;
  const STORE = 'geoludo.train.v1';
  const SETTINGS = 'geoludo.train-settings.v1';
  const CATS = ['geo', 'history', 'sports', 'culture', 'timetravel'];
  const CAT_LABEL = { geo: '🗺️ Geography', history: '📜 History', sports: '⚽ Sports', culture: '🎭 Culture', timetravel: '⏳ Time Travel' };
  // Geo Time Travel's own questions (data/timetravel.js): practised by era instead of by level
  const ERAS = [
    { name: 'Prehistory', icon: '🦴', color: '#c98b4a' }, { name: 'Antiquity', icon: '🏛️', color: '#e0b04a' },
    { name: 'Middle Ages', icon: '🏰', color: '#8fa7c9' }, { name: 'Early Modern', icon: '⛵', color: '#4ab0c9' }, { name: 'Modern', icon: '🏭', color: '#9a7cff' },
  ];
  const GEO_TYPES = ['name', 'flag', 'capital', 'city', 'geoq'];
  /* Parts of the world to practise, by the answer's country. Tonga, Samoa and Kiribati sit next to the
   * Americas on this map (west of the date line), so they are practised with them. */
  const AREAS = ['europe', 'africa', 'asia', 'oceania', 'americas'];
  const AREA_OF_REGION = {
    'Northern Europe': 'europe', 'Western Europe': 'europe', 'Central Europe': 'europe', 'Eastern Europe': 'europe',
    'Southern Europe': 'europe', 'Southeast Europe': 'europe',
    'Northern Africa': 'africa', 'Western Africa': 'africa', 'Middle Africa': 'africa', 'Eastern Africa': 'africa', 'Southern Africa': 'africa',
    'Western Asia': 'asia', 'Central Asia': 'asia', 'Southern Asia': 'asia', 'Eastern Asia': 'asia',
    'South-Eastern Asia': 'oceania', 'Australia and New Zealand': 'oceania', 'Melanesia': 'oceania', 'Micronesia': 'oceania', 'Polynesia': 'oceania',
    'North America': 'americas', 'Central America': 'americas', 'Caribbean': 'americas', 'South America': 'americas',
  };
  const AREA_EXCEPTIONS = { TON: 'americas', WSM: 'americas', KIR: 'americas' };
  const areaOf = (c) => AREA_EXCEPTIONS[c.id] || AREA_OF_REGION[c.region] || null;
  // Map view for a set of areas: around their countries (Russia left out, or Europe would reach Siberia).
  function areaPoints() {
    return window.WORLD.countries.filter((c) => c.fame && c.id !== 'RUS' && settings.areas.includes(areaOf(c))).map((c) => c.c);
  }

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  let prog = load(STORE, { n: 0, items: {} });
  const settings = Object.assign({ cats: ['geo'], types: GEO_TYPES.slice(), levels: [1, 2, 3, 4, 5, 6], areas: AREAS.slice(), eras: [0, 1, 2, 3, 4], scope: 'world', timer: false, sound: true }, load(SETTINGS, {}));
  if (!Quiz.SCOPES.some((x) => x.value === settings.scope)) settings.scope = 'world';
  // US states & Canadian provinces only: geography questions about them, so the other categories and parts of the world step aside
  const naOnly = () => settings.scope === 'na';
  const NA_CATS = CATS.filter((c) => c !== 'timetravel');
  const catsKey = (k) => (k === 'cats' && naOnly() ? 'naCats' : k);
  const inScope = (e) => (e.pick.na ? settings.scope !== 'world' : settings.scope !== 'na');
  settings.areas = (settings.areas || []).filter((a) => AREAS.includes(a));
  if (!settings.areas.length) settings.areas = AREAS.slice();
  settings.eras = (settings.eras || []).filter((x) => x >= 0 && x <= 4);
  if (!settings.eras.length) settings.eras = [0, 1, 2, 3, 4];
  Sound.enabled = settings.sound;
  let picks = null; // the option rows (set up below)



  /* ---------- Question catalogue ---------- */
  // Every question once (a question text appearing in two files is one entry).
  const ALL = [];
  const seenKey = new Set();
  for (const q of window.TIME_TRAVEL_QUESTIONS || []) {
    const c = window.WORLD.countries.find((x) => x.id === q.a);
    if (c) ALL.push({ pick: { type: 'tt', c, h: { q: q.q }, era: q.era, key: 'tt:' + q.id }, cat: 'timetravel', lvl: 0, key: 'tt:' + q.id });
  }
  for (const cat of CATS) {
    if (!Quiz.pools[cat]) continue;
    for (let lvl = 1; lvl <= 6; lvl++) {
      for (const pick of Quiz.pools[cat][lvl]) {
        if (seenKey.has(pick.key)) continue;
        seenKey.add(pick.key);
        ALL.push({ pick, cat, lvl, key: pick.key });
      }
    }
  }
  const rec = (key) => prog.items[key];
  const mastered = (r) => !!r && r.last === 1 && (r.w === 0 || r.s >= 2);
  const isMistake = (r) => !!r && r.w > 0 && !mastered(r);

  function filtered() {
    const allAreas = settings.areas.length === AREAS.length || naOnly();
    return ALL.filter((e) => inScope(e) && settings.cats.includes(e.cat) && !(naOnly() && e.cat === 'timetravel')
      && (e.cat === 'timetravel' ? settings.eras.includes(e.pick.era) : settings.levels.includes(e.lvl))
      && (e.cat !== 'geo' || settings.types.includes(e.pick.type))
      && (allAreas || settings.areas.includes(areaOf(e.pick.c))));
  }

  /* ---------- Home screen ---------- */
  function syncChips() {
    document.querySelectorAll('#cat-chips .chip-btn').forEach((b) => b.classList.toggle('active', settings.cats.includes(b.dataset.cat)));
    document.querySelectorAll('#type-chips .chip-btn').forEach((b) => b.classList.toggle('active', settings.types.includes(b.dataset.type)));
    document.querySelectorAll('#level-chips .chip-btn').forEach((b) => b.classList.toggle('active', settings.levels.includes(+b.dataset.l)));
    document.querySelectorAll('#area-chips .chip-btn[data-area]').forEach((b) => b.classList.toggle('active', settings.areas.includes(b.dataset.area)));
    const sc = Quiz.SCOPES.find((x) => x.value === settings.scope);
    $('scope-btn').textContent = `${sc.label} ▾`;
    // Time Travel is about countries of the world: not on the map of the US states & Canadian provinces
    const tt = document.querySelector('#cat-chips [data-cat="timetravel"]');
    tt.disabled = naOnly();
    if (naOnly()) tt.classList.remove('active');
    document.querySelector('#type-chips [data-type="name"]').textContent = naOnly() ? 'States & provinces' : 'Countries';
    $('area-row').hidden = naOnly(); // parts of the world don't apply to the US states & Canadian provinces
    $('era-row').hidden = naOnly() || !settings.cats.includes('timetravel');
    // levels grade every category but Time Travel (graded by era instead)
    $('level-row').hidden = !settings.cats.some((c) => c !== 'timetravel');
    document.querySelectorAll('#era-chips .chip-btn[data-era]').forEach((b) => b.classList.toggle('active', settings.eras.includes(+b.dataset.era)));
    document.querySelectorAll('.all-chip').forEach((b) => {
      const on = !!picks && picks[catsKey(b.dataset.all)].isAll();
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    $('type-row').hidden = !settings.cats.includes('geo');
    $('opt-timer').checked = settings.timer;
    $('sound-btn').textContent = settings.sound ? '🔊' : '🔇';
    const list = filtered();
    const m = list.filter((e) => mastered(rec(e.key))).length;
    const mis = list.filter((e) => isMistake(rec(e.key))).length;
    $('avail').innerHTML = list.length
      ? `<b>${list.length}</b> questions selected · ${m} mastered · ${list.length - m} to go`
      : 'Select at least one category, type and level.';
    $('start-btn').disabled = !list.length;
    $('mistake-count').textContent = mis ? `(${mis})` : '';
    $('mistakes-btn').disabled = !mis;
    save(SETTINGS, settings);
  }
  // Each row: tap options on/off, or "All" (tapped again: back to the option chosen last).
  picks = {
    cats: MultiPick({ order: CATS, get: () => settings.cats, set: (v) => { settings.cats = v; }, onChange: syncChips }),
    types: MultiPick({ order: GEO_TYPES, get: () => settings.types, set: (v) => { settings.types = v; }, onChange: syncChips }),
    levels: MultiPick({ order: [1, 2, 3, 4, 5, 6], get: () => settings.levels, set: (v) => { settings.levels = v; }, onChange: syncChips }),
    areas: MultiPick({ order: AREAS, get: () => settings.areas, set: (v) => { settings.areas = v; }, onChange: syncChips }),
    eras: MultiPick({ order: [0, 1, 2, 3, 4], get: () => settings.eras, set: (v) => { settings.eras = v; }, onChange: syncChips }),
    // on the map of the US states & Canadian provinces, "All" covers the four categories that have questions there
    // (Time Travel keeps whatever it was, for when the map is switched back)
    naCats: MultiPick({ order: NA_CATS, get: () => settings.cats.filter((c) => c !== 'timetravel'),
      set: (v) => { settings.cats = CATS.filter((c) => v.includes(c) || (c === 'timetravel' && settings.cats.includes(c))); }, onChange: syncChips }),
  };
  document.querySelectorAll('#cat-chips .chip-btn[data-cat]').forEach((b) => b.addEventListener('click', () => picks[catsKey('cats')].toggle(b.dataset.cat)));
  document.querySelectorAll('#type-chips .chip-btn[data-type]').forEach((b) => b.addEventListener('click', () => picks.types.toggle(b.dataset.type)));
  document.querySelectorAll('#level-chips .chip-btn[data-l]').forEach((b) => b.addEventListener('click', () => picks.levels.toggle(+b.dataset.l)));
  document.querySelectorAll('#area-chips .chip-btn[data-area]').forEach((b) => b.addEventListener('click', () => picks.areas.toggle(b.dataset.area)));
  document.querySelectorAll('#era-chips .chip-btn[data-era]').forEach((b) => b.addEventListener('click', () => picks.eras.toggle(+b.dataset.era)));
  document.querySelectorAll('.all-chip').forEach((b) => b.addEventListener('click', () => picks[catsKey(b.dataset.all)].all()));
  $('scope-btn').addEventListener('click', async () => {
    const v = await Dialog.menu($('scope-btn'), Quiz.SCOPES, settings.scope);
    if (v == null || v === settings.scope) return;
    settings.scope = v;
    if (naOnly() && !settings.cats.some((c) => c !== 'timetravel')) settings.cats = ['geo'].concat(settings.cats); // Time Travel alone has nothing there
    syncChips();
  });
  $('opt-timer').addEventListener('change', () => { settings.timer = $('opt-timer').checked; syncChips(); });
  $('sound-btn').addEventListener('click', () => { settings.sound = !settings.sound; Sound.enabled = settings.sound; syncChips(); });

  function renderOverview() {
    const total = ALL.length;
    const m = ALL.filter((e) => mastered(rec(e.key))).length;
    const seen = ALL.filter((e) => rec(e.key)).length;
    const due = ALL.filter((e) => isMistake(rec(e.key))).length;
    const pct = total ? Math.round((m / total) * 100) : 0;
    $('ov-pct').textContent = `${pct}%`;
    $('ov-mastered').textContent = m;
    $('ov-total').textContent = total;
    $('ov-seen').textContent = seen;
    $('ov-due').textContent = due;
    $('ring-fg').style.strokeDashoffset = 326.7 * (1 - m / Math.max(1, total));
    // progress table: category x level
    const rows = CATS.map((cat) => {
      if (cat === 'timetravel') { // by era, not by level
        const cells = [0, 1, 2, 3, 4].map((era) => {
          const list = ALL.filter((e) => e.cat === cat && e.pick.era === era);
          const mm = list.filter((e) => mastered(rec(e.key))).length;
          const p = list.length ? mm / list.length : 0;
          return `<div class="pt-cell" style="--c:${ERAS[era].color}" title="${ERAS[era].name}: ${mm} of ${list.length} mastered">
            <i style="height:${Math.round(p * 100)}%"></i><span>${ERAS[era].icon} ${mm}/${list.length}</span></div>`;
        }).join('') + '<div></div>';
        return `<div class="pt-row"><div class="pt-name">${CAT_LABEL[cat]}</div>${cells}</div>`;
      }
      const cells = [1, 2, 3, 4, 5, 6].map((l) => {
        const list = ALL.filter((e) => e.cat === cat && e.lvl === l);
        const mm = list.filter((e) => mastered(rec(e.key))).length;
        const p = list.length ? mm / list.length : 0;
        return `<div class="pt-cell" style="--c:var(--l${l})" title="Level ${l}: ${mm} of ${list.length} mastered">
          <i style="height:${Math.round(p * 100)}%"></i><span>${mm}/${list.length}</span></div>`;
      }).join('');
      return `<div class="pt-row"><div class="pt-name">${CAT_LABEL[cat]}</div>${cells}</div>`;
    }).join('');
    $('progress-table').innerHTML = `<div class="pt-row pt-head"><div></div>${[1, 2, 3, 4, 5, 6].map((l) => `<div style="color:var(--l${l})">${l}</div>`).join('')}</div>${rows}`;
    syncChips();
  }
  $('reset-btn').addEventListener('click', async () => {
    if (!await Dialog.confirm({ icon: '🧹', title: 'Reset training?', text: 'All your training progress will be forgotten. This cannot be undone.', ok: 'Reset', cancel: 'Keep it', danger: true })) return;
    prog = { n: 0, items: {} };
    save(STORE, prog);
    renderOverview();
  });

  /* ---------- Session ---------- */
  let session = null;
  let timerHandle = null;

  function show(id) {
    document.querySelectorAll('.t-screen').forEach((s) => s.classList.toggle('active', s.id === id));
    document.body.classList.toggle('playing', id === 'play');
    window.scrollTo(0, 0);
  }

  function startSession(mistakesOnly) {
    Sound.ensure();
    const pool = filtered().filter((e) => !mistakesOnly || isMistake(rec(e.key)));
    if (!pool.length) return;
    WorldMap.setScope(settings.scope);
    session = { pool, mistakesOnly, ok: 0, bad: 0, streak: 0, best: 0, answered: 0, newMastered: 0, missed: [], last: null, lastCountry: null };
    $('t-mode').textContent = mistakesOnly ? '🔁 Mistakes' : `${pool.length} questions`;
    show('play');
    nextQuestion();
  }
  $('start-btn').addEventListener('click', () => startSession(false));
  $('mistakes-btn').addEventListener('click', () => startSession(true));

  const REVIEW_EVERY = 6; // every 6th question revisits a mastered one (practised longest ago)
  const RECENT = 4; // questions from the last few turns are avoided while there is any alternative
  function choose() {
    const pool = session.pool;
    const n = prog.n;
    session.picks = (session.picks || 0) + 1;
    const recent = session.recent || [];
    const avoid = (e) => recent.includes(e.key) || e.pick.c.id === session.lastCountry;
    const prefer = (list) => { const v = list.filter((e) => !avoid(e)); return v.length ? v : list; };
    const rand = (list) => list[Math.floor(Math.random() * list.length)];
    const oldest = (list) => list.slice().sort((a, b) => rec(a.key).at - rec(b.key).at)[0];
    // a missed question waits until it is due, so it comes back after a few others, not straight away
    const waiting = (e) => { const r = rec(e.key); return isMistake(r) && r.due > n; };
    // 1. missed questions that are due again
    const due = pool.filter((e) => { const r = rec(e.key); return isMistake(r) && r.due <= n && !recent.includes(e.key); });
    if (due.length) return due.sort((a, b) => rec(a.key).due - rec(b.key).due)[0];
    if (session.mistakesOnly) {
      const left = pool.filter((e) => isMistake(rec(e.key)));
      if (!left.length) return null; // all fixed!
      const ready = left.filter((e) => !avoid(e));
      if (ready.length) return rand(ready);
      // only just-asked ones left: put another practised question in between
      const chosen = new Set(filtered().map((e) => e.key)); // the categories, levels … currently selected
      const other = ALL.filter((e) => chosen.has(e.key) && rec(e.key) && !isMistake(rec(e.key)) && !avoid(e));
      return other.length ? oldest(other) : rand(left);
    }
    // review: mastered questions from earlier sessions first (not one just asked in this one)
    const seenNow = session.seen || (session.seen = new Set());
    const masteredAll = pool.filter((e) => mastered(rec(e.key)) && !avoid(e));
    const masteredOnes = masteredAll.filter((e) => !seenNow.has(e.key)).length ? masteredAll.filter((e) => !seenNow.has(e.key)) : masteredAll;
    // 2. now and then, a mastered question comes back for review
    if (session.picks % REVIEW_EVERY === 0 && masteredOnes.length) return oldest(masteredOnes);
    // 3. never practised
    const fresh = pool.filter((e) => !rec(e.key));
    if (fresh.length) return rand(prefer(fresh));
    // 4. practised, not mastered (missed ones only once they are due)
    const weak = pool.filter((e) => !mastered(rec(e.key)) && !waiting(e) && !avoid(e));
    if (weak.length) return rand(weak);
    // 5. mastered, practised longest ago
    if (masteredOnes.length) return oldest(masteredOnes);
    // 6. nothing else: whatever is least recent
    return oldest(prefer(pool.filter((e) => rec(e.key)))) || rand(pool);
  }
  function nextQuestion() {
    clearInterval(timerHandle);
    const e = choose();
    if (!e) return finish(true);
    const q = e.cat === 'timetravel'
      ? { level: 0, levelLabel: '', country: e.pick.c, type: 'tt', category: 'timetravel', key: e.key, kind: 'Tap the country on the map', prompt: e.pick.h.q, tag: 'Time Travel' }
      : Quiz.describe(e.pick, e.lvl, e.cat);
    session.cur = { e, q, hinted: false, done: false };
    session.last = e.key;
    session.recent = [e.key, ...(session.recent || [])].slice(0, RECENT);
    (session.seen || (session.seen = new Set())).add(e.key);
    session.lastCountry = q.country.id;
    const r = rec(e.key);
    const diff = $('q-diff');
    if (e.cat === 'timetravel') { // an era, not a level
      diff.style.setProperty('--c', ERAS[e.pick.era].color);
      diff.textContent = `${ERAS[e.pick.era].icon} ${ERAS[e.pick.era].name}`;
    } else {
      diff.style.setProperty('--c', `var(--l${e.lvl})`);
      diff.textContent = `${e.lvl} · ${q.levelLabel}`;
    }
    $('q-tag').textContent = q.tag;
    $('q-status').textContent = !r ? '✨ New' : isMistake(r) ? '🔁 Missed before' : mastered(r) ? '⭐ Mastered' : '📖 Practising';
    $('q-kind').textContent = q.kind.replace('Click', 'Tap');
    const prompt = $('q-prompt');
    prompt.textContent = q.prompt.replace(/^Click/, 'Tap');
    prompt.classList.toggle('long', q.prompt.length > 48);
    const flag = $('q-flag');
    if (q.flag) { flag.hidden = false; flag.src = q.flag; } else { flag.hidden = true; flag.removeAttribute('src'); }
    $('result').hidden = true;
    $('hint-btn').disabled = false;
    $('idk-btn').disabled = false;
    WorldMap.prepare(answer);
    // practising some parts of the world only: start the map there
    if (!naOnly() && settings.areas.length < AREAS.length) WorldMap.focusPoints(areaPoints(), 450, 40);
    if (settings.timer) startTimer(['history', 'sports', 'culture', 'geoq'].includes(q.type) ? TIMER_SECS + 15 : TIMER_SECS);
    else $('timer').hidden = true;
    updateScore();
  }

  function startTimer(total) {
    const t = $('timer');
    t.hidden = false;
    t.classList.remove('low');
    let left = total;
    const ring = $('timer-ring');
    const draw = () => {
      $('timer-num').textContent = left;
      ring.style.strokeDashoffset = 119.4 * (1 - left / total);
      t.classList.toggle('low', left <= 5);
    };
    ring.style.transition = 'none'; draw(); void ring.getBoundingClientRect(); ring.style.transition = '';
    timerHandle = setInterval(() => {
      left--;
      draw();
      if (left <= 0) { clearInterval(timerHandle); answer(null); }
    }, 1000);
  }

  function updateScore() {
    $('s-ok').textContent = session.ok;
    $('s-bad').textContent = session.bad;
    $('s-streak').textContent = session.streak;
  }

  function factFor(q) {
    const c = q.country;
    switch (q.type) {
      case 'capital': return `The capital of <b>${esc(c.name)}</b> is <b>${esc(c.capital)}</b>.`;
      case 'city': return `<b>${esc(q.city)}</b> is in <b>${esc(c.name)}</b>.`;
      case 'flag': return `That's the flag of <b>${esc(c.name)}</b>.`;
      case 'name': return `<b>${esc(c.name)}</b>${c.noCap ? '' : ` — capital: ${esc(c.capital)}`}.${c.parent ? '' : ` Region: ${esc(c.region)}.`}`;
      default: return `The answer is <b>${esc(c.name)}</b>.`;
    }
  }

  function record(key, ok, hinted) {
    prog.n++;
    const r = prog.items[key] || { r: 0, w: 0, s: 0, last: 0, due: 0, at: 0 };
    const wasMastered = mastered(r);
    r.at = prog.n;
    if (ok && !hinted) {
      r.r++; r.s++; r.last = 1;
      r.due = r.w > 0 && r.s < 2 ? prog.n + 8 : 0; // missed before: check once more a bit later
    } else {
      if (ok) r.r++; else r.w++;
      r.s = 0; r.last = 0;
      r.due = prog.n + 3 + Math.floor(Math.random() * 4); // comes back after a few other questions
    }
    prog.items[key] = r;
    save(STORE, prog);
    return { nowMastered: !wasMastered && mastered(r) };
  }

  function answer(clickedId) {
    const cur = session && session.cur;
    if (!cur || cur.done) return;
    cur.done = true;
    clearInterval(timerHandle);
    WorldMap.lock();
    const { q, e } = cur;
    const ok = WorldMap.matches(clickedId, q.country.id); // a state counts for its country
    const { nowMastered } = record(e.key, ok, cur.hinted);
    session.answered++;
    if (ok) { session.ok++; session.streak++; session.best = Math.max(session.best, session.streak); } else { session.bad++; session.streak = 0; }
    if (nowMastered) session.newMastered++;
    if (!ok && !session.missed.includes(q.country.name)) session.missed.push(q.country.name);
    WorldMap.reveal(q.country.id, clickedId === 'idk' ? null : clickedId, q.pin ? { p: q.pin, name: q.city } : null);
    const clicked = clickedId && clickedId !== 'idk' ? WorldMap.byId.get(clickedId) : null;
    const res = $('result');
    res.classList.toggle('bad', !ok);
    $('result-icon').textContent = ok ? '✓' : clickedId === 'idk' ? '?' : clickedId ? '✗' : '⏱';
    if (ok) {
      const cheers = session.streak >= 10 ? `🔥 ${session.streak} in a row!` : session.streak >= 5 ? `${session.streak} in a row!` : ['Correct!', 'Spot on!', 'Nice!', 'Yes!'][session.answered % 4];
      $('result-title').textContent = cur.hinted ? 'Correct (with a hint)' : cheers;
      $('result-sub').innerHTML = factFor(q) + (nowMastered ? ' <b class="gold">⭐ Mastered!</b>' : '');
      Sound.correct();
      if (session.streak > 0 && session.streak % 5 === 0) {
        const r = $('map-wrap').getBoundingClientRect();
        Confetti.burst(r.left + r.width / 2, r.top + r.height * 0.7, 70, 0.8);
      }
    } else {
      $('result-title').textContent = clickedId === 'idk' ? 'Now you know' : clicked ? `Not ${clicked.name}` : "Time's up";
      $('result-sub').innerHTML = `${factFor(q)} <span class="muted">It will come back soon.</span>`;
      Sound.wrong();
    }
    $('hint-btn').disabled = true;
    $('idk-btn').disabled = true;
    res.hidden = false;
    updateScore();
    setTimeout(() => $('next-btn').focus({ preventScroll: true }), 50);
  }

  $('next-btn').addEventListener('click', nextQuestion);
  $('idk-btn').addEventListener('click', () => answer('idk'));
  $('hint-btn').addEventListener('click', () => {
    const cur = session && session.cur;
    if (!cur || cur.done || cur.hinted) return;
    cur.hinted = true;
    const c = cur.q.country;
    const h = WorldMap.hintFor(c.id);
    WorldMap.hint(h.ids);
    $('q-kind').textContent = `🧭 Somewhere in ${h.name}`;
    $('hint-btn').disabled = true;
  });
  $('end-btn').addEventListener('click', () => finish(false));

  function finish(allFixed) {
    clearInterval(timerHandle);
    const s = session;
    if (!s) return show('home');
    if (!s.answered) { session = null; renderOverview(); return show('home'); }
    const acc = Math.round((s.ok / s.answered) * 100);
    $('sum-emoji').textContent = allFixed ? '🎉' : acc >= 90 ? '🏆' : acc >= 70 ? '🌍' : '🧭';
    $('sum-title').textContent = allFixed ? 'All mistakes fixed!' : acc >= 90 ? 'Ready to impress your friends!' : acc >= 70 ? 'Nice session!' : 'Every miss is a lesson';
    $('sum-answered').textContent = s.answered;
    $('sum-acc').textContent = `${acc}%`;
    $('sum-best').textContent = s.best;
    $('sum-mastered').textContent = s.newMastered;
    $('sum-missed').innerHTML = s.missed.length
      ? `<b>To review:</b> ${s.missed.slice(0, 15).map(esc).join(', ')}${s.missed.length > 15 ? '…' : ''}`
      : '<b>No mistakes this session.</b>';
    if (acc >= 90 || allFixed) Confetti.rain(160);
    session = null;
    renderOverview();
    show('summary');
  }
  $('again-btn').addEventListener('click', () => startSession(false));
  $('home-btn').addEventListener('click', () => show('home'));

  document.addEventListener('keydown', (e) => {
    if (!$('play').classList.contains('active')) return;
    if (e.key === 'Enter' && !$('result').hidden) { e.preventDefault(); nextQuestion(); }
    else if (e.key === 'Escape') finish(false);
    else if ((e.key === 'h' || e.key === 'H') && !$('hint-btn').disabled) $('hint-btn').click();
  });

  if (/[?&]debug\b/.test(location.search)) window.__train = { get session() { return session; }, get prog() { return prog; }, answer, nextQuestion, ALL, mastered: (k) => mastered(rec(k)) };

  renderOverview();
})();
