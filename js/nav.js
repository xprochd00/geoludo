/* GeoGames top bar, the same on every page: "← Home", the GeoGames logo (also home), a Games menu and a
 * Feedback form. It hides itself while a game is being played (see css/nav.css), so the map keeps the
 * room on phones; each game has its own menu button there.
 * Needs js/dialog.js (Dialog.menu) for the Games menu. Load it after dialog.js on every page. */
(function () {
  const ROOT = new URL('..', document.currentScript.src); // the site's root (this file is in js/)
  const GAMES = [
    { id: 'ludo', icon: '🎲', name: 'Geo Ludo', path: 'ludo/', note: 'Roll, answer, race round the board' },
    { id: 'voyage', icon: '⛵', name: 'Geo Voyage', path: 'voyage.html', note: 'Sail around the world' },
    { id: 'timetravel', icon: '⏳', name: 'Geo Time Travel', path: 'timetravel.html', note: 'From prehistory to today' },
    { id: 'train', icon: '🎯', name: 'Training', path: 'train.html', note: 'Practise on your own' },
  ];
  // Feedback goes to a new GitHub issue (prefilled); the text can also be copied, e.g. into an e-mail.
  const FEEDBACK_REPO = 'xprochd00/geoludo';
  const url = (p) => new URL(p, ROOT).href;
  const here = location.pathname;
  const current = GAMES.find((g) => here.endsWith('/' + g.path) || (g.path.endsWith('/') && here.includes('/' + g.path))) || null;

  const nav = document.createElement('nav');
  nav.className = 'gg-nav';
  nav.setAttribute('aria-label', 'GeoGames');
  nav.innerHTML = `
    <a class="gg-home" href="${url('index.html')}">← Home</a>
    <a class="gg-logo" href="${url('index.html')}" aria-label="GeoGames home"><span aria-hidden="true">🌍</span> Geo<b>Games</b></a>
    <div class="gg-right">
      <button type="button" class="gg-btn gg-games" aria-haspopup="listbox">${current ? `${current.icon} <span class="gg-cur">${current.name}</span>` : '🎮 <span class="gg-cur">Games</span>'} ▾</button>
      <button type="button" class="gg-btn gg-fb" title="Send feedback: bugs, wrong information, ideas">💬<span class="gg-fb-text"> Feedback</span></button>
    </div>`;
  document.body.prepend(nav);

  nav.querySelector('.gg-games').addEventListener('click', async (e) => {
    const items = [{ value: 'index.html', label: '🏠 All games', note: 'GeoGames home' },
      ...GAMES.map((g) => ({ value: g.path, label: `${g.icon} ${g.name}`, note: g.note }))];
    const v = await Dialog.menu(e.currentTarget, items, current ? current.path : 'index.html');
    if (v != null && (!current || v !== current.path)) location.href = url(v);
  });
  nav.querySelector('.gg-fb').addEventListener('click', openFeedback);

  /* ---------- Feedback form ---------- */
  const KINDS = [
    ['bug', '🐞 Bug or technical problem'],
    ['wrong', '❗ Wrong or inconsistent information'],
    ['idea', '💡 Suggestion to improve a game'],
    ['general', '💬 General feedback'],
  ];
  function openFeedback() {
    if (document.querySelector('.gg-feedback')) return;
    const wrap = document.createElement('div');
    wrap.className = 'overlay gg-feedback';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `<form class="win-card gg-fb-card">
      <h2>💬 Feedback</h2>
      <p>Found a bug, a wrong answer, or have an idea? Tell us.</p>
      <div class="gg-kinds" role="radiogroup" aria-label="Kind of feedback">
        ${KINDS.map(([k, label], i) => `<label class="gg-kind"><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}><span>${label}</span></label>`).join('')}
      </div>
      <div class="gg-field"><span>Game</span><div class="gg-games-pick" role="radiogroup" aria-label="Game">
        <label class="gg-kind small"><input type="radio" name="game" value="" ${current ? '' : 'checked'}><span>Any</span></label>
        ${GAMES.map((g) => `<label class="gg-kind small"><input type="radio" name="game" value="${g.id}" ${current && current.id === g.id ? 'checked' : ''}><span>${g.icon} ${g.name}</span></label>`).join('')}
      </div></div>
      <label class="gg-field"><span>What happened, or what would you like?</span>
        <textarea name="msg" rows="5" required placeholder="For a wrong answer, please quote the question."></textarea></label>
      <p class="gg-fb-note">Sending opens a prefilled report on GitHub (a free account is needed). No account? Use <b>Copy text</b> and send it any way you like.</p>
      <div class="win-actions">
        <button type="button" class="btn-ghost" data-act="cancel">Cancel</button>
        <button type="button" class="btn-ghost" data-act="copy">Copy text</button>
        <button type="submit" class="btn-primary">Send ↗</button>
      </div>
    </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    const report = () => {
      const kind = KINDS.find(([k]) => k === form.kind.value);
      const game = GAMES.find((g) => g.id === form.game.value);
      const msg = form.msg.value.trim();
      const title = `${kind[1].replace(/^\S+\s/, '')}${game ? ` · ${game.name}` : ''}: ${msg.split('\n')[0].slice(0, 60)}`;
      const body = `**Kind:** ${kind[1]}\n**Game:** ${game ? game.name : 'any'}\n**Page:** ${location.href}\n**Browser:** ${navigator.userAgent}\n\n${msg}`;
      return { title, body };
    };
    const needText = () => { if (form.msg.value.trim()) return true; form.msg.focus(); form.msg.reportValidity(); return false; };
    form.querySelector('[data-act="cancel"]').addEventListener('click', close);
    form.querySelector('[data-act="copy"]').addEventListener('click', (e) => {
      if (!needText()) return;
      const r = report();
      const btn = e.currentTarget;
      const text = `${r.title}\n\n${r.body}`;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { btn.textContent = 'Copied ✓'; }, () => { btn.textContent = 'Copy failed'; });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!needText()) return;
      const r = report();
      const link = `https://github.com/${FEEDBACK_REPO}/issues/new?labels=feedback&title=${encodeURIComponent(r.title)}&body=${encodeURIComponent(r.body)}`;
      window.open(link, '_blank', 'noopener');
      form.innerHTML = '<h2>Thank you! 🙌</h2><p>Your report opened in a new tab: check it and press “Create” there to send it.</p><div class="win-actions"><button type="button" class="btn-primary">Close</button></div>';
      form.querySelector('button').addEventListener('click', close);
    });
    form.msg.focus();
  }

  window.GeoGames = { GAMES, url, openFeedback };
})();
