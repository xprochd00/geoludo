/* Game controller: setup screen, turn flow, hot-seat state. */
(function () {
  const { sleep, Sound, Confetti, Dice } = FX;
  const $ = (id) => document.getElementById(id);
  const COLORS = Board.COLORS;
  const SEATS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
  const DEFAULT_NAMES = ['Magellan', 'Earhart', 'Ibn Battuta', 'Zheng He'];
  const TIMER_SECS = 30;

  /* ================= SETUP ================= */
  let count = 4;
  const names = [...DEFAULT_NAMES];

  function renderInputs() {
    const box = $('player-inputs');
    box.innerHTML = '';
    SEATS[count].forEach((seat) => {
      const col = COLORS[seat];
      const row = document.createElement('div');
      row.className = 'player-row';
      row.style.setProperty('--pc', col.hex);
      row.innerHTML = `<span class="pawn-icon"></span><input maxlength="16" aria-label="${col.name} player name"><span class="color-name">${col.name}</span>`;
      const input = row.querySelector('input');
      input.value = names[seat];
      input.addEventListener('input', () => { names[seat] = input.value; });
      box.appendChild(row);
    });
  }
  document.querySelectorAll('.count-btn').forEach((b) => {
    b.addEventListener('click', () => {
      count = +b.dataset.count;
      document.querySelectorAll('.count-btn').forEach((x) => x.classList.toggle('active', x === b));
      renderInputs();
    });
  });
  renderInputs();

  $('start-btn').addEventListener('click', () => {
    Sound.ensure();
    startGame();
  });

  /* ================= STATE ================= */
  let state = null;

  function startGame() {
    state = {
      players: SEATS[count].map((seat) => ({
        seat, name: (names[seat] || '').trim() || DEFAULT_NAMES[seat], pos: 0, correct: 0, asked: 0, captures: 0,
      })),
      turn: 0,
      phase: 'roll',
      opts: { six: $('opt-six').checked, exact: $('opt-exact').checked, timer: $('opt-timer').checked },
      roll: 0,
      q: null,
      outcome: null,
    };
    Quiz.resetUsed();
    $('setup').classList.remove('active');
    $('game').classList.add('active');
    $('win').hidden = true;
    $('log').innerHTML = '';
    $('prism').classList.remove('show-map', 'settled');
    $('result').hidden = true;
    Board.render(state.players);
    log(`🌍 The race around the world begins! ${state.players.length} explorers set off.`);
    beginTurn();
  }

  const current = () => state.players[state.turn];

  /* ================= UI helpers ================= */
  function log(html, seat) {
    const li = document.createElement('li');
    li.innerHTML = html;
    if (seat != null) li.style.setProperty('--pc', COLORS[seat].hex);
    $('log').prepend(li);
  }
  function status(html) { $('status').innerHTML = html; }

  function renderStandings() {
    const ol = $('standings');
    ol.innerHTML = '';
    state.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', COLORS[p.seat].hex);
      li.classList.toggle('active', i === state.turn && state.phase !== 'over');
      const pct = Math.round((p.pos / Board.FINISH_POS) * 100);
      li.innerHTML = `<span class="pawn-icon"></span>
        <div><div class="nm"></div><div class="bar"><i style="width:${pct}%"></i></div></div>
        <div class="sc"><b>${p.pos}</b>/${Board.FINISH_POS}<br>${p.correct}/${p.asked} ✓</div>`;
      li.querySelector('.nm').textContent = p.name;
      ol.appendChild(li);
    });
  }

  function setTurnPill() {
    const p = current();
    const pill = $('turn-pill');
    pill.style.setProperty('--pc', COLORS[p.seat].hex);
    $('turn-name').textContent = p.name;
  }

  /* ================= TURN FLOW ================= */
  function beginTurn() {
    state.phase = 'roll';
    const p = current();
    setTurnPill();
    renderStandings();
    Board.setActive(p.seat);
    Board.showTarget(null);
    $('roll-btn').disabled = false;
    status(`<b>${esc(p.name)}</b>, roll the dice!`);
  }

  async function roll() {
    if (!state || state.phase !== 'roll') return;
    state.phase = 'rolling';
    $('roll-btn').disabled = true;
    const n = 1 + Math.floor(Math.random() * 6);
    state.roll = n;
    status('Rolling…');
    await Dice.roll(n);
    const p = current();
    const level = Quiz.levelForRoll(n);
    const L = Quiz.LEVELS[level];
    status(`Rolled <b>${n}</b> → <span class="dice-badge" style="color:var(--${level})">${L.label} question</span>`);

    if (state.opts.exact && p.pos + n > Board.FINISH_POS) {
      log(`<b>${esc(p.name)}</b> rolled ${n} but needs exactly ${Board.FINISH_POS - p.pos} to finish.`, p.seat);
      status(`Needs exactly <b>${Board.FINISH_POS - p.pos}</b> to finish — turn passes.`);
      await sleep(1600);
      return nextTurn(false);
    }
    const target = Math.min(Board.FINISH_POS, p.pos + n);
    Board.showTarget(p.seat, target);
    await sleep(800);
    askQuestion(level);
  }

  let timerHandle = null;
  async function askQuestion(level) {
    const p = current();
    const q = Quiz.next(level);
    state.q = q;
    state.phase = 'question';

    const diff = $('q-diff');
    diff.className = 'chip ' + level;
    diff.textContent = q.levelLabel;
    const pc = $('q-player');
    pc.style.setProperty('--pc', COLORS[p.seat].hex);
    pc.textContent = p.name;
    $('q-steps').textContent = `🎲 ${state.roll} → move ${state.roll} if correct`;
    $('q-kind').textContent = q.kind;
    $('q-prompt').textContent = q.prompt;
    const flag = $('q-flag');
    if (q.flag) {
      flag.hidden = false;
      flag.src = q.flag;
      flag.style.animation = 'none'; void flag.offsetWidth; flag.style.animation = '';
      $('q-prompt').textContent = 'Click its country';
    } else {
      flag.hidden = true;
      flag.removeAttribute('src');
    }
    $('result').hidden = true;
    WorldMap.prepare(answer);
    WorldMap.lock();

    Sound.whoosh();
    if (innerWidth <= 900) $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('prism').classList.add('show-map');
    await sleep(1150);
    if (state.q !== q) return;
    $('prism').classList.add('settled');
    WorldMap.prepare(answer);
    startTimer();
  }

  function startTimer() {
    const t = $('timer');
    clearInterval(timerHandle);
    if (!state.opts.timer) { t.hidden = true; return; }
    t.hidden = false;
    t.classList.remove('low');
    let left = TIMER_SECS;
    const ring = $('timer-ring');
    const CIRC = 119.4;
    const draw = () => {
      $('timer-num').textContent = left;
      ring.style.strokeDashoffset = CIRC * (1 - left / TIMER_SECS);
      t.classList.toggle('low', left <= 5);
    };
    ring.style.transition = 'none'; draw(); void ring.getBoundingClientRect(); ring.style.transition = '';
    timerHandle = setInterval(() => {
      left--;
      draw();
      if (left <= 5 && left > 0) Sound.tick();
      if (left <= 0) { clearInterval(timerHandle); answer(null); }
    }, 1000);
  }

  function answer(clickedId) {
    if (!state || state.phase !== 'question') return;
    clearInterval(timerHandle);
    state.phase = 'result';
    const p = current();
    const q = state.q;
    const c = q.country;
    const ok = clickedId === c.id;
    p.asked++;
    if (ok) p.correct++;
    state.outcome = ok;

    WorldMap.reveal(c.id, clickedId);

    const res = $('result');
    res.classList.toggle('bad', !ok);
    $('result-icon').textContent = ok ? '✓' : clickedId ? '✗' : '⏱';
    const clicked = clickedId ? WorldMap.byId.get(clickedId) : null;
    const fact = q.type === 'capital' ? `The capital of <b>${esc(c.name)}</b> is <b>${esc(c.capital)}</b>.`
      : q.type === 'flag' ? `That's the flag of <b>${esc(c.name)}</b>.`
      : `<b>${esc(c.name)}</b> — capital: ${esc(c.capital)}.`;
    if (ok) {
      const moves = Math.min(state.roll, Board.FINISH_POS - p.pos);
      $('result-title').textContent = ['Correct!', 'Spot on!', 'Brilliant!', 'Well navigated!'][(Math.random() * 4) | 0];
      $('result-sub').innerHTML = `${fact} Move <b>${moves}</b> space${moves === 1 ? '' : 's'}.`;
      Sound.correct();
      const r = $('map-wrap').getBoundingClientRect();
      Confetti.burst(r.left + r.width / 2, r.top + r.height * 0.75, 60, 0.8);
      log(`✓ <b>${esc(p.name)}</b> found ${esc(c.name)} <small>(${q.levelLabel})</small>`, p.seat);
    } else {
      $('result-title').textContent = clickedId ? 'Not quite!' : "Time's up!";
      $('result-sub').innerHTML = (clicked ? `You picked <b>${esc(clicked.name)}</b>. ` : '') +
        `The answer was <b>${esc(c.name)}</b>` + (q.type === 'capital' ? ` (capital: ${esc(c.capital)}).` : '.');
      Sound.wrong();
      log(`✗ <b>${esc(p.name)}</b> missed ${esc(c.name)}${clicked ? ` (picked ${esc(clicked.name)})` : ' (time ran out)'}`, p.seat);
    }
    res.hidden = false;
    renderStandings();
    setTimeout(() => $('continue-btn').focus({ preventScroll: true }), 50);
  }

  async function continueAfterAnswer() {
    if (!state || state.phase !== 'result') return;
    state.phase = 'moving';
    $('result').hidden = true;
    WorldMap.lock();
    Sound.whoosh();
    const prism = $('prism');
    prism.classList.remove('settled');
    void prism.offsetWidth;
    prism.classList.remove('show-map');
    await sleep(1150);
    const p = current();
    const ok = state.outcome;
    Board.showTarget(null);
    if (ok) {
      const from = p.pos;
      const to = Math.min(Board.FINISH_POS, p.pos + state.roll);
      status(`<b>${esc(p.name)}</b> moves ${to - from}…`);
      await Board.walk(p.seat, from, to);
      p.pos = to;
      renderStandings();
      // Capture rivals on the same loop square.
      const idx = Board.trackIndex(p.seat, p.pos);
      if (idx >= 0) {
        for (const o of state.players) {
          if (o !== p && Board.trackIndex(o.seat, o.pos) === idx) {
            p.captures++;
            log(`💥 <b>${esc(p.name)}</b> landed on <b>${esc(o.name)}</b> and sent them home!`, p.seat);
            status(`💥 <b>${esc(o.name)}</b> is sent back home!`);
            o.pos = 0;
            await Board.sendHome(o.seat);
            renderStandings();
          }
        }
      }
      if (p.pos >= Board.FINISH_POS) return win(p);
    } else {
      status(`<b>${esc(p.name)}</b> stays put.`);
      await sleep(500);
    }
    const extra = ok && state.roll === 6 && state.opts.six;
    if (extra) {
      log(`🎲 Six! <b>${esc(p.name)}</b> rolls again.`, p.seat);
    }
    nextTurn(extra);
  }

  function nextTurn(extra) {
    if (!extra) state.turn = (state.turn + 1) % state.players.length;
    beginTurn();
    if (extra) status(`🎲 Six! <b>${esc(current().name)}</b>, roll again!`);
  }

  function win(p) {
    state.phase = 'over';
    Board.setActive(-1);
    renderStandings();
    log(`🏆 <b>${esc(p.name)}</b> reached the finish and wins!`, p.seat);
    status(`🏆 <b>${esc(p.name)}</b> wins!`);
    Sound.win();
    Confetti.rain(260);
    $('win-name').textContent = p.name;
    const acc = p.asked ? Math.round((p.correct / p.asked) * 100) : 0;
    $('win-stats').textContent = `${p.correct} correct answer${p.correct === 1 ? '' : 's'} out of ${p.asked} (${acc}%) · ${p.captures} rival${p.captures === 1 ? '' : 's'} sent home`;
    const table = $('win-table');
    table.innerHTML = '';
    [...state.players].sort((a, b) => b.pos - a.pos || b.correct - a.correct).forEach((q, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', COLORS[q.seat].hex);
      li.innerHTML = `<b>${i + 1}.</b><span class="pawn-icon"></span><span></span><span>${q.pos}/${Board.FINISH_POS} · ${q.correct}/${q.asked} ✓</span>`;
      li.children[2].textContent = q.name;
      table.appendChild(li);
    });
    setTimeout(() => { $('win').hidden = false; $('again-btn').focus(); }, 900);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  /* ================= EVENTS ================= */
  $('roll-btn').addEventListener('click', roll);
  $('dice-scene').addEventListener('click', roll);
  $('continue-btn').addEventListener('click', continueAfterAnswer);
  $('again-btn').addEventListener('click', () => { $('win').hidden = true; startGame(); });
  $('setup-btn').addEventListener('click', toSetup);
  $('menu-btn').addEventListener('click', () => {
    if (state && state.phase !== 'over' && !confirm('Abandon this game and return to the setup screen?')) return;
    toSetup();
  });
  $('sound-btn').addEventListener('click', () => {
    Sound.enabled = !Sound.enabled;
    $('sound-btn').textContent = Sound.enabled ? '🔊' : '🔇';
  });
  function toSetup() {
    clearInterval(timerHandle);
    if (state) state.phase = 'over';
    $('win').hidden = true;
    $('game').classList.remove('active');
    $('setup').classList.add('active');
    renderInputs();
  }
  document.addEventListener('keydown', (e) => {
    if (!state || !$('game').classList.contains('active')) return;
    if (e.target.tagName === 'INPUT') return;
    if ((e.code === 'Space' || e.key === ' ') && state.phase === 'roll') { e.preventDefault(); roll(); }
    else if (e.key === 'Enter' && state.phase === 'result') { e.preventDefault(); continueAfterAnswer(); }
  });

  // Test hook: open the page with ?debug to inspect / tweak the live state from the console.
  if (/[?&]debug\b/.test(location.search)) window.__geoludo = { get state() { return state; }, Board };

  // Keep the 3D prism depth equal to half the stage height so the faces meet at a clean edge.
  const stage = $('stage');
  new ResizeObserver(() => {
    stage.style.setProperty('--depth', stage.clientHeight / 2 + 'px');
  }).observe(stage);
})();
