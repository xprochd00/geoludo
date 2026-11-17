/* Game controller: setup screen, turn flow, bots, saving, hot-seat state. */
(function () {
  const { sleep, Sound, Confetti, Dice } = FX;
  const $ = (id) => document.getElementById(id);
  const COLORS = Board.COLORS;
  const FIN = Board.FINISH_POS;
  const SEATS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
  const DEFAULT_NAMES = ['Magellan', 'Earhart', 'Ibn Battuta', 'Zheng He'];
  const TIMER_SECS = 30;
  const STEAL_SECS = 15;
  const ROLL_MS = 1150;
  const MAX_ATTEMPTS = 3; // rolls allowed to get a 6 when no piece is on the board
  const MAX_TOKENS = 3;

  /* Game-length presets. Quick was tuned with a simulation to last ~15-25 minutes. */
  const PRESETS = {
    quick: { pieces: 1, board: true, choose: true, steal: true, rescue: true, six: true, exact: false },
    classic: { pieces: 2, board: false, choose: false, steal: false, rescue: true, six: true, exact: false },
  };
  const PRESET_SUMMARY = {
    quick: [
      '1 piece each, starting on the board',
      '<b>Pick your challenge:</b> choose the question level after rolling, move roll + level',
      '<b>Steals &amp; hints</b> keep everyone in the game',
      'Rescue questions when a piece is about to be captured',
    ],
    classic: [
      '2 pieces each; a <b>6</b> brings a piece out (3 attempts when nothing is on the board)',
      'The number rolled sets the question level, and you move that many squares',
      'Rescue questions when a piece is about to be captured · a 6 earns another roll',
    ],
  };

  /* Computer players: chance of a correct answer falls with the question level. */
  const BOTS = {
    rookie: { label: 'Rookie', base: 0.85, drop: 0.11 },
    explorer: { label: 'Explorer', base: 0.92, drop: 0.075 },
    genius: { label: 'Genius', base: 0.97, drop: 0.045 },
  };
  const botAcc = (skill, lvl) => Math.min(0.98, Math.max(0.15, BOTS[skill].base - BOTS[skill].drop * (lvl - 1)));
  const isBot = (p) => p && p.type !== 'human';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const SAVE_KEY = 'geoludo.save.v1';
  const SETUP_KEY = 'geoludo.setup.v1';
  const PASSPORT_KEY = 'geoludo.passport.v1';

  /* Passport: every country a human player has found on this device. */
  const passport = new Set(store.get(PASSPORT_KEY) || []);
  const playableCount = window.WORLD.countries.filter((c) => c.fame).length;

  /* ================= SETUP ================= */
  const saved = store.get(SETUP_KEY) || {};
  let count = saved.count || 2;
  let mode = saved.mode || 'geo';
  let preset = saved.preset || 'quick';
  const names = saved.names || [...DEFAULT_NAMES];
  const types = saved.types || ['human', 'human', 'explorer', 'human'];
  const pieceCounts = saved.pieceCounts || [2, 2, 2, 2];
  let mixCats = (saved.mixCats || Quiz.CATEGORIES).filter((c) => Quiz.CATEGORIES.includes(c));
  if (mixCats.length < 2) mixCats = Quiz.CATEGORIES.slice();
  const custom = Object.assign({}, PRESETS.quick, saved.custom || {});
  const CUSTOM_IDS = { choose: 'opt-choose', board: 'opt-board', steal: 'opt-steal', rescue: 'opt-rescue', six: 'opt-six', exact: 'opt-exact' };
  $('opt-timer').checked = saved.timer !== false;
  $('opt-fast').checked = !!saved.fast;

  function saveSetup() {
    store.set(SETUP_KEY, { count, mode, preset, names, types, pieceCounts, mixCats, custom, timer: $('opt-timer').checked, fast: $('opt-fast').checked });
  }

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
        <select class="type-select" aria-label="${col.name} player: human or computer">
          <option value="human">🙂 Human</option>
          ${Object.entries(BOTS).map(([k, b]) => `<option value="${k}">🤖 Bot · ${b.label}</option>`).join('')}
        </select>
        <div class="piece-picker" role="radiogroup" aria-label="${col.name} player's number of pieces" title="Number of pieces (a handicap when unequal)" ${preset === 'custom' ? '' : 'hidden'}>
          ${[1, 2, 3, 4].map((n) => `<button type="button" role="radio" data-n="${n}" aria-label="${n} piece${n > 1 ? 's' : ''}">${n}</button>`).join('')}
        </div>`;
      const input = row.querySelector('input');
      input.value = names[seat];
      input.addEventListener('input', () => { names[seat] = input.value; saveSetup(); });
      const sel = row.querySelector('select');
      sel.value = types[seat];
      sel.addEventListener('change', () => { types[seat] = sel.value; saveSetup(); });
      const sync = () => row.querySelectorAll('.piece-picker button').forEach((b) => {
        const on = +b.dataset.n === pieceCounts[seat];
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on);
      });
      row.querySelectorAll('.piece-picker button').forEach((b) => b.addEventListener('click', () => { pieceCounts[seat] = +b.dataset.n; sync(); saveSetup(); }));
      sync();
      box.appendChild(row);
    });
    $('pieces-note').hidden = preset !== 'custom';
  }
  function syncCount() {
    document.querySelectorAll('.count-btn').forEach((x) => x.classList.toggle('active', +x.dataset.count === count));
  }
  document.querySelectorAll('.count-btn').forEach((b) => {
    b.addEventListener('click', () => { count = +b.dataset.count; syncCount(); renderInputs(); saveSetup(); });
  });

  /* Mixed mode: which categories to combine (at least two). */
  const CAT_NAMES = { geo: 'Geography', history: 'History & Geopolitics', sports: 'Sports', culture: 'Culture' };
  const CAT_SHORT = { geo: 'Geography', history: 'History', sports: 'Sports', culture: 'Culture' };
  function syncMix() {
    $('mix-options').hidden = mode !== 'mixed';
    document.querySelectorAll('.mix-chip').forEach((c) => {
      const on = mixCats.includes(c.dataset.cat);
      c.classList.toggle('active', on);
      c.setAttribute('aria-pressed', on);
    });
    const share = { 2: 'half', 3: 'a third', 4: 'a quarter' }[mixCats.length];
    $('mix-hint').textContent = mixCats.length === Quiz.CATEGORIES.length
      ? `All ${mixCats.length} categories, about ${share} each.`
      : `${mixCats.map((c) => CAT_NAMES[c]).join(' + ')}, about ${share} each.`;
  }
  document.querySelectorAll('.mix-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      if (mixCats.includes(cat)) {
        if (mixCats.length <= 2) {
          chip.classList.remove('shake'); void chip.offsetWidth; chip.classList.add('shake');
          $('mix-hint').textContent = 'Mixed mode needs at least two categories. Pick a single-category mode for just one.';
          return;
        }
        mixCats = mixCats.filter((c) => c !== cat);
      } else {
        mixCats = Quiz.CATEGORIES.filter((c) => c === cat || mixCats.includes(c));
      }
      syncMix();
      saveSetup();
    });
  });
  function syncMode() {
    document.querySelectorAll('.mode-card').forEach((x) => {
      x.classList.toggle('active', x.dataset.mode === mode);
      x.setAttribute('aria-checked', x.dataset.mode === mode);
    });
    syncMix();
  }
  document.querySelectorAll('.mode-card').forEach((b) => {
    b.addEventListener('click', () => { mode = b.dataset.mode; syncMode(); saveSetup(); });
  });

  /* Game-length presets + custom rules. */
  function syncPreset() {
    document.querySelectorAll('.preset-card').forEach((x) => {
      x.classList.toggle('active', x.dataset.preset === preset);
      x.setAttribute('aria-checked', x.dataset.preset === preset);
    });
    $('custom-rules').hidden = preset !== 'custom';
    $('preset-summary').hidden = preset === 'custom';
    $('preset-summary').innerHTML = (PRESET_SUMMARY[preset] || []).map((t) => `<li>${t}</li>`).join('');
    for (const [k, id] of Object.entries(CUSTOM_IDS)) $(id).checked = !!custom[k];
    renderInputs();
  }
  document.querySelectorAll('.preset-card').forEach((b) => {
    b.addEventListener('click', () => {
      // Custom starts from the preset that was selected before.
      if (b.dataset.preset === 'custom' && preset !== 'custom') Object.assign(custom, PRESETS[preset]);
      preset = b.dataset.preset;
      syncPreset();
      saveSetup();
    });
  });
  for (const [k, id] of Object.entries(CUSTOM_IDS)) {
    $(id).addEventListener('change', () => { custom[k] = $(id).checked; saveSetup(); });
  }
  $('opt-timer').addEventListener('change', saveSetup);
  $('opt-fast').addEventListener('change', saveSetup);

  function syncNotes() {
    $('unseen-note').textContent = `${Quiz.unseenCount()} of ${Quiz.totalCount()} questions not asked yet.`;
    $('passport-note').textContent = `🛂 Passport: ${passport.size} / ${playableCount} countries found`;
    const sv = store.get(SAVE_KEY);
    $('resume-card').hidden = !sv;
    if (sv) {
      const s = sv.state;
      const who = s.players[s.turn];
      $('resume-info').textContent = `${s.players.map((p) => p.name).join(', ')} · ${modeLabelFor(s.mode, s.cats)} · ${who.name} to play`;
    }
  }
  $('forget-btn').addEventListener('click', () => { Quiz.clearHistory(); syncNotes(); });
  $('discard-btn').addEventListener('click', () => { store.del(SAVE_KEY); syncNotes(); });
  $('resume-btn').addEventListener('click', () => { Sound.ensure(); resumeGame(); });

  syncCount();
  syncMode();
  syncPreset();
  syncNotes();

  $('start-btn').addEventListener('click', () => {
    Sound.ensure();
    saveSetup();
    startGame();
  });

  function modeLabelFor(m, cats) {
    return m === 'mixed' && cats.length < Quiz.CATEGORIES.length
      ? `Mixed: ${cats.map((c) => CAT_SHORT[c]).join(' + ')}`
      : Quiz.MODES[m].label;
  }

  /* ================= STATE ================= */
  let state = null;

  function startGame() {
    const rules = preset === 'custom' ? { ...custom } : { ...PRESETS[preset] };
    const opts = { ...rules, timer: $('opt-timer').checked, fast: $('opt-fast').checked };
    state = {
      players: SEATS[count].map((seat) => ({
        seat, name: (names[seat] || '').trim() || DEFAULT_NAMES[seat], type: types[seat],
        pieces: Array.from({ length: preset === 'custom' ? pieceCounts[seat] : rules.pieces }, () => ({ pos: opts.board ? 1 : 0 })),
        correct: 0, asked: 0, captures: 0, steals: 0, tokens: opts.steal ? 1 : 0,
      })),
      turn: 0,
      mode,
      cats: mode === 'mixed' ? mixCats.slice() : [mode],
      opts,
      preset,
      stamps: [],
    };
    launch();
    const rulesLine = opts.choose ? 'Pick your challenge after each roll' : 'The dice sets the question level';
    log(`🌍 A ${modeLabelFor(state.mode, state.cats).toLowerCase()} race begins! ${rulesLine}.${opts.board ? '' : ' Roll a <b>6</b> to bring a piece onto the board.'}`);
    beginTurn();
  }

  function resumeGame() {
    const sv = store.get(SAVE_KEY);
    if (!sv) return;
    state = sv.state;
    launch();
    $('log').innerHTML = sv.log || '';
    log('💾 Game resumed.');
    beginTurn();
  }

  /** Common start-up for a new or resumed game. */
  function launch() {
    Object.assign(state, { phase: 'roll', roll: 0, attempts: 0, choice: null, q: null, outcome: null, pending: null, stealer: null, gen: Math.random() });
    FX.setFast(state.opts.fast);
    Quiz.newGame(); // keeps the record of questions asked in earlier games
    $('setup').classList.remove('active');
    $('game').classList.add('active');
    $('win').hidden = true;
    $('log').innerHTML = '';
    const prism = $('prism');
    prism.classList.remove('show-map', 'settled');
    prism.classList.add('flat');
    $('result').hidden = true;
    $('level-picker').hidden = true;
    $('mode-chip').textContent = modeLabelFor(state.mode, state.cats);
    $('zone-legend').hidden = !state.opts.rescue;
    Board.render(state.players);
  }

  function saveGame() {
    if (!state || state.phase === 'over') return;
    const { players, turn, mode: m, cats, opts, preset: pr, stamps } = state;
    const items = [...$('log').children].slice(0, 40).map((li) => li.outerHTML).join('');
    store.set(SAVE_KEY, { v: 1, state: { players, turn, mode: m, cats, opts, preset: pr, stamps }, log: items });
  }

  const current = () => state.players[state.turn];
  const finishedCount = (p) => p.pieces.filter((pc) => pc.pos >= FIN).length;
  const homePos = () => (state.opts.board ? 1 : 0);
  const nextPlayer = () => state.players[(state.turn + 1) % state.players.length];

  /** Run fn after a pause, unless the game was left or replaced in the meantime. */
  function later(ms, fn) {
    const gen = state.gen;
    sleep(ms).then(() => { if (state && state.gen === gen && state.phase !== 'over') fn(); });
  }

  /* ================= UI helpers ================= */
  function log(html, seat) {
    const li = document.createElement('li');
    li.innerHTML = html;
    if (seat != null) li.style.setProperty('--pc', COLORS[seat].hex);
    $('log').prepend(li);
  }
  function status(html) { $('status').innerHTML = html; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  const who = (p) => `${isBot(p) ? '🤖 ' : ''}<b>${esc(p.name)}</b>`;
  const lvlSpan = (l) => `<span class="lvl-text" style="color:var(--l${l})">${Quiz.LEVELS[l].label}</span>`;
  const article = (word) => (/^[AEIOU]/.test(word) ? 'an' : 'a');

  /** Difficulty of the rescue question for a piece at this progress (1-51 on the loop), else null. */
  function rescueLevel(pos) {
    return pos >= 1 && pos <= Board.TRACK_LEN ? Math.min(6, 1 + Math.floor(((pos - 1) * 6) / Board.TRACK_LEN)) : null;
  }

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
    const rescue = state.opts.rescue;
    const zones = ZONES.map((z) => `<span class="z" style="left:${pct(z.a - 1)}%;width:${pct(z.b - z.a + 1)}%;--zc:${rescue ? `var(--l${z.lvl})` : 'rgba(255,255,255,.35)'}" title="Squares ${z.a}–${z.b}${rescue ? `: ${Quiz.LEVELS[z.lvl].label} rescue question` : ''}"></span>`).join('')
      + `<span class="z safe" style="left:${pct(Board.TRACK_LEN)}%;width:${pct(FIN - Board.TRACK_LEN)}%" title="Home column: safe"></span>`;
    const markers = p.pieces.map((pc, i) => {
      if (pc.pos <= 0) return '';
      const lvl = rescue && rescueLevel(pc.pos);
      return `<i class="pm${pc.pos >= FIN ? ' fin' : ''}" style="left:${pct(pc.pos - 0.5)}%;${lvl ? `--zc:var(--l${lvl})` : ''}">${p.pieces.length > 1 ? i + 1 : ''}</i>`;
    }).join('');
    const info = rescue ? `<div class="rinfo" title="Rescue question difficulty if a rival lands on the piece">🛡️ ${p.pieces.map((pc, i) => {
      const lvl = rescueLevel(pc.pos);
      const what = pc.pos <= 0 ? 'home' : pc.pos >= FIN ? '🏁' : lvl ? `<b style="color:var(--l${lvl})">${Quiz.LEVELS[lvl].label}</b>` : 'safe';
      return `<span class="ri"><i class="pd ${pc.pos >= FIN ? 'done' : pc.pos > 0 ? 'out' : 'home'}"></i>${p.pieces.length > 1 ? `${i + 1}: ` : ''}${what}</span>`;
    }).join('')}</div>` : '';
    return `<div class="pbar">${zones}${markers}</div>${info}`;
  }

  function renderStandings() {
    const ol = $('standings');
    ol.innerHTML = '';
    state.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', COLORS[p.seat].hex);
      li.classList.toggle('active', i === state.turn && state.phase !== 'over');
      const tokens = state.opts.steal ? `<span class="tokens" title="Compass tokens: spend one for a hint">🧭${p.tokens}</span>` : '';
      li.innerHTML = `<span class="pawn-icon"></span>
        <div class="pinfo"><div class="nm"><span></span>${isBot(p) ? `<small class="botbadge">🤖 ${BOTS[p.type].label}</small>` : ''}</div>${progressBar(p)}</div>
        <div class="sc">${p.pieces.length > 1 ? `<b>${finishedCount(p)}</b>/${p.pieces.length} 🏁<br>` : ''}${p.correct}/${p.asked} ✓${tokens ? '<br>' + tokens : ''}</div>`;
      li.querySelector('.nm span').textContent = p.name;
      ol.appendChild(li);
    });
  }

  function setTurnPill(p = current(), prefix = isBot(current()) ? '🤖 ' : '', suffix = "'s turn") {
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
    state.attempts = 0;
    const p = current();
    setTurnPill();
    renderStandings();
    Board.setSelectable([]);
    Board.showTarget(null);
    $('roll-btn').disabled = isBot(p);
    saveGame();
    const noneActive = !p.pieces.some((pc) => pc.pos > 0 && pc.pos < FIN);
    if (isBot(p)) {
      status(`${who(p)} is rolling…`);
      later(900, () => roll(false));
      return;
    }
    status(noneActive && !state.opts.board
      ? `${who(p)}, roll a <b>6</b> to bring a piece out — ${MAX_ATTEMPTS} attempts.`
      : `${who(p)}, roll the dice!`);
  }

  /** The moves the current player may make with roll n. */
  function optionsFor(p, n) {
    const out = [];
    const minMove = state.opts.choose ? n + 1 : n;
    p.pieces.forEach((pc, idx) => {
      if (pc.pos <= 0) {
        // Pieces at home are interchangeable, so only one of them is offered.
        if (n === 6 && !out.some((o) => o.action === 'enter')) {
          out.push({ seat: p.seat, idx, action: 'enter', target: 1, label: `Bring piece ${idx + 1} onto the board` });
        }
      } else if (pc.pos < FIN) {
        if (state.opts.exact && pc.pos + minMove > FIN) return;
        const target = Math.min(FIN, pc.pos + minMove);
        out.push({ seat: p.seat, idx, action: 'move', target, label: `Move piece ${idx + 1}` });
      }
    });
    return out;
  }

  async function roll(byUser = true) {
    if (!state || state.phase !== 'roll') return;
    const p = current();
    if (byUser && isBot(p)) return;
    state.phase = 'rolling';
    $('roll-btn').disabled = true;
    const n = 1 + Math.floor(Math.random() * 6);
    state.roll = n;
    status('Rolling…');
    await Dice.roll(n);
    if (!state || state.phase !== 'rolling') return;
    const opts = optionsFor(p, n);

    const noneActive = !p.pieces.some((pc) => pc.pos > 0 && pc.pos < FIN);
    if (!opts.length && noneActive && p.pieces.some((pc) => pc.pos <= 0)) {
      // Nothing on the board: up to 3 attempts to roll the 6 that unlocks a piece.
      state.attempts++;
      if (state.attempts < MAX_ATTEMPTS) {
        status(`Rolled <b>${n}</b> — no 6. Attempt <b>${state.attempts + 1}</b> of ${MAX_ATTEMPTS}${isBot(p) ? '…' : ': roll again!'}`);
        state.phase = 'roll';
        $('roll-btn').disabled = isBot(p);
        if (isBot(p)) later(800, () => roll(false));
        return;
      }
      log(`🎲 ${who(p)} didn't roll a 6 in ${MAX_ATTEMPTS} attempts.`, p.seat);
      status(`No 6 in ${MAX_ATTEMPTS} attempts — turn passes.`);
      await sleep(1500);
      return nextTurn(false);
    }
    if (!opts.length) {
      const why = `can't move ${n} (an exact roll is needed to finish)`;
      log(`🎲 ${who(p)} rolled ${n} and ${why}.`, p.seat);
      status(`Rolled <b>${n}</b> — ${why}. Turn passes.`);
      await sleep(1500);
      return nextTurn(false);
    }

    state.phase = 'choose';
    Board.setSelectable(isBot(p) ? [] : opts, choose);
    if (opts.length === 1 || isBot(p)) {
      const o = opts.length === 1 ? opts[0] : botPickPiece(p, opts);
      status(`Rolled <b>${n}</b> → ${o.action === 'enter' ? 'bringing a piece onto the board' : `moving${p.pieces.length > 1 ? ` piece ${o.idx + 1}` : ''}`}…`);
      Board.showTarget(p.seat, o.target);
      await sleep(isBot(p) ? 900 : 700);
      return choose(o);
    }
    const canEnter = opts.some((o) => o.action === 'enter');
    status(`Rolled <b>${n}</b> → ${canEnter ? 'click the glowing <b>home</b> piece to bring it out (no question) or a piece on the board to move it.' : 'click the piece you want to move.'}`);
  }

  async function choose(o) {
    if (!state || state.phase !== 'choose') return;
    state.phase = 'busy';
    state.choice = o;
    Board.setSelectable([]);
    const p = current();
    const pc = p.pieces[o.idx];
    if (o.action === 'enter') {
      log(`🚩 ${who(p)} brings piece ${o.idx + 1} onto the board.`, p.seat);
      status(`${who(p)} brings a piece out!`);
      pc.pos = 1;
      await Board.walk(p.seat, o.idx, 0, 1, state.players);
      await resolveLanding(p, o.idx, 0);
      renderStandings();
      return endOfMove(true);
    }
    const n = state.roll;
    const level = state.opts.choose ? await pickLevel(p, pc, n) : n;
    const moves = Math.min(FIN - pc.pos, state.opts.choose ? n + level : n);
    const target = pc.pos + moves;
    Board.showTarget(p.seat, target);
    await sleep(400);
    const ok = await quiz({ kind: 'move', player: p, idx: o.idx, level, moves });
    Board.showTarget(null);
    if (ok) {
      const from = pc.pos;
      status(`${who(p)} moves ${moves} square${moves === 1 ? '' : 's'}…`);
      pc.pos = target;
      await Board.walk(p.seat, o.idx, from, target, state.players);
      renderStandings();
      await resolveLanding(p, o.idx, from);
      if (pc.pos >= FIN) {
        log(`🏁 ${who(p)}'s piece ${p.pieces.length > 1 ? `${o.idx + 1} ` : ''}reached the finish!`, p.seat);
        if (finishedCount(p) === p.pieces.length) return win(p);
      }
    } else {
      status(`${who(p)}'s piece stays put.`);
      await sleep(500);
    }
    endOfMove(ok);
  }

  /* ---------- Pick your challenge ---------- */
  function pickLevel(p, pc, n) {
    return new Promise((resolve) => {
      state.phase = 'level';
      const panel = $('level-picker');
      $('lp-who').textContent = `${isBot(p) ? '🤖 ' : ''}${p.name} rolled ${n}`;
      $('lp-sub').textContent = '— pick your challenge: a correct answer moves roll + level';
      panel.style.setProperty('--pc', COLORS[p.seat].hex);
      const btns = $('lp-btns');
      btns.innerHTML = [1, 2, 3, 4, 5, 6].map((l) => {
        const move = Math.min(FIN - pc.pos, n + l);
        const blocked = state.opts.exact && pc.pos + n + l > FIN;
        return `<button type="button" data-l="${l}" style="--c:var(--l${l})" ${blocked ? 'disabled' : ''}>
          <b>${l}</b><span>${Quiz.LEVELS[l].label}</span><em>+${move}</em></button>`;
      }).join('');
      panel.hidden = false;
      const done = (l) => {
        if (state.phase !== 'level') return;
        state.phase = 'busy';
        panel.hidden = true;
        state.levelPick = null;
        log(`🎯 ${who(p)} picks ${lvlSpan(l)} (move ${Math.min(FIN - pc.pos, n + l)} if correct).`, p.seat);
        resolve(l);
      };
      btns.querySelectorAll('button').forEach((b) => {
        const l = +b.dataset.l;
        b.addEventListener('click', () => { if (!isBot(p)) done(l); });
        b.addEventListener('pointerenter', () => Board.showTarget(p.seat, pc.pos + Math.min(FIN - pc.pos, n + l)));
        b.addEventListener('focus', () => Board.showTarget(p.seat, pc.pos + Math.min(FIN - pc.pos, n + l)));
      });
      state.levelPick = done;
      if (isBot(p)) {
        status(`${who(p)} is picking a challenge…`);
        const l = botPickLevel(p, pc, n);
        later(700, () => {
          const b = btns.querySelector(`[data-l="${l}"]`);
          if (b) b.classList.add('chosen');
          Board.showTarget(p.seat, pc.pos + Math.min(FIN - pc.pos, n + l));
          later(800, () => done(l));
        });
      } else {
        status(`Rolled <b>${n}</b> → pick your challenge (keys <kbd>1</kbd>–<kbd>6</kbd>). Harder questions move you further.`);
        setTimeout(() => { const b = btns.querySelector('button:not([disabled])'); if (b) b.focus({ preventScroll: true }); }, 50);
      }
    });
  }

  /* ---------- Bots ---------- */
  function botPickLevel(p, pc, n) {
    // Maximise expected progress, with a little personality noise.
    let best = 1, bestV = -1;
    for (let l = 1; l <= 6; l++) {
      if (state.opts.exact && pc.pos + n + l > FIN) continue;
      const v = Math.min(FIN - pc.pos, n + l) * botAcc(p.type, l) * (0.9 + Math.random() * 0.2);
      if (v > bestV) { bestV = v; best = l; }
    }
    return best;
  }
  function botPickPiece(p, opts) {
    const enter = opts.find((o) => o.action === 'enter');
    const active = p.pieces.filter((pc) => pc.pos > 0 && pc.pos < FIN).length;
    if (enter && active < 2) return enter;
    const moves = opts.filter((o) => o.action === 'move');
    if (!moves.length) return enter;
    return moves.reduce((a, b) => (p.pieces[b.idx].pos > p.pieces[a.idx].pos ? b : a));
  }
  /** A bot answers: right with a probability that depends on its skill and the level, otherwise a neighbour. */
  function botAnswer(bot, level, excluded = []) {
    const q = state.q;
    const gen = state.gen;
    $('q-kind').textContent = `🤖 ${bot.name} is thinking…`;
    sleep(1400 + Math.random() * 1400).then(() => {
      if (!state || state.gen !== gen || state.q !== q || state.phase !== 'question') return;
      let id = q.country.id;
      if (Math.random() > botAcc(bot.type, level)) {
        const [x, y] = q.country.c;
        const near = window.WORLD.countries
          .filter((c) => c.fame && c.id !== q.country.id && !excluded.includes(c.id))
          .map((c) => ({ id: c.id, d: Math.hypot(c.c[0] - x, c.c[1] - y) }))
          .sort((a, b) => a.d - b.d).slice(0, 5);
        id = near[Math.floor(Math.random() * near.length)].id;
      }
      answer(id);
    });
  }

  /* ---------- Questions ----------
   * quiz(ctx) rolls the board away, asks one question and resolves with true/false once the result has
   * been acknowledged and the board is back.
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
    state.stealer = null;
    state.hintUsed = false;
    state.wrongPicks = [];
    const rescue = ctx.kind === 'rescue';

    $('quiz-card').classList.toggle('rescue', rescue);
    $('quiz-card').classList.remove('steal');
    const diff = $('q-diff');
    diff.className = 'chip lvl';
    diff.style.setProperty('--c', `var(--l${ctx.level})`);
    diff.textContent = `${ctx.level} · ${q.levelLabel}`;
    $('q-tag').textContent = q.tag;
    setAnswererChip(p, p.pieces.length > 1 ? ` · piece ${ctx.idx + 1}` : '');
    $('q-steps').textContent = rescue
      ? `🛡️ Rescue — answer correctly to stop ${ctx.attacker.name}'s capture`
      : `🎲 ${state.roll}${state.opts.choose ? ` + ${ctx.level}` : ''} → move ${ctx.moves} if correct`;
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
    $('timer').hidden = true;
    $('result').hidden = true;
    $('pass-btn').hidden = true;
    syncHint();
    WorldMap.prepare(answer);
    WorldMap.lock();

    await showMap();
    if (state.q !== q) return;
    WorldMap.prepare(answer);
    if (isBot(p)) botAnswer(p, ctx.level);
    else startTimer(timeFor(q));
  }

  const answerer = () => state.stealer || state.pending.ctx.player;
  const timeFor = (q) => (['history', 'sports', 'culture', 'geoq'].includes(q.type) ? TIMER_SECS + 15 : TIMER_SECS);

  function setAnswererChip(p, extra = '') {
    const pc = $('q-player');
    pc.style.setProperty('--pc', COLORS[p.seat].hex);
    pc.textContent = `${isBot(p) ? '🤖 ' : ''}${p.name}${extra}`;
  }

  function startTimer(total) {
    const t = $('timer');
    clearInterval(timerHandle);
    if (!state.opts.timer) { t.hidden = true; return; }
    t.hidden = false;
    t.classList.remove('low');
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

  /* ---------- Hints ---------- */
  function syncHint() {
    const btn = $('hint-btn');
    const a = state.pending && answerer();
    const show = state.opts.steal && state.phase === 'question' && a && !isBot(a) && !state.hintUsed;
    btn.hidden = !show;
    if (show) {
      $('hint-count').textContent = `×${a.tokens}`;
      btn.disabled = a.tokens <= 0;
      btn.title = a.tokens > 0 ? 'Spend a compass token to highlight the right region (H)' : 'No compass tokens left: steal a question or answer an expert one to earn more';
    }
  }
  function useHint() {
    if (!state || state.phase !== 'question' || state.hintUsed) return;
    const a = answerer();
    if (isBot(a) || a.tokens <= 0 || !state.opts.steal) return;
    a.tokens--;
    state.hintUsed = true;
    const c = state.q.country;
    const region = window.WORLD.countries.filter((x) => x.fame && x.region === c.region).map((x) => x.id);
    WorldMap.hint(region.length > 1 ? region : [c.id]);
    Sound.tone(660, 0.15, 'triangle', 0.1);
    log(`🧭 ${who(a)} used a hint: the answer is in ${esc(c.region)}.`, a.seat);
    $('q-kind').textContent = `🧭 Hint: it's somewhere in ${c.region}`;
    syncHint();
    renderStandings();
  }

  function factFor(q) {
    const c = q.country;
    switch (q.type) {
      case 'capital': return `The capital of <b>${esc(c.name)}</b> is <b>${esc(c.capital)}</b>.`;
      case 'city': return `<b>${esc(q.city)}</b> is in <b>${esc(c.name)}</b>.`;
      case 'flag': return `That's the flag of <b>${esc(c.name)}</b>.`;
      case 'history': case 'sports': case 'culture': case 'geoq': return `The answer is <b>${esc(c.name)}</b>.`;
      default: return `<b>${esc(c.name)}</b>` + (c.noCap ? '.' : ` — capital: ${esc(c.capital)}.`);
    }
  }

  function stamp(p, c) {
    if (isBot(p) || passport.has(c.id)) return;
    passport.add(c.id);
    store.set(PASSPORT_KEY, [...passport]);
    state.stamps.push(c.name);
  }

  function award(p, why) {
    if (!state.opts.steal || p.tokens >= MAX_TOKENS) return '';
    p.tokens++;
    log(`🧭 ${who(p)} earns a compass token (${why}).`, p.seat);
    return ` ${esc(p.name)} earns a 🧭 token.`;
  }

  function answer(clickedId) {
    if (!state || state.phase !== 'question') return;
    clearInterval(timerHandle);
    const { ctx } = state.pending;
    const q = state.q;
    const c = q.country;
    const ok = clickedId === c.id;
    const clicked = clickedId ? WorldMap.byId.get(clickedId) : null;

    /* --- a steal attempt resolves --- */
    if (state.stealer) {
      const s = state.stealer;
      const passed = clickedId === 'pass';
      if (!passed) s.asked++;
      state.phase = 'result';
      WorldMap.reveal(c.id, passed ? null : clickedId, q.pin ? { p: q.pin, name: q.city } : null);
      let sub;
      if (ok) {
        s.correct++;
        s.steals++;
        stamp(s, c);
        $('result-title').textContent = 'Stolen! 🦊';
        sub = `${factFor(q)}${award(s, 'steal')}`;
        Sound.correct();
        log(`🦊 ${who(s)} stole the question: ${esc(c.name)}.`, s.seat);
      } else {
        $('result-title').textContent = passed ? 'Passed' : 'Nobody got it';
        sub = (clicked ? `${esc(s.name)} picked <b>${esc(clicked.name)}</b>. ` : '') + `The answer was <b>${esc(c.name)}</b>.`;
        Sound.wrong();
      }
      showResult(ok, ok ? '🦊' : '✗', sub, s);
      return;
    }

    const p = ctx.player;
    const rescue = ctx.kind === 'rescue';
    p.asked++;
    state.outcome = ok;

    /* --- wrong move answer: the next player may steal --- */
    if (!ok && ctx.kind === 'move' && state.opts.steal && state.players.length > 1) {
      const s = nextPlayer();
      state.stealer = s;
      if (clickedId) { WorldMap.markWrong(clickedId); state.wrongPicks.push(clickedId); }
      Sound.wrong();
      log(`✗ ${who(p)} missed${clicked ? ` (picked ${esc(clicked.name)})` : ' (time ran out)'} — ${who(s)} can steal.`, p.seat);
      $('quiz-card').classList.add('steal');
      setAnswererChip(s, ' · steal');
      setTurnPill(s, '🦊 ', ' steals');
      $('q-kind').textContent = `🦊 ${s.name}, steal it! Find the answer to earn a 🧭 token`;
      $('q-steps').textContent = `🦊 Steal — a correct answer earns ${s.name} a 🧭 token`;
      const res = $('result');
      res.classList.add('bad');
      res.classList.add('compact');
      $('result-icon').textContent = '✗';
      $('result-title').textContent = clickedId ? 'Not quite!' : "Time's up!";
      $('result-sub').innerHTML = `${clicked ? `<b>${esc(clicked.name)}</b> is wrong. ` : ''}${who(s)}, your chance to steal!`;
      $('continue-btn').hidden = true;
      $('pass-btn').hidden = isBot(s);
      res.hidden = false;
      state.hintUsed = false;
      syncHint();
      if (isBot(s)) botAnswer(s, ctx.level, state.wrongPicks);
      else startTimer(STEAL_SECS);
      return;
    }

    state.phase = 'result';
    WorldMap.reveal(c.id, clickedId, q.pin ? { p: q.pin, name: q.city } : null);
    const extra = q.type === 'capital' ? ` (capital: ${esc(c.capital)})` : q.type === 'city' ? ` (${esc(q.city)})` : '';
    const missed = (clicked ? `You picked <b>${esc(clicked.name)}</b>. ` : '') + `The answer was <b>${esc(c.name)}</b>${extra}.`;
    let sub;
    if (ok) {
      p.correct++;
      stamp(p, c);
      $('result-title').textContent = rescue ? 'Rescued!' : ['Correct!', 'Spot on!', 'Brilliant!', 'Well navigated!'][(Math.random() * 4) | 0];
      sub = `${factFor(q)} ` + (rescue
        ? `${esc(ctx.attacker.name)}'s piece is pushed back.`
        : `Move <b>${ctx.moves}</b> square${ctx.moves === 1 ? '' : 's'}.`);
      if (!rescue && ctx.level === 6) sub += award(p, 'expert answer');
      Sound.correct();
      log(`${rescue ? '🛡️' : '✓'} ${who(p)} found ${esc(c.name)} <small>(${q.tag}, level ${q.level})</small>`, p.seat);
    } else {
      $('result-title').textContent = rescue ? (clickedId ? 'Captured!' : "Time's up — captured!") : clickedId ? 'Not quite!' : "Time's up!";
      sub = missed + (rescue ? ' The piece goes back.' : ' The piece stays put.');
      Sound.wrong();
      log(`✗ ${who(p)} missed ${esc(c.name)}${clicked ? ` (picked ${esc(clicked.name)})` : ' (time ran out)'}`, p.seat);
    }
    showResult(ok, ok ? (rescue ? '🛡' : '✓') : clickedId ? '✗' : '⏱', sub, p);
  }

  function showResult(ok, icon, sub, actor) {
    const res = $('result');
    res.classList.toggle('bad', !ok);
    res.classList.remove('compact');
    $('result-icon').textContent = icon;
    $('result-sub').innerHTML = sub;
    $('pass-btn').hidden = true;
    $('continue-btn').hidden = false;
    $('timer').hidden = true;
    $('hint-btn').hidden = true;
    res.hidden = false;
    if (ok) {
      const r = $('map-wrap').getBoundingClientRect();
      Confetti.burst(r.left + r.width / 2, r.top + r.height * 0.75, 60, 0.8);
    }
    renderStandings();
    // Bots don't press Continue: carry on by themselves after a moment.
    if (isBot(actor)) later(2600, continueAfterAnswer);
    else setTimeout(() => $('continue-btn').focus({ preventScroll: true }), 50);
  }

  async function continueAfterAnswer() {
    if (!state || state.phase !== 'result') return;
    state.phase = 'moving';
    state.stealer = null;
    $('result').hidden = true;
    WorldMap.lock();
    await showBoard();
    setTurnPill();
    const { resolve } = state.pending;
    state.pending = null;
    resolve(state.outcome);
  }

  /**
   * A piece has just landed. Rival pieces on the same square (unless it is a safe square) are under
   * attack. With rescue questions on, each defending player first gets a rescue question at the
   * difficulty of the threatened piece's progress; a correct rescue sends the attacker back to `from`.
   */
  async function resolveLanding(p, idx, from) {
    const sq = Board.trackIndex(p.seat, p.pieces[idx].pos);
    if (sq < 0) return;
    const groups = state.players.filter((o) => o !== p)
      .map((o) => ({ o, js: o.pieces.map((_, j) => j).filter((j) => Board.trackIndex(o.seat, o.pieces[j].pos) === sq) }))
      .filter((g) => g.js.length);
    if (!groups.length) return;
    if (Board.isSafe(sq)) {
      log(`🛡️ ${who(p)} shares a safe square with ${groups.map((g) => who(g.o)).join(', ')}. No capture.`, p.seat);
      return;
    }
    for (const { o, js } of groups) {
      const pieces = o.pieces.length === 1 ? 'piece' : js.length > 1 ? `pieces ${js.map((j) => j + 1).join(' & ')}` : `piece ${js[0] + 1}`;
      if (state.opts.rescue) {
        const lvl = rescueLevel(o.pieces[js[0]].pos);
        const label = Quiz.LEVELS[lvl].label;
        log(`⚔️ ${who(p)} attacks ${who(o)}'s ${pieces}! Rescue question: level ${lvl} (${label}).`, p.seat);
        status(`⚔️ ${who(o)}, your ${pieces} ${js.length > 1 ? 'are' : 'is'} under attack! Answer ${article(label)} ${lvlSpan(lvl)} rescue question.`);
        Sound.capture();
        await sleep(1400);
        const saved = await quiz({ kind: 'rescue', player: o, idx: js[0], level: lvl, attacker: p });
        if (saved) {
          log(`🛡️ ${who(o)} fought off the attack! ${who(p)} goes back to where it came from.`, o.seat);
          status(`🛡️ ${who(o)} saved the piece — ${who(p)} is pushed back!`);
          p.pieces[idx].pos = from;
          await Board.flyTo(p.seat, idx, state.players);
          renderStandings();
          return;
        }
      }
      p.captures++;
      const back = state.opts.board ? 'back to the start' : 'home';
      log(`💥 ${who(p)} captured ${who(o)}'s ${pieces} and sent ${js.length > 1 ? 'them' : 'it'} ${back}!`, p.seat);
      status(`💥 ${who(o)}'s ${pieces} ${js.length > 1 ? 'are' : 'is'} sent ${back}!`);
      js.forEach((j) => { o.pieces[j].pos = homePos(); });
      for (const j of js) await Board.sendHome(o.seat, j, state.players);
      renderStandings();
    }
  }

  function endOfMove(success) {
    const p = current();
    const extra = success && state.roll === 6 && state.opts.six;
    if (extra) log(`🎲 Six! ${who(p)} rolls again.`, p.seat);
    nextTurn(extra);
  }

  function nextTurn(extra) {
    if (!state || state.phase === 'over') return;
    if (!extra) state.turn = (state.turn + 1) % state.players.length;
    beginTurn();
    if (extra && !isBot(current())) status(`🎲 Six! ${who(current())}, roll again!`);
  }

  function win(p) {
    state.phase = 'over';
    store.del(SAVE_KEY);
    Board.setSelectable([]);
    renderStandings();
    log(`🏆 ${who(p)} wins!`, p.seat);
    status(`🏆 ${who(p)} wins!`);
    Sound.win();
    Confetti.rain(260);
    $('win-name').textContent = p.name;
    const acc = p.asked ? Math.round((p.correct / p.asked) * 100) : 0;
    $('win-stats').textContent = `${p.correct} correct answer${p.correct === 1 ? '' : 's'} out of ${p.asked} (${acc}%) · ${p.captures} capture${p.captures === 1 ? '' : 's'}${state.opts.steal ? ` · ${p.steals} steal${p.steals === 1 ? '' : 's'}` : ''}`;
    const table = $('win-table');
    table.innerHTML = '';
    const score = (x) => finishedCount(x) / x.pieces.length * 1000 + x.pieces.reduce((s, pc) => s + pc.pos, 0) / x.pieces.length;
    [...state.players].sort((a, b) => score(b) - score(a) || b.correct - a.correct).forEach((x, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', COLORS[x.seat].hex);
      const pa = x.asked ? Math.round((x.correct / x.asked) * 100) : 0;
      li.innerHTML = `<b>${i + 1}.</b><span class="pawn-icon"></span><span></span><span>${x.correct}/${x.asked} ✓ (${pa}%)${state.opts.steal ? ` · 🦊${x.steals}` : ''}</span>`;
      li.children[2].textContent = (isBot(x) ? '🤖 ' : '') + x.name;
      table.appendChild(li);
    });
    $('win-stamps').innerHTML = state.stamps.length
      ? `🛂 <b>${state.stamps.length} new passport stamp${state.stamps.length === 1 ? '' : 's'}:</b> ${state.stamps.slice(0, 12).map(esc).join(', ')}${state.stamps.length > 12 ? '…' : ''}<br><small>Passport: ${passport.size} / ${playableCount} countries found</small>`
      : `<small>🛂 Passport: ${passport.size} / ${playableCount} countries found</small>`;
    setTimeout(() => { $('win').hidden = false; $('again-btn').focus(); }, 900);
  }

  /* ================= EVENTS ================= */
  $('roll-btn').addEventListener('click', () => roll(true));
  $('dice-scene').addEventListener('click', () => roll(true));
  $('continue-btn').addEventListener('click', continueAfterAnswer);
  $('pass-btn').addEventListener('click', () => answer('pass'));
  $('hint-btn').addEventListener('click', useHint);
  $('again-btn').addEventListener('click', () => { $('win').hidden = true; startGame(); });
  $('setup-btn').addEventListener('click', toSetup);
  $('menu-btn').addEventListener('click', () => {
    if (state && state.phase !== 'over' && !confirm('Leave this game? It is saved: you can resume it from the start screen.')) return;
    toSetup();
  });
  $('sound-btn').addEventListener('click', () => {
    Sound.enabled = !Sound.enabled;
    $('sound-btn').textContent = Sound.enabled ? '🔊' : '🔇';
  });
  function toSetup() {
    clearInterval(timerHandle);
    if (state) { state.gen = null; state.phase = 'over'; }
    state = null;
    $('win').hidden = true;
    $('level-picker').hidden = true;
    $('game').classList.remove('active');
    $('setup').classList.add('active');
    renderInputs();
    syncNotes();
  }
  document.addEventListener('keydown', (e) => {
    if (!state || !$('game').classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.closest('.piece')) return;
    const p = current();
    if ((e.code === 'Space' || e.key === ' ') && state.phase === 'roll' && !isBot(p)) { e.preventDefault(); roll(true); }
    else if (e.key === 'Enter' && state.phase === 'result' && !$('continue-btn').hidden) { e.preventDefault(); continueAfterAnswer(); }
    else if ((e.key === 'h' || e.key === 'H') && state.phase === 'question') { e.preventDefault(); useHint(); }
    else if (state.phase === 'level' && /^[1-6]$/.test(e.key) && !isBot(p) && state.levelPick) {
      const b = document.querySelector(`#lp-btns [data-l="${e.key}"]`);
      if (b && !b.disabled) { e.preventDefault(); state.levelPick(+e.key); }
    } else if (state.phase === 'choose' && /^[1-4]$/.test(e.key) && !isBot(p)) {
      // Number keys pick the current player's piece with that number, if it can move.
      const o = optionsFor(p, state.roll).find((x) => x.idx === +e.key - 1);
      if (o) { e.preventDefault(); choose(o); }
    }
  });

  // Test hook: open the page with ?debug to inspect / tweak the live state from the console.
  if (/[?&]debug\b/.test(location.search)) window.__geoludo = { get state() { return state; }, Board, choose, optionsFor, botAcc };

  // Keep the 3D prism depth equal to half the stage height so the faces meet at a clean edge.
  const stage = $('stage');
  new ResizeObserver(() => {
    stage.style.setProperty('--depth', stage.clientHeight / 2 + 'px');
  }).observe(stage);
})();
