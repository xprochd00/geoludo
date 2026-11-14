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
  const MAX_ATTEMPTS = 3; // rolls allowed to get a 6 when no piece is on the board

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
  /* Mixed mode: which categories to combine (at least two). */
  const CAT_NAMES = { geo: 'Geography', history: 'History & Geopolitics', culture: 'Sports & Culture' };
  let mixCats = ['geo', 'history', 'culture'];
  function syncMix() {
    $('mix-options').hidden = mode !== 'mixed';
    document.querySelectorAll('.mix-chip').forEach((c) => {
      const on = mixCats.includes(c.dataset.cat);
      c.classList.toggle('active', on);
      c.setAttribute('aria-pressed', on);
    });
    $('mix-hint').textContent = mixCats.length === 3
      ? 'All three categories, about a third each.'
      : `${mixCats.map((c) => CAT_NAMES[c]).join(' + ')}, about half each.`;
  }
  document.querySelectorAll('.mix-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      if (mixCats.includes(cat)) {
        if (mixCats.length <= 2) {
          // need at least two categories to mix
          chip.classList.remove('shake'); void chip.offsetWidth; chip.classList.add('shake');
          $('mix-hint').textContent = 'Mixed mode needs at least two categories. Pick a single-category mode for just one.';
          return;
        }
        mixCats = mixCats.filter((c) => c !== cat);
      } else {
        mixCats = Quiz.CATEGORIES.filter((c) => c === cat || mixCats.includes(c));
      }
      syncMix();
    });
  });
  function syncUnseen() {
    $('unseen-note').textContent = `${Quiz.unseenCount()} of ${Quiz.totalCount()} questions not asked yet.`;
  }
  $('forget-btn').addEventListener('click', () => { Quiz.clearHistory(); syncUnseen(); });
  syncUnseen();

  document.querySelectorAll('.mode-card').forEach((b) => {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      syncMix();
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
      cats: mode === 'mixed' ? mixCats.slice() : [mode],
      opts: { six: $('opt-six').checked, exact: $('opt-exact').checked, timer: $('opt-timer').checked },
      roll: 0,
      choice: null,
      q: null,
      outcome: null,
    };
    Quiz.newGame(); // keeps the record of questions asked in earlier games
    $('setup').classList.remove('active');
    $('game').classList.add('active');
    $('win').hidden = true;
    $('log').innerHTML = '';
    const prism = $('prism');
    prism.classList.remove('show-map', 'settled');
    prism.classList.add('flat');
    $('result').hidden = true;
    const modeLabel = mode === 'mixed' && mixCats.length < 3
      ? `Mixed: ${mixCats.map((c) => CAT_NAMES[c].split(' ')[0]).join(' + ')}`
      : Quiz.MODES[mode].label;
    $('mode-chip').textContent = modeLabel;
    Board.render(state.players);
    log(`🌍 A ${modeLabel.toLowerCase()} race begins! ${state.players.length} explorers set off. Roll a <b>6</b> to bring a piece onto the board.`);
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

  /* Progress bar: the loop is split into 6 zones, one per rescue difficulty (start → finish),
   * then the home column, where pieces are safe. Each piece is a marker on the bar. */
  const ZONES = [1, 2, 3, 4, 5, 6].map((lvl) => {
    let a = 1;
    while (rescueLevel(a) !== lvl) a++;
    let b = a;
    while (b < Board.TRACK_LEN && rescueLevel(b + 1) === lvl) b++;
    return { lvl, a, b };
  });
  const pct = (pos) => (pos / FIN) * 100;

  function progressBar(p) {
    const zones = ZONES.map((z) => `<span class="z" style="left:${pct(z.a - 1)}%;width:${pct(z.b - z.a + 1)}%;--zc:var(--l${z.lvl})" title="Squares ${z.a}–${z.b}: ${Quiz.LEVELS[z.lvl].label} rescue question"></span>`).join('')
      + `<span class="z safe" style="left:${pct(Board.TRACK_LEN)}%;width:${pct(FIN - Board.TRACK_LEN)}%" title="Home column: safe"></span>`;
    const markers = p.pieces.map((pc, i) => {
      if (pc.pos <= 0) return '';
      const lvl = rescueLevel(pc.pos);
      return `<i class="pm${pc.pos >= FIN ? ' fin' : ''}" style="left:${pct(pc.pos - 0.5)}%;${lvl ? `--zc:var(--l${lvl})` : ''}">${i + 1}</i>`;
    }).join('');
    const info = p.pieces.map((pc, i) => {
      const lvl = rescueLevel(pc.pos);
      const what = pc.pos <= 0 ? 'home' : pc.pos >= FIN ? '🏁' : lvl ? `<b style="color:var(--l${lvl})">${Quiz.LEVELS[lvl].label}</b>` : 'safe';
      return `<span class="ri"><i class="pd ${pc.pos >= FIN ? 'done' : pc.pos > 0 ? 'out' : 'home'}"></i>${i + 1}: ${what}</span>`;
    }).join('');
    return `<div class="pbar">${zones}${markers}</div><div class="rinfo" title="Rescue question difficulty if a rival lands on the piece">🛡️ ${info}</div>`;
  }

  function renderStandings() {
    const ol = $('standings');
    ol.innerHTML = '';
    state.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', COLORS[p.seat].hex);
      li.classList.toggle('active', i === state.turn && state.phase !== 'over');
      li.innerHTML = `<span class="pawn-icon"></span>
        <div class="pinfo"><div class="nm"></div>${progressBar(p)}</div>
        <div class="sc"><b>${finishedCount(p)}</b>/${p.pieces.length} 🏁<br>${p.correct}/${p.asked} ✓</div>`;
      li.querySelector('.nm').textContent = p.name;
      ol.appendChild(li);
    });
  }

  function setTurnPill(who, prefix = '', suffix = "'s turn") {
    const p = who || current();
    $('turn-pill').style.setProperty('--pc', COLORS[p.seat].hex);
    $('turn-name').textContent = prefix + p.name;
    document.querySelector('#turn-pill .turn-label').textContent = suffix;
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
    state.attempts = 0;
    const noneActive = !p.pieces.some((pc) => pc.pos > 0 && pc.pos < FIN);
    status(noneActive
      ? `<b>${esc(p.name)}</b>, roll a <b>6</b> to bring a piece out — ${MAX_ATTEMPTS} attempts.`
      : `<b>${esc(p.name)}</b>, roll the dice!`);
  }

  /** The moves the current player may make with roll n. */
  function optionsFor(p, n) {
    const out = [];
    p.pieces.forEach((pc, idx) => {
      if (pc.pos <= 0) {
        // Pieces at home are interchangeable, so only one of them is offered.
        if (n === 6 && !out.some((o) => o.action === 'enter')) {
          out.push({ seat: p.seat, idx, action: 'enter', target: 1, label: `Bring piece ${idx + 1} onto the board` });
        }
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

    const noneActive = !p.pieces.some((pc) => pc.pos > 0 && pc.pos < FIN);
    if (!opts.length && noneActive && p.pieces.some((pc) => pc.pos <= 0)) {
      // Nothing on the board: up to 3 attempts to roll the 6 that unlocks a piece.
      state.attempts++;
      if (state.attempts < MAX_ATTEMPTS) {
        status(`Rolled <b>${n}</b> — no 6. Attempt <b>${state.attempts + 1}</b> of ${MAX_ATTEMPTS}: roll again!`);
        state.phase = 'roll';
        $('roll-btn').disabled = false;
        return;
      }
      log(`🎲 <b>${esc(p.name)}</b> didn't roll a 6 in ${MAX_ATTEMPTS} attempts.`, p.seat);
      status(`No 6 in ${MAX_ATTEMPTS} attempts — turn passes.`);
      await sleep(1700);
      return nextTurn(false);
    }

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
    if (canEnter) msg += `click the glowing <b>home</b> piece to bring it out (no question) or a piece on the board to move it (${lvl} question).`;
    else msg += `click the piece you want to move. Moving needs ${/^[AEIOU]/.test(Quiz.LEVELS[n].label) ? 'an' : 'a'} ${lvl} question.`;
    Board.setSelectable(opts, choose);
    if (opts.length === 1) {
      // Only one possible piece: select it automatically.
      const o = opts[0];
      status(`Rolled <b>${n}</b> → ${o.action === 'enter' ? 'bringing a piece onto the board' : `moving piece ${o.idx + 1} (${lvl} question)`}…`);
      await sleep(800);
      return choose(o);
    }
    status(msg);
  }

  async function choose(o) {
    if (!state || state.phase !== 'choose') return;
    state.phase = 'busy';
    state.choice = o;
    Board.setSelectable([]);
    const p = current();
    const pc = p.pieces[o.idx];
    if (o.action === 'enter') {
      log(`🚩 <b>${esc(p.name)}</b> brings piece ${o.idx + 1} onto the board.`, p.seat);
      status(`<b>${esc(p.name)}</b> brings a piece out!`);
      pc.pos = 1;
      await Board.walk(p.seat, o.idx, 0, 1, state.players);
      await resolveLanding(p, o.idx, 0);
      renderStandings();
      return endOfMove(true);
    }
    Board.showTarget(p.seat, o.target);
    await sleep(500);
    const ok = await quiz({ kind: 'move', player: p, idx: o.idx, level: state.roll, moves: o.target - pc.pos });
    Board.showTarget(null);
    if (ok) {
      const from = pc.pos;
      status(`<b>${esc(p.name)}</b> moves piece ${o.idx + 1}…`);
      pc.pos = o.target;
      await Board.walk(p.seat, o.idx, from, o.target, state.players);
      renderStandings();
      await resolveLanding(p, o.idx, from);
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

  /* ---------- Questions ----------
   * quiz(ctx) rolls the board away, asks one question and resolves with true/false once the player
   * has pressed Continue and the board is back.
   * ctx: { kind: 'move' | 'rescue', player, idx (piece), level, moves?, attacker? } */
  function quiz(ctx) {
    return new Promise((resolve) => {
      state.pending = { ctx, resolve };
      askQuestion(ctx);
    });
  }

  let timerHandle = null;
  async function askQuestion(ctx) {
    const p = ctx.player;
    const q = Quiz.next(ctx.level, state.mode, state.cats);
    state.q = q;
    state.phase = 'question';
    const rescue = ctx.kind === 'rescue';

    $('quiz-card').classList.toggle('rescue', rescue);
    const diff = $('q-diff');
    diff.className = 'chip lvl';
    diff.style.setProperty('--c', `var(--l${ctx.level})`);
    diff.textContent = `${ctx.level} · ${q.levelLabel}`;
    $('q-tag').textContent = q.tag;
    const pc = $('q-player');
    pc.style.setProperty('--pc', COLORS[p.seat].hex);
    pc.textContent = `${p.name} · piece ${ctx.idx + 1}`;
    $('q-steps').textContent = rescue
      ? `🛡️ Rescue — answer correctly to stop ${ctx.attacker.name}'s capture`
      : `🎲 ${state.roll} → move ${ctx.moves} if correct`;
    $('q-kind').textContent = (rescue ? `🛡️ ${p.name}, defend your piece! ` : '') + q.kind;
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
    if (rescue) setTurnPill(p, '🛡️ ', ' defends');
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
    // Long text questions (history, culture) get a little more time to read.
    const total = ['history', 'culture'].includes(state.q.type) ? TIMER_SECS + 15 : TIMER_SECS;
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
      case 'history': case 'culture': return `The answer is <b>${esc(c.name)}</b>.`;
      default: return `<b>${esc(c.name)}</b>` + (c.noCap ? '.' : ` — capital: ${esc(c.capital)}.`);
    }
  }

  function answer(clickedId) {
    if (!state || state.phase !== 'question') return;
    clearInterval(timerHandle);
    state.phase = 'result';
    const { ctx } = state.pending;
    const p = ctx.player;
    const q = state.q;
    const c = q.country;
    const ok = clickedId === c.id;
    const rescue = ctx.kind === 'rescue';
    p.asked++;
    if (ok) p.correct++;
    state.outcome = ok;

    WorldMap.reveal(c.id, clickedId, q.pin ? { p: q.pin, name: q.city } : null);

    const res = $('result');
    res.classList.toggle('bad', !ok);
    $('result-icon').textContent = ok ? (rescue ? '🛡' : '✓') : clickedId ? '✗' : '⏱';
    const clicked = clickedId ? WorldMap.byId.get(clickedId) : null;
    const extra = q.type === 'capital' ? ` (capital: ${esc(c.capital)})` : q.type === 'city' ? ` (${esc(q.city)})` : '';
    const missed = (clicked ? `You picked <b>${esc(clicked.name)}</b>. ` : '') + `The answer was <b>${esc(c.name)}</b>${extra}.`;
    if (ok) {
      $('result-title').textContent = rescue ? 'Rescued!' : ['Correct!', 'Spot on!', 'Brilliant!', 'Well navigated!'][(Math.random() * 4) | 0];
      $('result-sub').innerHTML = `${factFor(q)} ` + (rescue
        ? `${esc(ctx.attacker.name)}'s piece is pushed back.`
        : `Piece ${ctx.idx + 1} moves <b>${ctx.moves}</b> space${ctx.moves === 1 ? '' : 's'}.`);
      Sound.correct();
      const r = $('map-wrap').getBoundingClientRect();
      Confetti.burst(r.left + r.width / 2, r.top + r.height * 0.75, 60, 0.8);
      log(`${rescue ? '🛡️' : '✓'} <b>${esc(p.name)}</b> found ${esc(c.name)} <small>(${q.tag}, level ${q.level})</small>`, p.seat);
    } else {
      $('result-title').textContent = rescue ? (clickedId ? 'Captured!' : "Time's up — captured!") : clickedId ? 'Not quite!' : "Time's up!";
      $('result-sub').innerHTML = missed + (rescue ? ' Your piece goes home.' : ' The piece stays put.');
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
    setTurnPill();
    const { resolve } = state.pending;
    state.pending = null;
    resolve(state.outcome);
  }

  /** Difficulty of the rescue question for a piece at this progress (1-51 on the loop), else null. */
  function rescueLevel(pos) {
    return pos >= 1 && pos <= Board.TRACK_LEN ? Math.min(6, 1 + Math.floor(((pos - 1) * 6) / Board.TRACK_LEN)) : null;
  }

  /**
   * A piece has just landed. Rival pieces on the same square (unless it is a safe square) are under
   * attack: each defending player gets a rescue question at the difficulty of the threatened piece's
   * progress. A correct rescue sends the attacker back to `from` and cancels the capture.
   */
  async function resolveLanding(p, idx, from) {
    const sq = Board.trackIndex(p.seat, p.pieces[idx].pos);
    if (sq < 0) return;
    const groups = state.players.filter((o) => o !== p)
      .map((o) => ({ o, js: o.pieces.map((_, j) => j).filter((j) => Board.trackIndex(o.seat, o.pieces[j].pos) === sq) }))
      .filter((g) => g.js.length);
    if (!groups.length) return;
    if (Board.isSafe(sq)) {
      log(`🛡️ <b>${esc(p.name)}</b> shares a safe square with ${groups.map((g) => `<b>${esc(g.o.name)}</b>`).join(', ')}. No capture.`, p.seat);
      return;
    }
    for (const { o, js } of groups) {
      const lvl = rescueLevel(o.pieces[js[0]].pos);
      const label = Quiz.LEVELS[lvl].label;
      const pieces = js.length > 1 ? `pieces ${js.map((j) => j + 1).join(' & ')}` : `piece ${js[0] + 1}`;
      log(`⚔️ <b>${esc(p.name)}</b> attacks <b>${esc(o.name)}</b>'s ${pieces}! Rescue question: level ${lvl} (${label}).`, p.seat);
      status(`⚔️ <b>${esc(o.name)}</b>, your ${pieces} ${js.length > 1 ? 'are' : 'is'} under attack! Answer ${/^[AEIOU]/.test(label) ? 'an' : 'a'} <span class="lvl-text" style="color:var(--l${lvl})">${label}</span> rescue question.`);
      Sound.capture();
      await sleep(1400);
      const saved = await quiz({ kind: 'rescue', player: o, idx: js[0], level: lvl, attacker: p });
      if (saved) {
        log(`🛡️ <b>${esc(o.name)}</b> fought off the attack! <b>${esc(p.name)}</b>'s piece ${idx + 1} goes back to where it came from.`, o.seat);
        status(`🛡️ <b>${esc(o.name)}</b> saved the piece — <b>${esc(p.name)}</b> is pushed back!`);
        p.pieces[idx].pos = from;
        await Board.flyTo(p.seat, idx, state.players);
        renderStandings();
        return;
      }
      p.captures++;
      log(`💥 <b>${esc(p.name)}</b> captured <b>${esc(o.name)}</b>'s ${pieces} and sent ${js.length > 1 ? 'them' : 'it'} home!`, p.seat);
      status(`💥 <b>${esc(o.name)}</b>'s ${pieces} ${js.length > 1 ? 'are' : 'is'} sent back home!`);
      js.forEach((j) => { o.pieces[j].pos = 0; });
      for (const j of js) await Board.sendHome(o.seat, j, state.players);
      renderStandings();
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
    syncUnseen();
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
