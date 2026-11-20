/* Online rooms through a public message relay (MQTT over secure WebSocket).
 *
 * Why a relay: direct browser-to-browser links (WebRTC) often fail between a PC on Wi-Fi and a phone on
 * mobile data. A relay is reached over an ordinary secure WebSocket, which works on practically any
 * network. The host's browser still runs the game; the relay only passes JSON messages along.
 *
 *   Net.host({ onReady(code, relayKey), onMessage(conn, msg), onClose(conn), onError(text) })
 *     -> { code, relay, broadcast(msg), sendTo(conn, msg), close() }
 *   Net.join(code, relayKey, { onOpen(), onMessage(msg), onReconnecting(), onClose(), onError(text) })
 *     -> { send(msg), close() }
 *
 * The free public brokers below are tried in order; the one the host uses goes into the invitation link.
 * For local testing: ?relay=ws://127.0.0.1:8888
 */
(function () {
  const RELAYS = [
    { key: 'emqx', url: 'wss://broker.emqx.io:8084/mqtt' },
    { key: 'hivemq', url: 'wss://broker.hivemq.com:8884/mqtt' },
    { key: 'eclipse', url: 'wss://mqtt.eclipseprojects.io:443/mqtt' },
    { key: 'mosquitto', url: 'wss://test.mosquitto.org:8081/' },
  ];
  const TOPIC = window.NET_TOPIC || 'geoludo/voyage/v2/'; // a page may set its own channel (Time Travel)
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const randomCode = (n = 5) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  const params = new URLSearchParams(location.search);

  function relayList(preferred) {
    if (params.get('relay')) return [{ key: 'custom', url: params.get('relay') }];
    if (!preferred) return RELAYS;
    const r = RELAYS.find((x) => x.key === preferred);
    return r ? [r] : RELAYS;
  }

  /* ---------------- a minimal MQTT 3.1.1 client (QoS 0) over WebSocket ---------------- */
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  function str(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  function packet(type, flags, body) {
    const len = [];
    let n = body.length;
    do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
    return new Uint8Array([(type << 4) | flags, ...len, ...body]);
  }

  /**
   * opts: { url, clientId, will: { topic, payload }, onMessage(topic, text), onConnect(), onDrop() }
   * Resolves once connected; rejects if the first connection fails within `timeout` ms.
   */
  function mqtt(opts, timeout = 7000) {
    let ws = null;
    let buf = new Uint8Array(0);
    let pid = 1;
    let pingTimer = null;
    let closed = false;
    let connected = false;
    const subs = new Set();

    function send(bytes) { if (ws && ws.readyState === 1) ws.send(bytes); }
    function subscribe(topic) {
      subs.add(topic);
      if (!connected) return;
      pid = (pid % 65535) + 1;
      send(packet(8, 2, [pid >> 8, pid & 255, ...str(topic), 0]));
    }
    function publish(topic, text) {
      if (!connected) return false;
      send(packet(3, 0, [...str(topic), ...enc.encode(text)]));
      return true;
    }
    function onData(chunk) {
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf); merged.set(chunk, buf.length);
      buf = merged;
      for (;;) {
        if (buf.length < 2) return;
        let mult = 1, len = 0, i = 1, d;
        do {
          if (i >= buf.length) return; // header incomplete
          d = buf[i++]; len += (d & 127) * mult; mult *= 128;
        } while (d & 128);
        if (buf.length < i + len) return; // body incomplete
        const type = buf[0] >> 4;
        const qos = (buf[0] >> 1) & 3;
        const body = buf.subarray(i, i + len);
        buf = buf.slice(i + len);
        if (type === 2) { // CONNACK
          if (body[1] !== 0) { fail(new Error('refused')); return; }
          connected = true;
          subs.forEach((t) => { subs.delete(t); subscribe(t); });
          opts.onConnect && opts.onConnect();
        } else if (type === 3) { // PUBLISH
          const tl = (body[0] << 8) | body[1];
          const topic = dec.decode(body.subarray(2, 2 + tl));
          // (we subscribe with QoS 0, so no packet id follows the topic; skip it if a broker sends one)
          opts.onMessage && opts.onMessage(topic, dec.decode(body.subarray(2 + tl + (qos ? 2 : 0))));
        }
      }
    }
    let firstResolve, firstReject, settled = false;
    function fail(e) { if (!settled) { settled = true; firstReject(e); } try { ws.close(); } catch (x) { /* ignore */ } }
    let retry = 0;
    function open() {
      if (closed) return;
      buf = new Uint8Array(0);
      connected = false;
      try { ws = new WebSocket(opts.url, ['mqtt']); } catch (e) { fail(e); return; }
      ws.binaryType = 'arraybuffer';
      const startTimer = setTimeout(() => { if (!connected) fail(new Error('timeout')); }, timeout);
      ws.onopen = () => {
        const flags = 0x02 | (opts.will ? 0x04 : 0); // clean session (+ last will)
        const body = [...str('MQTT'), 4, flags, 0, 30, ...str(opts.clientId)];
        if (opts.will) body.push(...str(opts.will.topic), ...str(opts.will.payload));
        ws.send(packet(1, 0, body));
      };
      ws.onmessage = (ev) => {
        const wasConnected = connected;
        onData(new Uint8Array(ev.data));
        if (!wasConnected && connected) {
          clearTimeout(startTimer);
          retry = 0;
          if (!settled) { settled = true; firstResolve(api); }
        }
      };
      ws.onclose = () => {
        clearTimeout(startTimer);
        const was = connected;
        connected = false;
        if (!settled) { fail(new Error('closed')); return; }
        if (closed) return;
        if (was) opts.onDrop && opts.onDrop();
        retry++;
        setTimeout(open, Math.min(8000, 800 * retry)); // reconnect; subscriptions are restored
      };
      ws.onerror = () => { /* followed by onclose */ };
    }
    pingTimer = setInterval(() => { if (connected) send(new Uint8Array([0xc0, 0])); }, 20000);
    const api = {
      subscribe, publish,
      get connected() { return connected; },
      close() { closed = true; clearInterval(pingTimer); if (connected) send(new Uint8Array([0xe0, 0])); try { ws.close(); } catch (e) { /* ignore */ } },
    };
    return new Promise((resolve, reject) => { firstResolve = resolve; firstReject = reject; open(); });
  }

  /** Connect to the first relay that answers. */
  async function connectAny(list, base) {
    let lastErr = null;
    for (const relay of list) {
      try {
        const client = await mqtt({ ...base, url: relay.url });
        return { client, relay };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no relay');
  }

  const clientId = () => 'gl' + Math.random().toString(36).slice(2, 12);
  const NO_RELAY = 'Could not reach any online relay server. Check the internet connection, or try another network (some school or office Wi-Fi blocks them).';

  /* ---------------- host ---------------- */
  function host(h) {
    const code = randomCode();
    const base = TOPIC + code + '/';
    const conns = new Map(); // clientId -> conn
    let client = null;
    let relayKey = null;
    const api = {
      get code() { return code; },
      get relay() { return relayKey; },
      broadcast(msg) { client && client.publish(base + 'all', JSON.stringify(msg)); },
      sendTo(conn, msg) { if (client && conn && !conn.closed) client.publish(base + 'c/' + conn.id, JSON.stringify(msg)); },
      close() { if (client) { client.publish(base + 'all', JSON.stringify({ t: 'bye' })); setTimeout(() => client.close(), 150); } },
    };
    function connFor(id) {
      let c = conns.get(id);
      if (!c) {
        c = { id, closed: false, close() { if (!this.closed) { this.closed = true; conns.delete(id); h.onClose && h.onClose(this); } } };
        conns.set(id, c);
      }
      return c;
    }
    connectAny(relayList(null), {
      clientId: clientId(),
      onMessage(topic, text) {
        let env;
        try { env = JSON.parse(text); } catch (e) { return; }
        if (!env || typeof env.f !== 'string') return;
        if (env.m && env.m.t === 'gone') { const c = conns.get(env.f); if (c) c.close(); return; } // guest's last will
        const c = connFor(env.f);
        h.onMessage && h.onMessage(c, env.m);
      },
    }).then(({ client: cl, relay }) => {
      client = cl;
      relayKey = relay.key;
      client.subscribe(base + 'h');
      h.onReady && h.onReady(code, relayKey);
    }).catch(() => { h.onError && h.onError(NO_RELAY); });
    return api;
  }

  /* ---------------- guest ---------------- */
  function join(code, relayKey, h) {
    const id = clientId();
    const base = TOPIC + code.toUpperCase() + '/';
    let client = null;
    let closed = false;
    let lastHost = Date.now();
    let waiting = false;
    const toHost = (m) => client && client.publish(base + 'h', JSON.stringify({ f: id, m }));
    connectAny(relayList(relayKey), {
      clientId: id,
      will: { topic: base + 'h', payload: JSON.stringify({ f: id, m: { t: 'gone' } }) },
      onConnect() { if (client) { lastHost = Date.now(); h.onOpen && h.onOpen(); } },
      onDrop() { h.onReconnecting && h.onReconnecting(); },
      onMessage(topic, text) {
        let msg;
        try { msg = JSON.parse(text); } catch (e) { return; }
        lastHost = Date.now();
        if (waiting) { waiting = false; h.onBack && h.onBack(); }
        if (msg && msg.t === 'ping') { toHost({ t: 'pong' }); return; }
        h.onMessage && h.onMessage(msg);
      },
    }).then(({ client: cl }) => {
      client = cl;
      client.subscribe(base + 'all');
      client.subscribe(base + 'c/' + id);
      h.onOpen && h.onOpen();
    }).catch(() => { h.onError && h.onError(NO_RELAY); });
    // Tell the host we're here every 5 s (independent of the host's pings, which slow down when the
    // host's tab is in the background).
    const keepAlive = setInterval(() => { if (!closed && client && client.connected) toHost({ t: 'pong' }); }, 5000);
    // The host pings every 5 s; long silence means the host's page is closed or offline.
    const watchdog = setInterval(() => {
      if (!closed && client && Date.now() - lastHost > 20000 && !waiting) { waiting = true; h.onReconnecting && h.onReconnecting('host'); }
    }, 3000);
    return {
      send: toHost,
      close() { closed = true; clearInterval(watchdog); clearInterval(keepAlive); toHost({ t: 'leave' }); setTimeout(() => client && client.close(), 150); },
    };
  }

  const supported = () => 'WebSocket' in window && 'TextEncoder' in window;

  window.Net = { host, join, supported, randomCode, RELAYS };
})();
