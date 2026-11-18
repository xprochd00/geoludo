/* In-game dialogs (instead of the browser's confirm/alert), styled like the game's cards.
 *   Dialog.confirm({ title, text, ok: 'Leave', cancel: 'Stay', danger: true }) -> Promise<boolean>
 *   Dialog.alert({ title, text, ok }) -> Promise<void>
 * Keyboard: Enter = confirm, Escape = cancel. Focus starts on the safe choice. */
(function () {
  let open = null;

  function show({ title, text, ok = 'OK', cancel = null, danger = false, icon = '' }) {
    if (open) open.close(false);
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'overlay g-dialog';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML = `<div class="win-card g-dialog-card">
        ${icon ? `<div class="g-dialog-icon">${icon}</div>` : ''}
        <h2></h2><p></p>
        <div class="win-actions">
          ${cancel ? '<button type="button" class="btn-ghost" data-v="0"></button>' : ''}
          <button type="button" class="btn-primary${danger ? ' danger' : ''}" data-v="1"></button>
        </div></div>`;
      wrap.querySelector('h2').textContent = title || '';
      wrap.querySelector('p').textContent = text || '';
      wrap.querySelector('[data-v="1"]').textContent = ok;
      if (cancel) wrap.querySelector('[data-v="0"]').textContent = cancel;
      const prevFocus = document.activeElement;
      const close = (v) => {
        if (!wrap.isConnected) return;
        wrap.remove();
        document.removeEventListener('keydown', onKey, true);
        open = null;
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === 'Enter' && document.activeElement && document.activeElement.dataset.v) { e.preventDefault(); e.stopPropagation(); close(document.activeElement.dataset.v === '1'); }
        else if (e.key === 'Tab') { // keep focus inside the dialog
          const b = [...wrap.querySelectorAll('button')];
          const i = b.indexOf(document.activeElement);
          e.preventDefault();
          b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus();
        } else e.stopPropagation();
      };
      wrap.addEventListener('click', (e) => {
        const v = e.target.closest('button') && e.target.closest('button').dataset.v;
        if (v != null) close(v === '1');
        else if (e.target === wrap && cancel) close(false); // click outside = cancel
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      open = { close };
      (wrap.querySelector(cancel ? '[data-v="0"]' : '[data-v="1"]')).focus();
    });
  }

  /* A list of choices that opens under (or above) a button, in place of a browser drop-down.
   *   Dialog.menu(button, [{ value, label, note }], current) -> Promise<value | null> */
  let openMenu = null, openAnchor = null;
  function menu(anchor, items, current) {
    if (openMenu) {
      const same = openAnchor === anchor;
      openMenu(null);
      if (same) return Promise.resolve(null); // a second tap on the button closes it
    }
    openAnchor = anchor;
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'g-menu';
      box.setAttribute('role', 'listbox');
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.className = 'g-menu-item' + (it.value === current ? ' current' : '');
        b.setAttribute('aria-selected', it.value === current);
        b.dataset.v = it.value;
        b.innerHTML = '<span class="g-menu-label"></span><small></small><i aria-hidden="true">✓</i>';
        b.querySelector('.g-menu-label').textContent = it.label;
        b.querySelector('small').textContent = it.note || '';
        box.appendChild(b);
      });
      document.body.appendChild(box);
      // place it next to the button, inside the screen
      const r = anchor.getBoundingClientRect();
      const w = Math.max(r.width, box.offsetWidth);
      const h = box.offsetHeight;
      const below = innerHeight - r.bottom - 8 >= h || r.top < h + 8;
      box.style.minWidth = w + 'px';
      box.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
      box.style.top = (below ? r.bottom + 6 : r.top - h - 6) + 'px';
      anchor.setAttribute('aria-expanded', 'true');
      const close = (v) => {
        if (!box.isConnected) return;
        box.remove();
        openMenu = null;
        anchor.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', onKey, true);
        removeEventListener('scroll', onScroll, true);
        removeEventListener('resize', onScroll);
        resolve(v);
      };
      const outside = (e) => { if (!box.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(null); };
      // close when the page really scrolls (the button moved), not on a scroll event already under way
      const onScroll = (e) => { if (!box.contains(e.target) && Math.abs(anchor.getBoundingClientRect().top - r.top) > 4) close(null); };
      const opts = () => [...box.querySelectorAll('button')];
      const onKey = (e) => {
        const b = opts();
        const i = b.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); anchor.focus(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); b[(i + (e.key === 'ArrowDown' ? 1 : b.length - 1)) % b.length].focus(); }
        else if (e.key === 'Tab') close(null);
        else e.stopPropagation();
      };
      box.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) { close(items.find((it) => String(it.value) === b.dataset.v).value); anchor.focus(); }
      });
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
      addEventListener('scroll', onScroll, true);
      addEventListener('resize', onScroll);
      openMenu = close;
      (box.querySelector('.current') || box.querySelector('button')).focus({ preventScroll: true });
    });
  }

  window.Dialog = {
    confirm: (o) => show({ cancel: 'Cancel', ...o }),
    alert: (o) => show({ ...o, cancel: null }),
    menu,
  };
})();
