/* Small effects toolkit: timing helpers, synthesized sound, confetti and the 3D dice. */
(function () {
  // Global pace: 1 = normal, 0.5 = "fast animations". Scales every animation wait and the CSS durations.
  const pace = { factor: 1 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * pace.factor));
  function setFast(on) {
    pace.factor = on ? 0.5 : 1;
    document.documentElement.style.setProperty('--spd', pace.factor);
  }

  /* ---------- Sound (WebAudio synth, no assets) ---------- */
  const Sound = {
    enabled: true,
    ctx: null,
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.enabled = false; }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur = 0.12, type = 'sine', vol = 0.15, delay = 0, slideTo = null) {
      if (!this.enabled || !this.ensure()) return;
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    },
    roll() { for (let i = 0; i < 9; i++) this.tone(180 + Math.random() * 260, 0.05, 'triangle', 0.08, i * 0.09); },
    step() { this.tone(520, 0.07, 'sine', 0.1); },
    whoosh() { this.tone(200, 0.6, 'sawtooth', 0.03, 0, 900); },
    correct() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.14, i * 0.09)); },
    wrong() { this.tone(220, 0.25, 'square', 0.06); this.tone(160, 0.35, 'square', 0.06, 0.18); },
    capture() { this.tone(900, 0.5, 'sawtooth', 0.06, 0, 120); },
    tick() { this.tone(1200, 0.04, 'square', 0.03); },
    win() {
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.14, i * 0.13));
    },
  };

  /* ---------- Confetti ---------- */
  const Confetti = (() => {
    const canvas = document.getElementById('confetti');
    const ctx = canvas.getContext('2d');
    let parts = [];
    let running = false;
    const colors = ['#ef476f', '#ffd166', '#06d6a0', '#3a86ff', '#ffffff', '#ff9f1c'];
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    addEventListener('resize', resize);
    resize();
    function burst(x, y, n = 80, spread = 1) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (4 + Math.random() * 8) * spread;
        parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, r: 4 + Math.random() * 5,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0],
          life: 120 + Math.random() * 60, shape: Math.random() < 0.5 ? 0 : 1,
        });
      }
      if (!running) { running = true; requestAnimationFrame(loop); }
    }
    function rain(n = 200) {
      for (let i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.8, vx: (Math.random() - 0.5) * 2,
          vy: 2 + Math.random() * 3, r: 4 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
          c: colors[(Math.random() * colors.length) | 0], life: 400, shape: Math.random() < 0.5 ? 0 : 1,
        });
      }
      if (!running) { running = true; requestAnimationFrame(loop); }
    }
    function loop() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
      for (const p of parts) {
        p.vy += 0.18; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.fillStyle = p.c;
        if (p.shape) ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        else { ctx.beginPath(); ctx.arc(0, 0, p.r / 1.4, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      if (parts.length) requestAnimationFrame(loop);
      else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    }
    return { burst, rain };
  })();

  /* ---------- Dice ---------- */
  const Dice = (() => {
    const el = document.getElementById('dice');
    if (!el) return { roll: async () => {}, idle() {} }; // pages without a dice (training)
    // Rotation that brings face n to the front
    const FACE = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
    let spins = 0;
    el.classList.add('idle');
    async function roll(value) {
      el.classList.remove('idle');
      void el.offsetWidth;
      spins += 2;
      const [x, y] = FACE[value];
      const jitterX = (Math.random() - 0.5) * 8;
      const jitterY = (Math.random() - 0.5) * 8;
      el.style.transform = `rotateX(${x + spins * 360 + jitterX}deg) rotateY(${y + spins * 360 + jitterY}deg)`;
      Sound.roll();
      await sleep(1250);
    }
    function idle() {
      el.style.transform = '';
      el.classList.add('idle');
    }
    return { roll, idle };
  })();

  window.FX = { sleep, setFast, pace, Sound, Confetti, Dice };
})();
