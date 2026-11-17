/* Online rooms over WebRTC (PeerJS). The host's browser is the room: guests connect to it directly;
 * the public PeerJS server is only used to introduce them. No server of our own is needed, so the game
 * still works from GitHub Pages.
 *
 *   Net.host({ onReady(code), onOpen(conn), onMessage(conn, msg), onClose(conn), onError(text) })
 *   Net.join(code, { onOpen(), onMessage(msg), onClose(), onReconnecting(), onError(text) })
 *
 * For local testing, a private PeerServer can be used: ?peerhost=localhost&peerport=9000
 */
(function () {
  const PREFIX = 'geoludo-voyage-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const randomCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

  function peerOptions() {
    const q = new URLSearchParams(location.search);
    const opts = { debug: 1 };
    if (q.get('peerhost')) {
      opts.host = q.get('peerhost');
      opts.port = +(q.get('peerport') || 9000);
      opts.path = q.get('peerpath') || '/';
      opts.secure = q.get('peersecure') === '1';
    }
    return opts;
  }

  const ERR = {
    'peer-unavailable': 'That room does not exist (any more). Ask the host for a new link.',
    'network': 'Network problem: check your internet connection.',
    'server-error': 'The connection service is not reachable right now. Try again in a minute.',
    'socket-error': 'The connection service is not reachable right now. Try again in a minute.',
    'browser-incompatible': 'This browser does not support online play. Try Chrome, Safari or Firefox.',
    'webrtc': 'Could not connect directly to the other device (strict network or firewall).',
  };
  const errText = (e) => ERR[e && e.type] || `Connection error${e && e.type ? ` (${e.type})` : ''}.`;

  function send(conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { /* closed */ }
  }

  /* ---------------- host ---------------- */
  function host(h, attempt = 0) {
    const code = randomCode();
    const peer = new Peer(PREFIX + code, peerOptions());
    const conns = new Set();
    let ready = false;
    let closed = false;
    peer.on('open', () => { ready = true; h.onReady && h.onReady(code); });
    peer.on('connection', (conn) => {
      conn.on('open', () => { conns.add(conn); h.onOpen && h.onOpen(conn); });
      conn.on('data', (msg) => h.onMessage && h.onMessage(conn, msg));
      conn.on('close', () => { conns.delete(conn); h.onClose && h.onClose(conn); });
      conn.on('error', () => { conns.delete(conn); h.onClose && h.onClose(conn); });
    });
    // Losing the link to the introduction server doesn't break existing games; try to get it back
    // so that new and returning guests can still find the room.
    peer.on('disconnected', () => { if (!closed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* ignore */ } }, 1500); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && !ready && attempt < 4) { peer.destroy(); host(h, attempt + 1); return; } // code taken: new code
      if (!ready) h.onError && h.onError(errText(e));
    });
    const api = {
      get code() { return code; },
      broadcast(msg) { conns.forEach((c) => send(c, msg)); },
      sendTo: send,
      close() { closed = true; try { peer.destroy(); } catch (e) { /* ignore */ } },
    };
    h.api = api;
    return api;
  }

  /* ---------------- guest ---------------- */
  function join(code, h) {
    const peer = new Peer(peerOptions());
    let conn = null;
    let closed = false;
    let everOpen = false;
    let retries = 0;
    let lastSeen = Date.now();
    let watchdog = null;

    function connect() {
      if (closed) return;
      conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        everOpen = true;
        retries = 0;
        lastSeen = Date.now();
        h.onOpen && h.onOpen();
      });
      conn.on('data', (msg) => {
        lastSeen = Date.now();
        if (msg && msg.t === 'ping') { send(conn, { t: 'pong' }); return; }
        h.onMessage && h.onMessage(msg);
      });
      conn.on('close', lost);
      conn.on('error', lost);
    }
    function lost() {
      if (closed) return;
      if (!everOpen) return; // the first attempt is reported through peer 'error'
      if (retries >= 8) { h.onClose && h.onClose(); return; }
      retries++;
      h.onReconnecting && h.onReconnecting();
      setTimeout(() => {
        if (closed) return;
        try { if (peer.disconnected) peer.reconnect(); } catch (e) { /* ignore */ }
        connect();
      }, Math.min(8000, 1000 * retries));
    }
    peer.on('open', connect);
    peer.on('error', (e) => {
      if (!everOpen) { h.onError && h.onError(errText(e)); return; }
      if (e.type === 'peer-unavailable') lost();
    });
    peer.on('disconnected', () => { if (!closed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* ignore */ } }, 1500); });
    // The host pings every few seconds; silence means the link died without a 'close' event.
    watchdog = setInterval(() => {
      if (everOpen && !closed && Date.now() - lastSeen > 15000) { lastSeen = Date.now(); try { conn.close(); } catch (e) { /* ignore */ } lost(); }
    }, 3000);
    return {
      send(msg) { send(conn, msg); },
      close() { closed = true; clearInterval(watchdog); try { peer.destroy(); } catch (e) { /* ignore */ } },
    };
  }

  const supported = () => typeof Peer === 'function' && 'RTCPeerConnection' in window;

  window.Net = { host, join, supported, randomCode };
})();
