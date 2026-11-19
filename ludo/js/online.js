/* GeoLudo online rooms: lobby, invitation link, and keeping every device in step.
 *
 * Every device runs the same game from the same random seed (dice, questions and bots come out the
 * same everywhere). Only decisions travel: a device sends its player's roll / piece / level / answer /
 * continue to the host, the host numbers it and sends it to everyone (itself included), and each
 * device applies it when its game reaches that decision (see point()/receive() in game.js).
 * Someone who joins late or reloads gets the whole list and replays it without animations.
 * If a player's device goes offline, a bot plays for them after TAKEOVER seconds: the host makes
 * those decisions and they travel like any other, so all devices stay identical.
 *
 * Messages  host → guests: welcome, lobby, start, act, acts, roster, ping, full, bye
 *           guest → host : hello, act, resync, pong, leave
 */
(function () {
  const G = window.LudoGame;
  const { Sound } = FX;
  const $ = (id) => document.getElementById(id);
  const COLORS = Board.COLORS;
  const MAX_PLAYERS = 4;
  const TAKEOVER = 20; // seconds after a player goes offline before a bot plays for them
  const SILENT = 30000; // ms without any message: the device is gone (phone locked, network lost)
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const uid = () => 'p' + Math.random().toString(36).slice(2, 9);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const PREFS = 'geoludo.online.v1';
  const prefs = Object.assign({ format: 'hotseat', name: '' }, store.get(PREFS) || {});
  const params = new URLSearchParams(location.search);
  const joinCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const seatKey = (code) => `geoludo.seat.${code}`;

  let net = null;
  let pingTimer = null;
  const room = { code: null, relay: null, players: [], cfg: null, isHost: false, me: null };

  /* ---------- setup screen: hot seat or online ---------- */
  function syncFormat() {
    const online = !!joinCode || prefs.format === 'online';
    document.querySelectorAll('.format-btn').forEach((b) => b.classList.toggle('active', b.dataset.format === (online ? 'online' : 'hotseat')));
    $('online-section').hidden = !online;
    $('players-section').hidden = online;
    $('start-btn').hidden = online;
    $('create-btn').hidden = !online || !!joinCode;
    $('resume-card').style.display = online ? 'none' : ''; // the saved game is a hot-seat game
  }
  document.querySelectorAll('.format-btn').forEach((b) => b.addEventListener('click', () => {
    prefs.format = b.dataset.format; store.set(PREFS, prefs); syncFormat();
  }));
  $('my-name').value = prefs.name || '';
  $('my-name').addEventListener('input', () => { prefs.name = $('my-name').value; store.set(PREFS, prefs); });
  if (joinCode) {
    $('join-banner').hidden = false;
    $('join-code').textContent = joinCode;
    // the room's settings are the host's: someone joining only enters a name
    ['format-section', 'players-section', 'cat-section', 'length-section', 'options-section'].forEach((id) => { $(id).hidden = true; });
    $('online-note').hidden = true;
    $('join-btn').hidden = false;
  }
  syncFormat();

  function show(id) {
    ['setup', 'lobby', 'game'].forEach((s) => $(s).classList.toggle('active', s === id));
  }
  function banner(text, fatal) {
    let b = $('net-banner');
    if (!text) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'net-banner'; b.className = 'net-banner'; document.body.appendChild(b); }
    b.textContent = text;
    if (fatal) {
      const a = document.createElement('a');
      a.href = location.pathname; a.textContent = ' Back to the menu'; a.style.color = '#fff'; a.style.marginLeft = '8px';
      b.appendChild(a);
    }
  }
  const myName = () => ($('my-name').value || '').trim().slice(0, 16);
  function shareUrl(code) {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('room', code);
    if (room.relay) u.searchParams.set('r', room.relay);
    const test = params.get('relay');
    if (test) u.searchParams.set('relay', test); // local testing only
    return u.toString();
  }

  /* ---------- lobby ---------- */
  const rulesLine = (cfg) => {
    const len = cfg.preset === 'quick' ? 'Quick' : cfg.preset === 'classic' ? 'Classic' : 'Custom rules';
    return `${G.modeLabelFor(cfg.mode, cfg.cats)} · ${len}${cfg.opts.timer ? '' : ' · no timer'}`;
  };
  function renderLobby() {
    show('lobby');
    const host = room.isHost;
    $('room-code').textContent = room.code;
    $('share-link').value = shareUrl(room.code);
    $('share-btn').hidden = !navigator.share;
    const seats = G.SEATS[Math.max(2, room.players.length)] || G.SEATS[4];
    const custom = !!room.cfg && room.cfg.preset === 'custom';
    $('crew-count').textContent = `${room.players.length} / ${MAX_PLAYERS}`;
    $('crew').innerHTML = room.players.map((p, i) => {
      const col = COLORS[seats[i] != null ? seats[i] : i].hex;
      const bot = p.type !== 'human';
      const tags = `${i === 0 ? ' <small>host</small>' : ''}${p.id === room.me ? ' <small>you</small>' : ''}`;
      const ctl = bot ? (host ? `<button type="button" class="type-select bot" data-skill="${p.id}" title="Choose the bot's level" aria-haspopup="listbox">🤖 ${G.BOTS[p.type].label} ▾</button><button type="button" class="crew-x" data-rm="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ` <small>🤖 ${G.BOTS[p.type].label}</small>`) : '';
      // Custom rules: pieces per player are set here (players are only known in the room)
      const n = piecesOf(p);
      const pieces = !custom ? '' : host
        ? `<div class="piece-picker" role="radiogroup" aria-label="${esc(p.name)}'s number of pieces" title="Number of pieces (a handicap when unequal)">${[1, 2, 3, 4].map((k) => `<button type="button" role="radio" data-pc="${p.id}" data-n="${k}" class="${k === n ? 'active' : ''}" aria-checked="${k === n}">${k}</button>`).join('')}</div>`
        : `<small class="crew-pieces">${n} piece${n > 1 ? 's' : ''}</small>`;
      return `<li style="--pc:${col}"><span class="pawn-icon"></span><b>${esc(p.name)}</b>${tags}<div class="crew-ctl">${pieces}${ctl}</div></li>`;
    }).join('');
    $('add-bot-btn').hidden = !host || room.players.length >= MAX_PLAYERS;
    $('lobby-rules').textContent = room.cfg ? rulesLine(room.cfg) : '';
    $('lobby-start-btn').hidden = !host;
    $('lobby-start-btn').disabled = room.players.length < 2;
    $('lobby-start-btn').textContent = room.players.length < 2 ? 'Waiting for players…' : `Start the race with ${room.players.length} ✈️`;
    $('lobby-wait').hidden = host;
    if (host) {
      $('crew').querySelectorAll('[data-skill]').forEach((b) => b.addEventListener('click', async () => {
        const p = room.players.find((x) => x.id === b.dataset.skill);
        const v = p && await Dialog.menu(b, G.botChoices(), p.type);
        if (!v || v === p.type || !room.players.includes(p)) return;
        p.type = v;
        lobbyUpdate();
      }));
      $('crew').querySelectorAll('[data-pc]').forEach((b) => b.addEventListener('click', () => {
        const p = room.players.find((x) => x.id === b.dataset.pc);
        if (!p) return;
        p.pieces = +b.dataset.n;
        lobbyUpdate();
      }));
      $('crew').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        room.players = room.players.filter((x) => x.id !== b.dataset.rm);
        lobbyUpdate();
      }));
    }
  }
  /** Pieces for a player in a Custom room (default: 2, like the hot-seat default). */
  const piecesOf = (p) => (p.pieces >= 1 && p.pieces <= 4 ? p.pieces : 2);
  function lobbyUpdate() {
    renderLobby();
    net.broadcast({ t: 'lobby', players: room.players, cfg: room.cfg, code: room.code });
  }
  $('add-bot-btn').addEventListener('click', () => {
    if (!room.isHost || room.players.length >= MAX_PLAYERS) return;
    const taken = new Set(room.players.map((p) => p.name));
    let k = 1;
    while (taken.has(G.defaultName(k, 'bot'))) k++;
    const name = G.defaultName(k, 'bot');
    room.players.push({ id: uid(), name, type: 'explorer', connected: true });
    lobbyUpdate();
  });
  function copyLink() {
    const btn = $('copy-btn');
    const link = $('share-link').value;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
      () => { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy'; }, 1600); },
      () => { $('share-link').select(); document.execCommand('copy'); },
    );
  }
  $('copy-btn').addEventListener('click', copyLink);
  $('share-btn').addEventListener('click', () => navigator.share({ title: 'GeoLudo', text: 'Join my GeoLudo game!', url: $('share-link').value }).catch(() => {}));
  $('leave-btn').addEventListener('click', () => leave());

  /* ======================================================================
   * HOST
   * ==================================================================== */
  const game = { seed: 0, players: [], log: [], seq: 0, running: false };
  const roster = {}; // seat -> { connected, auto }
  const connOf = new Map(); // pid -> conn
  const offTimers = {};

  $('create-btn').addEventListener('click', () => {
    const name = myName();
    if (!name) { $('my-name').focus(); $('net-status').textContent = 'Enter your name first.'; return; }
    if (!Net.supported()) { $('net-status').textContent = 'Online play is not supported in this browser.'; return; }
    Sound.ensure();
    $('create-btn').disabled = true;
    $('net-status').textContent = 'Opening a room…';
    room.isHost = true;
    room.me = uid();
    room.players = [{ id: room.me, name, type: 'human', connected: true }];
    room.cfg = G.currentConfig();
    net = Net.host({
      onReady(code, relayKey) {
        room.code = code;
        room.relay = relayKey;
        $('create-btn').disabled = false;
        $('net-status').textContent = '';
        renderLobby();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          net.broadcast({ t: 'ping', step: G.step });
          const now = Date.now();
          connOf.forEach((conn, pid) => { if (now - (conn._seen || now) > SILENT) gone(pid, conn); });
        }, 5000);
      },
      onError(text) { $('create-btn').disabled = false; $('net-status').textContent = text; },
      onMessage(conn, msg) { hostMessage(conn, msg); },
      onClose(conn) { if (conn._pid) gone(conn._pid, conn); },
    });
  });

  const seatOfPid = (pid) => { const p = game.players.find((x) => x.pid === pid); return p ? p.seat : null; };
  function gone(pid, conn) {
    if (connOf.get(pid) === conn) connOf.delete(pid);
    try { conn.close(); } catch (e) { /* ignore */ }
    if (!game.running) {
      room.players = room.players.filter((p) => p.id !== pid);
      lobbyUpdate();
      return;
    }
    const seat = seatOfPid(pid);
    if (seat == null || !roster[seat] || !roster[seat].connected) return;
    roster[seat].connected = false;
    clearTimeout(offTimers[seat]);
    offTimers[seat] = setTimeout(() => {
      if (roster[seat].connected) return;
      roster[seat].auto = true; // a bot plays for them until they are back
      rosterUpdate();
    }, TAKEOVER * 1000);
    rosterUpdate();
  }
  function rosterUpdate() {
    G.NET.roster = roster;
    G.renderStandings();
    G.resupervise();
    net.broadcast({ t: 'roster', roster });
  }

  /** Host: number a decision and send it to everyone, itself included. */
  function hostSend(a) {
    const act = { ...a, seq: ++game.seq };
    game.log.push(act);
    net.broadcast({ t: 'act', a: act });
    G.receive(act);
  }
  function startMsg(seat) {
    return { t: 'start', seed: game.seed, cfg: room.cfg, players: game.players, seat, log: game.log, step: G.step, roster };
  }

  function hostStart() {
    const humansAndBots = room.players.slice(0, MAX_PLAYERS);
    const seats = G.SEATS[humansAndBots.length];
    room.cfg = G.currentConfig();
    if (room.cfg.preset === 'custom') { // per player, as set in the lobby
      room.cfg.pieces = [2, 2, 2, 2];
      humansAndBots.forEach((p, i) => { room.cfg.pieces[seats[i]] = piecesOf(p); });
    }
    game.seed = (Math.random() * 2 ** 31) | 0;
    game.players = humansAndBots.map((p, i) => ({ seat: seats[i], name: p.name, type: p.type, pid: p.type === 'human' ? p.id : null }));
    game.log = [];
    game.seq = 0;
    game.running = true;
    Object.keys(roster).forEach((k) => delete roster[k]);
    game.players.forEach((p) => { roster[p.seat] = { connected: p.type !== 'human' || p.pid === room.me || connOf.has(p.pid), auto: false }; });
    // players who were already gone get their bot straight away after the usual wait
    game.players.forEach((p) => { if (!roster[p.seat].connected) { roster[p.seat].connected = true; gone(p.pid, {}); } });
    connOf.forEach((conn, pid) => net.sendTo(conn, startMsg(seatOfPid(pid))));
    G.NET.roster = roster;
    G.NET.onLeave = leave;
    G.NET.onAgain = () => hostStart();
    G.start({ cfg: room.cfg, seed: game.seed, players: game.players, seat: seatOfPid(room.me), host: true, send: hostSend });
    G.NET.roster = roster;
    G.renderStandings();
  }
  $('lobby-start-btn').addEventListener('click', () => { if (room.isHost && room.players.length >= 2) hostStart(); });

  function hostMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    conn._seen = Date.now();
    if (msg.t === 'pong') return;
    if (msg.t === 'hello') {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Explorer';
      let pid = msg.pid;
      if (game.running) {
        let p = game.players.find((x) => x.pid && x.pid === pid);
        // same name as a player who is offline: give them their seat back
        if (!p) p = game.players.find((x) => x.pid && roster[x.seat] && !roster[x.seat].connected && x.name.toLowerCase() === name.toLowerCase());
        if (!p) { // game running: watch only
          net.sendTo(conn, { t: 'welcome', pid: null, code: room.code });
          net.sendTo(conn, startMsg(null));
          return;
        }
        pid = p.pid;
        attach(conn, pid);
        net.sendTo(conn, { t: 'welcome', pid, code: room.code });
        net.sendTo(conn, startMsg(p.seat));
        clearTimeout(offTimers[p.seat]);
        roster[p.seat] = { connected: true, auto: false };
        rosterUpdate();
        return;
      }
      let known = room.players.find((p) => p.id === pid);
      if (!known) {
        if (room.players.length >= MAX_PLAYERS) { net.sendTo(conn, { t: 'full' }); return; }
        pid = uid();
        room.players.push({ id: pid, name, type: 'human', connected: true });
      }
      attach(conn, pid);
      net.sendTo(conn, { t: 'welcome', pid, code: room.code });
      lobbyUpdate();
    } else if (msg.t === 'act' && conn._pid && game.running && msg.a && typeof msg.a === 'object') {
      const seat = seatOfPid(conn._pid);
      if (seat == null) return; // spectators don't play
      const a = msg.a;
      if (!['roll', 'choose', 'level', 'answer', 'hint', 'continue'].includes(a.t) || typeof a.step !== 'number') return;
      hostSend({ t: a.t, step: a.step, idx: a.idx, action: a.action, l: a.l, id: a.id, by: seat });
    } else if (msg.t === 'resync' && game.running) {
      net.sendTo(conn, { t: 'acts', list: game.log.filter((a) => a.seq >= (msg.from | 0)) });
    } else if (msg.t === 'leave' && conn._pid) {
      gone(conn._pid, conn);
    }
  }
  function attach(conn, pid) {
    conn._pid = pid;
    const old = connOf.get(pid);
    if (old && old !== conn) { try { old.close(); } catch (e) { /* ignore */ } }
    connOf.set(pid, conn);
  }

  /* ======================================================================
   * GUEST
   * ==================================================================== */
  const guest = { lastSeq: 0, buffer: [], asked: false };
  $('join-btn').addEventListener('click', () => {
    const name = myName();
    if (!name) { $('my-name').focus(); $('net-status').textContent = 'Enter your name first.'; return; }
    if (!Net.supported()) { $('net-status').textContent = 'Online play is not supported in this browser.'; return; }
    Sound.ensure();
    $('join-btn').disabled = true;
    $('net-status').textContent = 'Connecting…';
    room.isHost = false;
    room.code = joinCode;
    room.relay = params.get('r');
    room.me = store.get(seatKey(joinCode));
    let welcomed = false;
    net = Net.join(joinCode, room.relay, {
      onOpen() {
        net.send({ t: 'hello', pid: room.me, name });
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
      onClose() { banner('Disconnected from the game.', true); },
      onMessage: guestMessage,
    });
  });

  function guestMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        room.me = msg.pid;
        if (msg.pid) store.set(seatKey(joinCode), msg.pid);
        banner(null);
        $('join-btn').disabled = false;
        $('net-status').textContent = '';
        break;
      case 'lobby':
        room.players = msg.players; room.cfg = msg.cfg; room.code = msg.code;
        if (!G.running) renderLobby();
        break;
      case 'full':
        $('join-btn').disabled = false;
        $('net-status').textContent = `This game is full (${MAX_PLAYERS} players).`;
        break;
      case 'start':
        guest.lastSeq = 0; guest.buffer = []; guest.asked = false;
        room.cfg = msg.cfg;
        G.NET.onLeave = leave;
        G.start({ cfg: msg.cfg, seed: msg.seed, players: msg.players, seat: msg.seat, host: false, send: (a) => net.send({ t: 'act', a }) });
        G.NET.roster = msg.roster || {};
        G.NET.hostStep = msg.step || 0;
        G.renderStandings();
        (msg.log || []).forEach(take);
        break;
      case 'act': take(msg.a); break;
      case 'acts': guest.asked = false; (msg.list || []).forEach(take); break;
      case 'roster': G.NET.roster = msg.roster || {}; G.renderStandings(); break;
      case 'ping': G.NET.hostStep = Math.max(G.NET.hostStep, msg.step || 0); net.send({ t: 'pong' }); break;
      case 'bye': banner('The host ended the game.', true); break;
      default: break;
    }
  }
  /** Decisions arrive numbered; apply them in order and ask again for any that went missing. */
  function take(a) {
    if (!a || !G.running || a.seq <= guest.lastSeq) return;
    if (a.seq > guest.lastSeq + 1) {
      if (!guest.buffer.some((b) => b.seq === a.seq)) guest.buffer.push(a);
      if (!guest.asked) { guest.asked = true; net.send({ t: 'resync', from: guest.lastSeq + 1 }); }
      return;
    }
    guest.lastSeq = a.seq;
    G.receive(a);
    guest.buffer.sort((x, y) => x.seq - y.seq);
    while (guest.buffer.length && guest.buffer[0].seq <= guest.lastSeq + 1) {
      const b = guest.buffer.shift();
      if (b.seq === guest.lastSeq + 1) { guest.lastSeq = b.seq; G.receive(b); }
    }
  }

  /* ---------- leaving ---------- */
  function leave() {
    if (net) {
      try { net.broadcast ? net.broadcast({ t: 'bye' }) : net.send({ t: 'leave' }); } catch (e) { /* ignore */ }
      const n = net;
      setTimeout(() => { try { n.close(); } catch (e) { /* ignore */ } }, 200);
      net = null;
    }
    clearInterval(pingTimer);
    location.href = location.pathname; // back to a clean setup screen
  }
})();
