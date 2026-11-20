/* Geo Time Travel: a history race on the world map, from prehistory to today.
 *
 * Each player travels through five eras. A turn is one question from the player's current era, answered
 * on the map. Each era needs `need` correct answers (2, 3 or 4) before the player travels on; arriving in
 * a new era gives a life back (up to 5). A wrong answer or a timeout costs a life; at 0 the era claims the
 * player (a sabre-toothed cat, Spartans, the plague...). The first player to reach today ends the journey
 * once the round is complete (everyone gets as many turns). Eliminated players sit out; the others play on
 * until the last one is out, and then the one who got furthest wins.
 * Questions come from their own pool (data/timetravel.js), drawn at random, never twice in a game.
 *
 * Like Voyage: a host-run engine (hot seat: on this device; online: on the host's device, the state is
 * sent to everyone through the relay in js/net.js), bots, and a bot takeover for players who go offline. */
(function () {
  const { sleep, Sound, Confetti } = FX;
  const $ = (id) => document.getElementById(id);
  const W = window.WORLD;
  const QUESTIONS = window.TIME_TRAVEL_QUESTIONS || [];
  const COLORS = ['#ef476f', '#06c167', '#ffb703', '#3a86ff', '#b15cff', '#00c2d1'];
  const MAX_PLAYERS = 6;
  const START_LIVES = 3, MAX_LIVES = 5;
  const Q_TIME = 45;
  const AUTO_NEXT = 5200, DOOM_MS = 3600;
  const TAKEOVER = 20; // online: seconds after going offline before a bot plays for the player
  const BOT_ANSWER = [2600, 5200];
  const BOTS = {
    rookie: { label: 'Rookie', acc: 0.55, note: 'Bot · makes mistakes' },
    explorer: { label: 'Explorer', acc: 0.72, note: 'Bot · a fair match' },
    genius: { label: 'Genius', acc: 0.88, note: 'Bot · hard to beat' },
  };
  const ERAS = [
    { key: 'prehistory', name: 'Prehistory', icon: '🦴', when: 'until ~3000 BC', color: '#c98b4a', threats: [
      { icon: '🐅', title: 'A sabre-toothed cat!', text: (n) => `${n} was eaten by a sabre-toothed cat.` },
      { icon: '🦣', title: 'Mammoth stampede!', text: (n) => `${n} was trampled by a herd of woolly mammoths.` },
      { icon: '🌋', title: 'The volcano wakes!', text: (n) => `${n} was buried under hot ash.` }] },
    { key: 'ancient', name: 'Antiquity', icon: '🏛️', when: '3000 BC – AD 500', color: '#e0b04a', threats: [
      { icon: '⚔️', title: 'Spartan warriors!', text: (n) => `${n} met three hundred Spartans in a narrow pass.` },
      { icon: '🦁', title: 'Into the arena!', text: (n) => `${n} was thrown to the lions of the Colosseum.` },
      { icon: '🛡️', title: 'A Roman legion!', text: (n) => `${n} was marched off by a Roman legion.` }] },
    { key: 'middle_ages', name: 'Middle Ages', icon: '🏰', when: '500 – 1500', color: '#8fa7c9', threats: [
      { icon: '🐀', title: 'The Black Death!', text: (n) => `${n} caught the plague.` },
      { icon: '🪓', title: 'Vikings!', text: (n) => `${n} was carried off by a Viking raid.` },
      { icon: '🏹', title: 'Arrows from the walls!', text: (n) => `${n} came too close to a castle under siege.` }] },
    { key: 'early_modern', name: 'Early Modern', icon: '⛵', when: '1500 – 1800', color: '#4ab0c9', threats: [
      { icon: '🏴‍☠️', title: 'Pirates!', text: (n) => `${n} was made to walk the plank.` },
      { icon: '💥', title: 'Cannon fire!', text: (n) => `${n} was hit by a cannonball in a naval battle.` },
      { icon: '🔥', title: 'The Great Fire!', text: (n) => `${n} was caught in the Great Fire of London.` }] },
    { key: 'modern', name: 'Modern', icon: '🏭', when: '1800 – today', color: '#9a7cff', threats: [
      { icon: '🧊', title: 'Iceberg ahead!', text: (n) => `${n} sailed on the Titanic.` },
      { icon: '🚂', title: 'Runaway train!', text: (n) => `${n} stood in the way of a runaway steam train.` },
      { icon: '⚡', title: 'Time machine failure!', text: (n) => `${n}'s time machine short-circuited.` }] },
  ];
  const NE = ERAS.length;
  const TODAY = { name: 'Today', icon: '🏁' };

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const uid = () => 'p' + Math.random().toString(36).slice(2, 9);
  const byId = (id) => W.countries.find((c) => c.id === id);
  const isBotP = (p) => !!(p && (p.bot || p.auto));
  const progress = (p) => (p.finished ? 1000 : p.era * 10 + p.done);
  const eraOf = (p) => (p.finished ? TODAY : ERAS[p.era]);

  /* ======================================================================
   * ENGINE (host only)
   * ==================================================================== */
  function createEngine(cfg, emit) {
    const S = {
      v: 1, gid: Math.random().toString(36).slice(2, 8), online: !!cfg.online, room: cfg.room || null, need: cfg.need || 3,
      phase: 'question',
      players: cfg.players.map((p, i) => ({
        id: p.id, name: p.name, color: COLORS[i % COLORS.length], bot: BOTS[p.bot] ? p.bot : null, auto: false, connected: true,
        era: 0, done: 0, lives: START_LIVES, alive: true, finished: false, correct: 0, asked: 0, elim: null,
      })),
      turn: 0, round: 1, finalRound: false, finishers: [], q: null, res: null, ranking: null, seq: 0, log: [],
    };
    const used = new Set();
    let secret = null;
    let timer = null;
    const offTimers = {};
    const active = () => S.players[S.turn];
    const publish = () => { S.seq++; emit(JSON.parse(JSON.stringify(S))); };
    const log = (t) => { S.log.unshift(t); S.log = S.log.slice(0, 30); };
    const clearTimer = () => { clearTimeout(timer); timer = null; };

    /** A question of this era not asked yet in this game (if the era has none left: the nearest era's). */
    function draw(era) {
      for (let d = 0; d < NE; d++) {
        for (const e of [era - d, era + d]) {
          const pool = QUESTIONS.filter((q) => q.era === e && !used.has(q.id));
          if (pool.length) { const q = pool[Math.floor(Math.random() * pool.length)]; used.add(q.id); return q; }
        }
      }
      used.clear(); // every question asked (only in a very long game)
      return draw(era);
    }

    function startTurn() {
      clearTimer();
      const p = active();
      if (!p.alive || p.finished) return advance();
      secret = draw(p.era);
      S.q = { era: p.era, prompt: secret.q, time: Q_TIME, started: Date.now() };
      S.res = null;
      S.phase = 'question';
      timer = setTimeout(() => answer(p.id, null), (Q_TIME + 1) * 1000);
      publish();
      if (isBotP(p)) botAnswer(p);
    }

    function botAnswer(p) {
      clearTimer();
      const started = S.q.started;
      timer = setTimeout(() => {
        if (S.phase !== 'question' || active() !== p || S.q.started !== started) return;
        const c = byId(secret.a);
        let id = c.id;
        if (Math.random() > BOTS[p.bot || 'explorer'].acc) {
          const pool = W.countries.filter((x) => x.fame && x.id !== c.id && x.region === c.region);
          const all = pool.length ? pool : W.countries.filter((x) => x.fame && x.id !== c.id);
          id = all[Math.floor(Math.random() * all.length)].id;
        }
        answer(p.id, id);
      }, BOT_ANSWER[0] + Math.random() * (BOT_ANSWER[1] - BOT_ANSWER[0]));
    }

    function answer(pid, countryId) {
      const p = active();
      if (S.phase !== 'question' || pid !== p.id) return;
      clearTimer();
      const c = byId(secret.a);
      const ok = countryId === c.id;
      const clicked = countryId ? byId(countryId) : null;
      p.asked++;
      const res = { pid, ok, era: p.era, answer: c.id, answerName: c.name, clicked: countryId, clickedName: clicked ? clicked.name : null, timeout: countryId == null };
      if (ok) {
        p.correct++;
        p.done++;
        if (p.done >= S.need) {
          p.era++;
          p.done = 0;
          res.advanced = true;
          if (p.era >= NE) {
            p.finished = true;
            res.home = true;
            S.finishers.push(p.id);
            log(`🏁 ${p.name} has reached today!`);
            if (!S.finalRound) { S.finalRound = true; log('⏳ Last round.'); }
          } else {
            const before = p.lives;
            p.lives = Math.min(MAX_LIVES, p.lives + 1);
            res.bonus = p.lives > before;
            log(`${ERAS[p.era].icon} ${p.name} travels on to ${ERAS[p.era].name}${res.bonus ? ' (+1 ❤️)' : ''}.`);
          }
        } else log(`✓ ${p.name} found ${c.name}.`);
      } else {
        p.lives--;
        res.lostLife = true;
        log(`✗ ${p.name} missed: ${c.name}.`);
        if (p.lives <= 0) {
          p.alive = false;
          const k = Math.floor(Math.random() * ERAS[p.era].threats.length);
          p.elim = { era: p.era, k };
          res.eliminated = { era: p.era, k };
          log(`${ERAS[p.era].threats[k].icon} ${ERAS[p.era].threats[k].text(p.name)}`);
        }
      }
      S.res = res;
      S.phase = 'result';
      if (S.online || isBotP(p)) timer = setTimeout(() => next(null, true), AUTO_NEXT + (res.eliminated ? DOOM_MS : 0));
      publish();
    }

    function next(pid, auto) {
      if (S.phase !== 'result') return;
      if (!auto && S.online && pid !== active().id && pid !== S.players[0].id) return;
      advance();
    }

    const playing = (p) => p.alive && !p.finished;
    function advance() {
      clearTimer();
      const n = S.players.length;
      // the journey goes on while anyone is still travelling; it ends when the last one is out
      // (or, once someone has reached today, at the end of that round)
      if (!S.players.some(playing)) return finish();
      let t = S.turn;
      for (let k = 0; k < n; k++) {
        if (t === n - 1) { if (S.finalRound) return finish(); S.round++; }
        t = (t + 1) % n;
        if (playing(S.players[t])) { S.turn = t; return startTurn(); }
      }
      return finish();
    }

    function finish() {
      clearTimer();
      const acc = (p) => (p.asked ? p.correct / p.asked : 0);
      const ranked = S.players.slice().sort((a, b) => (b.finished - a.finished) || (a.finished && b.finished ? S.finishers.indexOf(a.id) - S.finishers.indexOf(b.id) : 0)
        || progress(b) - progress(a) || (b.alive - a.alive) || b.lives - a.lives || acc(b) - acc(a));
      S.ranking = ranked.map((p) => p.id);
      S.phase = 'over';
      S.q = null;
      publish();
    }

    function takeOver(pid) {
      const p = S.players.find((o) => o.id === pid);
      if (!p || p.connected || p.auto || S.phase === 'over') return;
      p.auto = true;
      log(`🤖 A bot travels for ${p.name} until they are back.`);
      if (p === active() && S.phase === 'question') botAnswer(p);
      publish();
    }
    function setConnected(pid, on) {
      const p = S.players.find((o) => o.id === pid);
      if (!p || p.connected === on) return;
      p.connected = on;
      clearTimeout(offTimers[pid]);
      if (on) { log(`🔌 ${p.name} is back.`); p.auto = false; }
      else { log(`📴 ${p.name} lost connection. A bot plays for them in ${TAKEOVER} s.`); offTimers[pid] = setTimeout(() => takeOver(pid), TAKEOVER * 1000); }
      publish();
    }

    function handle(pid, a) {
      if (!a) return;
      if (a.t === 'answer') answer(pid, a.id || null);
      else if (a.t === 'next') next(pid);
    }

    return {
      start() { log('⏳ The journey through time begins!'); startTurn(); },
      handle, setConnected,
      get state() { return S; },
      snapshot: () => JSON.parse(JSON.stringify(S)),
      peek: () => secret && secret.a, // tests only (host side)
      stop() { clearTimer(); Object.values(offTimers).forEach(clearTimeout); },
    };
  }

  /* ======================================================================
   * VIEW (every device)
   * ==================================================================== */
  const view = { state: null, me: null, hotseat: true, isHost: true, send: null, shownRes: null, timerHandle: null, qReceived: 0 };
  const activeP = (s) => s.players[s.turn];
  const canAct = (s) => !isBotP(activeP(s)) && (view.hotseat || (view.me && activeP(s).id === view.me));
  const hearts = (p) => (p.finished ? '🏁' : !p.alive ? '💀' : '❤️'.repeat(p.lives));

  function show(id) {
    document.querySelectorAll('.v-screen').forEach((x) => x.classList.toggle('active', x.id === id));
    document.body.classList.toggle('in-game', id === 'game');
  }

  function renderTop(s) {
    $('v-players').innerHTML = s.players.map((p, i) => {
      const e = eraOf(p);
      const isMe = !view.hotseat && p.id === view.me;
      return `<div class="vp tt-vp${i === s.turn && s.phase !== 'over' ? ' active' : ''}${p.alive ? '' : ' dead'}${p.connected ? '' : ' off'}" style="--pc:${p.color}" title="${esc(p.name)}: ${e.name}, ${p.lives} lives">
        <span class="vp-name">${p.bot || p.auto ? '🤖 ' : ''}${esc(p.name)}${isMe ? ' (you)' : ''}</span>
        <span class="vp-num">${e.icon} ${p.finished ? 'Today' : `${p.done}/${s.need}`} · ${hearts(p)}</span></div>`;
    }).join('');
  }

  /** The active player's road through the eras. */
  function renderTimeline(s, p) {
    $('timeline').innerHTML = ERAS.map((e, i) => {
      const state = p.finished || i < p.era ? 'done' : i === p.era ? 'now' : 'later';
      const dots = state === 'now' ? `<i class="tt-dots">${Array.from({ length: s.need }, (_, k) => `<b class="${k < p.done ? 'on' : ''}"></b>`).join('')}</i>` : '';
      return `<div class="tt-step ${state}" style="--ec:${e.color}" title="${e.name} (${e.when})"><span>${e.icon}</span><small>${e.name}</small>${dots}</div>`;
    }).join('<span class="tt-arrow">›</span>') + `<span class="tt-arrow">›</span><div class="tt-step ${p.finished ? 'done' : 'later'}"><span>${TODAY.icon}</span><small>Today</small></div>`;
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
    view.timerHandle = setInterval(() => {
      const left = draw();
      if (left <= 5 && left > 0 && canAct(view.state)) Sound.tick();
      if (left <= 0) stopTimer();
    }, 1000);
  }

  function render(s) {
    const prev = view.state;
    view.state = s;
    show('game');
    if (s.phase !== 'over') $('finish').hidden = true;
    renderTop(s);
    const p = activeP(s);
    $('panel').style.setProperty('--pc', p.color);
    $('panel-dot').style.background = p.color;
    document.body.dataset.era = eraOf(p).name;
    if (prev && prev.gid === s.gid && prev.seq === s.seq) return;
    renderTimeline(s, p);

    if (s.phase === 'question') {
      if (prev && prev.gid === s.gid && prev.phase === 'question' && prev.q && prev.q.started === s.q.started) return; // same question
      view.qReceived = Date.now();
      const e = ERAS[s.q.era];
      const mine = canAct(s);
      $('result').hidden = true;
      $('next-btn').hidden = true;
      $('doom').hidden = true;
      const card = $('quiz-card');
      card.hidden = false;
      card.style.setProperty('--pc', p.color);
      const chip = $('q-era');
      chip.style.setProperty('--ec', e.color);
      chip.textContent = `${e.icon} ${e.name}`;
      $('q-who').style.setProperty('--pc', p.color);
      $('q-who').textContent = mine && !view.hotseat ? 'Your question' : `${isBotP(p) ? '🤖 ' : ''}${p.name}`;
      $('q-lives').textContent = hearts(p);
      $('q-prompt').textContent = s.q.prompt;
      $('q-kind').textContent = 'Tap the country on the map';
      $('panel-title').textContent = mine ? (view.hotseat ? `${p.name}: where did it happen?` : 'Where did it happen?') : `${isBotP(p) ? '🤖 ' : ''}${p.name} is answering…`;
      $('panel-sub').textContent = `${e.name} · ${p.done}/${s.need} found`;
      document.body.classList.add('answering');
      WorldMap.reset(true);
      if (mine) WorldMap.prepare((id) => { WorldMap.lock(); view.send({ t: 'answer', id }); });
      else { WorldMap.clear(); WorldMap.lock(); }
      runTimer(s.q);
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

  async function showResult(s) {
    const r = s.res;
    const p = s.players.find((x) => x.id === r.pid);
    const who = view.hotseat ? p.name : (p.id === view.me ? 'You' : p.name);
    WorldMap.lock();
    WorldMap.clear();
    WorldMap.reveal(r.answer, r.clicked);
    const res = $('result');
    res.hidden = false;
    res.classList.toggle('bad', !r.ok);
    let title, sub;
    if (r.ok) {
      $('result-icon').textContent = r.home ? '🏁' : r.advanced ? ERAS[p.era].icon : '✓';
      title = r.home ? `${who} reached today! 🏁` : r.advanced ? `${who} travel${who === 'You' ? '' : 's'} on to ${ERAS[p.era].name}!` : `${who}: correct!`;
      sub = `The answer is <b>${esc(r.answerName)}</b>.${r.bonus ? ' <b class="gold">+1 ❤️ for the new era</b>' : ''}`;
      Sound.correct();
      if (r.advanced) { const b = $('map-wrap').getBoundingClientRect(); Confetti.burst(b.left + b.width / 2, b.top + b.height * 0.6, r.home ? 140 : 70, 0.8); }
    } else {
      $('result-icon').textContent = r.timeout ? '⏱' : '✗';
      title = r.timeout ? `${who}: time's up` : `${who}: not ${r.clickedName}`;
      sub = `The answer was <b>${esc(r.answerName)}</b>. ${r.eliminated ? '<b>No lives left…</b>' : `−1 ❤️ (${p.lives} left)`}`;
      Sound.wrong();
    }
    $('result-title').textContent = title;
    $('result-sub').innerHTML = sub;
    $('panel-title').textContent = r.ok ? (r.advanced ? `${eraOf(p).icon} ${eraOf(p).name}` : `${p.name}: ${p.done}/${s.need} in ${ERAS[p.era].name}`) : `${p.name}: ${hearts(p)}`;
    $('panel-sub').textContent = '';
    const nextBtn = $('next-btn');
    nextBtn.textContent = 'Next ⏎';
    nextBtn.hidden = !(view.hotseat || canAct(s) || view.isHost);
    if (r.eliminated) {
      await sleep(1400);
      if (view.state && view.state.seq === s.seq) await doom(p, r.eliminated);
    }
    if (!nextBtn.hidden && view.state && view.state.seq === s.seq) nextBtn.focus({ preventScroll: true });
  }

  /** The era claims a player: a short scene, then back to the game. */
  async function doom(p, el) {
    const t = ERAS[el.era].threats[el.k];
    const box = $('doom');
    box.style.setProperty('--ec', ERAS[el.era].color);
    $('doom-icon').textContent = t.icon;
    $('doom-title').textContent = t.title;
    $('doom-text').textContent = `${t.text(p.name)} ${p.name} is out of the journey.`;
    box.hidden = false;
    box.classList.remove('play'); void box.offsetWidth; box.classList.add('play');
    Sound.tone(140, 0.5, 'sawtooth', 0.12, 0, 60);
    await sleep(DOOM_MS);
    box.hidden = true;
  }
  $('doom').addEventListener('click', () => { $('doom').hidden = true; });

  function showFinish(s) {
    const order = s.ranking.map((id) => s.players.find((p) => p.id === id));
    const w = order[0];
    const solo = s.players.length === 1;
    $('win-icon').textContent = w.finished ? '🏆' : w.alive ? '⏳' : '💀';
    $('win-title').textContent = solo ? (w.finished ? 'You made it to today!' : `The journey ends in ${eraOf(w).name}`) : `${w.name} wins the journey!`;
    $('win-sub').textContent = w.finished ? `Back in the present after ${s.round} rounds.` : solo ? `${w.correct} correct answers out of ${w.asked}.` : `${w.name} travelled furthest: ${eraOf(w).name}.`;
    $('podium').innerHTML = order.map((p, i) => {
      const acc = p.asked ? Math.round((p.correct / p.asked) * 100) : 0;
      return `<li style="--pc:${p.color}"><b>${['🥇', '🥈', '🥉'][i] || i + 1 + '.'}</b><span class="pawn-icon"></span><span>${esc(p.name)}</span>
        <span>${eraOf(p).icon} ${eraOf(p).name} · ${p.alive || p.finished ? hearts(p) : `💀 ${ERAS[p.elim.era].threats[p.elim.k].icon}`} · ${acc}% ✓</span></li>`;
    }).join('');
    $('again-btn').hidden = !(view.hotseat || view.isHost);
    setTimeout(() => { $('finish').hidden = false; if (w.finished) { Sound.win(); Confetti.rain(200); } }, 700);
  }

  /* ======================================================================
   * SETUP
   * ==================================================================== */
  const SETUP_KEY = 'timetravel.setup.v1';
  const setup = Object.assign({ need: 3, format: 'hotseat', count: 2, names: ['', '', '', '', '', ''], types: ['human', 'explorer', 'human', 'human', 'human', 'human'], myName: '' }, store.get(SETUP_KEY) || {});
  if (![2, 3, 4].includes(setup.need)) setup.need = 3;
  const saveSetup = () => store.set(SETUP_KEY, setup);
  const params = new URLSearchParams(location.search);
  const joinCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const typeText = (t) => `${t === 'human' ? '🙂 Human' : `🤖 ${BOTS[t].label}`} ▾`;
  const botChoices = () => Object.entries(BOTS).map(([k, b]) => ({ value: k, label: `🤖 ${b.label}`, note: b.note }));
  const typeChoices = () => [{ value: 'human', label: '🙂 Human', note: 'A person plays' }, ...botChoices()];
  const nthOfKind = (list, i) => list.slice(0, i + 1).filter((t) => (t === 'human') === (list[i] === 'human')).length;
  const defaultName = (n, t) => (t === 'human' ? `Traveller ${n}` : `Bot traveller ${n}`);

  function syncSetup() {
    document.querySelectorAll('#length-grid .format-btn').forEach((b) => b.classList.toggle('active', +b.dataset.need === setup.need));
    $('length-hint').textContent = `${setup.need * NE} correct answers to reach today · 3 lives, +1 in each new era`;
    document.querySelectorAll('#format-section .format-btn').forEach((b) => b.classList.toggle('active', b.dataset.format === setup.format));
    $('hotseat-section').hidden = !!joinCode || setup.format !== 'hotseat';
    $('online-section').hidden = !joinCode && setup.format !== 'online';
    $('count-num').textContent = setup.count;
    const list = $('name-list');
    list.innerHTML = '';
    const types = setup.types.slice(0, setup.count);
    for (let i = 0; i < setup.count; i++) {
      const row = document.createElement('label');
      row.className = 'name-row';
      row.style.setProperty('--pc', COLORS[i]);
      row.innerHTML = `<span class="pawn-icon"></span><input maxlength="16" aria-label="Player ${i + 1} name"><button type="button" class="type-btn" aria-haspopup="listbox" title="Choose: human or computer traveller"></button>`;
      const input = row.querySelector('input');
      input.value = setup.names[i] || '';
      input.placeholder = defaultName(nthOfKind(types, i), setup.types[i]);
      input.addEventListener('input', () => { setup.names[i] = input.value; saveSetup(); });
      const tb = row.querySelector('.type-btn');
      tb.textContent = typeText(setup.types[i]);
      tb.classList.toggle('bot', setup.types[i] !== 'human');
      tb.addEventListener('click', async (e) => {
        e.preventDefault();
        const v = await Dialog.menu(tb, typeChoices(), setup.types[i]);
        if (v == null || v === setup.types[i]) return;
        setup.types[i] = v;
        syncSetup();
      });
      list.appendChild(row);
    }
    $('my-name').value = setup.myName || '';
    saveSetup();
  }
  document.querySelectorAll('#length-grid .format-btn').forEach((b) => b.addEventListener('click', () => { setup.need = +b.dataset.need; syncSetup(); }));
  document.querySelectorAll('#format-section .format-btn').forEach((b) => b.addEventListener('click', () => { setup.format = b.dataset.format; syncSetup(); }));
  $('minus-btn').addEventListener('click', () => { setup.count = Math.max(1, setup.count - 1); syncSetup(); });
  $('plus-btn').addEventListener('click', () => { setup.count = Math.min(MAX_PLAYERS, setup.count + 1); syncSetup(); });
  $('my-name').addEventListener('input', () => { setup.myName = $('my-name').value; saveSetup(); });

  /* ======================================================================
   * HOT SEAT
   * ==================================================================== */
  let engine = null;
  function startHotseat() {
    const types = setup.types.slice(0, setup.count);
    const players = types.map((t, i) => {
      const bot = t !== 'human' ? t : null;
      return { id: uid(), name: (setup.names[i] || '').trim() || defaultName(nthOfKind(types, i), t), bot };
    });
    view.hotseat = true; view.me = null; view.isHost = true; view.state = null; view.shownRes = null;
    engine = createEngine({ need: setup.need, players }, render);
    view.send = (a) => engine.handle(engine.state.players[engine.state.turn].id, a);
    $('finish').hidden = true;
    show('game');
    WorldMap.reset(false);
    engine.start();
  }
  $('start-btn').addEventListener('click', () => { Sound.ensure(); startHotseat(); });

  /* ======================================================================
   * ONLINE (same relay and room system as Voyage, its own channel)
   * ==================================================================== */
  let net = null;
  const lobby = { players: [], need: 3 };
  const connOf = new Map();
  let pingTimer = null;
  function shareUrl(code) {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    if (params.get('relay')) u.searchParams.set('relay', params.get('relay'));
    u.searchParams.set('room', code);
    if (lobby.relay) u.searchParams.set('r', lobby.relay);
    return u.toString();
  }
  function renderLobby(players, need, code, isHost) {
    show('lobby');
    $('room-code').textContent = code;
    $('share-link').value = shareUrl(code);
    $('share-btn').hidden = !navigator.share;
    $('crew-count').textContent = `${players.length} / ${MAX_PLAYERS}`;
    $('crew').innerHTML = players.map((p, i) => `<li style="--pc:${COLORS[i]}"><span class="pawn-icon"></span><b>${p.bot ? '🤖 ' : ''}${esc(p.name)}</b>${i === 0 ? ' <small>host</small>' : ''}${p.id === view.me ? ' <small>you</small>' : ''}${
      p.bot ? (isHost ? ` <button type="button" class="type-btn bot" data-skill="${p.id}" aria-haspopup="listbox">${BOTS[p.bot].label} ▾</button><button type="button" class="crew-x" data-rm="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ` <small>bot · ${BOTS[p.bot].label}</small>`) : ''}</li>`).join('');
    $('add-bot-btn').hidden = !isHost || players.length >= MAX_PLAYERS;
    if (isHost) {
      $('crew').querySelectorAll('[data-skill]').forEach((b) => b.addEventListener('click', async () => {
        const p = lobby.players.find((x) => x.id === b.dataset.skill);
        const v = p && await Dialog.menu(b, botChoices(), p.bot);
        if (!v || v === p.bot || !lobby.players.includes(p)) return;
        p.bot = v;
        hostLobbyUpdate();
      }));
      $('crew').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        lobby.players = lobby.players.filter((x) => x.id !== b.dataset.rm);
        hostLobbyUpdate();
      }));
    }
    $('lobby-rules').textContent = `${need} correct answers per era · ${need * NE} to reach today`;
    $('lobby-start-btn').hidden = !isHost;
    $('lobby-start-btn').disabled = players.length < 2;
    $('lobby-start-btn').textContent = players.length < 2 ? 'Waiting for players…' : `Start the journey with ${players.length} ⏳`;
    $('lobby-wait').hidden = isHost;
  }
  $('add-bot-btn').addEventListener('click', () => {
    if (!view.isHost || lobby.players.length >= MAX_PLAYERS) return;
    const taken = new Set(lobby.players.map((p) => p.name));
    let k = 1;
    while (taken.has(defaultName(k, 'bot'))) k++;
    lobby.players.push({ id: uid(), name: defaultName(k, 'bot'), bot: 'explorer', connected: true });
    hostLobbyUpdate();
  });
  function copyLink(btn) {
    const link = $('share-link').value;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
      () => { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = btn.id === 'copy-btn' ? 'Copy' : 'Copy invitation link'; }, 1600); },
      () => { $('share-link').select(); document.execCommand('copy'); },
    );
  }
  $('copy-btn').addEventListener('click', () => copyLink($('copy-btn')));
  $('copy2-btn').addEventListener('click', () => copyLink($('copy2-btn')));
  $('share-btn').addEventListener('click', () => navigator.share({ title: 'Geo Time Travel', text: 'Travel through time with me!', url: $('share-link').value }).catch(() => {}));

  $('create-btn').addEventListener('click', () => {
    const name = ($('my-name').value || '').trim();
    if (!name) { $('my-name').focus(); $('net-status').textContent = 'Enter your name first.'; return; }
    if (!Net.supported()) { $('net-status').textContent = 'Online play is not supported in this browser.'; return; }
    Sound.ensure();
    $('create-btn').disabled = true;
    $('net-status').textContent = 'Opening a room…';
    view.hotseat = false; view.isHost = true; view.me = uid(); view.state = null; view.shownRes = null;
    lobby.players = [{ id: view.me, name, connected: true }];
    lobby.need = setup.need;
    net = Net.host({
      onReady(code, relayKey) {
        lobby.code = code; lobby.relay = relayKey;
        $('create-btn').disabled = false;
        $('net-status').textContent = '';
        renderLobby(lobby.players, lobby.need, code, true);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          net.broadcast({ t: 'ping' });
          const now = Date.now();
          connOf.forEach((conn, pid) => {
            if (now - (conn._seen || now) > 30000) {
              connOf.delete(pid);
              try { conn.close(); } catch (e) { /* ignore */ }
              if (engine) engine.setConnected(pid, false);
              else { lobby.players = lobby.players.filter((p) => p.id !== pid); hostLobbyUpdate(); }
            }
          });
        }, 5000);
      },
      onError(text) { $('create-btn').disabled = false; $('net-status').textContent = text; },
      onMessage: hostMessage,
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
    renderLobby(lobby.players, lobby.need, lobby.code, true);
    net.broadcast({ t: 'lobby', players: lobby.players, need: lobby.need, code: lobby.code });
  }
  const remainingFor = (s) => (s.phase === 'question' && s.q ? Math.max(0, s.q.time - (Date.now() - s.q.started) / 1000) : null);
  function hostMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    conn._seen = Date.now();
    if (msg.t === 'pong') return;
    if (msg.t === 'hello') {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Traveller';
      let pid = msg.pid;
      const roster = engine ? engine.state.players : lobby.players;
      let known = roster.find((p) => p.id === pid);
      if (!known && engine) {
        known = roster.find((p) => !p.connected && p.name.toLowerCase() === name.toLowerCase());
        if (known) pid = known.id;
      }
      if (!known) {
        if (engine) { // running: watch only
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
  function startOnline(players) {
    engine = createEngine({ online: true, room: lobby.code, need: lobby.need, players }, (s) => {
      net.broadcast({ t: 'state', s, remaining: remainingFor(s) });
      if (s.q) s.q.remaining = remainingFor(s);
      render(s);
    });
    view.send = (a) => engine.handle(view.me, a);
    view.shownRes = null;
    engine.start();
  }
  $('lobby-start-btn').addEventListener('click', () => { if (view.isHost && lobby.players.length >= 2) startOnline(lobby.players); });

  function seatKey(code) { return `timetravel.seat.${code}`; }
  if (joinCode) {
    $('join-banner').hidden = false;
    $('join-code').textContent = joinCode;
    ['length-section', 'format-section', 'hotseat-section'].forEach((id) => { $(id).hidden = true; });
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
      onClose() { banner('Disconnected from the journey.', true); },
      onMessage(msg) {
        if (msg.t === 'welcome') {
          welcomed = true;
          view.me = msg.pid;
          if (msg.pid) store.set(seatKey(joinCode), msg.pid);
          banner(null);
        } else if (msg.t === 'lobby') renderLobby(msg.players, msg.need, msg.code, false);
        else if (msg.t === 'full') { $('join-btn').disabled = false; $('net-status').textContent = `This journey is full (${MAX_PLAYERS} travellers).`; }
        else if (msg.t === 'state') { if (msg.s.q) msg.s.q.remaining = msg.remaining; render(msg.s); }
        else if (msg.t === 'ping') net.send({ t: 'pong' });
        else if (msg.t === 'bye') banner('The host ended the journey.', true);
      },
    });
    view.send = (a) => net.send({ t: 'act', a });
  });
  function banner(text, fatal) {
    let b = $('net-banner');
    if (!text) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'net-banner'; b.className = 'net-banner'; document.body.appendChild(b); }
    b.innerHTML = `${esc(text)}${fatal ? ' <a href="timetravel.html">Menu</a>' : ''}`;
  }

  /* ======================================================================
   * MENU / FINISH / KEYS
   * ==================================================================== */
  $('next-btn').addEventListener('click', () => view.send && view.send({ t: 'next' }));
  $('menu-btn').addEventListener('click', () => {
    $('menu').hidden = false;
    $('menu-room').textContent = view.hotseat ? 'Hot seat journey.' : `Room ${lobby.code || joinCode}`;
    $('copy2-btn').hidden = view.hotseat;
    if (!view.hotseat) $('share-link').value = shareUrl(lobby.code || joinCode);
  });
  $('resume-btn').addEventListener('click', () => { $('menu').hidden = true; });
  $('quit-btn').addEventListener('click', async () => {
    if (!await Dialog.confirm({ icon: '⏳', title: 'Leave the journey?', text: !view.hotseat && view.isHost ? 'You are the host: leaving ends the journey for everyone in the room.' : 'This journey will end.', ok: 'Leave', cancel: 'Stay', danger: !view.hotseat && view.isHost })) return;
    leave();
  });
  $('leave-btn').addEventListener('click', leave);
  $('home-btn').addEventListener('click', leave);
  $('again-btn').addEventListener('click', () => {
    $('finish').hidden = true;
    if (view.hotseat) { startHotseat(); return; }
    if (view.isHost && engine) {
      engine.stop();
      startOnline(engine.state.players.filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name, bot: p.bot })));
    }
  });
  function leave() {
    if (engine) engine.stop();
    engine = null;
    if (net) {
      if (view.isHost && !view.hotseat) net.broadcast({ t: 'bye' });
      else if (!view.hotseat) net.send({ t: 'leave' });
      const n = net;
      setTimeout(() => { try { n.close(); } catch (e) { /* ignore */ } }, 200);
      net = null;
    }
    clearInterval(pingTimer);
    stopTimer();
    location.href = 'timetravel.html';
  }
  $('sound-btn').addEventListener('click', () => { Sound.enabled = !Sound.enabled; $('sound-btn').textContent = Sound.enabled ? '🔊' : '🔇'; });
  document.addEventListener('keydown', (e) => {
    const s = view.state;
    if (!s || !$('game').classList.contains('active') || e.target.tagName === 'INPUT') return;
    if (s.phase === 'result' && e.key === 'Enter' && !$('next-btn').hidden) { e.preventDefault(); view.send({ t: 'next' }); }
    else if (e.key === 'Escape') $('menu').hidden = !$('menu').hidden;
  });

  if (/[?&]debug\b/.test(location.search)) window.__tt = { view, get engine() { return engine; }, ERAS };
  syncSetup();
})();
