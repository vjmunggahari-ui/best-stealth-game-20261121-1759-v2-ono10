// BLACKOUT: The Meridian Heist — top-down stealth engine.
// No libraries, no network: plain canvas, keyboard + mouse, WebAudio bleeps
// synthesised in code. Six heists, raycast vision cones, suspicion, noise,
// light and shadow, hiding spots, cameras, alarms, lockpicking, five gadgets.
'use strict';

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

const COLS = 30; // TILE comes from levels.js
const ROWS = 19;
const W = COLS * TILE; // 960
const H = ROWS * TILE; // 608

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('mini');
const mctx = mini ? mini.getContext('2d') : null;

const $ = (id) => document.getElementById(id);
const hud = {
  heist: $('hud-heist'), time: $('hud-time'), loot: $('hud-loot'),
  sus: $('hud-suspicion'), susFill: $('hud-suspicion-fill'),
  alarm: $('hud-alarm'), gadgets: $('hud-gadgets'), objective: $('hud-objective'),
  toast: $('toast'),
};

// Tiny seeded random so screenshot scenes are repeatable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Audio: everything synthesised, no audio files.                      */
/* ------------------------------------------------------------------ */

let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  return AC;
}
function beep(freq, dur, type, vol, when) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + (when || 0);
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.08, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  pickup() { beep(880, 0.09, 'sine', 0.09); beep(1318, 0.12, 'sine', 0.08, 0.07); },
  star() { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.14, 'triangle', 0.09, i * 0.09)); },
  alert() { beep(220, 0.25, 'sawtooth', 0.1); beep(185, 0.3, 'sawtooth', 0.1, 0.12); },
  caught() { [392, 311, 233, 175].forEach((f, i) => beep(f, 0.2, 'sawtooth', 0.1, i * 0.13)); },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, 0.18, 'triangle', 0.09, i * 0.1)); },
  pebble() { beep(1400, 0.05, 'square', 0.05); },
  door() { beep(330, 0.08, 'square', 0.06); beep(440, 0.1, 'square', 0.06, 0.08); },
  step() { beep(90 + Math.random() * 40, 0.04, 'sine', 0.03); },
  emp() { beep(1200, 0.4, 'sawtooth', 0.06); beep(300, 0.4, 'sawtooth', 0.06, 0.05); },
  smoke() { beep(200, 0.5, 'sine', 0.05); },
};

/* ------------------------------------------------------------------ */
/* Level parsing                                                       */
/* ------------------------------------------------------------------ */

const game = {
  screen: 'menu', // menu | playing | caught | won | heistdone
  heistIndex: 0,
  level: null,
  player: null,
  guards: [],
  cameras: [],
  treasures: [],
  star: null,
  exitTile: null,
  hideSpots: [],
  lamps: [],
  doors: [], // {tx, ty, open, progress}
  noises: [], // {x, y, r, ttl, max}
  smokes: [], // {x, y, r, ttl}
  keys: {},
  mouse: { x: W / 2, y: H / 2 },
  time: 0,
  alarm: 0,
  alerted: false, // any guard ever reached full suspicion this heist
  loot: 0,
  starTaken: false,
  lockpicking: null, // door being picked
  toastTimer: 0,
  empTimer: 0,
  cloakTimer: 0,
  stepTimer: 0,
  wonStats: null,
  menuSel: 0,
  best: {},
};

try { game.best = JSON.parse(localStorage.getItem('blackout-best') || '{}'); } catch (e) { game.best = {}; }
function saveBest() {
  try { localStorage.setItem('blackout-best', JSON.stringify(game.best)); } catch (e) { /* private mode */ }
}

function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return '#';
  return game.level.grid[ty][tx];
}
function isWall(tx, ty) { const t = tileAt(tx, ty); return t === '#' || t === 'D'; }
function isDoor(tx, ty) { return tileAt(tx, ty) === 'D'; }

function loadHeist(i) {
  const def = HEISTS[i];
  const grid = def.map.map((row) => row.split(''));
  game.level = { def, grid };
  game.heistIndex = i;
  game.guards = [];
  game.cameras = [];
  game.treasures = [];
  game.hideSpots = [];
  game.lamps = [];
  game.doors = [];
  game.noises = [];
  game.smokes = [];
  game.time = 0; game.alarm = 0; game.alerted = false;
  game.loot = 0; game.starTaken = false; game.lockpicking = null;
  game.empTimer = 0; game.cloakTimer = 0;

  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const c = grid[ty][tx];
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      if (c === 'P') game.player = { x: cx, y: cy, r: 11, dir: -Math.PI / 2, hidden: false, moving: false, running: false, sneaking: false };
      else if (c === 'T') game.treasures.push({ tx, ty, x: cx, y: cy, taken: false });
      else if (c === 'S') game.star = { tx, ty, x: cx, y: cy, taken: false };
      else if (c === 'X') game.exitTile = { tx, ty, x: cx, y: cy };
      else if (c === 'H') game.hideSpots.push({ tx, ty, x: cx, y: cy });
      else if (c === 'L') game.lamps.push({ tx, ty, x: cx, y: cy, r: 100 });
      else if (c === 'D') game.doors.push({ tx, ty, x: cx, y: cy, open: false, progress: 0 });
    }
  }
  def.patrols.forEach((pts, idx) => {
    const start = pts[0];
    game.guards.push({
      id: idx,
      x: start[0] * TILE + TILE / 2, y: start[1] * TILE + TILE / 2,
      r: 12, dir: 0, patrol: pts, wp: 1, speed: 1.05,
      state: 'patrol', // patrol | investigate | chase
      suspicion: 0, target: null, lastSeen: null, wait: 0,
      stuck: 0, pauseT: 0,
    });
  });
  def.cameras.forEach((c) => {
    game.cameras.push({
      x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2,
      base: Math.PI / 2, angle: Math.PI / 2, sweep: c.sweep,
      t: Math.random() * 6, range: 230, fov: 0.62,
    });
  });
  game.gadgetCounts = Object.assign({}, def.gadgets);
  game.screen = 'playing';
  toast(def.name + ' — ' + def.brief);
  updateHUD();
}

/* ------------------------------------------------------------------ */
/* Geometry: line of sight + raycast cones                             */
/* ------------------------------------------------------------------ */

function losBlocked(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 8));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWall(Math.floor((x0 + dx * t) / TILE), Math.floor((y0 + dy * t) / TILE))) return true;
  }
  return false;
}

function castRay(x, y, angle, maxDist) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let d = 0;
  while (d < maxDist) {
    d += 6;
    if (isWall(Math.floor((x + dx * d) / TILE), Math.floor((y + dy * d) / TILE))) return d;
  }
  return maxDist;
}

function conePolygon(x, y, dir, fov, range, rays) {
  const pts = [[x, y]];
  for (let i = 0; i <= rays; i++) {
    const a = dir - fov / 2 + (fov * i) / rays;
    const d = castRay(x, y, a, range);
    pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d]);
  }
  return pts;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function inSmoke(x, y) {
  return game.smokes.some((s) => Math.hypot(x - s.x, y - s.y) < s.r);
}
function segmentInSmoke(x0, y0, x1, y1) {
  return game.smokes.some((s) => {
    // distance from smoke centre to the segment
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    let t = ((s.x - x0) * dx + (s.y - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(s.x - (x0 + dx * t), s.y - (y0 + dy * t)) < s.r;
  });
}

function playerLit() {
  return game.lamps.some((l) => Math.hypot(game.player.x - l.x, game.player.y - l.y) < l.r);
}

// Can `seer` at (x,y) facing dir with fov/range see the player?
function canSee(x, y, dir, fov, range) {
  const p = game.player;
  if (p.hidden) return false;
  if (game.cloakTimer > 0) return false;
  const d = Math.hypot(p.x - x, p.y - y);
  if (d > range) return false;
  if (Math.abs(angleDiff(Math.atan2(p.y - y, p.x - x), dir)) > fov / 2) return false;
  if (losBlocked(x, y, p.x, p.y)) return false;
  if (segmentInSmoke(x, y, p.x, p.y)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Noise                                                               */
/* ------------------------------------------------------------------ */

function emitNoise(x, y, r) {
  game.noises.push({ x, y, r, ttl: 0.7, max: 0.7 });
  for (const g of game.guards) {
    if (g.state !== 'chase' && Math.hypot(g.x - x, g.y - y) < r + 40) {
      g.state = 'investigate';
      g.target = { x, y };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

const KEYMAP = { w: 'up', a: 'left', s: 'down', d: 'right' };
window.addEventListener('keydown', (e) => {
  audio(); // unlock audio on first gesture
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  game.keys[k] = true;
  if (game.screen === 'menu') {
    if (k === 'arrowup' || k === 'w') game.menuSel = (game.menuSel + HEISTS.length - 1) % HEISTS.length;
    if (k === 'arrowdown' || k === 's') game.menuSel = (game.menuSel + 1) % HEISTS.length;
    if (k === 'enter') loadHeist(game.menuSel);
    return;
  }
  if (game.screen === 'caught' || game.screen === 'won' || game.screen === 'heistdone') {
    if (k === 'enter' || k === 'r') {
      if (game.screen === 'won') { game.screen = 'menu'; }
      else if (game.screen === 'heistdone') {
        if (game.heistIndex < HEISTS.length - 1) loadHeist(game.heistIndex + 1);
        else game.screen = 'won';
      }
      else loadHeist(game.heistIndex);
    }
    if (k === 'escape') game.screen = 'menu';
    return;
  }
  if (k === 'e') tryInteract();
  if (k >= '1' && k <= '5') useGadget(GADGETS[Number(k) - 1].id);
  if (k === 'escape') game.screen = 'menu';
});
window.addEventListener('keyup', (e) => { game.keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  game.mouse.x = (e.clientX - r.left) * (W / r.width);
  game.mouse.y = (e.clientY - r.top) * (H / r.height);
});
canvas.addEventListener('click', () => {
  if (game.screen === 'playing') useGadget('pebble', true);
});

function tryInteract() {
  const p = game.player;
  if (!p) return;
  // Step out of / into a hiding spot.
  if (p.hidden) { p.hidden = false; toast('You slip out of cover.'); return; }
  let best = null, bestD = 60;
  for (const h of game.hideSpots) {
    const d = Math.hypot(p.x - h.x, p.y - h.y);
    if (d < bestD) { best = h; bestD = d; }
  }
  if (best) { p.hidden = true; p.x = best.x; p.y = best.y; toast('Hidden. Guards cannot see you here.'); return; }
  // Start picking a locked door.
  for (const d of game.doors) {
    if (!d.open && Math.hypot(p.x - d.x, p.y - d.y) < 56) {
      game.lockpicking = d;
      toast('Picking the lock — hold still…');
      return;
    }
  }
}

function useGadget(id, atMouse) {
  if (game.screen !== 'playing') return;
  const counts = game.gadgetCounts;
  if (!counts[id] || counts[id] <= 0) { toast('No ' + id + ' left.'); return; }
  const p = game.player;
  if (id === 'pebble') {
    const tx = atMouse ? game.mouse.x : p.x + Math.cos(p.dir) * 130;
    const ty = atMouse ? game.mouse.y : p.y + Math.sin(p.dir) * 130;
    counts.pebble--;
    emitNoise(tx, ty, 210);
    game.noises.push({ x: tx, y: ty, r: 210, ttl: 0.7, max: 0.7 });
    sfx.pebble();
    toast('Pebble tossed — they heard that.');
  } else if (id === 'smoke') {
    counts.smoke--;
    game.smokes.push({ x: p.x, y: p.y, r: 95, ttl: 6 });
    sfx.smoke();
    toast('Smoke out. Move.');
  } else if (id === 'emp') {
    counts.emp--;
    game.empTimer = 12;
    sfx.emp();
    toast('EMP pulse — cameras dead for 12s.');
  } else if (id === 'lockpick') {
    let door = null, bd = 64;
    for (const d of game.doors) {
      if (d.open) continue;
      const dist = Math.hypot(p.x - d.x, p.y - d.y);
      if (dist < bd) { door = d; bd = dist; }
    }
    if (!door) { toast('No locked door nearby.'); return; }
    counts.lockpick--;
    door.open = true;
    game.level.grid[door.ty][door.tx] = '.';
    sfx.door();
    toast('Lock picked clean.');
  } else if (id === 'cloak') {
    counts.cloak--;
    game.cloakTimer = 5;
    toast('Shadow cloak — unseen for 5s.');
  }
  updateHUD();
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

function moveCircle(e, dx, dy) {
  const nx = e.x + dx;
  if (!isWall(Math.floor((nx + Math.sign(dx) * e.r) / TILE), Math.floor(e.y / TILE)) &&
      !isWall(Math.floor((nx + Math.sign(dx) * e.r) / TILE), Math.floor((e.y - e.r * 0.7) / TILE)) &&
      !isWall(Math.floor((nx + Math.sign(dx) * e.r) / TILE), Math.floor((e.y + e.r * 0.7) / TILE))) e.x = nx;
  const ny = e.y + dy;
  if (!isWall(Math.floor(e.x / TILE), Math.floor((ny + Math.sign(dy) * e.r) / TILE)) &&
      !isWall(Math.floor((e.x - e.r * 0.7) / TILE), Math.floor((ny + Math.sign(dy) * e.r) / TILE)) &&
      !isWall(Math.floor((e.x + e.r * 0.7) / TILE), Math.floor((ny + Math.sign(dy) * e.r) / TILE))) e.y = ny;
}

function update(dt) {
  const p = game.player;
  game.time += dt;
  if (game.empTimer > 0) game.empTimer -= dt;
  if (game.cloakTimer > 0) game.cloakTimer -= dt;
  for (const s of game.smokes) s.ttl -= dt;
  game.smokes = game.smokes.filter((s) => s.ttl > 0);
  for (const n of game.noises) n.ttl -= dt;
  game.noises = game.noises.filter((n) => n.ttl > 0);
  if (game.toastTimer > 0) game.toastTimer -= dt;

  // --- player movement ---
  let mx = 0, my = 0;
  if (game.keys['w'] || game.keys['arrowup']) my -= 1;
  if (game.keys['s'] || game.keys['arrowdown']) my += 1;
  if (game.keys['a'] || game.keys['arrowleft']) mx -= 1;
  if (game.keys['d'] || game.keys['arrowright']) mx += 1;
  const running = !!(game.keys['shift']);
  const sneaking = !!(game.keys['control'] || game.keys['c']);
  p.running = running && (mx || my);
  p.sneaking = sneaking;
  p.moving = !!(mx || my) && !p.hidden;
  if (p.hidden) { mx = 0; my = 0; }
  if (mx || my) {
    const len = Math.hypot(mx, my);
    const speed = running ? 3.7 : sneaking ? 1.25 : 2.3;
    const vx = (mx / len) * speed, vy = (my / len) * speed;
    p.dir = Math.atan2(vy, vx);
    moveCircle(p, vx, vy);
    // Footsteps: running is loud, walking is a whisper, sneaking is silent.
    game.stepTimer -= dt;
    if (game.stepTimer <= 0) {
      if (running) { emitNoise(p.x, p.y, 80); game.stepTimer = 0.45; sfx.step(); }
      else if (!sneaking) { game.stepTimer = 0.6; }
      else game.stepTimer = 0.3;
    }
  }
  // Lockpicking: hold still next to a locked door.
  if (game.lockpicking) {
    const d = game.lockpicking;
    if (Math.hypot(p.x - d.x, p.y - d.y) > 64 || p.moving) { game.lockpicking = null; }
    else {
      d.progress += dt / 2.0;
      if (d.progress >= 1) {
        d.open = true;
        game.level.grid[d.ty][d.tx] = '.';
        game.lockpicking = null;
        sfx.door();
        toast('Lock picked.');
      }
    }
  }

  // --- pickups ---
  for (const t of game.treasures) {
    if (!t.taken && Math.hypot(p.x - t.x, p.y - t.y) < 24) {
      t.taken = true; game.loot++;
      sfx.pickup();
      toast('Treasure pocketed (' + game.loot + '/' + game.treasures.length + ').');
    }
  }
  if (game.star && !game.star.taken && Math.hypot(p.x - game.star.x, p.y - game.star.y) < 26) {
    game.star.taken = true;
    sfx.star();
    toast('STAR PRIZE secured — reach the exit unseen!');
    game.objective = 'Reach the exit';
  }
  // --- exit ---
  if (game.exitTile && Math.hypot(p.x - game.exitTile.x, p.y - game.exitTile.y) < 26) {
    if (!game.starTaken) { toast('The job is not done — steal the star prize first!'); }
    else return heistComplete();
  }

  // --- guards ---
  const lit = playerLit();
  for (const g of game.guards) {
    const sees = canSee(g.x, g.y, g.dir, 1.22, 235);
    if (sees) {
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      let rate = 55 * (1 - d / 300);
      if (lit) rate *= 1.6; else rate *= 0.55;
      if (p.running) rate *= 1.5;
      if (p.sneaking) rate *= 0.6;
      g.suspicion = Math.min(100, g.suspicion + rate * dt);
      g.lastSeen = { x: p.x, y: p.y };
    } else {
      g.suspicion = Math.max(0, g.suspicion - 14 * dt);
    }
    if (g.suspicion >= 100 && g.state !== 'chase') {
      g.state = 'chase';
      game.alerted = true;
      game.alarm = Math.min(3, game.alarm + 1);
      sfx.alert();
      toast('SPOTTED! Guard ' + (g.id + 1) + ' is on you — break line of sight!');
    }
    if (g.state === 'chase') {
      g.target = g.lastSeen ? { x: g.lastSeen.x, y: g.lastSeen.y } : { x: p.x, y: p.y };
      if (g.suspicion <= 0 && !sees) { g.state = 'investigate'; }
      if (Math.hypot(p.x - g.x, p.y - g.y) < 26 && !p.hidden) return caught();
    } else if (g.state === 'investigate') {
      if (g.target && Math.hypot(g.x - g.target.x, g.y - g.target.y) < 14) {
        g.wait += dt;
        if (g.wait > 1.6) { g.state = 'patrol'; g.wait = 0; g.target = null; }
      }
    }
    // Movement by state.
    let tx = null, ty = null, speed = g.speed;
    if (g.state === 'patrol') {
      const wp = g.patrol[g.wp];
      tx = wp[0] * TILE + TILE / 2; ty = wp[1] * TILE + TILE / 2;
      if (Math.hypot(g.x - tx, g.y - ty) < 8) { g.wp = (g.wp + 1) % g.patrol.length; g.pauseT = 0.5; }
    } else {
      speed = g.state === 'chase' ? 2.5 : 1.7;
      if (g.target) { tx = g.target.x; ty = g.target.y; }
    }
    if (g.pauseT > 0) { g.pauseT -= dt; }
    else if (tx !== null) {
      const dx = tx - g.x, dy = ty - g.y, dist = Math.hypot(dx, dy);
      if (dist > 2) {
        const vx = (dx / dist) * speed, vy = (dy / dist) * speed;
        const ox = g.x, oy = g.y;
        moveCircle(g, vx, vy);
        if (Math.hypot(g.x - ox, g.y - oy) < 0.2) { g.stuck += dt; if (g.stuck > 0.8) { g.wp = (g.wp + 1) % g.patrol.length; g.stuck = 0; g.state = 'patrol'; } }
        else g.stuck = 0;
        g.dir = Math.atan2(vy, vx);
      }
    }
  }

  // --- cameras ---
  if (game.empTimer <= 0) {
    for (const c of game.cameras) {
      c.t += dt;
      const span = c.sweep[1] - c.sweep[0];
      c.angle = c.base + c.sweep[0] + (Math.sin(c.t * 0.7) * 0.5 + 0.5) * span;
      if (canSee(c.x, c.y, c.angle, c.fov, c.range)) {
        game.alerted = true;
        game.alarm = Math.min(3, game.alarm + dt * 0.25);
        if (Math.random() < dt * 2) toast('Camera on you — break its line of sight!');
      }
    }
  }
  if (game.alarm >= 3 && !game.lockdownToast) {
    game.lockdownToast = true;
    toast('LOCKDOWN — every guard is hunting. Finish fast.');
  }
  updateHUD();
}

function caught() {
  game.screen = 'caught';
  sfx.caught();
  updateHUD();
}

function heistComplete() {
  const def = game.level.def;
  const total = game.treasures.length;
  const ghost = !game.alerted;
  const under = game.time <= def.par;
  let score = game.loot * 100 + (game.starTaken ? 500 : 0) + (ghost ? 400 : 0) + (under ? 200 : 0);
  score -= Math.floor(game.time);
  let rank = 'C';
  if (ghost && under && game.loot === total) rank = 'S — GHOST';
  else if (ghost && game.loot >= total - 1) rank = 'A';
  else if (game.loot >= Math.ceil(total / 2)) rank = 'B';
  game.wonStats = {
    heist: def.name, time: Math.round(game.time), loot: game.loot, total,
    ghost, under, score, rank, alarm: game.alarm,
  };
  const prev = game.best[def.id];
  if (!prev || score > prev.score) { game.best[def.id] = { score, rank }; saveBest(); }
  game.screen = 'heistdone';
  sfx.win();
  updateHUD();
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function toast(msg) {
  if (!hud.toast) return;
  hud.toast.textContent = msg;
  hud.toast.style.opacity = '1';
  game.toastTimer = 3;
}

function fmtTime(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m + ':' + String(ss).padStart(2, '0');
}

function updateHUD() {
  if (!hud.heist || game.screen === 'menu') return;
  const def = game.level ? game.level.def : null;
  if (def) hud.heist.textContent = def.name;
  hud.time.textContent = '⏱ ' + fmtTime(game.time);
  hud.loot.textContent = '◆ ' + game.loot + '/' + (game.treasures ? game.treasures.length : 0) + (game.starTaken ? ' ★' : '');
  let maxSus = 0;
  for (const g of game.guards) maxSus = Math.max(maxSus, g.suspicion);
  hud.susFill.style.width = Math.round(maxSus) + '%';
  hud.susFill.style.background = maxSus > 70 ? '#e5484d' : maxSus > 35 ? '#f5a524' : '#46a758';
  hud.sus.textContent = 'Suspicion ' + Math.round(maxSus) + '%';
  hud.alarm.textContent = 'Alarm ' + '●'.repeat(Math.floor(game.alarm)) + '○'.repeat(3 - Math.floor(game.alarm)) + (game.empTimer > 0 ? ' · EMP ' + Math.ceil(game.empTimer) + 's' : '') + (game.cloakTimer > 0 ? ' · CLOAK ' + Math.ceil(game.cloakTimer) + 's' : '');
  const counts = game.gadgetCounts || {};
  hud.gadgets.textContent = GADGETS.map((g) => g.key + ' ' + g.name + ' ×' + (counts[g.id] || 0)).join('  ·  ');
  hud.objective.textContent = game.starTaken ? 'Objective: reach the exit (X)' : 'Objective: steal the ★ star prize, then reach the exit (X)';
  if (hud.toast && game.toastTimer <= 0) hud.toast.style.opacity = '0';
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

const lightCanvas = document.createElement('canvas');
lightCanvas.width = W; lightCanvas.height = H;
const lctx = lightCanvas.getContext('2d');

function drawFloor() {
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const t = tileAt(tx, ty);
      const x = tx * TILE, y = ty * TILE;
      if (t === '#') {
        ctx.fillStyle = (tx + ty) % 2 ? '#232838' : '#262b3d';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, y, TILE, 3);
      } else {
        ctx.fillStyle = (tx + ty) % 2 ? '#12141d' : '#14161f';
        ctx.fillRect(x, y, TILE, TILE);
      }
    }
  }
}

function drawCone(x, y, dir, fov, range, color) {
  const poly = conePolygon(x, y, dir, fov, range, 22);
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawWorld() {
  drawFloor();
  const p = game.player;

  // Hiding spots, lamps, doors, exit, treasures, star.
  for (const h of game.hideSpots) {
    ctx.fillStyle = '#3a2f1d';
    ctx.fillRect(h.x - 13, h.y - 13, 26, 26);
    ctx.strokeStyle = '#8a6d3b'; ctx.lineWidth = 2;
    ctx.strokeRect(h.x - 13, h.y - 13, 26, 26);
    ctx.fillStyle = '#c9a86a'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('HIDE', h.x, h.y + 4);
  }
  for (const l of game.lamps) {
    ctx.fillStyle = '#f5c542';
    ctx.beginPath(); ctx.arc(l.x, l.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(245,197,66,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(l.x, l.y, 10, 0, Math.PI * 2); ctx.stroke();
  }
  for (const d of game.doors) {
    if (d.open) continue;
    ctx.fillStyle = '#6b4f2a';
    ctx.fillRect(d.x - 16, d.y - 16, 32, 32);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(d.x, d.y, 4, 0, Math.PI * 2); ctx.fill();
    if (d.progress > 0) {
      ctx.fillStyle = '#46a758';
      ctx.fillRect(d.x - 14, d.y - 22, 28 * d.progress, 4);
    }
  }
  // Exit.
  const ex = game.exitTile;
  ctx.fillStyle = 'rgba(70,167,88,0.25)';
  ctx.fillRect(ex.x - 16, ex.y - 16, 32, 32);
  ctx.strokeStyle = '#46a758'; ctx.lineWidth = 2;
  ctx.strokeRect(ex.x - 16, ex.y - 16, 32, 32);
  ctx.fillStyle = '#7ee787'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
  ctx.fillText('EXIT', ex.x, ex.y + 5);
  // Treasures.
  for (const t of game.treasures) {
    if (t.taken) continue;
    ctx.fillStyle = '#ffd166';
    ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-6, -6, 12, 12); ctx.restore();
    ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1.5;
    ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(Math.PI / 4); ctx.strokeRect(-6, -6, 12, 12); ctx.restore();
  }
  // Star prize.
  if (game.star && !game.star.taken) {
    const s = game.star;
    ctx.fillStyle = '#ff5d8f';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 5 : 12, a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx[i ? 'lineTo' : 'moveTo'](s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 11px monospace';
    ctx.fillText('★ PRIZE', s.x, s.y - 18);
  }

  // Noise rings.
  for (const n of game.noises) {
    const a = (n.ttl / n.max) * 0.8;
    ctx.strokeStyle = 'rgba(255,209,102,' + a + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (1 - n.ttl / n.max) + 8, 0, Math.PI * 2); ctx.stroke();
  }
  // Smoke clouds.
  for (const s of game.smokes) {
    ctx.fillStyle = 'rgba(160,160,170,0.55)';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(200,200,210,0.4)';
    ctx.beginPath(); ctx.arc(s.x - 20, s.y - 10, s.r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s.x + 22, s.y + 12, s.r * 0.55, 0, Math.PI * 2); ctx.fill();
  }

  // Guard + camera vision cones (under the darkness so they glow through it).
  for (const g of game.guards) {
    const col = g.state === 'chase' ? 'rgba(229,72,77,0.34)'
      : g.state === 'investigate' ? 'rgba(245,165,36,0.30)' : 'rgba(245,197,66,0.22)';
    drawCone(g.x, g.y, g.dir, 1.22, 235, col);
  }
  for (const c of game.cameras) {
    if (game.empTimer > 0) continue;
    drawCone(c.x, c.y, c.angle, c.fov, c.range, 'rgba(229,72,77,0.20)');
  }

  // Darkness: lamps and the player punch holes in the night.
  lctx.clearRect(0, 0, W, H);
  lctx.fillStyle = 'rgba(4,6,14,0.62)';
  lctx.fillRect(0, 0, W, H);
  lctx.globalCompositeOperation = 'destination-out';
  for (const l of game.lamps) {
    const grad = lctx.createRadialGradient(l.x, l.y, 8, l.x, l.y, l.r);
    grad.addColorStop(0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = grad;
    lctx.beginPath(); lctx.arc(l.x, l.y, l.r, 0, Math.PI * 2); lctx.fill();
  }
  const pg = lctx.createRadialGradient(p.x, p.y, 6, p.x, p.y, 70);
  pg.addColorStop(0, 'rgba(0,0,0,0.9)');
  pg.addColorStop(1, 'rgba(0,0,0,0)');
  lctx.fillStyle = pg;
  lctx.beginPath(); lctx.arc(p.x, p.y, 70, 0, Math.PI * 2); lctx.fill();
  lctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(lightCanvas, 0, 0);

  // Cameras (bodies).
  for (const c of game.cameras) {
    ctx.fillStyle = game.empTimer > 0 ? '#555' : '#e5484d';
    ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(c.angle) * 16, c.y + Math.sin(c.angle) * 16); ctx.stroke();
  }
  // Guards.
  for (const g of game.guards) {
    // Suspicion ring.
    if (g.suspicion > 1) {
      ctx.strokeStyle = g.suspicion > 70 ? '#e5484d' : '#f5a524';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(g.x, g.y, 18, -Math.PI / 2, -Math.PI / 2 + (g.suspicion / 100) * Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = g.state === 'chase' ? '#e5484d' : g.state === 'investigate' ? '#f5a524' : '#7a8699';
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0b0d12'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.stroke();
    // Facing tick.
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(g.x, g.y);
    ctx.lineTo(g.x + Math.cos(g.dir) * 15, g.y + Math.sin(g.dir) * 15); ctx.stroke();
    // State mark.
    if (g.state !== 'patrol') {
      ctx.fillStyle = g.state === 'chase' ? '#e5484d' : '#f5a524';
      ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
      ctx.fillText(g.state === 'chase' ? '!' : '?', g.x, g.y - 18);
    }
  }
  // Player.
  ctx.save();
  if (game.cloakTimer > 0) ctx.globalAlpha = 0.45;
  ctx.fillStyle = p.hidden ? '#8a6d3b' : '#4cc38a';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0b0d12'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(p.dir) * 15, p.y + Math.sin(p.dir) * 15); ctx.stroke();
  ctx.restore();
  if (p.hidden) {
    ctx.fillStyle = '#c9a86a'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('HIDDEN — E to leave', p.x, p.y - 20);
  }
  if (game.lockpicking) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    ctx.fillText('PICKING… ' + Math.round(game.lockpicking.progress * 100) + '%', p.x, p.y - 22);
  }
  drawMinimap();
}

function drawMinimap() {
  if (!mctx) return;
  const s = 120 / W;
  mctx.clearRect(0, 0, 120, 76);
  mctx.fillStyle = '#0b0d12';
  mctx.fillRect(0, 0, 120, 76);
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (tileAt(tx, ty) === '#') { mctx.fillStyle = '#3a4157'; mctx.fillRect(tx * TILE * s, ty * TILE * s, TILE * s, TILE * s); }
    }
  }
  mctx.fillStyle = '#ffd166';
  for (const t of game.treasures) if (!t.taken) mctx.fillRect(t.x * s - 1, t.y * s - 1, 2, 2);
  if (game.star && !game.star.taken) { mctx.fillStyle = '#ff5d8f'; mctx.fillRect(game.star.x * s - 2, game.star.y * s - 2, 4, 4); }
  mctx.fillStyle = '#46a758';
  mctx.fillRect(game.exitTile.x * s - 2, game.exitTile.y * s - 2, 4, 4);
  mctx.fillStyle = '#e5484d';
  for (const g of game.guards) { mctx.beginPath(); mctx.arc(g.x * s, g.y * s, 2.5, 0, Math.PI * 2); mctx.fill(); }
  mctx.fillStyle = '#4cc38a';
  mctx.beginPath(); mctx.arc(game.player.x * s, game.player.y * s, 3, 0, Math.PI * 2); mctx.fill();
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

function drawMenu() {
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  // Decorative cones (plain triangles — no level loaded yet, so no raycast).
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(245,197,66,0.20)';
  ctx.beginPath(); ctx.moveTo(200, 300); ctx.lineTo(430, 180); ctx.lineTo(430, 420); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(760, 320); ctx.lineTo(530, 200); ctx.lineTo(530, 440); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f5c542';
  ctx.font = 'bold 54px monospace';
  ctx.fillText('BLACKOUT', W / 2, 110);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = 'bold 24px monospace';
  ctx.fillText('The Meridian Heist', W / 2, 148);
  ctx.fillStyle = '#9aa3b2';
  ctx.font = '15px monospace';
  ctx.fillText('6 heists · 24 guards · 40 treasures · 5 gadgets', W / 2, 178);
  ctx.fillText('Raycast vision cones · suspicion · noise · light & shadow · hiding · cameras · alarms · lockpicking', W / 2, 202);
  HEISTS.forEach((h, i) => {
    const y = 248 + i * 46;
    const sel = i === game.menuSel;
    if (sel) {
      ctx.fillStyle = 'rgba(245,197,66,0.16)';
      ctx.fillRect(180, y - 24, 600, 36);
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 1.5;
      ctx.strokeRect(180, y - 24, 600, 36);
    }
    ctx.fillStyle = sel ? '#ffd166' : '#d7dce6';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(h.name, 200, y);
    ctx.textAlign = 'right';
    const best = game.best[h.id];
    ctx.fillStyle = '#9aa3b2';
    ctx.font = '14px monospace';
    ctx.fillText(best ? 'Best: ' + best.rank + ' · ' + best.score + ' pts' : 'Par ' + fmtTime(h.par), 760, y);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9aa3b2';
  ctx.font = '14px monospace';
  ctx.fillText('↑↓ choose heist · Enter to play · WASD move · Shift run (loud) · Ctrl sneak · E hide / pick locks', W / 2, 248 + HEISTS.length * 46 + 8);
  ctx.fillText('1-5 gadgets · click to toss a pebble · steal the ★ then reach EXIT unseen', W / 2, 248 + HEISTS.length * 46 + 30);
}

function drawCaught() {
  drawWorld();
  ctx.fillStyle = 'rgba(10,0,0,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e5484d';
  ctx.font = 'bold 52px monospace';
  ctx.fillText('CAUGHT', W / 2, 250);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '18px monospace';
  ctx.fillText('The guards were faster than your shadow.', W / 2, 292);
  ctx.fillStyle = '#9aa3b2';
  ctx.font = '15px monospace';
  ctx.fillText('Enter — retry this heist · Esc — menu', W / 2, 330);
}

function drawHeistDone() {
  const s = game.wonStats;
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4cc38a';
  ctx.font = 'bold 46px monospace';
  ctx.fillText('CLEAN GETAWAY', W / 2, 130);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '20px monospace';
  ctx.fillText(s.heist, W / 2, 172);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 30px monospace';
  ctx.fillText('Rank ' + s.rank, W / 2, 224);
  ctx.fillStyle = '#d7dce6';
  ctx.font = '17px monospace';
  ctx.fillText('Time ' + fmtTime(s.time) + '  ·  Loot ' + s.loot + '/' + s.total + '  ·  Score ' + s.score, W / 2, 266);
  ctx.fillText('Ghost: ' + (s.ghost ? 'YES — never spotted' : 'no — you were seen') + '  ·  Under par: ' + (s.under ? 'yes' : 'no') + '  ·  Alarms: ' + s.alarm + '/3', W / 2, 296);
  ctx.fillStyle = '#9aa3b2';
  ctx.font = '15px monospace';
  ctx.fillText('Enter — next heist · Esc — menu', W / 2, 350);
}

function drawWon() {
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4cc38a';
  ctx.font = 'bold 46px monospace';
  ctx.fillText('THE MERIDIAN HEIST', W / 2, 200);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '20px monospace';
  ctx.fillText('All six jobs done. The crew vanishes into the night.', W / 2, 250);
  ctx.fillStyle = '#9aa3b2';
  ctx.font = '15px monospace';
  ctx.fillText('Enter — menu', W / 2, 300);
}

function render() {
  if (game.screen === 'menu') { drawMenu(); return; }
  if (game.screen === 'caught') { drawCaught(); return; }
  if (game.screen === 'heistdone') { drawHeistDone(); return; }
  if (game.screen === 'won') { drawWon(); return; }
  drawWorld();
}

/* ------------------------------------------------------------------ */
/* Screenshot scenes: deterministic staged states for ?shot=           */
/* ------------------------------------------------------------------ */

function applyShot() {
  const q = new URLSearchParams(window.location.search);
  const shot = q.get('shot');
  if (!shot) return;
  const rng = mulberry32(1337);
  if (shot === 'cover') {
    loadHeist(0);
    game.player.x = 9 * TILE + 16; game.player.y = 9 * TILE + 16;
    game.player.dir = 0.4;
    game.guards[0].x = 12 * TILE + 16; game.guards[0].y = 8 * TILE + 16; game.guards[0].dir = 2.6;
    game.guards[1].x = 25 * TILE + 16; game.guards[1].y = 9 * TILE + 16; game.guards[1].dir = Math.PI;
    toast('The Dusk Gallery — stay out of the cones.');
  } else if (shot === 'alert') {
    loadHeist(1);
    game.player.x = 16 * TILE + 16; game.player.y = 9 * TILE + 16;
    game.player.dir = -1.2; game.player.running = true;
    const g = game.guards[1];
    g.x = 19 * TILE + 16; g.y = 9 * TILE + 16; g.dir = Math.PI;
    g.state = 'chase'; g.suspicion = 100; g.lastSeen = { x: game.player.x, y: game.player.y };
    game.alerted = true; game.alarm = 1;
    game.loot = 3; game.treasures[0].taken = true; game.treasures[1].taken = true; game.treasures[2].taken = true;
    emitNoise(game.player.x, game.player.y, 90);
    toast('SPOTTED! Break line of sight!');
  } else if (shot === 'vault') {
    loadHeist(4);
    game.player.x = 24 * TILE + 16; game.player.y = 3 * TILE + 16;
    game.player.dir = Math.PI; game.player.sneaking = true;
    game.starTaken = false;
    game.loot = 5;
    game.treasures.forEach((t, i) => { if (i < 5) t.taken = true; });
    game.smokes.push({ x: 20 * TILE + 16, y: 6 * TILE + 16, r: 90, ttl: 5 });
    game.guards[0].x = 5 * TILE + 16; game.guards[0].y = 8 * TILE + 16; game.guards[0].dir = 0;
    game.guards[1].x = 18 * TILE + 16; game.guards[1].y = 9 * TILE + 16; game.guards[1].dir = -0.6;
    game.guards[1].state = 'investigate'; game.guards[1].target = { x: 20 * TILE + 16, y: 6 * TILE + 16 };
    game.guards[1].suspicion = 55;
    toast('The Glasshouse — smoke out, move quiet.');
  } else if (shot === 'victory') {
    loadHeist(0);
    game.wonStats = {
      heist: '1 · The Dusk Gallery', time: 132, loot: 5, total: 5,
      ghost: true, under: true, score: 1468, rank: 'S — GHOST', alarm: 0,
    };
    game.screen = 'heistdone';
    toast('');
  }
  updateHUD();
  window.__shotReady = true;
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

let last = 0;
function loop(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
  last = ts;
  if (game.screen === 'playing') update(dt);
  render();
  requestAnimationFrame(loop);
}

applyShot();
if (game.screen === 'menu') updateHUD();
requestAnimationFrame(loop);
