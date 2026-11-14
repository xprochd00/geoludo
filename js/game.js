/* Game controller: setup screen, turn flow, hot-seat state. */
(function () {
  const { sleep, Sound, Confetti, Dice } = FX;
  const $ = (id) => document.getElementById(id);
  const COLORS = Board.COLORS;
  const FIN = Board.FINISH_POS;
  const SEATS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
  const DEFAULT_NAMES = ['Magellan', 'Earhart', 'Ibn Battuta', 'Zheng He'];
  const TIMER_SECS = 30;
  const ROLL_MS = 1150;

  /* ================= SETUP ================= */
  let count = 4;
  let mode = 'geo';
  const names = [...DEFAULT_NAMES];
  const pieceCounts = [2, 2, 2, 2];

  function renderInputs() {
    const box = $('player-inputs');
    box.innerHTML = '';
    SEATS[count].forEach((seat) => {
      const col = COLORS[seat];
      const row = document.createElement('div');
      row.className = 'player-row';
      row.style.setProperty('--pc', col.hex);
      row.innerHTML = `<span class="pawn-icon"></span>
        <input maxlength="16" aria-label="${col.name} player name">
        <div class="piece-picker" role="radiogroup" aria-label="${col.name} player's number of pieces" title="Number of pieces">
          ${[1, 2, 3, 4].map((n) => `<button type="button" role="radio" data-n="${n}" aria-label="${n} piece${n > 1 ? 's' : ''}">${n}</button>`).join('')}
        </div>`;
      const input = row.querySelector('input');
      input.value = names[seat];
      input.addEventListener('input', () => { names[seat] = input.value; });
      const sync = () => row.querySelectorAll('.piece-picker button').forEach((b) => {
        const on = +b.dataset.n === pieceCounts[seat];
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on);
      });
      row.querySelectorAll('.piece-picker button').forEach((b) => b.addEventListener('click', () => { pieceCounts[seat] = +b.dataset.n; sync(); }));
      sync();
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
  document.querySelectorAll('.mode-card').forEach((b) => {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      document.querySelectorAll('.mode-card').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-checked', x === b);
      });
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
        seat, name: (names[seat] || '').trim() || DEFAULT_NAMES[seat],
        pieces: Array.from({ length: pieceCounts[seat] }, () => ({ pos: 0 })),
        correct: 0, asked: 0, captures: 0,
      })),
      turn: 0,
      phase: 'roll',
      mode,
      opts: { six: $('opt-six').checked, exact: $('opt-exact').checked, timer: $('opt-timer').checked },
      roll: 0,
      choice: null,
      q: null,
      outcome: null,
    };
    Quiz.resetUsed();
    $('setup').classList.remove('active');
    $('game').classList.add('active');
    $('win').hidden = true;
    $('log').innerHTML = '';
    const prism = $('prism');
    prism.classList.remove('show-map', 'settled');
    prism.classList.add('flat');
    $('result').hidden = true;
    $('mode-chip').textContent = Quiz.MODES[mode].label;
    Board.render(state.players);
    log(`🌍 A ${Quiz.MODES[mode].label.toLowerCase()} race begins! ${state.players.length} explorers set off. Roll a <b>6</b> to bring a piece onto the board.`);
    beginTurn();
  }

  const current = () => state.players[state.turn];
  const finishedCount = (p) => p.pieces.filter((pc) => pc.pos >= FIN).length;

  /* ================= UI helpers ================= */
  function log(html, seat) {
    const li = document.createElement('li');
    li.innerHTML = html;
    if (seat != null) li.style.setProperty('--pc', COLORS[seat].hex);
    $('log').prepend(li);
  }
  function status(html) { $('status').innerHTML = html; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  function pieceDots(p) {
    return p.pieces.map((pc) => {
      const cls = pc.pos >= FIN ? 'done' : pc.pos > 0 ? 'out' : 'home';
      const t = pc.pos >= FIN ? 'finished' : pc.pos > 0 ? `${pc.pos}/${FIN}` : 'at home';
      return `<i class="pd ${cls}" title="${t}"></i>`;
    }).join('');
  }

  function renderStandings() {
    const ol = $('standings');
    ol.innerHTML = '';
    state.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', COLORS[p.seat].hex);
      li.classList.toggle('active', i === state.turn && state.phase !== 'over');
      const total = p.pieces.reduce((s, pc) => s + pc.pos, 0);
      const pct = Math.round((total / (FIN * p.pieces.length)) * 100);
      li.innerHTML = `<span class="pawn-icon"></span>
        <div><div class="nm"></div><div class="bar"><i style="width:${pct}%"></i></div><div class="dots">${pieceDots(p)}</div></div>
        <div class="sc"><b>${finishedCount(p)}</b>/${p.pieces.length} 🏁<br>${p.correct}/${p.asked} ✓</div>`;
      li.querySelector('.nm').textContent = p.name;
      ol.appendChild(li);
    });
  }

  function setTurnPill() {
    const p = current();
    $('turn-pill').style.setProperty('--pc', COLORS[p.seat].hex);
    $('turn-name').textContent = p.name;
  }

  /* ---------- Board ⇄ map roll ---------- */
  async function showMap() {
    const prism = $('prism');
    // Leave the flat resting state without animating (it looks identical to the 3D rest pose).
    prism.style.transition = 'none';
    prism.classList.remove('flat');
    void prism.offsetWidth;
    prism.style.transition = '';
    Sound.whoosh();
    if (innerWidth <= 900) $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
    prism.classList.add('show-map');
    await sleep(ROLL_MS);
    // Flatten the 3D scene once the roll is done: same picture, reliable hit-testing.
    prism.classList.add('settled');
  }
  async function showBoard() {
    const prism = $('prism');
    prism.classList.remove('settled');
    void prism.offsetWidth;
    Sound.whoosh();
    prism.classList.remove('show-map');
    await sleep(ROLL_MS);
    prism.classList.add('flat');
  }

  /* ================= TURN FLOW ================= */
  function beginTurn() {
    state.phase = 'roll';
    state.choice = null;
    const p = current();
    setTurnPill();
    renderStandings();
    Board.setSelectable([]);
    $('roll-btn').disabled = false;
    status(`<b>${esc(p.name)}</b>, roll the dice!`);
  }

  /** The moves the current player may make with roll n. */
  function optionsFor(p, n) {
    const out = [];
    p.pieces.forEach((pc, idx) => {
      if (pc.pos <= 0) {
        if (n === 6) out.push({ seat: p.seat, idx, action: 'enter', target: 1, label: `Bring piece ${idx + 1} onto the board` });
      } else if (pc.pos < FIN) {
        if (state.opts.exact && pc.pos + n > FIN) return;
        const target = Math.min(FIN, pc.pos + n);
        out.push({ seat: p.seat, idx, action: 'move', target, label: `Move piece ${idx + 1} forward ${target - pc.pos}` });
      }
    });
    return out;
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
    const opts = optionsFor(p, n);
    const lvl = `<span class="lvl-text" style="color:var(--l${n})">${Quiz.LEVELS[n].label}</span>`;

    if (!opts.length) {
      const atHome = p.pieces.every((pc) => pc.pos <= 0 || pc.pos >= FIN);
      const why = atHome ? 'needs a <b>6</b> to bring a piece out' : `can't move ${n} (an exact roll is needed to finish)`;
      log(`🎲 <b>${esc(p.name)}</b> rolled ${n} and ${why}.`, p.seat);
      status(`Rolled <b>${n}</b> — ${why}. Turn passes.`);
      await sleep(1700);
      return nextTurn(false);
    }

    state.phase = 'choose';
    const canEnter = opts.some((o) => o.action === 'enter');
    const canMove = opts.some((o) => o.action === 'move');
    let msg = `Rolled <b>${n}</b> → `;
    if (canEnter && canMove) msg += `click a <b>home</b> piece to bring it out (no question) or a piece on the board to move it (${lvl} question).`;
    else if (canEnter) msg += 'click a glowing piece to bring it onto the board — no question needed!';
    else msg += `click the piece you want to move. Moving needs a ${lvl} question.`;
    status(msg);
    Board.setSelectable(opts, choose);
  }

  async function choose(o) {
    if (!state || state.phase !== 'choose') return;
    state.phase = 'busy';
    state.choice = o;
    Board.setSelectable([]);
    const p = current();
    if (o.action === 'enter') {
      log(`🚩 <b>${esc(p.name)}</b> brings piece ${o.idx + 1} onto the board.`, p.seat);
      status(`<b>${esc(p.name)}</b> brings a piece out!`);
      p.pieces[o.idx].pos = 1;
      await Board.walk(p.seat, o.idx, 0, 1, state.players);
      await captureAt(p, o.idx);
      renderStandings();
      return endOfMove(true);
    }
    Board.showTarget(p.seat, o.target);
    await sleep(500);
    askQuestion(state.roll);
  }

  let timerHandle = null;
  async function askQuestion(level) {
    const p = current();
    const q = Quiz.next(level, state.mode);
    state.q = q;
    state.phase = 'question';

    const diff = $('q-diff');
    diff.className = 'chip lvl';
    diff.style.setProperty('--c', `var(--l${level})`);
    diff.textContent = `${level} · ${q.levelLabel}`;
    $('q-tag').textContent = q.tag;
    const pc = $('q-player');
    pc.style.setProperty('--pc', COLORS[p.seat].hex);
    pc.textContent = `${p.name} · piece ${state.choice.idx + 1}`;
    $('q-steps').textContent = `🎲 ${state.roll} → move ${state.choice.target - p.pieces[state.choice.idx].pos} if correct`;
    $('q-kind').textContent = q.kind;
    const prompt = $('q-prompt');
    prompt.textContent = q.prompt;
    prompt.classList.toggle('long', q.prompt.length > 48);
    const flag = $('q-flag');
    if (q.flag) {
      flag.hidden = false;
      flag.src = q.flag;
      flag.style.animation = 'none'; void flag.offsetWidth; flag.style.animation = '';
    } else {
      flag.hidden = true;
      flag.removeAttribute('src');
    }
    $('timer').hidden = !state.opts.timer;
    $('result').hidden = true;
    WorldMap.prepare(answer);
    WorldMap.lock();

    await showMap();
    if (state.q !== q) return;
    WorldMap.prepare(answer);
    startTimer();
  }

  function startTimer() {
    const t = $('timer');
    clearInterval(timerHandle);
    if (!state.opts.timer) { t.hidden = true; return; }
    t.hidden = false;
    t.classList.remove('low');
    // History questions are long to read: give them a little more time.
    const total = state.q.type === 'history' ? TIMER_SECS + 15 : TIMER_SECS;
    let left = total;
    const ring = $('timer-ring');
    const CIRC = 119.4;
    const draw = () => {
      $('timer-num').textContent = left;
      ring.style.strokeDashoffset = CIRC * (1 - left / total);
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

  function factFor(q) {
    const c = q.country;
    switch (q.type) {
      case 'capital': return `The capital of <b>${esc(c.name)}</b> is <b>${esc(c.capital)}</b>.`;
      case 'city': return `<b>${esc(q.city)}</b> is in <b>${esc(c.name)}</b>.`;
      case 'flag': return `That's the flag of <b>${esc(c.name)}</b>.`;
      case 'history': return `The answer is <b>${esc(c.name)}</b>.`;
      default: return `<b>${esc(c.name)}</b>` + (c.noCap ? '.' : ` — capital: ${esc(c.capital)}.`);
    }
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
    const pc = p.pieces[state.choice.idx];
    if (ok) {
      const moves = state.choice.target - pc.pos;
      $('result-title').textContent = ['Correct!', 'Spot on!', 'Brilliant!', 'Well navigated!'][(Math.random() * 4) | 0];
      $('result-sub').innerHTML = `${factFor(q)} Piece ${state.choice.idx + 1} moves <b>${moves}</b> space${moves === 1 ? '' : 's'}.`;
      Sound.correct();
      const r = $('map-wrap').getBoundingClientRect();
      Confetti.burst(r.left + r.width / 2, r.top + r.height * 0.75, 60, 0.8);
      log(`✓ <b>${esc(p.name)}</b> found ${esc(c.name)} <small>(${q.tag}, level ${q.level})</small>`, p.seat);
    } else {
      $('result-title').textContent = clickedId ? 'Not quite!' : "Time's up!";
      const extra = q.type === 'capital' ? ` (capital: ${esc(c.capital)})` : q.type === 'city' ? ` (${esc(q.city)})` : '';
      $('result-sub').innerHTML = (clicked ? `You picked <b>${esc(clicked.name)}</b>. ` : '') +
        `The answer was <b>${esc(c.name)}</b>${extra}. The piece stays put.`;
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
    await showBoard();
    const p = current();
    const ok = state.outcome;
    const o = state.choice;
    Board.showTarget(null);
    if (ok) {
      const pc = p.pieces[o.idx];
      const from = pc.pos;
      status(`<b>${esc(p.name)}</b> moves piece ${o.idx + 1}…`);
      pc.pos = o.target;
      await Board.walk(p.seat, o.idx, from, o.target, state.players);
      renderStandings();
      await captureAt(p, o.idx);
      if (pc.pos >= FIN) {
        log(`🏁 <b>${esc(p.name)}</b>'s piece ${o.idx + 1} reached the finish!`, p.seat);
        if (finishedCount(p) === p.pieces.length) return win(p);
      }
    } else {
      status(`<b>${esc(p.name)}</b>'s piece stays put.`);
      await sleep(500);
    }
    endOfMove(ok);
  }

  /** Send home every rival piece on the square the given piece now occupies. */
  async function captureAt(p, idx) {
    const sq = Board.trackIndex(p.seat, p.pieces[idx].pos);
    if (sq < 0) return;
    for (const o of state.players) {
      if (o === p) continue;
      for (let j = 0; j < o.pieces.length; j++) {
        if (Board.trackIndex(o.seat, o.pieces[j].pos) === sq) {
          p.captures++;
          log(`💥 <b>${esc(p.name)}</b> landed on <b>${esc(o.name)}</b>'s piece and sent it home!`, p.seat);
          status(`💥 <b>${esc(o.name)}</b>'s piece is sent back home!`);
          o.pieces[j].pos = 0;
          await Board.sendHome(o.seat, j, state.players);
          renderStandings();
        }
      }
    }
  }

  function endOfMove(success) {
    const p = current();
    const extra = success && state.roll === 6 && state.opts.six;
    if (extra) log(`🎲 Six! <b>${esc(p.name)}</b> rolls again.`, p.seat);
    nextTurn(extra);
  }

  function nextTurn(extra) {
    if (!extra) state.turn = (state.turn + 1) % state.players.length;
    beginTurn();
    if (extra) status(`🎲 Six! <b>${esc(current().name)}</b>, roll again!`);
  }

  function win(p) {
    state.phase = 'over';
    Board.setSelectable([]);
    renderStandings();
    log(`🏆 <b>${esc(p.name)}</b> brought every piece home and wins!`, p.seat);
    status(`🏆 <b>${esc(p.name)}</b> wins!`);
    Sound.win();
    Confetti.rain(260);
    $('win-name').textContent = p.name;
    const acc = p.asked ? Math.round((p.correct / p.asked) * 100) : 0;
    $('win-stats').textContent = `${p.correct} correct answer${p.correct === 1 ? '' : 's'} out of ${p.asked} (${acc}%) · ${p.captures} rival piece${p.captures === 1 ? '' : 's'} sent home`;
    const table = $('win-table');
    table.innerHTML = '';
    const score = (x) => finishedCount(x) / x.pieces.length * 1000 + x.pieces.reduce((s, pc) => s + pc.pos, 0) / x.pieces.length;
    [...state.players].sort((a, b) => score(b) - score(a) || b.correct - a.correct).forEach((x, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', COLORS[x.seat].hex);
      li.innerHTML = `<b>${i + 1}.</b><span class="pawn-icon"></span><span></span><span>${finishedCount(x)}/${x.pieces.length} 🏁 · ${x.correct}/${x.asked} ✓</span>`;
      li.children[2].textContent = x.name;
      table.appendChild(li);
    });
    setTimeout(() => { $('win').hidden = false; $('again-btn').focus(); }, 900);
  }

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
    if (e.target.tagName === 'INPUT' || e.target.closest('.piece')) return;
    if ((e.code === 'Space' || e.key === ' ') && state.phase === 'roll') { e.preventDefault(); roll(); }
    else if (e.key === 'Enter' && state.phase === 'result') { e.preventDefault(); continueAfterAnswer(); }
    else if (state.phase === 'choose' && /^[1-4]$/.test(e.key)) {
      // Number keys pick the current player's piece with that number, if it can move.
      const o = optionsFor(current(), state.roll).find((x) => x.idx === +e.key - 1);
      if (o) { e.preventDefault(); choose(o); }
    }
  });

  // Test hook: open the page with ?debug to inspect / tweak the live state from the console.
  if (/[?&]debug\b/.test(location.search)) window.__geoludo = { get state() { return state; }, Board, choose, optionsFor };

  // Keep the 3D prism depth equal to half the stage height so the faces meet at a clean edge.
  const stage = $('stage');
  new ResizeObserver(() => {
    stage.style.setProperty('--depth', stage.clientHeight / 2 + 'px');
  }).observe(stage);
})();
