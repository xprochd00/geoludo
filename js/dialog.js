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

  window.Dialog = {
    confirm: (o) => show({ cancel: 'Cancel', ...o }),
    alert: (o) => show({ ...o, cancel: null }),
  };
})();
