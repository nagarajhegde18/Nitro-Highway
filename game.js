const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const scoreEl = $('score'), bestEl = $('best'), coinsEl = $('coins');
const fuelFill = $('fuelFill'), nitroFill = $('nitroFill');
const overlay = $('overlay'), titleEl = $('title'), msgEl = $('msg');
const startBtn = $('startBtn'), skinsEl = $('skins'), nitroBtn = $('nitroBtn'), muteBtn = $('muteBtn');

const W = canvas.width;
const H = canvas.height;
const ROAD_X = 40;
const ROAD_W = 320;
const LANES = 4;
const LANE_W = ROAD_W / LANES;
const CAR_W = 40;
const CAR_H = 70;
const PICK = 26;            // pickup size
const THEME_EVERY = 1000;   // distance units before the theme changes
const NITRO_BOOST = 1.5;    // speed multiplier while nitro is on

// ---------------------------------------------------------------
// Themes (day / night / weather). grass/road = [r,g,b], ov = [r,g,b,alpha]
// ---------------------------------------------------------------
const THEMES = [
  { name: 'Sunny Day',   grass: [45, 138, 62], road: [58, 58, 63], ov: [0, 0, 0, 0],         rain: false },
  { name: 'Sunset',      grass: [74, 122, 58], road: [74, 64, 70], ov: [255, 110, 30, 0.22], rain: false },
  { name: 'Night',       grass: [20, 60, 35],  road: [30, 30, 38], ov: [5, 10, 45, 0.6],     rain: false },
  { name: 'Stormy Rain', grass: [40, 90, 60],  road: [45, 48, 56], ov: [40, 55, 80, 0.3],    rain: true  }
];

// ---------------------------------------------------------------
// Car skins. Sprites are drawn in code. If an image exists at `src`
// it replaces the drawn sprite (top-down car facing up, ~40x70 px).
// ---------------------------------------------------------------
const SKINS = [
  { name: 'Classic',   color: '#ffcc00', stripe: false, src: 'images/car-classic.png' },
  { name: 'Red Racer', color: '#e74c3c', stripe: true,  src: 'images/car-red.png' },
  { name: 'Ocean',     color: '#3498db', stripe: true,  src: 'images/car-blue.png' },
  { name: 'Mint',      color: '#2ecc71', stripe: false, src: 'images/car-green.png' }
];
const ENEMY_COLORS = ['#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#e67e22', '#1abc9c'];

function makeSprite(color, isPlayer, stripe) {
  const c = document.createElement('canvas');
  c.width = CAR_W;
  c.height = CAR_H;
  const g = c.getContext('2d');

  // wheels
  g.fillStyle = '#111';
  g.fillRect(0, 8, 5, 16);
  g.fillRect(CAR_W - 5, 8, 5, 16);
  g.fillRect(0, CAR_H - 24, 5, 16);
  g.fillRect(CAR_W - 5, CAR_H - 24, 5, 16);

  // body
  g.fillStyle = color;
  g.fillRect(3, 0, CAR_W - 6, CAR_H);
  if (stripe) {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(CAR_W / 2 - 3, 0, 6, CAR_H);
  }

  // windows
  g.fillStyle = '#aee6ff';
  g.fillRect(8, 18, CAR_W - 16, 14);
  g.fillStyle = '#7fb9d6';
  g.fillRect(8, CAR_H - 20, CAR_W - 16, 10);

  // lights
  if (isPlayer) {
    g.fillStyle = '#fff7a8';
    g.fillRect(6, 2, 8, 5);
    g.fillRect(CAR_W - 14, 2, 8, 5);
  } else {
    g.fillStyle = '#ff2d2d';
    g.fillRect(6, CAR_H - 6, 8, 4);
    g.fillRect(CAR_W - 14, CAR_H - 6, 8, 4);
  }
  return c;
}

const enemySprites = ENEMY_COLORS.map(c => makeSprite(c, false, false));

SKINS.forEach(skin => {
  skin.sprite = makeSprite(skin.color, true, skin.stripe);
  const img = new Image();
  img.onload = () => { skin.sprite = img; renderSkinButtons(); if (!running) draw(); };
  img.onerror = () => {};          // no image file? keep the drawn sprite
  img.src = skin.src;
});

// ---------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------
function load(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : v; } catch (e) { return def; }
}
function save(key, val) {
  try { localStorage.setItem(key, val); } catch (e) {}
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let player, enemies, pickups, texts, drops = [];
let speed, boost, distance, coins, fuel, nitro;
let spawnTimer, coinGap, trailLeft, coinLane, fuelGap, lowFuelTimer;
let lineOffset, lastTime, gameTime;
let themeIndex, toastTimer, env, rainLevel;
let running = false;
let best = Number(load('endlessDriveBest', 0)) || 0;
let skinIndex = Math.min(Number(load('endlessDriveSkin', 0)) || 0, SKINS.length - 1);
const keys = { left: false, right: false, nitro: false };
const ptr = { left: false, right: false };   // mouse / touch steering

bestEl.textContent = best;

function reset() {
  player = { x: W / 2 - CAR_W / 2, y: H - CAR_H - 30, vx: 0 };
  enemies = [];
  pickups = [];
  texts = [];
  speed = 250;
  boost = 1;
  distance = 0;
  coins = 0;
  fuel = 100;
  nitro = 20;
  spawnTimer = 0.5;
  coinGap = 400;
  trailLeft = 0;
  coinLane = 1;
  fuelGap = 2000;
  lowFuelTimer = 0;
  lineOffset = 0;
  gameTime = 0;
  themeIndex = 0;
  toastTimer = 0;
  rainLevel = 0;
  env = {
    grass: THEMES[0].grass.slice(),
    road: THEMES[0].road.slice(),
    ov: THEMES[0].ov.slice()
  };
  if (!drops.length) {
    for (let i = 0; i < 90; i++) {
      drops.push({ x: Math.random() * W, y: Math.random() * H, s: 700 + Math.random() * 400 });
    }
  }
  updateHud();
}

function getScore() { return Math.floor(distance) + coins * 10; }

function updateHud() {
  scoreEl.textContent = getScore();
  coinsEl.textContent = coins;
  fuelFill.style.width = fuel + '%';
  fuelFill.classList.toggle('low', fuel < 25);
  nitroFill.style.width = nitro + '%';
}

function startGame() {
  if (running) return;
  reset();
  overlay.classList.add('hidden');
  if (document.activeElement) document.activeElement.blur();
  window.focus();
  running = true;
  SFX.start();
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function gameOver(reason) {
  running = false;
  if (reason === 'Crashed!') SFX.crash(); else SFX.sputter();
  const finalScore = getScore();
  if (finalScore > best) {
    best = finalScore;
    bestEl.textContent = best;
    save('endlessDriveBest', best);
  }
  titleEl.textContent = reason;
  msgEl.innerHTML = 'Score: ' + finalScore + ' &nbsp; 🪙 ' + coins + '<br>Best: ' + best;
  startBtn.textContent = 'Play Again';
  overlay.classList.remove('hidden');
}

// ---------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------
function spawnEnemy() {
  const lane = Math.floor(Math.random() * LANES);
  if (enemies.some(e => e.lane === lane && e.y < CAR_H * 2)) return;
  enemies.push({
    lane,
    x: ROAD_X + lane * LANE_W + (LANE_W - CAR_W) / 2,
    y: -CAR_H,
    v: speed * (0.3 + Math.random() * 0.25), // enemy's own forward speed
    sprite: enemySprites[Math.floor(Math.random() * enemySprites.length)]
  });
}

function spawnPickup(type, lane) {
  if (enemies.some(e => e.lane === lane && e.y < CAR_H * 1.5)) return false;
  pickups.push({
    type,
    x: ROAD_X + lane * LANE_W + (LANE_W - PICK) / 2,
    y: -PICK,
    phase: Math.random() * 6
  });
  return true;
}

function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function hit(a, b) {
  const m = 5; // forgiving hitbox
  return overlap(a.x + m, a.y + m, CAR_W - 2 * m, CAR_H - 2 * m,
                 b.x + m, b.y + m, CAR_W - 2 * m, CAR_H - 2 * m);
}

// ---------------------------------------------------------------
// Update
// ---------------------------------------------------------------
function lerpArr(a, b, t) {
  for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * t;
}

function update(dt) {
  gameTime += dt;
  speed = Math.min(speed + 8 * dt, 600);

  // nitro
  const nitroOn = keys.nitro && nitro > 0;
  if (nitroOn) nitro = Math.max(0, nitro - 35 * dt);
  boost += ((nitroOn ? NITRO_BOOST : 1) - boost) * Math.min(1, 6 * dt);
  const v = speed * boost; // actual road speed in px/s

  // fuel
  fuel -= 3 * (nitroOn ? 1.5 : 1) * dt;
  if (fuel <= 0) { fuel = 0; updateHud(); gameOver('Out of fuel!'); return; }

  distance += (v * dt) / 10;
  lineOffset = (lineOffset + v * dt) % 40;

  // theme / weather
  const idx = Math.max(0, Math.floor(distance / THEME_EVERY)) % THEMES.length;
  if (idx !== themeIndex) { themeIndex = idx; toastTimer = 2.5; SFX.chime(); }
  const T = THEMES[themeIndex];
  const k = Math.min(1, 1.2 * dt);
  lerpArr(env.grass, T.grass, k);
  lerpArr(env.road, T.road, k);
  lerpArr(env.ov, T.ov, k);
  rainLevel += ((T.rain ? 1 : 0) - rainLevel) * Math.min(1, 0.8 * dt);
  if (toastTimer > 0) toastTimer -= dt;
  for (const d of drops) {
    d.y += d.s * dt;
    d.x -= 80 * dt;
    if (d.y > H) { d.y = -10; d.x = Math.random() * (W + 80); }
    if (d.x < 0) d.x += W;
  }

  // steering (a bit slippery in the rain)
  const dir = ((keys.right || ptr.right) ? 1 : 0) - ((keys.left || ptr.left) ? 1 : 0);
  const grip = 10 - 5 * rainLevel;
  player.vx += (dir * 320 - player.vx) * Math.min(1, grip * dt);
  player.x += player.vx * dt;
  player.x = Math.max(ROAD_X + 4, Math.min(ROAD_X + ROAD_W - CAR_W - 4, player.x));

  // enemy traffic
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnEnemy();
    spawnTimer = Math.max(0.55, 1.2 - speed / 900) + Math.random() * 0.3;
  }

  // coin trails
  coinGap -= v * dt;
  if (coinGap <= 0) {
    if (trailLeft > 0) {
      spawnPickup('coin', coinLane);
      trailLeft--;
      coinGap = 80;
    } else {
      coinLane = Math.floor(Math.random() * LANES);
      trailLeft = 3 + Math.floor(Math.random() * 4);
      coinGap = 500 + Math.random() * 500;
    }
  }

  // fuel cans
  fuelGap -= v * dt;
  if (fuelGap <= 0) {
    const ok = spawnPickup('fuel', Math.floor(Math.random() * LANES));
    fuelGap = ok ? 2200 + Math.random() * 1500 : 100;
  }

  // move enemies, near-miss sound, check crashes
  for (const e of enemies) {
    e.y += (v - e.v) * dt;
    if (!e.passed && e.y > player.y + CAR_H) {
      e.passed = true;
      if (Math.abs(e.x - player.x) < CAR_W + 25) SFX.whoosh();   // near miss
    }
    if (hit(player, e)) { updateHud(); gameOver('Crashed!'); return; }
  }
  enemies = enemies.filter(e => e.y < H + CAR_H);

  // move pickups, check collection
  for (const p of pickups) {
    p.y += v * dt;
    if (!p.taken && overlap(player.x, player.y, CAR_W, CAR_H, p.x, p.y, PICK, PICK)) {
      p.taken = true;
      if (p.type === 'coin') {
        coins++;
        SFX.coin();
        nitro = Math.min(100, nitro + 10);
        texts.push({ x: p.x, y: p.y, text: '+10', color: '#f1c40f', life: 1 });
      } else {
        fuel = Math.min(100, fuel + 35);
        SFX.fuel();
        texts.push({ x: p.x, y: p.y, text: '+FUEL', color: '#2ecc71', life: 1 });
      }
    }
  }
  pickups = pickups.filter(p => !p.taken && p.y < H + PICK);

  // floating texts
  for (const t of texts) { t.y -= 40 * dt; t.life -= 1.5 * dt; }
  texts = texts.filter(t => t.life > 0);

  // audio
  SFX.setNitro(nitroOn);
  SFX.engine(speed, boost);
  SFX.rain(rainLevel);
  if (fuel < 25) {
    lowFuelTimer -= dt;
    if (lowFuelTimer <= 0) { SFX.lowFuel(); lowFuelTimer = 0.9; }
  } else {
    lowFuelTimer = 0;
  }

  updateHud();
}

// ---------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------
const rgb = a => 'rgb(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ')';

function drawRoad() {
  ctx.fillStyle = rgb(env.grass);
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = rgb(env.road);
  ctx.fillRect(ROAD_X, 0, ROAD_W, H);

  ctx.fillStyle = '#fff';
  ctx.fillRect(ROAD_X, 0, 4, H);
  ctx.fillRect(ROAD_X + ROAD_W - 4, 0, 4, H);

  ctx.fillStyle = '#f1c40f';
  for (let i = 1; i < LANES; i++) {
    const x = ROAD_X + i * LANE_W - 2;
    for (let y = -40 + lineOffset; y < H; y += 40) ctx.fillRect(x, y, 4, 20);
  }

  ctx.fillStyle = '#ecf0f1';
  for (let y = -80 + (lineOffset * 2) % 80; y < H; y += 80) {
    ctx.fillRect(18, y, 6, 20);
    ctx.fillRect(W - 24, y, 6, 20);
  }
}

function drawPickup(p) {
  const cx = p.x + PICK / 2;
  const cy = p.y + PICK / 2;
  if (p.type === 'coin') {
    const w = Math.abs(Math.cos(gameTime * 4 + p.phase)) * 10 + 2; // spinning
    ctx.fillStyle = '#f1c40f';
    ctx.strokeStyle = '#b7950b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(cx - 10, cy - 12, 20, 24);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(cx - 4, cy - 16, 8, 5);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F', cx, cy + 1);
  }
}

function drawNitroFlame() {
  if (boost < 1.15) return;
  const f = 14 + Math.random() * 14;
  const py = player.y + CAR_H;
  for (const fx of [10, CAR_W - 10]) {
    const px = player.x + fx;
    ctx.fillStyle = '#ff9f1a';
    ctx.beginPath();
    ctx.moveTo(px - 5, py);
    ctx.lineTo(px, py + f);
    ctx.lineTo(px + 5, py);
    ctx.fill();
    ctx.fillStyle = '#fff176';
    ctx.beginPath();
    ctx.moveTo(px - 2.5, py);
    ctx.lineTo(px, py + f * 0.55);
    ctx.lineTo(px + 2.5, py);
    ctx.fill();
  }
}

function drawWeatherAndLight() {
  // day / night tint
  if (env.ov[3] > 0.005) {
    ctx.fillStyle = 'rgba(' + (env.ov[0] | 0) + ',' + (env.ov[1] | 0) + ',' + (env.ov[2] | 0) + ',' + env.ov[3] + ')';
    ctx.fillRect(0, 0, W, H);
  }

  // headlight glow when it's dark
  if (env.ov[3] > 0.15) {
    const cx = player.x + CAR_W / 2;
    const g = ctx.createRadialGradient(cx, player.y, 5, cx, player.y - 40, 170);
    g.addColorStop(0, 'rgba(255,240,170,' + env.ov[3] * 0.9 + ')');
    g.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // rain
  if (rainLevel > 0.02) {
    ctx.save();
    ctx.globalAlpha = rainLevel * 0.6;
    ctx.strokeStyle = '#cfe8ff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const d of drops) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 3, d.y + 14);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function draw() {
  drawRoad();
  for (const p of pickups) drawPickup(p);
  for (const e of enemies) ctx.drawImage(e.sprite, e.x, e.y, CAR_W, CAR_H);
  drawNitroFlame();
  ctx.drawImage(SKINS[skinIndex].sprite, player.x, player.y, CAR_W, CAR_H);
  drawWeatherAndLight();

  // floating "+10" texts
  ctx.save();
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  for (const t of texts) {
    ctx.globalAlpha = Math.max(0, t.life);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x + PICK / 2, t.y);
  }
  ctx.restore();

  // theme name toast
  if (toastTimer > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, toastTimer);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.fillText(THEMES[themeIndex].name, W / 2, 110);
    ctx.restore();
  }
}

function loop(now) {
  if (!running) return;
  const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.05));
  lastTime = now;
  update(dt);
  draw();
  if (running) requestAnimationFrame(loop);
}

// ---------------------------------------------------------------
// Skin picker
// ---------------------------------------------------------------
function renderSkinButtons() {
  skinsEl.innerHTML = '';
  SKINS.forEach((skin, i) => {
    const b = document.createElement('button');
    b.className = 'skin' + (i === skinIndex ? ' selected' : '');
    const c = document.createElement('canvas');
    c.width = CAR_W;
    c.height = CAR_H;
    c.getContext('2d').drawImage(skin.sprite, 0, 0, CAR_W, CAR_H);
    const label = document.createElement('span');
    label.textContent = skin.name;
    b.append(c, label);
    b.addEventListener('click', () => {
      skinIndex = i;
      save('endlessDriveSkin', i);
      renderSkinButtons();
      draw();
    });
    skinsEl.appendChild(b);
  });
}

// ---------------------------------------------------------------
// Input
// ---------------------------------------------------------------
const LEFT_CODES = ['ArrowLeft', 'KeyA'];
const RIGHT_CODES = ['ArrowRight', 'KeyD'];
const NITRO_CODES = ['ShiftLeft', 'ShiftRight', 'KeyW', 'ArrowUp'];

window.addEventListener('keydown', e => {
  if (LEFT_CODES.includes(e.code)) keys.left = true;
  if (RIGHT_CODES.includes(e.code)) keys.right = true;
  if (NITRO_CODES.includes(e.code)) keys.nitro = true;
  if (e.code === 'KeyM') toggleMute();
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if ((e.code === 'Enter' || e.code === 'Space') && !running) startGame();
});
window.addEventListener('keyup', e => {
  if (LEFT_CODES.includes(e.code)) keys.left = false;
  if (RIGHT_CODES.includes(e.code)) keys.right = false;
  if (NITRO_CODES.includes(e.code)) keys.nitro = false;
});
window.addEventListener('blur', () => { keys.left = keys.right = keys.nitro = false; });

// Mouse + touch steering: press the left or right half of the game
const pointers = new Map();
function applyPointers() {
  const rect = canvas.getBoundingClientRect();
  ptr.left = ptr.right = false;
  for (const x of pointers.values()) {
    if (x - rect.left < rect.width / 2) ptr.left = true;
    else ptr.right = true;
  }
}
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  pointers.set(e.pointerId, e.clientX);
  applyPointers();
});
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) { pointers.set(e.pointerId, e.clientX); applyPointers(); }
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type =>
  canvas.addEventListener(type, e => { pointers.delete(e.pointerId); applyPointers(); })
);

// Nitro button (touch + mouse)
const nitroDown = e => { e.preventDefault(); keys.nitro = true; };
const nitroUp = e => { e.preventDefault(); keys.nitro = false; };
nitroBtn.addEventListener('pointerdown', nitroDown);
nitroBtn.addEventListener('pointerup', nitroUp);
nitroBtn.addEventListener('pointercancel', nitroUp);
nitroBtn.addEventListener('pointerleave', nitroUp);

startBtn.addEventListener('click', startGame);

// Mute button (also press M)
function refreshMute() { muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊'; }
function toggleMute() { SFX.init(); SFX.toggleMute(); refreshMute(); }
muteBtn.addEventListener('click', () => { toggleMute(); muteBtn.blur(); });
refreshMute();

// ---------------------------------------------------------------
// Init: draw one frame behind the start screen
// ---------------------------------------------------------------
reset();
renderSkinButtons();
draw();