// Duck Hunt — a dependency-free HTML5 Canvas game.
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = 430;   // top of the grass line
  const HUD_Y = 520;      // top of the HUD bar
  const PX = 4;           // pixel-art scale factor

  const DUCKS_PER_ROUND = 10;
  const SHOTS_PER_WAVE = 3;
  const DUCK_TYPES = [
    { name: 'black', body: '#2b2b2b', wing: '#555', belly: '#7a5230', points: 500, speed: 1.0 },
    { name: 'blue',  body: '#2457c5', wing: '#6b8fe0', belly: '#c9a46b', points: 1000, speed: 1.25 },
    { name: 'red',   body: '#b5301f', wing: '#e0705a', belly: '#e6c48a', points: 1500, speed: 1.5 },
  ];
  const DIFFICULTY = {
    easy:   { speed: 0.8,  time: 2,  req: -1 },
    normal: { speed: 1,    time: 0,  req: 0 },
    hard:   { speed: 1.25, time: -1, req: 1 },
  };
  const CROSSHAIRS = ['#e74c3c', '#f1c40f', '#2ecc71', '#00e5ff', '#ffffff'];

  // ---------- Persistence ----------
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (_) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage unavailable */ }
  }

  const settings = Object.assign(
    { sound: true, volume: 0.7, art: 'classic', difficulty: 'normal', crosshair: CROSSHAIRS[0] },
    load('duckhunt.settings', {}),
  );
  let history = load('duckhunt.history', []);
  if (!Array.isArray(history)) history = [];
  let hiScore = Math.max(Number(load('duckhunt.hiscore', 0)) || 0, 0, ...history.map(h => h.score));

  function saveSettings() {
    save('duckhunt.settings', settings);
    if (master) master.gain.value = settings.volume;
    renderSettings();
  }

  // ---------- Layout / input ----------
  const stage = $('stage');
  function fit() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
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
    const k = e.key.toLowerCase();
    if (k === 'm') {
      settings.sound = !settings.sound;
      saveSettings();
    } else if (k === 'escape' && (screen === 'settings' || screen === 'history')) {
      actions[screen === 'settings' ? 'back' : 'home']();
    } else if ((k === 'p' || k === 'escape') && inGame() && (screen === null || screen === 'pause')) {
      togglePause();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && inGame() && !paused) togglePause();
  });

  // ---------- Audio (synthesized, no assets) ----------
  let audio = null;
  let master = null;
  function ac() {
    if (!audio) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      master = audio.createGain();
      master.gain.value = settings.volume;
      master.connect(audio.destination);
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function tone(freq, dur, type = 'square', vol = 0.15, slideTo = null, delay = 0) {
    if (!settings.sound) return;
    const a = ac();
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  const sfx = {
    shot() {
      if (!settings.sound) return;
      const a = ac();
      const len = a.sampleRate * 0.25;
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = a.createBufferSource();
      const g = a.createGain();
      g.gain.value = 0.5;
      src.buffer = buf;
      src.connect(g).connect(master);
      src.start();
    },
    click() { tone(660, 0.05, 'square', 0.08); },
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
  let state = 'menu';       // menu | intro | flying | dog | roundEnd | gameOver
  let paused = false;
  let stateTime = 0;
  let mode = 1;             // ducks per wave
  let difficulty = settings.difficulty;
  let round = 1;
  let wave = 0;
  let score = 0;
  let shots = SHOTS_PER_WAVE;
  let shotsFired = 0;
  let totalHits = 0;
  let results = [];         // per duck this round: true (hit) / false (miss)
  let ducks = [];
  let dog = { mode: 'hidden', x: W / 2, y: GROUND_Y + 40, ducks: [] };
  let flash = 0;            // white screen flash after a shot
  let skyFlash = 0;         // pink sky when a duck escapes
  let popups = [];          // floating score text
  let recorded = false;
  let lastGame = null;

  const diff = () => DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const wavesPerRound = () => DUCKS_PER_ROUND / mode;
  const requiredHits = () => clamp(6 + Math.floor((round - 1) / 3) + diff().req, 3, 10);
  const roundSpeed = () => (1 + (round - 1) * 0.12) * diff().speed;
  const waveDuration = () => Math.max(3.5, 7 - (round - 1) * 0.3 + diff().time + (mode - 1));
  const inGame = () => ['intro', 'flying', 'dog', 'roundEnd'].includes(state);

  function setState(s) { state = s; stateTime = 0; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function newGame(m) {
    mode = m;
    difficulty = settings.difficulty;
    round = 1;
    score = 0;
    shotsFired = 0;
    totalHits = 0;
    recorded = false;
    paused = false;
    popups = [];
    show(null);
    startRound();
    sfx.start();
  }

  function startRound() {
    wave = 0;
    results = [];
    ducks = [];
    dog = { mode: 'sniff', x: -60, y: GROUND_Y - 10, ducks: [] };
    setState('intro');
  }

  function makeDuck(i, n, demo = false) {
    const roll = Math.random();
    const type = round < 2 && !demo ? DUCK_TYPES[roll < 0.7 ? 0 : 1]
      : DUCK_TYPES[roll < 0.45 ? 0 : roll < 0.8 ? 1 : 2];
    const speed = 170 * type.speed * (demo ? 0.8 : roundSpeed());
    const angle = rand(-Math.PI * 0.8, -Math.PI * 0.2);
    const x = n === 1 ? rand(120, W - 120) : i === 0 ? rand(120, W / 2 - 40) : rand(W / 2 + 40, W - 120);
    return {
      type, x, speed,
      y: GROUND_Y + 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      mode: 'fly',        // fly | hit | fall | escape | gone
      result: null,
      t: 0,
      turnIn: rand(0.6, 1.6),
      quackIn: rand(0.3, 1) + i * 0.4,
    };
  }

  function startWave() {
    shots = SHOTS_PER_WAVE;
    ducks = Array.from({ length: mode }, (_, i) => makeDuck(i, mode));
    dog.mode = 'hidden';
    setState('flying');
  }

  function endWave() {
    const hitDucks = ducks.filter(d => d.result);
    ducks.forEach(d => results.push(d.result));
    wave++;
    const last = hitDucks[hitDucks.length - 1];
    dog = {
      mode: hitDucks.length ? 'show' : 'laugh',
      x: last ? clamp(last.x, 100, W - 100) : W / 2,
      y: GROUND_Y + 60,
      ducks: hitDucks.map(d => d.type),
    };
    if (hitDucks.length) sfx.gotIt(); else sfx.laugh();
    setState('dog');
  }

  function finishRound() {
    const hits = results.filter(Boolean).length;
    if (hits >= requiredHits()) {
      if (hits === DUCKS_PER_ROUND) {
        score += 10000;
        popups.push({ x: W / 2, y: 260, text: 'PERFECT! +10000', t: 0 });
      }
      sfx.roundClear();
      setState('roundEnd');
    } else {
      sfx.gameOver();
      recordGame();
      dog = { mode: 'laugh', x: W / 2, y: GROUND_Y + 60, ducks: [] };
      setState('gameOver');
    }
  }

  function recordGame() {
    if (recorded) return;
    recorded = true;
    const isHigh = score > hiScore;
    lastGame = { t: Date.now(), mode, difficulty, round, score, hits: totalHits, shots: shotsFired, isHigh };
    if (shotsFired === 0 && score === 0) return; // nothing worth keeping
    history.unshift({ t: lastGame.t, mode, difficulty, round, score, hits: totalHits, shots: shotsFired });
    history = history.slice(0, 100);
    save('duckhunt.history', history);
    if (isHigh) hiScore = score;
  }

  function onShoot() {
    ac();
    if (paused || state !== 'flying' || shots <= 0 || !ducks.some(d => d.mode === 'fly')) return;
    shots--;
    shotsFired++;
    flash = 0.06;
    sfx.shot();
    let target = null;
    let best = 34 * 34;
    for (const d of ducks) {
      if (d.mode !== 'fly') continue;
      const dist = (mouse.x - d.x) ** 2 + (mouse.y - d.y) ** 2;
      if (dist < best) { best = dist; target = d; }
    }
    if (target && mouse.y < GROUND_Y) {
      target.mode = 'hit';
      target.t = 0;
      totalHits++;
      const pts = target.type.points * round;
      score += pts;
      popups.push({ x: target.x, y: target.y - 30, text: String(pts), t: 0 });
      sfx.hit();
    }
    if (shots === 0) escapeAll();
  }

  function escapeDuck(d) {
    d.mode = 'escape';
    d.vx *= 0.3;
    d.vy = -d.speed * 1.3;
    skyFlash = 1;
  }
  function escapeAll() { ducks.forEach(d => { if (d.mode === 'fly') escapeDuck(d); }); }

  // ---------- Update ----------
  function update(dt) {
    stateTime += dt;
    flash = Math.max(0, flash - dt);
    skyFlash = Math.max(0, skyFlash - dt * 0.6);
    popups = popups.filter(p => (p.t += dt) < 1.2);

    if (state === 'menu') {
      ducks.forEach(d => updateDuck(d, dt, true));
    } else if (state === 'intro') {
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
      ducks.forEach(d => updateDuck(d, dt, false));
      if (stateTime > waveDuration()) escapeAll();
      if (ducks.every(d => d.result !== null)) endWave();
    } else if (state === 'dog') {
      // Pop up, hold, drop back down.
      const up = Math.min(1, stateTime / 0.4);
      const down = Math.max(0, (stateTime - 1.4) / 0.4);
      dog.y = GROUND_Y + 60 - 85 * (up - down);
      if (stateTime > 1.9) {
        if (wave >= wavesPerRound()) finishRound();
        else startWave();
      }
    } else if (state === 'roundEnd') {
      if (stateTime > 2.6) { round++; startRound(); }
    } else if (state === 'gameOver') {
      dog.y = GROUND_Y + 60 - 85 * Math.min(1, stateTime / 0.4);
      if (stateTime > 1.3 && screen !== 'gameover') {
        renderGameOver();
        show('gameover');
      }
    }
  }

  function updateDuck(d, dt, demo) {
    d.t += dt;
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
        d.turnIn = rand(0.5, 1.5) / (demo ? 1 : roundSpeed());
      }
      if (!demo) {
        d.quackIn -= dt;
        if (d.quackIn <= 0) { sfx.quack(); d.quackIn = rand(0.8, 1.6); }
      }
    } else if (d.mode === 'hit') {
      if (d.t > 0.45) { d.mode = 'fall'; d.t = 0; d.vy = 0; sfx.fall(); }
    } else if (d.mode === 'fall') {
      d.vy += 900 * dt;
      d.y += d.vy * dt;
      if (d.y > GROUND_Y + 20) { d.mode = 'gone'; d.result = true; sfx.land(); }
    } else if (d.mode === 'escape') {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < -60) { d.mode = 'gone'; d.result = false; }
    }
  }

  // ---------- Pixel-art sprites ----------
  // Each sprite is a grid of palette characters; '.' is transparent.
  function makeSprite(rows, pal) {
    const w = Math.max(...rows.map(r => r.length));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = rows.length;
    const g = c.getContext('2d');
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); }
    }));
    return c;
  }
  function flipped(src, h, v) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.translate(h ? c.width : 0, v ? c.height : 0);
    g.scale(h ? -1 : 1, v ? -1 : 1);
    g.drawImage(src, 0, 0);
    return c;
  }

  const DUCK_HEAD = [
    '.............GGG..',
    '............GGEGG.',
    '............GGPGYY',
  ];
  const DUCK_FRAMES = [
    [ // wings up
      '...WW.............',
      '...WWW............',
      '....WWW...........',
      '....WWWW.....GGG..',
      '.....WWWW...GGEGG.',
      '.....WWWWW..GGPGYY',
      'B....BWWWWB.GGGGYY',
      'BB.BBBBBBBBBwwG...',
      '.BBBBBBBBBBBB.....',
      '..BBLLLLLLLBB.....',
      '...BLLLLLLLB......',
      '....BBBBBBB.......',
    ],
    [ // wings level
      '..................',
      '..................',
      '..................',
      ...DUCK_HEAD,
      'B....BBBBBB.GGGGYY',
      'BB.BWWWWWWBBwwG...',
      '.BWWWWWWWBBBB.....',
      '..BBLLLLLLLBB.....',
      '...BLLLLLLLB......',
      '....BBBBBBB.......',
    ],
    [ // wings down
      '..................',
      '..................',
      '..................',
      ...DUCK_HEAD,
      'B....BBBBBB.GGGGYY',
      'BB.BBBBBBBBBwwG...',
      '.BBBBBBBBBBBB.....',
      '..BBLLWWWWLBB.....',
      '...BLLWWWWWB......',
      '....BBBWWWWW......',
      '.......WWWW.......',
      '........WW........',
    ],
  ];
  const DUCK_HIT = [
    '....GGGGG.....',
    '...GEEGEEG....',
    '...GEPGPEG....',
    '....GYYYG.....',
    '..BBBwwwBBB...',
    '.WBBBBBBBBBW..',
    'WWBBLLLLLBBWW.',
    'W.BBLLLLLBB.W.',
    '...BBBBBBB....',
    '....Y...Y.....',
  ];
  const DOG_PAL = { D: '#b5793f', d: '#6b3f1d', T: '#f0d9b5', K: '#000', R: '#8b1a1a', E: '#fff' };
  const DOG_BODY = [
    '...............dd.........',
    '..............dDDDD.......',
    'DD...........dDDDDDD......',
    '.DD..........dDDKDDDT.....',
    '..DDDDDDDDDDDDDDDDDTTTK...',
    '..DDDDDDDDDDDDDDDD..TTT...',
    '..DDDDDDDDDDDDDDD.........',
    '..DDDDDDDDDDDDDD..........',
  ];
  const DOG_FRONT = (eyes, m1, m2, m3) => [
    '..dd..........dd..',
    '.ddddDDDDDDDDdddd.',
    '.dddDDDDDDDDDDddd.',
    eyes,
    '.ddDDDDDDDDDDDDdd.',
    '..dDDDTTTTTTDDDd..',
    '....DTTTKKTTTD....',
    m1, m2, m3,
    '.....DDDDDDDD.....',
    '....DDDDDDDDDD....',
    '....DDDTTTTDDD....',
    '....DDTTTTTTDD....',
    '....DDTTTTTTDD....',
    '....DDDDDDDDDD....',
  ];
  const SPR = {
    cloud: makeSprite([
      '....wwww.......',
      '..wwwwwwww.ww..',
      '.wwwwwwwwwwwww.',
      'wwwwwwwwwwwwwww',
      '.wwwwwwwwwwwww.',
    ], { w: '#fff' }),
    dogSide: [
      makeSprite([...DOG_BODY,
        '...DD..DD....DD..DD.......',
        '...DD..DD....DD..DD.......',
        '...KK..KK....KK..KK.......'], DOG_PAL),
      makeSprite([...DOG_BODY,
        '..DD....DD..DD....DD......',
        '.DD......DD.DD.....DD.....',
        '.KK......KK.KK.....KK.....'], DOG_PAL),
    ],
    dogHappy: makeSprite(DOG_FRONT(
      '.dddDEKDDDDEKDddd.',
      '....DTTTTTTTTD....',
      '.....TKTTTTKT.....',
      '......TKKKKT......'), DOG_PAL),
    dogLaugh: makeSprite(DOG_FRONT(
      '.dddDKKDDDDKKDddd.',
      '....DTRRRRRRTD....',
      '.....TRRRRRRT.....',
      '......TRRRRT......'), DOG_PAL),
  };
  const duckSprites = new Map();
  function duckSprite(type) {
    if (!duckSprites.has(type.name)) {
      const pal = { B: type.body, W: type.wing, L: type.belly, G: '#1f7a3a', w: '#fff', E: '#fff', P: '#000', Y: '#f2a33a' };
      const right = DUCK_FRAMES.map(f => makeSprite(f, pal));
      const hit = makeSprite(DUCK_HIT, pal);
      duckSprites.set(type.name, {
        right,
        left: right.map(s => flipped(s, true, false)),
        hit,
        fall: [flipped(hit, false, true), flipped(hit, true, true)],
      });
    }
    return duckSprites.get(type.name);
  }

  // ---------- Rendering ----------
  const bg = document.createElement('canvas');
  bg.width = W; bg.height = H;
  const fg = document.createElement('canvas');
  fg.width = W; fg.height = H;
  buildBackground(bg.getContext('2d'));
  buildForeground(fg.getContext('2d'));

  const low = document.createElement('canvas');
  low.width = W / PX;
  low.height = HUD_Y / PX;
  const lctx = low.getContext('2d');
  lctx.imageSmoothingEnabled = false;

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

  function skyColor() {
    return skyFlash > 0 && Math.floor(stateTime * 10) % 2 === 0 ? '#ffb3c6' : '#63adff';
  }

  function cloudPositions() {
    const t = performance.now() / 1000;
    return [[0, 70, 1], [300, 130, 0.7], [560, 50, 1.2]].map(([ox, y, s]) =>
      [((ox + t * 12 * s) % (W + 200)) - 100, y, s]);
  }

  const dogInFront = () => dog.mode === 'sniff' || (dog.mode === 'jump' && stateTime < 2.6);

  // --- Classic (vector) art ---
  function renderClassicWorld() {
    ctx.fillStyle = skyColor();
    ctx.fillRect(0, 0, W, GROUND_Y + 10);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, s] of cloudPositions()) {
      ctx.beginPath();
      ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
      ctx.arc(x + 25 * s, y - 10 * s, 26 * s, 0, Math.PI * 2);
      ctx.arc(x + 52 * s, y, 22 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.drawImage(bg, 0, 0);
    const front = dogInFront();
    if (!front) drawDogClassic();
    ducks.forEach(drawDuckClassic);
    ctx.drawImage(fg, 0, 0);
    if (front) drawDogClassic();
  }

  function drawDuckClassic(d) {
    if (d.mode === 'gone') return;
    ctx.save();
    ctx.translate(d.x, d.y);
    if (d.mode === 'hit') {
      duckBody(d.type, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-4, -26, 8, 8);
    } else if (d.mode === 'fall') {
      ctx.rotate(Math.PI / 2 + Math.sin(d.t * 30) * 0.3);
      duckBody(d.type, 0);
    } else {
      ctx.scale(d.vx >= 0 ? 1 : -1, 1);
      ctx.rotate(d.mode === 'escape' ? -0.5 : clamp(d.vy / d.speed, -0.6, 0.6) * 0.5);
      duckBody(d.type, Math.sin(d.t * (d.mode === 'escape' ? 14 : 10)));
    }
    ctx.restore();
  }

  function duckBody(c, wingPhase) {
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

  function drawDogClassic() {
    if (dog.mode === 'hidden') return;
    ctx.save();
    ctx.translate(dog.x, dog.y);
    const brown = '#b5793f';
    const dark = '#6b3f1d';
    const t = stateTime;

    if (dog.mode === 'sniff' || dog.mode === 'jump') {
      // Side view, walking right.
      const step = dog.mode === 'sniff' ? Math.sin(t * 14) * 4 : 0;
      const headDrop = dog.mode === 'sniff' ? 10 : 0;
      ctx.fillStyle = brown;
      ctx.beginPath(); ctx.ellipse(0, 0, 34, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-26, 8, 8, 22 + step); ctx.fillRect(16, 8, 8, 22 - step);
      ctx.beginPath(); ctx.arc(36, -16 + headDrop, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(28, -10 + headDrop, 7, 14, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(52, -14 + headDrop, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = brown;
      ctx.fillRect(-40, -14, 10, 5);
      ctx.restore();
      return;
    }

    // Front view popping out of the grass.
    const bob = dog.mode === 'laugh' ? Math.sin(t * 25) * 3 : 0;
    ctx.translate(0, bob);
    ctx.fillStyle = brown;
    ctx.fillRect(-26, 0, 52, 60);
    ctx.beginPath(); ctx.arc(0, -10, 28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-28, -6, 9, 20, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(28, -6, 9, 20, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0d9b5';
    ctx.beginPath(); ctx.ellipse(0, 4, 16, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(0, -2, 5, 0, Math.PI * 2); ctx.fill();
    if (dog.mode === 'laugh') {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-15, -18); ctx.lineTo(-7, -14); ctx.moveTo(15, -18); ctx.lineTo(7, -14); ctx.stroke();
      ctx.fillStyle = '#8b1a1a';
      ctx.beginPath(); ctx.ellipse(0, 11, 8, 5 + Math.abs(bob), 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-10, -16, 3.5, 0, Math.PI * 2); ctx.arc(10, -16, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 6, 7, 0.2, Math.PI - 0.2); ctx.stroke();
      // Hold each caught duck up in a paw.
      dog.ducks.forEach((type, i) => {
        const side = i === 0 ? 1 : -1;
        ctx.fillStyle = brown;
        ctx.fillRect(side > 0 ? 26 : -38, -30, 12, 40);
        ctx.save();
        ctx.translate(side * 40, -48);
        ctx.rotate(Math.PI / 2);
        ctx.scale(0.8, 0.8);
        duckBody(type, 0);
        ctx.restore();
      });
    }
    ctx.restore();
  }

  // --- Pixel art ---
  function renderPixelWorld() {
    lctx.fillStyle = skyColor();
    lctx.fillRect(0, 0, low.width, low.height);
    for (const [x, y] of cloudPositions()) lctx.drawImage(SPR.cloud, Math.round(x / PX), Math.round(y / PX));
    lctx.drawImage(bg, 0, 0, W, HUD_Y, 0, 0, low.width, low.height);
    const front = dogInFront();
    if (!front) drawDogPixel();
    ducks.forEach(drawDuckPixel);
    lctx.drawImage(fg, 0, 0, W, HUD_Y, 0, 0, low.width, low.height);
    if (front) drawDogPixel();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, 0, 0, low.width, low.height, 0, 0, W, HUD_Y);
    ctx.imageSmoothingEnabled = true;
  }

  function blit(img, cx, cy) {
    lctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2));
  }

  function drawDuckPixel(d) {
    if (d.mode === 'gone') return;
    const s = duckSprite(d.type);
    let img;
    if (d.mode === 'hit') img = s.hit;
    else if (d.mode === 'fall') img = s.fall[Math.floor(d.t * 8) % 2];
    else {
      const frame = [0, 1, 2, 1][Math.floor(d.t * (d.mode === 'escape' ? 16 : 12)) % 4];
      img = (d.vx >= 0 ? s.right : s.left)[frame];
    }
    blit(img, d.x / PX, d.y / PX);
  }

  function drawDogPixel() {
    if (dog.mode === 'hidden') return;
    const x = dog.x / PX;
    const y = dog.y / PX;
    if (dog.mode === 'sniff' || dog.mode === 'jump') {
      const img = SPR.dogSide[dog.mode === 'sniff' ? Math.floor(stateTime * 7) % 2 : 0];
      lctx.drawImage(img, Math.round(x - 13), Math.round(y - 5));
      return;
    }
    const laugh = dog.mode === 'laugh';
    const bob = laugh ? Math.round(Math.sin(stateTime * 25)) : 0;
    const top = Math.round(y - 10 + bob);
    lctx.drawImage(laugh ? SPR.dogLaugh : SPR.dogHappy, Math.round(x - 9), top);
    dog.ducks.forEach((type, i) => {
      const img = duckSprite(type).hit;
      lctx.fillStyle = DOG_PAL.D;
      lctx.fillRect(Math.round(x + (i === 0 ? 7 : -9)), top - 2, 2, 8);
      lctx.drawImage(img, Math.round(x + (i === 0 ? 4 : -4 - img.width)), top - img.height - 1);
    });
  }

  // --- HUD / overlays ---
  function text(str, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `${Math.round(size * 0.7)}px "Press Start 2P", "Courier New", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 5);
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
    if (state === 'menu') return;

    // Shots
    box(20, HUD_Y + 14, 100, 62);
    for (let i = 0; i < SHOTS_PER_WAVE; i++) {
      ctx.fillStyle = i < shots ? '#f2a33a' : '#333';
      ctx.fillRect(38 + i * 24, HUD_Y + 24, 12, 24);
      ctx.fillStyle = i < shots ? '#c0392b' : '#333';
      ctx.fillRect(38 + i * 24, HUD_Y + 44, 12, 6);
    }
    text('SHOT', 70, HUD_Y + 64, 16, '#7cfc00');

    // Hit tracker — includes the outcome of ducks still in the current wave.
    box(140, HUD_Y + 14, 420, 62);
    text('HIT', 172, HUD_Y + 34, 16, '#7cfc00');
    const blinkOn = Math.floor(stateTime * 4) % 2 === 0;
    for (let i = 0; i < DUCKS_PER_ROUND; i++) {
      let r = results[i];
      let blink = false;
      const j = i - results.length;
      if (r === undefined && state === 'flying' && j >= 0 && j < ducks.length) {
        const d = ducks[j];
        if (d.mode === 'hit' || d.mode === 'fall' || d.result === true) r = true;
        else blink = blinkOn;
      }
      const x = 210 + i * 33;
      ctx.fillStyle = r === true ? '#e74c3c' : r === false ? '#555' : blink ? '#000' : '#fff';
      ctx.beginPath(); ctx.ellipse(x + 12, HUD_Y + 34, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 22, HUD_Y + 28, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#2f6fff';
    for (let i = 0; i < requiredHits(); i++) ctx.fillRect(210 + i * 33, HUD_Y + 54, 26, 8);

    // Score
    box(580, HUD_Y + 14, 200, 62);
    text(String(score).padStart(6, '0'), 680, HUD_Y + 36, 24);
    text('SCORE', 680, HUD_Y + 62, 16, '#7cfc00');

    text(`R=${round}`, 20, 24, 18, '#fff', 'left');
    text(`HI ${hiScore}`, W - 20, 24, 18, '#fff', 'right');
    if (!settings.sound) text('MUTED', W / 2, 24, 14, '#ddd');
  }

  function drawCrosshair() {
    const { x, y } = mouse;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = settings.crosshair;
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
    if (state === 'intro' && stateTime < 2.2) {
      box(W / 2 - 110, 140, 220, 80);
      text('ROUND', W / 2, 165, 26);
      text(String(round), W / 2, 197, 30);
    } else if (state === 'flying' && ducks.some(d => d.mode === 'escape') && !ducks.some(d => d.mode === 'fly')) {
      box(W / 2 - 120, 150, 240, 56);
      text('FLY AWAY', W / 2, 178, 28);
    } else if (state === 'roundEnd') {
      box(W / 2 - 170, 140, 340, 90);
      text('ROUND CLEAR!', W / 2, 172, 30, '#7cfc00');
      text(`${results.filter(Boolean).length}/${DUCKS_PER_ROUND} DUCKS`, W / 2, 205, 20);
    }
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t / 1.2;
      text(p.text, p.x, p.y - p.t * 40, 20);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    if (settings.art === 'pixel') renderPixelWorld();
    else renderClassicWorld();
    drawHUD();
    drawOverlay();
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, 0, W, GROUND_Y);
    }
    if (inGame() && !paused) drawCrosshair();
  }

  // ---------- Menus ----------
  const SCREENS = ['home', 'settings', 'history', 'pause', 'gameover'];
  let screen = 'home';
  let settingsReturn = 'home';

  function show(name) {
    screen = name;
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
    if (name === 'home') $('home-top').textContent = hiScore ? `TOP SCORE ${hiScore}` : '';
  }

  function togglePause() {
    paused = !paused;
    show(paused ? 'pause' : null);
  }

  function goHome() {
    paused = false;
    round = 1;
    ducks = [makeDuck(0, 1, true)];
    dog = { mode: 'hidden', x: W / 2, y: GROUND_Y + 40, ducks: [] };
    setState('menu');
    show('home');
  }

  const actions = {
    play1: () => newGame(1),
    play2: () => newGame(2),
    again: () => newGame(mode),
    home: goHome,
    history: () => { renderHistory(); show('history'); },
    settings: () => { settingsReturn = screen; renderSettings(); show('settings'); },
    back: () => show(settingsReturn),
    resume: togglePause,
    quit: () => { recordGame(); goHome(); },
    fullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    },
    'clear-history': () => {
      if (!history.length || !window.confirm('Delete all saved scores?')) return;
      history = [];
      hiScore = 0;
      save('duckhunt.history', history);
      save('duckhunt.hiscore', 0);
      renderHistory();
    },
    set: btn => {
      const key = btn.parentElement.dataset.key;
      const raw = btn.dataset.value;
      settings[key] = raw === 'true' ? true : raw === 'false' ? false : raw;
      saveSettings();
    },
  };

  stage.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    ac();
    sfx.click();
    actions[btn.dataset.action](btn);
  });

  $('volume').addEventListener('input', e => {
    settings.volume = Number(e.target.value);
    saveSettings();
  });

  const swatches = $('swatches');
  for (const color of CROSSHAIRS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.action = 'set';
    b.dataset.value = color;
    b.style.background = color;
    b.setAttribute('aria-label', `Crosshair color ${color}`);
    swatches.appendChild(b);
  }

  function renderSettings() {
    document.querySelectorAll('#settings .seg').forEach(seg => {
      const current = String(settings[seg.dataset.key]);
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === current));
    });
    $('volume').value = settings.volume;
  }

  function fmtDate(t) {
    const d = new Date(t);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }
  const accuracy = g => (g.shots ? Math.round((g.hits / g.shots) * 100) : 0);

  function renderHistory() {
    const table = $('history-table');
    if (!history.length) {
      $('history-stats').textContent = '';
      table.innerHTML = '<tr><td class="empty">NO GAMES YET</td></tr>';
      return;
    }
    const best = Math.max(...history.map(h => h.score));
    const avg = Math.round(history.reduce((s, h) => s + h.score, 0) / history.length);
    const hits = history.reduce((s, h) => s + h.hits, 0);
    const shotsAll = history.reduce((s, h) => s + h.shots, 0);
    $('history-stats').textContent =
      `GAMES ${history.length} · BEST ${best} · AVG ${avg} · ACCURACY ${accuracy({ hits, shots: shotsAll })}%`;
    const rows = history.map(h => `
      <tr class="${h.score === best ? 'best' : ''}">
        <td>${fmtDate(h.t)}</td>
        <td>${h.mode === 2 ? '2 DUCKS' : '1 DUCK'}</td>
        <td>${String(h.difficulty || 'normal').toUpperCase()}</td>
        <td>R${h.round}</td>
        <td>${accuracy(h)}%</td>
        <td>${h.score}</td>
      </tr>`).join('');
    table.innerHTML = `<tr><th>DATE</th><th>MODE</th><th>LEVEL</th><th>RND</th><th>HIT</th><th>SCORE</th></tr>${rows}`;
  }

  function renderGameOver() {
    const g = lastGame;
    $('go-newhigh').classList.toggle('hidden', !(g && g.isHigh && g.score > 0));
    $('go-summary').innerHTML = g ? `
      SCORE <b>${g.score}</b><br>
      ROUND REACHED <b>${g.round}</b><br>
      DUCKS HIT <b>${g.hits}</b> · ACCURACY <b>${accuracy(g)}%</b><br>
      HIGH SCORE <b>${hiScore}</b>` : '';
  }

  // ---------- Main loop ----------
  goHome();
  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    if (!paused) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
