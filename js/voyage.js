/* GeoLudo Voyage: a race around the world by ship.
 *
 * One rules engine (the "host") owns the game state. In hot seat it runs on this device; online it runs
 * in the room creator's browser and every device just renders the shared state and sends actions.
 *
 * Turn: the active player picks a level 1-6 → answers a question on the map → if correct, the ship sails
 * `level` ports along the route. Wrong answers cost nothing. When a ship reaches the last port, the round
 * is finished (equal turns) and the ship that sailed furthest wins.
 */
(function () {
  const { sleep, Sound, Confetti } = FX;
  const $ = (id) => document.getElementById(id);
  const W = window.WORLD;
  const ROUTE = W.route;
  const N = ROUTE.ports.length - 1; // ports to sail
  const LEVELS = Quiz.LEVELS;
  const COLORS = ['#ef476f', '#06c167', '#ffb703', '#3a86ff', '#b15cff', '#00c2d1'];
  const SHIP_NAMES = ['Santa Maria', 'Victoria', 'Endeavour', 'Beagle', 'Golden Hind', 'Calypso'];
  const MAX_PLAYERS = 6;
  const Q_TIME = 30, Q_TIME_LONG = 45;
  const PICK_TIMEOUT = 45; // online only: auto-pick level 3 if a player is idle
  const AUTO_NEXT = 5200; // online: move on after a result
  const TAKEOVER = 20; // online: seconds after a player goes offline before a bot sails their ship
  const BOT_THINK = 1400, BOT_ANSWER = [2600, 5200]; // bot pacing (ms)
  // Computer captains: accuracy falls with the level (same model as GeoLudo's bots).
  const BOTS = {
    rookie: { label: 'Rookie', base: 0.85, drop: 0.11 },
    explorer: { label: 'Explorer', base: 0.92, drop: 0.075 },
    genius: { label: 'Genius', base: 0.97, drop: 0.045 },
  };
  const BOT_NAMES = ['Zheng He', 'James Cook', 'Amundsen', 'Bougainville', 'Tasman', 'Vespucci'];
  const botAcc = (skill, lvl) => Math.min(0.98, Math.max(0.15, BOTS[skill].base - BOTS[skill].drop * (lvl - 1)));
  const isBotP = (p) => !!(p && (p.bot || p.auto));
  const LEG_MS = 520; // ship animation per port
  // Compass tokens: everyone starts with one; land exactly on a treasure port or answer 3 in a
  // row to find another (max 3). Spend one during your question to see the answer's region.
  const TOKENS_START = 1, TOKENS_MAX = 3, STREAK_BONUS = 3;
  const TREASURE = new Set(Array.from({ length: N }, (_, i) => i).filter((i) => i > 0 && i % 5 === 3));
  const CAT_LABEL = { geo: 'Geography', history: 'History', sports: 'Sports', culture: 'Culture' };

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const uid = () => 'p' + Math.random().toString(36).slice(2, 9);
  const byId = (id) => W.countries.find((c) => c.id === id);
  const portName = (i) => ROUTE.ports[Math.min(i, N)].name;

  /* ======================================================================
   * ENGINE (host only)
   * ==================================================================== */
  function createEngine(cfg, emit) {
    const S = {
      v: 1, gid: Math.random().toString(36).slice(2, 8), online: !!cfg.online, room: cfg.room || null,
      phase: 'pick', cats: cfg.cats, n: N,
      players: cfg.players.map((p, i) => ({
        id: p.id, name: p.name, color: COLORS[i % COLORS.length], ship: SHIP_NAMES[i % SHIP_NAMES.length],
        pos: 0, dist: 0, correct: 0, asked: 0, streak: 0, best: 0, knew: 0, connected: true, tokens: TOKENS_START, found: 0, hints: 0, bot: BOTS[p.bot] ? p.bot : null, auto: false,
      })),
      turn: 0, round: 1, finalRound: false, finishers: [],
      q: null, res: null, ranking: null, seq: 0, log: [],
    };
    if (cfg.resume) Object.assign(S, cfg.resume, { phase: 'pick', q: null, res: null, gid: S.gid });
    S.players.forEach((p) => { if (p.tokens == null) Object.assign(p, { tokens: TOKENS_START, found: 0, hints: 0 }); });
    let secret = null; // the current question including its answer (never sent to guests)
    let guesses = {};
    let timer = null;
    const offTimers = {}; // pid -> bot takeover timer
    const mode = () => (S.cats.length > 1 ? 'mixed' : S.cats[0]);
    const active = () => S.players[S.turn];

    function publish() { S.seq++; emit(JSON.parse(JSON.stringify(S))); }
    function log(text) { S.log.unshift(text); S.log = S.log.slice(0, 30); }
    function clearTimer() { clearTimeout(timer); timer = null; }

    function startPick() {
      clearTimer();
      S.phase = 'pick'; S.q = null; S.res = null;
      secret = null; guesses = {};
      const p = active();
      if (isBotP(p)) timer = setTimeout(() => botPick(p), BOT_THINK);
      else if (S.online && p.connected) timer = setTimeout(() => pick(p.id, 3, true), PICK_TIMEOUT * 1000);
      // (an offline player waits for their bot takeover, see setConnected)
      publish();
    }

    function pick(pid, level, auto) {
      const p = active();
      if (S.phase !== 'pick' || pid !== p.id || !(level >= 1 && level <= 6)) return;
      clearTimer();
      secret = Quiz.next(level, mode(), S.cats);
      const long = ['history', 'sports', 'culture', 'geoq'].includes(secret.type);
      const time = long ? Q_TIME_LONG : Q_TIME;
      S.q = {
        level, levelLabel: LEVELS[level].label, tag: secret.tag, type: secret.type, kind: secret.kind,
        prompt: secret.prompt, flag: secret.flag || null, time, started: Date.now(), auto: !!auto, hint: null,
      };
      S.phase = 'question';
      guesses = {};
      timer = setTimeout(() => answer(p.id, null), (time + 1) * 1000);
      publish();
      if (isBotP(p)) botQuestion(p);
    }

    /* ---- computer captains (and bots sailing for offline players) ---- */
    const skillOf = (p) => p.bot || 'explorer';
    function botPick(p) {
      if (S.phase !== 'pick' || active() !== p) return;
      const leader = Math.max(...S.players.filter((o) => o !== p).map((o) => o.dist), 0);
      let best = 3, bv = -1;
      for (let l = 1; l <= 6; l++) {
        const to = Math.min(N, p.pos + l);
        let v = botAcc(skillOf(p), l) * (Math.min(N - p.pos, l) + (TREASURE.has(to) && p.tokens < TOKENS_MAX ? 1.2 : 0));
        if (S.finalRound && p.dist + l <= leader) v *= 0.2; // last chance: only a big jump helps
        v *= 0.85 + Math.random() * 0.3;
        if (v > bv) { bv = v; best = l; }
      }
      pick(p.id, best);
    }
    function botQuestion(p) {
      clearTimer();
      const started = S.q.started;
      const hint = p.tokens > 0 && S.q.level >= 4 && Math.random() < 0.6;
      if (hint) setTimeout(() => { if (S.q && S.q.started === started && active() === p) useHint(p.id); }, 1200);
      const [a, b] = BOT_ANSWER;
      timer = setTimeout(() => {
        if (S.phase !== 'question' || active() !== p) return;
        const c = secret.country;
        const acc = Math.min(0.98, botAcc(skillOf(p), S.q.level) + (S.q.hint ? 0.15 : 0));
        let id = c.id;
        if (Math.random() > acc) { // a plausible mistake: a country of the same region
          const pool = W.countries.filter((x) => x.fame && x.id !== c.id && x.region === c.region);
          const all = pool.length ? pool : W.countries.filter((x) => x.fame && x.id !== c.id);
          id = all[Math.floor(Math.random() * all.length)].id;
        }
        answer(p.id, id);
      }, a + Math.random() * (b - a) + (hint ? 1200 : 0));
    }
    function takeOver(pid) {
      const p = S.players.find((o) => o.id === pid);
      if (!p || p.connected || p.auto || S.phase === 'over') return;
      p.auto = true;
      log(`🤖 A bot takes the helm for ${p.name} until they are back.`);
      if (p === active()) {
        if (S.phase === 'pick') { clearTimer(); timer = setTimeout(() => botPick(p), BOT_THINK); }
        else if (S.phase === 'question') botQuestion(p);
      }
      publish();
    }

    function factFor(q) {
      const c = q.country;
      switch (q.type) {
        case 'capital': return `The capital of <b>${esc(c.name)}</b> is <b>${esc(c.capital)}</b>.`;
        case 'city': return `<b>${esc(q.city)}</b> is in <b>${esc(c.name)}</b>.`;
        case 'flag': return `That's the flag of <b>${esc(c.name)}</b>.`;
        case 'name': return `<b>${esc(c.name)}</b>${c.noCap ? '' : ` — capital: ${esc(c.capital)}`}.`;
        default: return `The answer is <b>${esc(c.name)}</b>.`;
      }
    }

    function answer(pid, countryId) {
      const p = active();
      if (S.phase !== 'question' || pid !== p.id) return;
      clearTimer();
      const c = secret.country;
      const ok = countryId === c.id;
      p.asked++;
      const from = p.pos;
      let to = from;
      if (ok) {
        p.correct++; p.streak++; p.best = Math.max(p.best, p.streak);
        p.dist += S.q.level;
        to = Math.min(N, from + S.q.level);
        p.pos = to;
      } else p.streak = 0;
      // compass tokens: treasure port reached exactly, or a streak of correct answers
      const gains = [];
      if (ok && TREASURE.has(to)) gains.push('treasure');
      if (ok && p.streak > 0 && p.streak % STREAK_BONUS === 0) gains.push('streak');
      const gained = Math.min(gains.length, TOKENS_MAX - p.tokens);
      p.tokens += gained; p.found += gained;
      const knew = S.players.filter((o) => o !== p && guesses[o.id] === c.id);
      knew.forEach((o) => { o.knew++; });
      const clicked = countryId ? byId(countryId) : null;
      S.res = {
        pid: p.id, ok, level: S.q.level, from, to, clicked: countryId, clickedName: clicked ? clicked.name : null,
        answer: c.id, answerName: c.name, fact: factFor(secret), pin: secret.pin ? { p: secret.pin, name: secret.city } : null,
        knew: knew.map((o) => o.name), timeout: countryId === null, gains: gained ? gains : [], gained, hinted: !!S.q.hint,
      };
      log(ok ? `✓ ${p.name} sailed ${to - from} port${to - from === 1 ? '' : 's'} to ${portName(to)} (${LEVELS[S.q.level].label})`
        : `✗ ${p.name} missed: ${c.name}`);
      if (gained) log(`🧭 ${p.name} found a compass token${gains.includes('treasure') ? ` in ${portName(to)}` : ` (${p.streak} in a row)`}.`);
      if (to >= N && !S.finishers.includes(p.id)) {
        S.finishers.push(p.id);
        if (!S.finalRound) { S.finalRound = true; log(`⚓ ${p.name} is home! Last round.`); }
      }
      S.phase = 'result';
      if (S.online || isBotP(p)) timer = setTimeout(() => next(null, true), AUTO_NEXT + (to - from) * LEG_MS);
      publish();
    }

    function useHint(pid) {
      const p = active();
      if (S.phase !== 'question' || pid !== p.id || S.q.hint || p.tokens <= 0) return;
      const c = secret.country;
      const ids = W.countries.filter((x) => x.fame && x.region === c.region).map((x) => x.id);
      p.tokens--; p.hints++;
      S.q.hint = { region: c.region, ids: ids.length > 1 ? ids : [c.id] };
      log(`🧭 ${p.name} used a compass: the answer is in ${c.region}.`);
      publish();
    }

    function guess(pid, countryId) {
      if (S.phase !== 'question' || pid === active().id || guesses[pid]) return;
      if (!S.players.some((o) => o.id === pid)) return;
      guesses[pid] = countryId;
    }

    function next(pid, auto) {
      if (S.phase !== 'result') return;
      if (!auto && S.online && pid !== active().id && pid !== S.players[0].id) return;
      advance();
    }

    function advance() {
      clearTimer();
      const last = S.turn === S.players.length - 1;
      if (S.finalRound && last) return finish();
      if (S.players.length === 1 && S.finalRound) return finish();
      S.turn = (S.turn + 1) % S.players.length;
      if (S.turn === 0) S.round++;
      startPick();
    }

    function finish() {
      clearTimer();
      const acc = (p) => (p.asked ? p.correct / p.asked : 0);
      const ranked = S.players.slice().sort((a, b) => b.dist - a.dist || acc(b) - acc(a) || a.asked - b.asked);
      S.ranking = ranked.map((p) => p.id);
      S.phase = 'over';
      S.q = null;
      publish();
    }

    function setConnected(pid, on) {
      const p = S.players.find((o) => o.id === pid);
      if (!p || p.connected === on) return;
      p.connected = on;
      clearTimeout(offTimers[pid]);
      if (on) {
        log(`🔌 ${p.name} is back${p.auto ? ' and takes the helm again' : ''}.`);
        if (p.auto) {
          p.auto = false;
          if (p === active() && S.phase === 'pick') { clearTimer(); timer = setTimeout(() => pick(p.id, 3, true), PICK_TIMEOUT * 1000); }
        }
      } else {
        log(`📴 ${p.name} lost connection. A bot sails for them in ${TAKEOVER} s.`);
        // a reloading / reconnecting player gets a moment; then a bot plays their turns
        offTimers[pid] = setTimeout(() => takeOver(pid), TAKEOVER * 1000);
        if (p === active() && S.phase === 'pick') clearTimer();
      }
      publish();
    }

    function handle(pid, a) {
      if (!a) return;
      if (a.t === 'pick') pick(pid, +a.level);
      else if (a.t === 'answer') answer(pid, a.id || null);
      else if (a.t === 'guess') guess(pid, a.id);
      else if (a.t === 'hint') useHint(pid);
      else if (a.t === 'next') next(pid);
    }

    return {
      start() { if (cfg.resume) startPick(); else { log('⛵ The voyage begins in Lisbon!'); startPick(); } },
      handle, setConnected,
      get state() { return S; },
      snapshot() { return JSON.parse(JSON.stringify(S)); },
      peek() { return secret && secret.country.id; }, // debug / tests only (host side)
      stop() { clearTimer(); Object.values(offTimers).forEach(clearTimeout); },
    };
  }

  const view = {
    state: null, me: null, hotseat: true, send: null, lastSeq: 0, shownRes: null, animating: null, guessed: null,
    timerHandle: null,
  };

  /* ======================================================================
   * MAP OVERLAY: route, ports, ships
   * ==================================================================== */
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const overlay = WorldMap.overlay;
  const routeLayer = mk('g', { class: 'route' }, overlay);
  const portLayer = mk('g', { class: 'ports' }, overlay);
  const targetLayer = mk('g', { class: 'targets' }, overlay);
  const shipLayer = mk('g', { class: 'ships' }, overlay);
  let unit = 1; // map units per screen pixel
  const ships = new Map(); // pid -> { g, at: [x, y] }

  (function drawRoute() {
    let d = '';
    ROUTE.legs.forEach((leg) => {
      let pen = false;
      leg.forEach((pt) => {
        if (!pt) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${pt[0]},${pt[1]}`;
        pen = true;
      });
    });
    mk('path', { d, class: 'route-glow', 'vector-effect': 'non-scaling-stroke' }, routeLayer);
    mk('path', { d, class: 'route-line', 'vector-effect': 'non-scaling-stroke' }, routeLayer);
    ROUTE.ports.forEach((pt, i) => {
      if (i === N) return; // finish = start
      const g = mk('g', { class: 'port' + (i === 0 ? ' home' : ''), 'data-i': i }, portLayer);
      mk('circle', { cx: pt.p[0], cy: pt.p[1], r: 3, class: 'port-dot', 'vector-effect': 'non-scaling-stroke' }, g);
      if (TREASURE.has(i)) {
        g.classList.add('treasure');
        const t = mk('text', { x: pt.p[0], y: pt.p[1], class: 'port-label treasure-label' }, g);
        t.textContent = '🧭';
        mk('title', {}, g).textContent = `${pt.name}: land here exactly to find a compass token`;
      }
      if (i === 0) {
        const t = mk('text', { x: pt.p[0], y: pt.p[1], class: 'port-label home-label' }, g);
        t.textContent = '⚓ Lisbon · start & finish';
      }
    });
  })();

  function shipSvg(color, label) {
    const g = mk('g', { class: 'ship' });
    const inner = mk('g', { class: 'ship-inner' }, g);
    mk('ellipse', { cx: 0, cy: 7, rx: 13, ry: 3.5, fill: 'rgba(0,0,0,.35)' }, inner);
    mk('path', { d: 'M-12,1 L12,1 L8,8 L-8,8 Z', fill: '#5b3a1e', stroke: '#2b1a0c', 'stroke-width': 1 }, inner);
    mk('path', { d: 'M-12,1 L12,1 L11,3 L-11,3 Z', fill: color }, inner);
    mk('line', { x1: 0, y1: 1, x2: 0, y2: -19, stroke: '#3a2a1a', 'stroke-width': 1.6 }, inner);
    mk('path', { d: 'M1,-18 Q12,-10 1,-3 Z', fill: '#fff', stroke: 'rgba(0,0,0,.25)', 'stroke-width': .6 }, inner);
    mk('path', { d: 'M-1,-16 Q-10,-9 -1,-3 Z', fill: color, stroke: 'rgba(0,0,0,.25)', 'stroke-width': .6 }, inner);
    mk('path', { d: 'M0,-19 L7,-21 L0,-23 Z', fill: color }, inner);
    const t = mk('text', { x: 0, y: 19, class: 'ship-label' }, inner);
    t.textContent = label;
    return g;
  }

  function placeShip(pid, xy) {
    const s = ships.get(pid);
    if (!s) return;
    s.at = xy;
    s.g.setAttribute('transform', `translate(${xy[0]},${xy[1]}) scale(${unit * 1.15})`);
  }

  /** Ships at the same port are fanned out so all stay visible. */
  function layoutShips(state, except) {
    const groups = {};
    state.players.forEach((p) => { (groups[p.pos] = groups[p.pos] || []).push(p.id); });
    Object.entries(groups).forEach(([pos, ids]) => {
      const [x, y] = ROUTE.ports[+pos].p;
      ids.forEach((id, k) => {
        if (id === except) return;
        const off = (k - (ids.length - 1) / 2) * 30 * unit;
        placeShip(id, [x + off, y]);
      });
    });
  }

  function syncShips(state) {
    const ids = new Set(state.players.map((p) => p.id));
    ships.forEach((s, id) => { if (!ids.has(id)) { s.g.remove(); ships.delete(id); } });
    state.players.forEach((p) => {
      if (!ships.has(p.id)) {
        const g = shipSvg(p.color, p.name.slice(0, 10));
        shipLayer.appendChild(g);
        ships.set(p.id, { g, at: ROUTE.ports[p.pos].p });
      }
      const s = ships.get(p.id);
      s.g.classList.toggle('active', state.phase !== 'over' && state.players[state.turn].id === p.id);
      s.g.classList.toggle('offline', !p.connected);
    });
  }

  WorldMap.onScale((u) => {
    unit = u;
    portLayer.querySelectorAll('.port-dot').forEach((c) => c.setAttribute('r', 3.2 * u));
    portLayer.querySelectorAll('.treasure-label').forEach((t) => { t.setAttribute('font-size', 14 * u); t.setAttribute('dy', -6 * u); });
    portLayer.querySelectorAll('.home-label').forEach((t) => {
      t.setAttribute('font-size', 12 * u); t.setAttribute('dx', -26 * u); t.setAttribute('dy', 4 * u); t.setAttribute('stroke-width', 3 * u);
    });
    targetLayer.querySelectorAll('circle').forEach((c) => c.setAttribute('r', 9 * u));
    targetLayer.querySelectorAll('text').forEach((t) => { t.setAttribute('font-size', 13 * u); t.setAttribute('dy', -13 * u); t.setAttribute('stroke-width', 3.5 * u); });
    if (view.state) layoutShips(view.state, view.animating);
    ships.forEach((s, id) => { if (id === view.animating) placeShip(id, s.at); });
  });

  function showTarget(i, color) {
    targetLayer.innerHTML = '';
    if (i == null) return;
    const [x, y] = ROUTE.ports[Math.min(i, N)].p;
    mk('circle', { cx: x, cy: y, r: 9 * unit, class: 'target-ring', stroke: color, 'vector-effect': 'non-scaling-stroke' }, targetLayer);
    const t = mk('text', { x, y, class: 'port-label target-label', 'font-size': 13 * unit, dy: -13 * unit, 'stroke-width': 3.5 * unit }, targetLayer);
    t.textContent = (i >= N ? '🏁 ' : '→ ') + portName(i);
  }

  /** Points along the route from port a to port b (jumps across the date line are kept as null). */
  function pathPoints(a, b) {
    const pts = [];
    for (let i = a; i < b; i++) pts.push(...ROUTE.legs[i]);
    return pts;
  }

  async function sailShip(state, res) {
    const s = ships.get(res.pid);
    if (!s || res.to <= res.from) return;
    view.animating = res.pid;
    const pts = pathPoints(res.from, res.to).filter(Boolean);
    await WorldMap.focusPoints([ROUTE.ports[res.from].p, ROUTE.ports[res.to].p, ...pts], 700, 70);
    const legs = res.to - res.from;
    for (let i = res.from; i < res.to; i++) {
      const leg = ROUTE.legs[i];
      const segs = [];
      leg.forEach((pt) => { if (pt) segs.push(pt); });
      const dur = LEG_MS * FX.pace.factor;
      const t0 = performance.now();
      // walk along the leg's points, skipping the jump across the date line
      await new Promise((resolve) => {
        const cum = [0];
        for (let k = 1; k < leg.length; k++) {
          const p0 = leg[k - 1], p1 = leg[k];
          cum.push(cum[k - 1] + (p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) : 0));
        }
        const total = cum[cum.length - 1] || 1;
        (function frame(now) {
          const t = Math.min(1, (now - t0) / dur);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const target = e * total;
          let k = 1;
          while (k < cum.length - 1 && cum[k] < target) k++;
          const p0 = leg[k - 1] || leg[k], p1 = leg[k] || leg[k - 1];
          const f = cum[k] > cum[k - 1] ? (target - cum[k - 1]) / (cum[k] - cum[k - 1]) : 1;
          placeShip(res.pid, [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f]);
          if (t < 1) requestAnimationFrame(frame); else resolve();
        })(t0);
      });
      Sound.step();
      if (i + 1 === res.to || legs <= 3) setPanelSub(`⚓ ${portName(i + 1)}`);
    }
    view.animating = null;
    layoutShips(state);
  }

  /* ======================================================================
   * VIEW (every device)
   * ==================================================================== */
  const activeP = (s) => s.players[s.turn];
  const canAct = (s) => !isBotP(activeP(s)) && (view.hotseat || (view.me && activeP(s).id === view.me));
  const meP = (s) => s.players.find((p) => p.id === view.me);

  function show(id) {
    document.querySelectorAll('.v-screen').forEach((x) => x.classList.toggle('active', x.id === id));
    document.body.classList.toggle('in-game', id === 'game');
  }
  function setPanelSub(html) { $('panel-sub').innerHTML = html; }

  function renderTop(s) {
    $('v-round').innerHTML = s.finalRound ? '<b>Last round</b>' : `Round <b>${s.round}</b>`;
    $('v-players').innerHTML = s.players.map((p, i) => {
      const pct = Math.round((p.pos / N) * 100);
      const isMe = !view.hotseat && p.id === view.me;
      return `<div class="vp${i === s.turn && s.phase !== 'over' ? ' active' : ''}${p.connected ? '' : ' off'}" style="--pc:${p.color}" title="${esc(p.name)}: port ${p.pos}/${N}, ${p.correct}/${p.asked} correct">
        <span class="vp-name">${p.bot || p.auto ? '🤖 ' : ''}${esc(p.name)}${isMe ? ' (you)' : ''}</span>
        <span class="vp-bar"><i style="width:${pct}%"></i></span>
        <span class="vp-num">${p.pos}/${N} · 🧭${p.tokens}${p.streak >= 3 ? ` · 🔥${p.streak}` : ''}</span></div>`;
    }).join('');
  }

  function renderLevels(s) {
    const p = activeP(s);
    const box = $('levels');
    box.innerHTML = [1, 2, 3, 4, 5, 6].map((l) => {
      const to = Math.min(N, p.pos + l);
      const gem = TREASURE.has(to) && p.tokens < TOKENS_MAX ? '<i class="lv-gem" title="Treasure port: find a compass token">🧭</i>' : '';
      return `<button type="button" data-l="${l}" style="--c:var(--l${l})">${gem}<b>${l}</b><span>${LEVELS[l].label}</span><em>${to >= N ? '🏁 Finish' : `→ ${esc(portName(to))}`}</em></button>`;
    }).join('');
    box.querySelectorAll('button').forEach((b) => {
      const l = +b.dataset.l;
      b.addEventListener('click', () => view.send({ t: 'pick', level: l }));
      b.addEventListener('pointerenter', () => showTarget(p.pos + l, p.color));
      b.addEventListener('focus', () => showTarget(p.pos + l, p.color));
    });
  }

  function stopTimer() { clearInterval(view.timerHandle); view.timerHandle = null; }
  function runTimer(q) {
    stopTimer();
    const t = $('timer');
    t.hidden = false;
    const total = q.time;
    const deadline = view.qReceived + (q.remaining != null ? q.remaining : total) * 1000;
    const ring = $('timer-ring');
    const draw = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      $('timer-num').textContent = left;
      ring.style.strokeDashoffset = 119.4 * (1 - left / total);
      t.classList.toggle('low', left <= 5);
      return left;
    };
    ring.style.transition = 'none'; draw(); void ring.getBoundingClientRect(); ring.style.transition = '';
    let lastTick = null;
    view.timerHandle = setInterval(() => {
      const left = draw();
      if (left <= 5 && left > 0 && left !== lastTick && canAct(view.state)) { lastTick = left; Sound.tick(); }
      if (left <= 0) stopTimer();
    }, 250);
  }

  /** Render the shared state. Idempotent: the same state can be rendered again. */
  function render(s) {
    const prev = view.state;
    view.state = s;
    if (s.phase === 'lobby') return;
    show('game');
    if (s.phase !== 'over') $('finish').hidden = true;
    syncShips(s);
    renderTop(s);
    const p = activeP(s);
    const mine = canAct(s);
    $('panel').style.setProperty('--pc', p.color);
    $('panel-dot').style.background = p.color;
    const newPhase = !prev || prev.gid !== s.gid || prev.phase !== s.phase || prev.turn !== s.turn || prev.seq !== s.seq;
    if (!newPhase) return;

    if (s.phase === 'pick') {
      stopTimer();
      $('quiz-card').hidden = true;
      $('result').hidden = true;
      $('next-btn').hidden = true;
      WorldMap.clear();
      WorldMap.lock();
      document.body.classList.remove('answering');
      if (!view.animating) layoutShips(s);
      const fresh = !prev || prev.gid !== s.gid || prev.phase !== 'pick' || prev.turn !== s.turn;
      const botTag = isBotP(p) ? '🤖 ' : '';
      $('panel-title').textContent = !mine ? `${botTag}${p.name}'s turn` : view.hotseat ? `${p.name}, your turn` : 'Your turn!';
      setPanelSub(mine ? 'Choose your challenge — a correct answer sails you that many ports.'
        : p.auto ? `${esc(p.name)} is offline: a bot sails for them until they are back.` : `${esc(p.name)} is choosing a challenge…`);
      $('levels').hidden = !mine;
      if (mine) renderLevels(s);
      showTarget(null);
      if (fresh && !view.animating) {
        const ahead = [];
        for (let i = p.pos; i <= Math.min(N, p.pos + 6); i++) ahead.push(ROUTE.ports[i].p);
        WorldMap.focusPoints(ahead, 800, 90);
        if (mine && !view.hotseat) Sound.tone(880, 0.12, 'triangle', 0.12);
      }
    } else if (s.phase === 'question' && prev && prev.gid === s.gid && prev.phase === 'question' && prev.q && prev.q.started === s.q.started) {
      syncHint(s, true); // same question, e.g. a compass was used
    } else if (s.phase === 'question') {
      view.qReceived = Date.now();
      view.guessed = null;
      $('levels').hidden = true;
      $('result').hidden = true;
      $('next-btn').hidden = true;
      showTarget(Math.min(N, p.pos + s.q.level), p.color);
      const q = s.q;
      const card = $('quiz-card');
      card.hidden = false;
      card.style.setProperty('--pc', p.color);
      const diff = $('q-diff');
      diff.style.setProperty('--c', `var(--l${q.level})`);
      diff.textContent = `${q.level} · ${q.levelLabel}`;
      $('q-tag').textContent = q.tag;
      const who = $('q-who');
      who.style.setProperty('--pc', p.color);
      who.textContent = mine && !view.hotseat ? 'Your question' : p.name;
      $('q-kind').textContent = q.kind.replace('Click', 'Tap');
      const prompt = $('q-prompt');
      prompt.textContent = q.type === 'flag' ? 'Tap its country' : q.prompt;
      prompt.classList.toggle('long', q.prompt.length > 48);
      const flag = $('q-flag');
      if (q.flag) { flag.hidden = false; flag.src = q.flag; } else { flag.hidden = true; flag.removeAttribute('src'); }
      $('q-note').textContent = mine ? (q.auto ? 'Level picked automatically (time ran out).' : '') : view.me ? 'Guess along — it won\'t move your ship, but everyone will see if you knew it.' : '';
      $('panel-title').textContent = mine ? (view.hotseat ? `${p.name}: tap the answer on the map` : 'Tap the answer on the map') : `${isBotP(p) ? '🤖 ' : ''}${p.name} is answering…`;
      setPanelSub(`Correct = sail ${q.level} port${q.level === 1 ? '' : 's'} to ${esc(portName(Math.min(N, p.pos + q.level)))}`);
      document.body.classList.add('answering');
      WorldMap.reset(true);
      if (mine) WorldMap.prepare((id) => { WorldMap.lock(); view.send({ t: 'answer', id }); });
      else if (view.me && meP(s)) {
        WorldMap.prepare((id) => {
          if (view.guessed) return;
          view.guessed = id;
          WorldMap.lock();
          WorldMap.markPicked(id); // neutral marker until the reveal
          view.send({ t: 'guess', id });
          $('q-note').innerHTML = `Your guess: <b>${esc(byId(id).name)}</b>. Wait for the reveal…`;
        });
      } else { WorldMap.clear(); WorldMap.lock(); }
      runTimer(q);
      syncHint(s, false);
      if (mine) Sound.whoosh();
    } else if (s.phase === 'result') {
      stopTimer();
      document.body.classList.remove('answering');
      $('timer').hidden = true;
      if (view.shownRes === s.gid + s.seq) return;
      view.shownRes = s.gid + s.seq;
      showResult(s);
    } else if (s.phase === 'over') {
      stopTimer();
      document.body.classList.remove('answering');
      $('quiz-card').hidden = true;
      showFinish(s);
    }
  }

  /** The compass button (active player) and the region highlight once a compass was used. */
  function syncHint(s, fresh) {
    const p = activeP(s);
    const q = s.q;
    const btn = $('hint-btn');
    btn.hidden = !canAct(s) || !!q.hint;
    btn.disabled = p.tokens <= 0;
    btn.querySelector('b').textContent = p.tokens;
    btn.title = p.tokens > 0 ? 'Spend a compass token to see the region of the answer (H)' : 'No compass tokens: land exactly on a 🧭 port or answer 3 in a row';
    if (!q.hint) return;
    $('q-kind').textContent = `🧭 Hint: it's somewhere in ${q.hint.region}`;
    WorldMap.hint(q.hint.ids);
    if (fresh) Sound.tone(660, 0.15, 'triangle', 0.1);
  }
  function askHint() {
    const s = view.state;
    if (!s || s.phase !== 'question' || !canAct(s) || s.q.hint || activeP(s).tokens <= 0) return;
    $('hint-btn').hidden = true;
    view.send({ t: 'hint' });
  }

  async function showResult(s) {
    const r = s.res;
    const p = s.players.find((x) => x.id === r.pid);
    const mine = canAct(s);
    $('levels').hidden = true;
    WorldMap.lock();
    WorldMap.clear();
    WorldMap.reveal(r.answer, r.clicked, r.pin);
    const res = $('result');
    res.hidden = false;
    res.classList.toggle('bad', !r.ok);
    $('result-icon').textContent = r.ok ? '✓' : r.timeout ? '⏱' : '✗';
    const who = view.hotseat ? p.name : (p.id === view.me ? 'You' : p.name);
    $('result-title').textContent = r.ok
      ? (r.to >= N ? `${who} reached Lisbon! 🏁` : `${who}: correct! ⛵ +${r.to - r.from}`)
      : r.timeout ? `${who}: time's up` : `${who}: not ${r.clickedName}`;
    let sub = r.fact;
    if (r.knew.length) sub += ` <span class="knew">👀 Also knew it: ${r.knew.map(esc).join(', ')}</span>`;
    if (!view.hotseat && view.me && view.me !== r.pid && view.guessed) {
      sub += view.guessed === r.answer ? ' <b class="gold">You knew it too!</b>' : ' <span class="muted">Your guess was wrong.</span>';
    }
    if (r.gained) sub += ` <b class="gold">🧭 +${r.gained} compass${r.gains.includes('treasure') ? ` found in ${esc(portName(r.to))}` : ` for ${p.streak} in a row`}!</b>`;
    $('result-sub').innerHTML = sub;
    $('panel-title').textContent = r.ok ? `${p.name} sets sail` : `${p.name} stays in ${portName(r.from)}`;
    setPanelSub('');
    if (r.ok) {
      Sound.correct();
      if (mine || view.hotseat) {
        const box = $('map-wrap').getBoundingClientRect();
        Confetti.burst(box.left + box.width / 2, box.top + box.height * 0.6, r.to >= N ? 120 : 50, 0.8);
      }
    } else Sound.wrong();
    const nextBtn = $('next-btn');
    const nextP = s.players[(s.turn + 1) % s.players.length];
    const endsNow = s.finalRound && s.turn === s.players.length - 1;
    nextBtn.textContent = endsNow ? 'See results 🏆' : view.hotseat ? (s.players.length > 1 ? `Pass to ${nextP.name} ⏎` : 'Next ⏎') : 'Next ⏎';
    nextBtn.hidden = !(view.hotseat || mine || (view.isHost));
    if (r.ok) {
      await sleep(1500);
      if (view.state && view.state.seq === s.seq) {
        $('quiz-card').hidden = true; // keep the route visible while the ship sails
        await sailShip(s, r);
      }
    }
    if (!nextBtn.hidden && view.state && view.state.seq === s.seq) nextBtn.focus({ preventScroll: true });
  }

  function showFinish(s) {
    const order = s.ranking.map((id) => s.players.find((p) => p.id === id));
    const w = order[0];
    $('win-name').textContent = w.name;
    const solo = s.players.length === 1;
    $('win-sub').textContent = solo
      ? `Voyage completed in ${w.asked} turns with ${w.correct} correct answers (${Math.round((w.correct / Math.max(1, w.asked)) * 100)}%).`
      : `${w.ship} sailed home after ${s.round} rounds.`;
    $('podium').innerHTML = order.map((p, i) => {
      const acc = p.asked ? Math.round((p.correct / p.asked) * 100) : 0;
      return `<li style="--pc:${p.color}"><b>${['🥇', '🥈', '🥉'][i] || i + 1 + '.'}</b><span class="pawn-icon"></span><span>${esc(p.name)}</span>
        <span>${p.dist >= N ? '🏁' : `${p.pos}/${N}`} · ${acc}% ✓${p.found ? ` · 🧭${p.found}` : ''}${p.best >= 3 ? ` · 🔥${p.best}` : ''}${!view.hotseat && p.knew ? ` · 👀${p.knew}` : ''}</span></li>`;
    }).join('');
    $('again-btn').hidden = !(view.hotseat || view.isHost);
    setTimeout(() => { $('finish').hidden = false; Sound.win(); Confetti.rain(200); }, 600);
    if (view.hotseat) store.del(SAVE_KEY);
  }

  /* ======================================================================
   * SETUP
   * ==================================================================== */
  const SETUP_KEY = 'voyage.setup.v1';
  const SAVE_KEY = 'voyage.save.v1';
  const setup = Object.assign({ cats: ['geo'], format: 'hotseat', count: 2, names: ['', '', '', '', '', ''], types: ['human', 'explorer', 'human', 'human', 'human', 'human'], myName: '' }, store.get(SETUP_KEY) || {});
  if (!Array.isArray(setup.types) || setup.types.length < MAX_PLAYERS) setup.types = ['human', 'explorer', 'human', 'human', 'human', 'human'];
  const TYPE_ORDER = ['human', ...Object.keys(BOTS)];
  const typeText = (t) => (t === 'human' ? '🙂 Human' : `🤖 ${BOTS[t].label}`);
  const nextType = (t) => TYPE_ORDER[(TYPE_ORDER.indexOf(t) + 1) % TYPE_ORDER.length];
  const saveSetup = () => store.set(SETUP_KEY, setup);
  const params = new URLSearchParams(location.search);
  const joinCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function syncSetup() {
    document.querySelectorAll('#cat-chips .cat-btn').forEach((b) => b.classList.toggle('active', setup.cats.includes(b.dataset.cat)));
    $('cat-hint').textContent = setup.cats.length > 1
      ? `Mixed: ${setup.cats.map((c) => CAT_LABEL[c]).join(' + ')}, in equal shares.`
      : `${CAT_LABEL[setup.cats[0]]} questions only. Pick more to mix them.`;
    document.querySelectorAll('.format-btn').forEach((b) => b.classList.toggle('active', b.dataset.format === setup.format));
    // an invitation link always shows the join form
    $('hotseat-section').hidden = !!joinCode || setup.format !== 'hotseat';
    $('online-section').hidden = !joinCode && setup.format !== 'online';
    $('count-num').textContent = setup.count;
    const list = $('name-list');
    list.innerHTML = '';
    for (let i = 0; i < setup.count; i++) {
      const row = document.createElement('label');
      row.className = 'name-row';
      row.style.setProperty('--pc', COLORS[i]);
      row.innerHTML = `<span class="pawn-icon"></span><input maxlength="16" aria-label="Player ${i + 1} name"><small>${SHIP_NAMES[i]}</small>
        <button type="button" class="type-btn" title="Tap to switch: human or computer captain"></button>`;
      const input = row.querySelector('input');
      input.value = setup.names[i] || '';
      input.addEventListener('input', () => { setup.names[i] = input.value; saveSetup(); });
      const tb = row.querySelector('.type-btn');
      const syncType = () => {
        const t = setup.types[i];
        tb.textContent = typeText(t);
        tb.classList.toggle('bot', t !== 'human');
        tb.setAttribute('aria-label', `Player ${i + 1}: ${t === 'human' ? 'human' : `computer, ${BOTS[t].label}`}. Tap to change.`);
        input.placeholder = t === 'human' ? `Captain ${i + 1}` : BOT_NAMES[i];
      };
      tb.addEventListener('click', (e) => { e.preventDefault(); setup.types[i] = nextType(setup.types[i]); syncType(); saveSetup(); });
      syncType();
      list.appendChild(row);
    }
    $('my-name').value = setup.myName || '';
    saveSetup();
  }
  document.querySelectorAll('#cat-chips .cat-btn').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.cat;
    if (setup.cats.includes(c)) { if (setup.cats.length > 1) setup.cats = setup.cats.filter((x) => x !== c); }
    else setup.cats = Quiz.CATEGORIES.filter((x) => x === c || setup.cats.includes(x));
    syncSetup();
  }));
  document.querySelectorAll('.format-btn').forEach((b) => b.addEventListener('click', () => { setup.format = b.dataset.format; syncSetup(); }));
  $('minus-btn').addEventListener('click', () => { setup.count = Math.max(1, setup.count - 1); syncSetup(); });
  $('plus-btn').addEventListener('click', () => { setup.count = Math.min(MAX_PLAYERS, setup.count + 1); syncSetup(); });
  $('my-name').addEventListener('input', () => { setup.myName = $('my-name').value; saveSetup(); });

  /* ======================================================================
   * HOT SEAT
   * ==================================================================== */
  let engine = null;
  function startHotseat(resume) {
    const players = resume ? resume.players : Array.from({ length: setup.count }, (_, i) => {
      const bot = setup.types[i] !== 'human' ? setup.types[i] : null;
      return { id: uid(), name: (setup.names[i] || '').trim() || (bot ? BOT_NAMES[i] : `Captain ${i + 1}`), bot };
    });
    view.hotseat = true; view.me = null; view.isHost = true; view.state = null; view.shownRes = null;
    Quiz.newGame();
    engine = createEngine({ cats: resume ? resume.cats : setup.cats.slice(), players, resume }, (s) => {
      if (s.phase === 'pick') store.set(SAVE_KEY, s);
      render(s);
    });
    view.send = (a) => engine.handle(engine.state.players[engine.state.turn].id, a);
    $('finish').hidden = true;
    show('game');
    WorldMap.reset(false);
    engine.start();
  }
  $('start-btn').addEventListener('click', () => { Sound.ensure(); startHotseat(null); });

  // Resume a saved hot-seat voyage
  (function offerResume() {
    const s = store.get(SAVE_KEY);
    if (!s || joinCode || !s.players) return;
    const box = document.createElement('div');
    box.className = 'resume-card';
    box.innerHTML = `<div><b>Voyage in progress</b><small>${s.players.map((p) => esc(p.name)).join(', ')} · round ${s.round}</small></div>
      <button type="button" class="btn-primary">Resume ▶</button><button type="button" class="link-btn">Discard</button>`;
    box.querySelector('.btn-primary').addEventListener('click', () => { Sound.ensure(); box.remove(); startHotseat(s); });
    box.querySelector('.link-btn').addEventListener('click', () => { store.del(SAVE_KEY); box.remove(); });
    document.querySelector('#setup .logo').after(box);
  })();

  /* ======================================================================
   * ONLINE
   * ==================================================================== */
  let net = null; // { host api } or { guest api }
  const lobby = { players: [], cats: [] }; // host-side lobby
  const connOf = new Map(); // pid -> conn (host)
  let pingTimer = null;

  function shareUrl(code) {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    if (params.get('relay')) u.searchParams.set('relay', params.get('relay')); // local testing
    u.searchParams.set('room', code);
    if (lobby.relay) u.searchParams.set('r', lobby.relay); // everyone uses the host's relay
    return u.toString();
  }

  function renderLobby(players, cats, code, isHost) {
    show('lobby');
    $('room-code').textContent = code;
    $('share-link').value = shareUrl(code);
    $('share-btn').hidden = !navigator.share;
    $('crew-count').textContent = `${players.length} / ${MAX_PLAYERS}`;
    $('crew').innerHTML = players.map((p, i) => `<li style="--pc:${COLORS[i]}"><span class="pawn-icon"></span><b>${p.bot ? '🤖 ' : ''}${esc(p.name)}</b>${i === 0 ? ' <small>host</small>' : ''}${p.id === view.me ? ' <small>you</small>' : ''}${p.connected === false ? ' <small>offline</small>' : ''}${
      p.bot ? (isHost ? ` <button type="button" class="type-btn bot" data-skill="${p.id}" title="Tap to change the bot's level">${BOTS[p.bot].label}</button><button type="button" class="crew-x" data-rm="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ` <small>bot · ${BOTS[p.bot].label}</small>`) : ''}</li>`).join('');
    $('add-bot-btn').hidden = !isHost || players.length >= MAX_PLAYERS;
    if (isHost) {
      $('crew').querySelectorAll('[data-skill]').forEach((b) => b.addEventListener('click', () => {
        const p = lobby.players.find((x) => x.id === b.dataset.skill);
        const ks = Object.keys(BOTS);
        p.bot = ks[(ks.indexOf(p.bot) + 1) % ks.length];
        hostLobbyUpdate();
      }));
      $('crew').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        lobby.players = lobby.players.filter((x) => x.id !== b.dataset.rm);
        hostLobbyUpdate();
      }));
    }
    $('lobby-cats').textContent = `Questions: ${cats.map((c) => CAT_LABEL[c]).join(' + ')}`;
    $('lobby-start-btn').hidden = !isHost;
    $('lobby-start-btn').disabled = players.length < 2;
    $('lobby-start-btn').textContent = players.length < 2 ? 'Waiting for players…' : `Start the voyage with ${players.length} ⛵`;
    $('lobby-wait').hidden = isHost;
  }
  $('add-bot-btn').addEventListener('click', () => {
    if (!view.isHost || lobby.players.length >= MAX_PLAYERS) return;
    const taken = new Set(lobby.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) || `Bot ${lobby.players.length + 1}`;
    lobby.players.push({ id: uid(), name, bot: 'explorer', connected: true });
    hostLobbyUpdate();
  });
  $('copy-btn').addEventListener('click', () => copyLink($('copy-btn')));
  $('copy2-btn').addEventListener('click', () => copyLink($('copy2-btn')));
  function copyLink(btn) {
    const link = $('share-link').value;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
      () => { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = btn.id === 'copy-btn' ? 'Copy' : 'Copy invitation link'; }, 1600); },
      () => { $('share-link').select(); document.execCommand('copy'); },
    );
  }
  $('share-btn').addEventListener('click', () => navigator.share({ title: 'GeoLudo Voyage', text: 'Join my voyage around the world!', url: $('share-link').value }).catch(() => {}));

  /* ---- host ---- */
  $('create-btn').addEventListener('click', () => {
    const name = ($('my-name').value || '').trim();
    if (!name) { $('my-name').focus(); $('net-status').textContent = 'Enter your name first.'; return; }
    if (!Net.supported()) { $('net-status').textContent = 'Online play is not supported in this browser.'; return; }
    Sound.ensure();
    $('create-btn').disabled = true;
    $('net-status').textContent = 'Opening a room…';
    view.hotseat = false; view.isHost = true; view.me = uid(); view.state = null; view.shownRes = null;
    lobby.players = [{ id: view.me, name, connected: true }];
    lobby.cats = setup.cats.slice();
    net = Net.host({
      onReady(code, relayKey) {
        lobby.code = code;
        lobby.relay = relayKey;
        $('create-btn').disabled = false;
        $('net-status').textContent = '';
        renderLobby(lobby.players, lobby.cats, code, true);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          net.broadcast({ t: 'ping' });
          const now = Date.now();
          connOf.forEach((conn, pid) => {
            if (now - (conn._seen || now) > 30000) { // silent: phone locked, browser closed, network gone
              connOf.delete(pid);
              try { conn.close(); } catch (e) { /* ignore */ }
              if (engine) engine.setConnected(pid, false);
              else { lobby.players = lobby.players.filter((p) => p.id !== pid); hostLobbyUpdate(); }
            }
          });
        }, 5000);
      },
      onError(text) { $('create-btn').disabled = false; $('net-status').textContent = text; },
      onMessage(conn, msg) { hostMessage(conn, msg); },
      onClose(conn) {
        const pid = conn._pid;
        if (!pid) return;
        if (connOf.get(pid) === conn) connOf.delete(pid);
        if (engine) engine.setConnected(pid, false);
        else { lobby.players = lobby.players.filter((p) => p.id !== pid); hostLobbyUpdate(); }
      },
    });
  });

  function hostLobbyUpdate() {
    renderLobby(lobby.players, lobby.cats, lobby.code, true);
    net.broadcast({ t: 'lobby', players: lobby.players, cats: lobby.cats, code: lobby.code });
  }

  function hostMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    conn._seen = Date.now();
    if (msg.t === 'pong') return;
    if (msg.t === 'hello') {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Captain';
      let pid = msg.pid;
      const roster = engine ? engine.state.players : lobby.players;
      let known = roster.find((p) => p.id === pid);
      if (!known && engine) {
        // same name as a player who is offline: give them their ship back
        known = roster.find((p) => !p.connected && p.name.toLowerCase() === name.toLowerCase());
        if (known) pid = known.id;
      }
      if (!known) {
        if (engine) { // game already running: watch only
          net.sendTo(conn, { t: 'welcome', pid: null, code: lobby.code });
          net.sendTo(conn, { t: 'state', s: engine.snapshot(), remaining: remainingFor(engine.state) });
          return;
        }
        if (lobby.players.length >= MAX_PLAYERS) { net.sendTo(conn, { t: 'full' }); return; }
        pid = uid();
        lobby.players.push({ id: pid, name, connected: true });
      }
      conn._pid = pid;
      const old = connOf.get(pid);
      if (old && old !== conn) { try { old.close(); } catch (e) { /* ignore */ } }
      connOf.set(pid, conn);
      net.sendTo(conn, { t: 'welcome', pid, code: lobby.code });
      if (engine) {
        engine.setConnected(pid, true);
        net.sendTo(conn, { t: 'state', s: engine.snapshot(), remaining: remainingFor(engine.state) });
      } else hostLobbyUpdate();
    } else if (msg.t === 'act' && conn._pid && engine) {
      engine.handle(conn._pid, msg.a);
    } else if (msg.t === 'leave' && conn._pid) {
      if (engine) engine.setConnected(conn._pid, false);
      else { lobby.players = lobby.players.filter((p) => p.id !== conn._pid); hostLobbyUpdate(); }
    }
  }
  const remainingFor = (s) => (s.phase === 'question' && s.q ? Math.max(0, s.q.time - (Date.now() - s.q.started) / 1000) : null);

  $('lobby-start-btn').addEventListener('click', () => {
    if (!view.isHost || lobby.players.length < 2) return;
    Quiz.newGame();
    engine = createEngine({ online: true, room: lobby.code, cats: lobby.cats, players: lobby.players }, (s) => {
      net.broadcast({ t: 'state', s, remaining: remainingFor(s) });
      s.q && (s.q.remaining = remainingFor(s));
      render(s);
    });
    view.send = (a) => engine.handle(view.me, a);
    engine.start();
  });

  /* ---- guest ---- */
  function seatKey(code) { return `voyage.seat.${code}`; }
  if (joinCode) {
    $('join-banner').hidden = false;
    $('join-code').textContent = joinCode;
    $('cat-section').hidden = true;
    $('format-section').hidden = true;
    $('hotseat-section').hidden = true;
    $('online-section').hidden = false;
    $('create-btn').hidden = true;
    $('join-btn').hidden = false;
  }
  $('join-btn').addEventListener('click', () => {
    const name = ($('my-name').value || '').trim();
    if (!name) { $('my-name').focus(); $('net-status').textContent = 'Enter your name first.'; return; }
    if (!Net.supported()) { $('net-status').textContent = 'Online play is not supported in this browser.'; return; }
    Sound.ensure();
    $('join-btn').disabled = true;
    $('net-status').textContent = 'Connecting…';
    view.hotseat = false; view.isHost = false; view.state = null; view.shownRes = null;
    view.me = store.get(seatKey(joinCode));
    let welcomed = false;
    net = Net.join(joinCode, params.get('r'), {
      onOpen() {
        net.send({ t: 'hello', pid: view.me, name });
        $('net-status').textContent = 'Looking for the room…';
        setTimeout(() => {
          if (welcomed) return;
          $('join-btn').disabled = false;
          $('net-status').textContent = 'No answer from this room. Check that the host\'s page is still open (the room ends when the host leaves), then try again.';
        }, 12000);
      },
      onReconnecting(who) { banner(who === 'host' ? 'Waiting for the host…' : 'Connection lost — reconnecting…'); },
      onBack() { banner(null); },
      onError(text) { $('join-btn').disabled = false; $('net-status').textContent = text; },
      onClose() { banner('Disconnected from the voyage.', true); },
      onMessage(msg) {
        if (msg.t === 'welcome') {
          welcomed = true;
          view.me = msg.pid;
          if (msg.pid) store.set(seatKey(joinCode), msg.pid);
          banner(null);
        } else if (msg.t === 'lobby') {
          renderLobby(msg.players, msg.cats, msg.code, false);
        } else if (msg.t === 'full') {
          $('join-btn').disabled = false;
          $('net-status').textContent = 'This voyage is full (6 ships).';
        } else if (msg.t === 'state') {
          if (msg.s.q) msg.s.q.remaining = msg.remaining;
          render(msg.s);
        } else if (msg.t === 'bye') {
          banner('The host ended the voyage.', true);
        }
      },
    });
    view.send = (a) => net.send({ t: 'act', a });
  });

  function banner(text, fatal) {
    let b = $('net-banner');
    if (!text) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'net-banner'; b.className = 'net-banner'; document.body.appendChild(b); }
    b.innerHTML = `${esc(text)}${fatal ? ' <a href="index.html">Menu</a>' : ''}`;
  }

  /* ======================================================================
   * MENU / FINISH / KEYS
   * ==================================================================== */
  $('next-btn').addEventListener('click', () => view.send && view.send({ t: 'next' }));
  $('menu-btn').addEventListener('click', () => {
    $('menu').hidden = false;
    $('menu-room').textContent = view.hotseat ? 'Your voyage is saved at every turn.' : `Room ${lobby.code || joinCode}`;
    $('copy2-btn').hidden = view.hotseat;
    if (!view.hotseat) $('share-link').value = shareUrl(lobby.code || joinCode);
  });
  $('resume-btn').addEventListener('click', () => { $('menu').hidden = true; });
  $('quit-btn').addEventListener('click', async () => {
    if (!view.hotseat && view.isHost && !await Dialog.confirm({ icon: '⚓', title: 'End the voyage?', text: 'You are the host: leaving ends the voyage for everyone in the room.', ok: 'End it', cancel: 'Stay', danger: true })) return;
    leave();
  });
  $('leave-btn').addEventListener('click', leave);
  $('home-btn').addEventListener('click', leave);
  $('again-btn').addEventListener('click', () => {
    $('finish').hidden = true;
    if (view.hotseat) { startHotseat(null); return; }
    if (view.isHost && engine) {
      engine.stop();
      const players = engine.state.players.filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name }));
      engine = createEngine({ online: true, room: lobby.code, cats: lobby.cats, players }, (s) => {
        net.broadcast({ t: 'state', s, remaining: remainingFor(s) });
        render(s);
      });
      view.shownRes = null;
      engine.start();
    }
  });
  function leave() {
    if (engine) engine.stop();
    engine = null;
    if (net) {
      if (view.isHost && !view.hotseat) net.broadcast({ t: 'bye' });
      else if (!view.hotseat) net.send({ t: 'leave' });
      setTimeout(() => { try { net.close(); } catch (e) { /* ignore */ } net = null; }, 200);
    }
    clearInterval(pingTimer);
    stopTimer();
    location.href = 'index.html';
  }
  $('hint-btn').addEventListener('click', askHint);
  $('sound-btn').addEventListener('click', () => { Sound.enabled = !Sound.enabled; $('sound-btn').textContent = Sound.enabled ? '🔊' : '🔇'; });
  document.addEventListener('keydown', (e) => {
    const s = view.state;
    if (!s || !$('game').classList.contains('active') || e.target.tagName === 'INPUT') return;
    if (s.phase === 'pick' && canAct(s) && /^[1-6]$/.test(e.key)) { e.preventDefault(); view.send({ t: 'pick', level: +e.key }); }
    else if (s.phase === 'result' && e.key === 'Enter' && !$('next-btn').hidden) { e.preventDefault(); view.send({ t: 'next' }); }
    else if (s.phase === 'question' && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); askHint(); }
    else if (e.key === 'Escape') $('menu').hidden = !$('menu').hidden;
  });

  if (/[?&]debug\b/.test(location.search)) window.__voyage = { view, get engine() { return engine; }, ROUTE, N };

  syncSetup();
})();
