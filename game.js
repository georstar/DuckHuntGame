// Duck Hunt — a dependency-free HTML5 Canvas game.
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = 430;   // top of the grass line
  const HUD_Y = 520;      // top of the HUD bar

  const WAVES_PER_ROUND = 10;
  const SHOTS_PER_WAVE = 3;
  const DUCK_TYPES = [
    { name: 'black', body: '#2b2b2b', wing: '#555', belly: '#7a5230', points: 500, speed: 1.0 },
    { name: 'blue',  body: '#2457c5', wing: '#6b8fe0', belly: '#c9a46b', points: 1000, speed: 1.25 },
    { name: 'red',   body: '#b5301f', wing: '#e0705a', belly: '#e6c48a', points: 1500, speed: 1.5 },
  ];

  // ---------- Layout / input ----------
  function fit() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
  }
  window.addEventListener('resize', fit);
  fit();

  const mouse = { x: W / 2, y: H / 2 };
  function toGame(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
  }
  canvas.addEventListener('mousemove', e => Object.assign(mouse, toGame(e.clientX, e.clientY)));
  canvas.addEventListener('mousedown', e => {
    Object.assign(mouse, toGame(e.clientX, e.clientY));
    onShoot();
  });
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    Object.assign(mouse, toGame(t.clientX, t.clientY));
    onShoot();
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (state !== 'title' && state !== 'gameOver') paused = !paused;
    } else if (e.key === 'm' || e.key === 'M') {
      muted = !muted;
    } else if ((e.key === ' ' || e.key === 'Enter') && (state === 'title' || state === 'gameOver')) {
      onShoot();
    }
  });

  // ---------- Audio (synthesized, no assets) ----------
  let audio = null;
  let muted = false;
  function ac() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function tone(freq, dur, type = 'square', vol = 0.15, slideTo = null, delay = 0) {
    if (muted) return;
    const a = ac();
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  const sfx = {
    shot() {
      if (muted) return;
      const a = ac();
      const len = a.sampleRate * 0.25;
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = a.createBufferSource();
      const g = a.createGain();
      g.gain.value = 0.5;
      src.buffer = buf;
      src.connect(g).connect(a.destination);
      src.start();
    },
    quack() { tone(520, 0.08, 'sawtooth', 0.08, 380); tone(480, 0.1, 'sawtooth', 0.08, 300, 0.1); },
    hit() { tone(900, 0.12, 'square', 0.12, 1400); },
    fall() { tone(1200, 0.8, 'triangle', 0.12, 200); },
    land() { tone(120, 0.15, 'square', 0.15, 60); },
    laugh() { for (let i = 0; i < 5; i++) tone(i % 2 ? 330 : 400, 0.1, 'square', 0.1, null, i * 0.13); },
    gotIt() { [523, 659, 784].forEach((f, i) => tone(f, 0.12, 'square', 0.1, null, i * 0.09)); },
    roundClear() { [523, 587, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, 'square', 0.1, null, i * 0.12)); },
    gameOver() { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.15, null, i * 0.28)); },
    start() { [262, 330, 392, 523, 392, 523].forEach((f, i) => tone(f, 0.13, 'square', 0.1, null, i * 0.11)); },
  };

  // ---------- Game state ----------
  let state = 'title';      // title | intro | flying | dog | roundEnd | gameOver
  let paused = false;
  let stateTime = 0;
  let round = 1;
  let wave = 0;
  let score = 0;
  let shots = SHOTS_PER_WAVE;
  let results = [];         // per-wave: true (hit) / false (miss)
  let duck = null;
  let dog = { mode: 'hidden', x: W / 2, y: GROUND_Y + 40 };
  let flash = 0;            // white screen flash after a shot
  let skyFlash = 0;         // pink sky when a duck escapes
  let popups = [];          // floating score text
  let hiScore = 0;
  try { hiScore = Number(localStorage.getItem('duckhunt.hiscore')) || 0; } catch (_) { /* storage unavailable */ }

  const requiredHits = () => Math.min(9, 6 + Math.floor((round - 1) / 3));
  const roundSpeed = () => 1 + (round - 1) * 0.12;
  const waveDuration = () => Math.max(4, 7 - (round - 1) * 0.3);

  function setState(s) { state = s; stateTime = 0; }

  function newGame() {
    round = 1;
    score = 0;
    startRound();
    sfx.start();
  }

  function startRound() {
    wave = 0;
    results = [];
    dog = { mode: 'sniff', x: -60, y: GROUND_Y - 10 };
    setState('intro');
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function startWave() {
    shots = SHOTS_PER_WAVE;
    const roll = Math.random();
    const type = round < 2 ? DUCK_TYPES[roll < 0.7 ? 0 : 1]
      : DUCK_TYPES[roll < 0.45 ? 0 : roll < 0.8 ? 1 : 2];
    const speed = 170 * type.speed * roundSpeed();
    const angle = rand(-Math.PI * 0.8, -Math.PI * 0.2);
    duck = {
      type,
      x: rand(120, W - 120),
      y: GROUND_Y + 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
      mode: 'fly',        // fly | hit | fall | escape | gone
      t: 0,
      flap: 0,
      turnIn: rand(0.6, 1.6),
      quackIn: rand(0.3, 1),
    };
    dog.mode = 'hidden';
    setState('flying');
  }

  function endWave(hit) {
    results.push(hit);
    wave++;
    dog = { mode: hit ? 'show' : 'laugh', x: hit ? clamp(duck.x, 80, W - 80) : W / 2, y: GROUND_Y + 60 };
    if (hit) sfx.gotIt(); else sfx.laugh();
    setState('dog');
  }

  function finishRound() {
    const hits = results.filter(Boolean).length;
    if (hits >= requiredHits()) {
      if (hits === WAVES_PER_ROUND) {
        score += 10000;
        popups.push({ x: W / 2, y: 200, text: 'PERFECT! +10000', t: 0 });
      }
      sfx.roundClear();
      setState('roundEnd');
    } else {
      sfx.gameOver();
      if (score > hiScore) {
        hiScore = score;
        try { localStorage.setItem('duckhunt.hiscore', String(hiScore)); } catch (_) { /* ignore */ }
      }
      setState('gameOver');
    }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function onShoot() {
    ac();
    if (paused) return;
    if (state === 'title' || (state === 'gameOver' && stateTime > 1.2)) { newGame(); return; }
    if (state !== 'flying' || shots <= 0 || duck.mode !== 'fly') return;
    shots--;
    flash = 0.06;
    sfx.shot();
    const dx = mouse.x - duck.x;
    const dy = mouse.y - duck.y;
    if (dx * dx + dy * dy < 34 * 34 && mouse.y < GROUND_Y) {
      duck.mode = 'hit';
      duck.t = 0;
      const pts = duck.type.points * round;
      score += pts;
      popups.push({ x: duck.x, y: duck.y - 30, text: String(pts), t: 0 });
      sfx.hit();
    } else if (shots === 0) {
      escape();
    }
  }

  function escape() {
    duck.mode = 'escape';
    duck.vx = duck.vx * 0.3;
    duck.vy = -duck.speed * 1.3;
    skyFlash = 1;
  }

  // ---------- Update ----------
  function update(dt) {
    stateTime += dt;
    flash = Math.max(0, flash - dt);
    skyFlash = Math.max(0, skyFlash - dt * 0.6);
    popups = popups.filter(p => (p.t += dt) < 1.2);

    if (state === 'intro') {
      // Dog sniffs across, then leaps into the grass.
      if (stateTime < 2.2) {
        dog.mode = 'sniff';
        dog.x = -60 + stateTime * 160;
        dog.y = GROUND_Y - 10;
      } else if (stateTime < 3.0) {
        const p = (stateTime - 2.2) / 0.8;
        dog.mode = 'jump';
        dog.x = 292 + p * 60;
        dog.y = GROUND_Y - 10 - Math.sin(p * Math.PI) * 110 + p * 60;
      } else {
        startWave();
      }
    } else if (state === 'flying') {
      updateDuck(dt);
    } else if (state === 'dog') {
      // Pop up, hold, drop back down.
      const up = Math.min(1, stateTime / 0.4);
      const down = Math.max(0, (stateTime - 1.4) / 0.4);
      dog.y = GROUND_Y + 60 - 85 * (up - down);
      if (stateTime > 1.9) {
        if (wave >= WAVES_PER_ROUND) finishRound();
        else startWave();
      }
    } else if (state === 'roundEnd') {
      if (stateTime > 2.6) { round++; startRound(); }
    }
  }

  function updateDuck(dt) {
    const d = duck;
    d.t += dt;
    d.flap += dt * (d.mode === 'escape' ? 14 : 10);

    if (d.mode === 'fly') {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      // Bounce off play-area edges.
      if (d.x < 30) { d.x = 30; d.vx = Math.abs(d.vx); }
      if (d.x > W - 30) { d.x = W - 30; d.vx = -Math.abs(d.vx); }
      if (d.y < 30) { d.y = 30; d.vy = Math.abs(d.vy); }
      if (d.y > GROUND_Y - 40 && d.t > 1) { d.y = GROUND_Y - 40; d.vy = -Math.abs(d.vy); }
      // Random direction changes keep it unpredictable.
      d.turnIn -= dt;
      if (d.turnIn <= 0) {
        const a = rand(0, Math.PI * 2);
        d.vx = Math.cos(a) * d.speed;
        d.vy = Math.sin(a) * d.speed * 0.8;
        d.turnIn = rand(0.5, 1.5) / roundSpeed();
      }
      d.quackIn -= dt;
      if (d.quackIn <= 0) { sfx.quack(); d.quackIn = rand(0.8, 1.6); }
      if (d.t > waveDuration()) escape();
    } else if (d.mode === 'hit') {
      if (d.t > 0.45) { d.mode = 'fall'; d.vy = 0; sfx.fall(); }
    } else if (d.mode === 'fall') {
      d.vy += 900 * dt;
      d.y += d.vy * dt;
      if (d.y > GROUND_Y + 20) { d.mode = 'gone'; sfx.land(); endWave(true); }
    } else if (d.mode === 'escape') {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < -60) { d.mode = 'gone'; endWave(false); }
    }
  }

  // ---------- Rendering ----------
  const bg = document.createElement('canvas');
  bg.width = W; bg.height = H;
  const fg = document.createElement('canvas');
  fg.width = W; fg.height = H;
  buildBackground(bg.getContext('2d'));
  buildForeground(fg.getContext('2d'));

  function buildBackground(g) {
    // Tree (left)
    g.fillStyle = '#6b3f1d';
    g.fillRect(70, 170, 34, GROUND_Y - 170);
    g.fillRect(104, 250, 40, 12);
    g.fillRect(40, 215, 34, 10);
    g.fillStyle = '#2f8f2f';
    [[87, 150, 70], [40, 200, 45], [140, 210, 50], [95, 95, 50], [150, 140, 40]].forEach(([x, y, r]) => {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    });
    g.fillStyle = '#3fae3f';
    [[70, 130, 30], [120, 120, 25], [60, 190, 22]].forEach(([x, y, r]) => {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    });
    // Bush (right)
    g.fillStyle = '#2f8f2f';
    [[640, GROUND_Y - 10, 40], [690, GROUND_Y - 30, 50], [740, GROUND_Y - 12, 38]].forEach(([x, y, r]) => {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    });
  }

  function buildForeground(g) {
    // Tall grass
    g.fillStyle = '#4caf28';
    g.fillRect(0, GROUND_Y, W, HUD_Y - GROUND_Y);
    g.fillStyle = '#3d9420';
    for (let x = 0; x < W; x += 10) {
      const h = 14 + ((x * 37) % 23);
      g.beginPath();
      g.moveTo(x, GROUND_Y + 2);
      g.lineTo(x + 5, GROUND_Y - h);
      g.lineTo(x + 10, GROUND_Y + 2);
      g.fill();
    }
    g.fillStyle = '#5fc93a';
    for (let x = 5; x < W; x += 14) {
      const h = 8 + ((x * 53) % 17);
      g.beginPath();
      g.moveTo(x, GROUND_Y + 4);
      g.lineTo(x + 4, GROUND_Y - h);
      g.lineTo(x + 8, GROUND_Y + 4);
      g.fill();
    }
    // Dirt strip
    g.fillStyle = '#8a5a2b';
    g.fillRect(0, GROUND_Y + 50, W, HUD_Y - GROUND_Y - 50);
    g.fillStyle = '#6e4520';
    for (let i = 0; i < 60; i++) g.fillRect((i * 97) % W, GROUND_Y + 54 + ((i * 13) % 32), 6, 4);
  }

  function drawSky() {
    const pink = skyFlash > 0 && Math.floor(stateTime * 10) % 2 === 0;
    ctx.fillStyle = pink ? '#ffb3c6' : '#63adff';
    ctx.fillRect(0, 0, W, GROUND_Y + 10);
    // Drifting clouds
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const t = performance.now() / 1000;
    [[0, 70, 1], [300, 130, 0.7], [560, 50, 1.2]].forEach(([ox, y, s]) => {
      const x = ((ox + t * 12 * s) % (W + 200)) - 100;
      cloud(x, y, s);
    });
  }

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
    ctx.arc(x + 25 * s, y - 10 * s, 26 * s, 0, Math.PI * 2);
    ctx.arc(x + 52 * s, y, 22 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDuck(d) {
    if (!d || d.mode === 'gone') return;
    const c = d.type;
    ctx.save();
    ctx.translate(d.x, d.y);

    if (d.mode === 'hit') {
      // Startled pose, facing the player.
      body(c, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-4, -26, 8, 8);
      ctx.restore();
      return;
    }
    if (d.mode === 'fall') {
      ctx.rotate(Math.PI / 2 + Math.sin(d.t * 30) * 0.3);
      body(c, 0);
      ctx.restore();
      return;
    }

    const facing = d.vx >= 0 ? 1 : -1;
    ctx.scale(facing, 1);
    const tilt = d.mode === 'escape' ? -0.5 : clamp(d.vy / d.speed, -0.6, 0.6) * 0.5;
    ctx.rotate(tilt);
    body(c, Math.sin(d.flap));
    ctx.restore();
  }

  function body(c, wingPhase) {
    // Tail
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(-22, -2); ctx.lineTo(-34, -8); ctx.lineTo(-30, 4); ctx.closePath(); ctx.fill();
    // Body
    ctx.beginPath(); ctx.ellipse(0, 0, 24, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.belly;
    ctx.beginPath(); ctx.ellipse(2, 6, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    // Neck ring + head
    ctx.fillStyle = '#1f7a3a';
    ctx.beginPath(); ctx.arc(22, -14, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(14, -6, 12, 3);
    // Eye
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(25, -17, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(26, -17, 1.8, 0, Math.PI * 2); ctx.fill();
    // Beak
    ctx.fillStyle = '#f2a33a';
    ctx.beginPath(); ctx.moveTo(31, -15); ctx.lineTo(43, -11); ctx.lineTo(31, -9); ctx.closePath(); ctx.fill();
    // Wing
    ctx.fillStyle = c.wing;
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(10, -4);
    ctx.lineTo(-4, -4 - 26 * wingPhase);
    ctx.closePath();
    ctx.fill();
  }

  function drawDog() {
    if (dog.mode === 'hidden') return;
    ctx.save();
    ctx.translate(dog.x, dog.y);
    const brown = '#b5793f';
    const dark = '#6b3f1d';
    const t = stateTime;

    if (dog.mode === 'sniff' || dog.mode === 'jump') {
      // Side view, walking right.
      const step = dog.mode === 'sniff' ? Math.sin(t * 14) * 4 : 0;
      ctx.fillStyle = brown;
      ctx.beginPath(); ctx.ellipse(0, 0, 34, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-26, 8, 8, 22 + step); ctx.fillRect(16, 8, 8, 22 - step);
      ctx.beginPath(); ctx.arc(36, -16 + (dog.mode === 'sniff' ? 10 : 0), 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(28, -10 + (dog.mode === 'sniff' ? 10 : 0), 7, 14, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(52, -14 + (dog.mode === 'sniff' ? 10 : 0), 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = brown;
      ctx.fillRect(-40, -14, 10, 5);
      ctx.restore();
      return;
    }

    // Front view popping out of the grass.
    const bob = dog.mode === 'laugh' ? Math.sin(t * 25) * 3 : 0;
    ctx.translate(0, bob);
    ctx.fillStyle = brown;
    ctx.fillRect(-26, 0, 52, 60);                         // torso
    ctx.beginPath(); ctx.arc(0, -10, 28, 0, Math.PI * 2); ctx.fill();   // head
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-28, -6, 9, 20, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(28, -6, 9, 20, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0d9b5';
    ctx.beginPath(); ctx.ellipse(0, 4, 16, 12, 0, 0, Math.PI * 2); ctx.fill();   // muzzle
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(0, -2, 5, 0, Math.PI * 2); ctx.fill();   // nose
    if (dog.mode === 'laugh') {
      // Squinting eyes + open mouth
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-15, -18); ctx.lineTo(-7, -14); ctx.moveTo(15, -18); ctx.lineTo(7, -14); ctx.stroke();
      ctx.fillStyle = '#8b1a1a';
      ctx.beginPath(); ctx.ellipse(0, 11, 8, 5 + Math.abs(bob), 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-10, -16, 3.5, 0, Math.PI * 2); ctx.arc(10, -16, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 6, 7, 0.2, Math.PI - 0.2); ctx.stroke();
      // Holding the duck up in one paw
      ctx.fillStyle = brown;
      ctx.fillRect(26, -30, 12, 40);
      ctx.save();
      ctx.translate(40, -48);
      ctx.rotate(Math.PI / 2);
      ctx.scale(0.8, 0.8);
      body(duck ? duck.type : DUCK_TYPES[0], 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function text(str, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `bold ${size}px "Courier New", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function box(x, y, w, h) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#7cfc00';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }

  function drawHUD() {
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(0, HUD_Y, W, H - HUD_Y);

    // Shots
    box(20, HUD_Y + 14, 100, 62);
    for (let i = 0; i < SHOTS_PER_WAVE; i++) {
      ctx.fillStyle = i < shots ? '#f2a33a' : '#333';
      ctx.fillRect(38 + i * 24, HUD_Y + 24, 12, 24);
      ctx.fillStyle = i < shots ? '#c0392b' : '#333';
      ctx.fillRect(38 + i * 24, HUD_Y + 44, 12, 6);
    }
    text('SHOT', 70, HUD_Y + 64, 16, '#7cfc00');

    // Hit tracker
    box(140, HUD_Y + 14, 420, 62);
    text('HIT', 172, HUD_Y + 34, 16, '#7cfc00');
    for (let i = 0; i < WAVES_PER_ROUND; i++) {
      const x = 210 + i * 33;
      const blink = i === results.length && state === 'flying' && Math.floor(stateTime * 4) % 2 === 0;
      ctx.fillStyle = results[i] === true ? '#e74c3c' : results[i] === false ? '#555' : blink ? '#000' : '#fff';
      ctx.beginPath(); ctx.ellipse(x + 12, HUD_Y + 34, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 22, HUD_Y + 28, 5, 0, Math.PI * 2); ctx.fill();
    }
    // Required-hits bar
    const req = requiredHits();
    ctx.fillStyle = '#2f6fff';
    for (let i = 0; i < req; i++) ctx.fillRect(210 + i * 33, HUD_Y + 54, 26, 8);

    // Score
    box(580, HUD_Y + 14, 200, 62);
    text(String(score).padStart(6, '0'), 680, HUD_Y + 36, 24);
    text('SCORE', 680, HUD_Y + 62, 16, '#7cfc00');

    // Round label in the sky corner
    text(`R=${round}`, 40, 24, 18, '#fff', 'left');
    text(`HI ${hiScore}`, W - 20, 24, 18, '#fff', 'right');
    if (muted) text('MUTED', W / 2, 24, 14, '#ddd');
  }

  function drawCrosshair() {
    const { x, y } = mouse;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.moveTo(x - 24, y); ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y); ctx.lineTo(x + 24, y);
    ctx.moveTo(x, y - 24); ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 24);
    ctx.stroke();
  }

  function drawOverlay() {
    if (state === 'title') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
      text('DUCK HUNT', W / 2, 170, 80, '#f2a33a');
      text('Click to start', W / 2, 270, 28);
      text('Aim with the mouse · click to shoot · 3 shots per duck', W / 2, 330, 18, '#ddd');
      text(`Hit enough ducks each round to advance · P pause · M mute`, W / 2, 360, 18, '#ddd');
      if (hiScore) text(`HIGH SCORE ${hiScore}`, W / 2, 420, 22, '#7cfc00');
    } else if (state === 'intro' && stateTime < 2.2) {
      box(W / 2 - 110, 140, 220, 80);
      text('ROUND', W / 2, 165, 26);
      text(String(round), W / 2, 197, 30);
    } else if (state === 'flying' && duck && duck.mode === 'escape') {
      box(W / 2 - 110, 150, 220, 56);
      text('FLY AWAY', W / 2, 178, 28);
    } else if (state === 'roundEnd') {
      box(W / 2 - 160, 140, 320, 90);
      text('ROUND CLEAR!', W / 2, 172, 30, '#7cfc00');
      text(`${results.filter(Boolean).length}/${WAVES_PER_ROUND} ducks`, W / 2, 205, 20);
    } else if (state === 'gameOver') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      text('GAME OVER', W / 2, 180, 64, '#e74c3c');
      text(`Score ${score}`, W / 2, 250, 28);
      text(`High score ${hiScore}`, W / 2, 290, 22, '#7cfc00');
      if (stateTime > 1.2) text('Click to play again', W / 2, 350, 24);
    }
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      text('PAUSED', W / 2, H / 2 - 40, 48);
      text('Press P to resume', W / 2, H / 2 + 10, 20);
    }
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t / 1.2;
      text(p.text, p.x, p.y - p.t * 40, 20);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    drawSky();
    ctx.drawImage(bg, 0, 0);
    // The dog rises from behind the grass, so draw it before the foreground —
    // except when sniffing/jumping in front of it during the intro.
    const dogInFront = dog.mode === 'sniff' || (dog.mode === 'jump' && stateTime < 2.6);
    if (!dogInFront) drawDog();
    drawDuck(duck && state === 'flying' ? duck : null);
    ctx.drawImage(fg, 0, 0);
    if (dogInFront) drawDog();
    drawHUD();
    drawOverlay();
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, 0, W, GROUND_Y);
    }
    drawCrosshair();
  }

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
