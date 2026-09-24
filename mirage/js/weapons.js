'use strict';
// Weapon stats (modelled on CS2 values) and procedural weapon models.

// Recoil patterns: cumulative [yaw, pitch] offsets in degrees for each shot of a spray.
function curve(n, peak, rise, wobble) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = peak * (1 - Math.exp(-i / rise));
    const y = wobble ? wobble(i) : 0;
    out.push([y, p]);
  }
  return out;
}
const PATTERNS = {
  ak47: [[0, 0], [0.05, 0.35], [-0.05, 0.95], [0.1, 1.8], [0.25, 2.8], [0.15, 3.8], [-0.1, 4.7], [-0.35, 5.4], [-0.2, 5.95], [0.3, 6.35],
    [1.0, 6.65], [1.7, 6.85], [2.2, 7.0], [2.5, 7.1], [2.6, 7.2], [2.4, 7.25], [1.9, 7.3], [1.2, 7.35], [0.4, 7.4], [-0.5, 7.45],
    [-1.4, 7.5], [-2.2, 7.5], [-2.7, 7.55], [-2.9, 7.6], [-2.8, 7.6], [-2.4, 7.65], [-1.7, 7.7], [-0.9, 7.7], [-0.2, 7.75], [0.5, 7.8]],
  m4a4: [[0, 0], [-0.05, 0.3], [0.05, 0.8], [0, 1.5], [-0.1, 2.3], [0.1, 3.1], [0.2, 3.8], [0.05, 4.4], [-0.2, 4.9], [-0.6, 5.3],
    [-1.1, 5.6], [-1.5, 5.8], [-1.7, 5.95], [-1.6, 6.05], [-1.2, 6.15], [-0.6, 6.2], [0.1, 6.25], [0.8, 6.3], [1.4, 6.35], [1.8, 6.4],
    [1.9, 6.4], [1.7, 6.45], [1.2, 6.5], [0.6, 6.5], [0, 6.55], [-0.5, 6.6], [-0.9, 6.6], [-1.1, 6.65], [-1.0, 6.7], [-0.7, 6.7]],
  m4a1s: curve(20, 5.4, 4.2, i => i < 7 ? 0.05 * Math.sin(i * 1.7) : Math.sin((i - 7) / 4) * 1.1),
  galil: curve(35, 6.6, 4.4, i => i < 8 ? 0.05 * Math.sin(i * 2) : Math.sin((i - 8) / 4.2) * 2.0),
  famas: curve(25, 6.0, 4.2, i => i < 7 ? 0.08 * Math.sin(i * 2) : -Math.sin((i - 7) / 4) * 1.6),
  mac10: curve(30, 5.4, 5.0, i => Math.sin(i / 2.6) * 1.8 * Math.min(1, i / 5)),
  mp9: curve(30, 5.0, 5.0, i => -Math.sin(i / 3) * 1.5 * Math.min(1, i / 5)),
  glock: curve(20, 9, 8, i => Math.sin(i * 2.3) * 0.35 * Math.min(1, i)),
  usp: curve(12, 8, 6, i => Math.sin(i * 2.1) * 0.3 * Math.min(1, i)),
  p250: curve(13, 9, 6, i => Math.sin(i * 1.9) * 0.4 * Math.min(1, i)),
  deagle: curve(7, 12, 3, i => Math.sin(i * 1.3) * 0.8 * Math.min(1, i)),
  sg553: curve(30, 6.2, 4.6, i => i < 8 ? 0.06 * Math.sin(i * 1.9) : -Math.sin((i - 8) / 4.3) * 1.9),
  aug: curve(30, 5.8, 4.6, i => i < 8 ? 0.05 * Math.sin(i * 2.2) : Math.sin((i - 8) / 4.6) * 1.7),
  ump45: curve(25, 5.0, 4.4, i => Math.sin(i / 3.2) * 1.3 * Math.min(1, i / 5)),
  p90: curve(50, 5.4, 6.0, i => Math.sin(i / 4) * 1.6 * Math.min(1, i / 6)),
  tec9: curve(18, 10, 6, i => Math.sin(i * 2.4) * 0.5 * Math.min(1, i)),
  fiveseven: curve(20, 8.5, 6, i => Math.sin(i * 2.2) * 0.35 * Math.min(1, i)),
  shotgun: curve(8, 6, 1.2, () => 0),
  none: [[0, 0]],
};

// Inaccuracy values are in milliradians. spread is the base cone, inFire the bloom per shot.
const WEAPONS = {
  knife: { name: 'Knife', slot: 3, type: 'knife', price: 0, speed: 250, deploy: 0.75, dmg: 40, dmg2: 65, rate: 0.4, rate2: 1.0, reach: 50, kill: 1500 },
  glock: { name: 'Glock-18', slot: 2, type: 'pistol', team: 'T', price: 200, dmg: 30, ap: 0.47, rpm: 400, auto: false, mag: 20, reserve: 120, reload: 2.27, deploy: 1.0, speed: 240, rangeMod: 0.85, pen: 25, spread: 2.0, inStand: 7.0, inCrouch: 5.2, inMove: 13.5, inJump: 45, inFire: 56, recovery: 0.33, pattern: 'glock', punch: 1.4, kill: 300, snd: 'glock' },
  usp: { name: 'USP-S', slot: 2, type: 'pistol', team: 'CT', price: 200, dmg: 35, ap: 0.505, rpm: 352, auto: false, mag: 12, reserve: 24, reload: 2.17, deploy: 1.0, speed: 240, rangeMod: 0.99, pen: 25, spread: 1.0, inStand: 4.0, inCrouch: 3.2, inMove: 12, inJump: 45, inFire: 50, recovery: 0.34, pattern: 'usp', punch: 1.5, kill: 300, snd: 'usp', silenced: true },
  p250: { name: 'P250', slot: 2, type: 'pistol', price: 300, dmg: 38, ap: 0.64, rpm: 400, auto: false, mag: 13, reserve: 26, reload: 2.2, deploy: 1.0, speed: 240, rangeMod: 0.85, pen: 30, spread: 2.0, inStand: 6.4, inCrouch: 5.0, inMove: 13.5, inJump: 45, inFire: 52, recovery: 0.34, pattern: 'p250', punch: 1.6, kill: 300, snd: 'p250' },
  deagle: { name: 'Desert Eagle', slot: 2, type: 'pistol', price: 700, dmg: 53, ap: 0.932, rpm: 267, auto: false, mag: 7, reserve: 35, reload: 2.2, deploy: 1.0, speed: 230, rangeMod: 0.81, pen: 50, spread: 2.0, inStand: 5.8, inCrouch: 4.4, inMove: 34, inJump: 110, inFire: 58, recovery: 0.42, pattern: 'deagle', punch: 3.0, kill: 300, snd: 'deagle' },
  tec9: { name: 'Tec-9', slot: 2, type: 'pistol', team: 'T', price: 500, dmg: 33, ap: 0.906, rpm: 500, auto: false, mag: 18, reserve: 90, reload: 2.5, deploy: 1.0, speed: 240, rangeMod: 0.831, pen: 40, spread: 2.0, inStand: 8.6, inCrouch: 6.6, inMove: 14, inJump: 45, inFire: 62, recovery: 0.4, pattern: 'tec9', punch: 1.5, kill: 300, snd: 'p250' },
  fiveseven: { name: 'Five-SeveN', slot: 2, type: 'pistol', team: 'CT', price: 500, dmg: 32, ap: 0.911, rpm: 400, auto: false, mag: 20, reserve: 100, reload: 2.2, deploy: 1.0, speed: 240, rangeMod: 0.81, pen: 40, spread: 2.0, inStand: 6.0, inCrouch: 4.6, inMove: 12, inJump: 45, inFire: 56, recovery: 0.35, pattern: 'fiveseven', punch: 1.4, kill: 300, snd: 'glock' },
  nova: { name: 'Nova', slot: 1, type: 'shotgun', price: 1050, dmg: 26, pellets: 9, pelletSpread: 45, ap: 0.5, rpm: 68, auto: false, mag: 8, reserve: 32, reload: 0.55, shells: true, deploy: 1.0, speed: 220, rangeMod: 0.7, pen: 10, spread: 1.0, inStand: 9, inCrouch: 7, inMove: 40, inJump: 60, inFire: 30, recovery: 0.5, pattern: 'shotgun', punch: 2.4, kill: 900, snd: 'shotgun' },
  xm1014: { name: 'XM1014', slot: 1, type: 'shotgun', price: 2000, dmg: 20, pellets: 6, pelletSpread: 42, ap: 0.8, rpm: 171, auto: true, mag: 7, reserve: 32, reload: 0.45, shells: true, deploy: 1.0, speed: 215, rangeMod: 0.7, pen: 10, spread: 1.0, inStand: 9, inCrouch: 7, inMove: 45, inJump: 60, inFire: 26, recovery: 0.45, pattern: 'shotgun', punch: 1.8, kill: 900, snd: 'shotgun' },
  mac10: { name: 'MAC-10', slot: 1, type: 'smg', team: 'T', price: 1050, dmg: 29, ap: 0.575, rpm: 800, auto: true, mag: 30, reserve: 100, reload: 2.57, deploy: 1.0, speed: 240, rangeMod: 0.8, pen: 28, spread: 0.6, inStand: 13, inCrouch: 9, inMove: 42, inJump: 60, inFire: 10, recovery: 0.35, pattern: 'mac10', punch: 0.5, kill: 600, snd: 'smg' },
  mp9: { name: 'MP9', slot: 1, type: 'smg', team: 'CT', price: 1250, dmg: 26, ap: 0.6, rpm: 857, auto: true, mag: 30, reserve: 120, reload: 2.13, deploy: 1.0, speed: 240, rangeMod: 0.87, pen: 28, spread: 0.6, inStand: 11, inCrouch: 8, inMove: 36, inJump: 60, inFire: 9, recovery: 0.32, pattern: 'mp9', punch: 0.45, kill: 600, snd: 'smg' },
  ump45: { name: 'UMP-45', slot: 1, type: 'smg', price: 1200, dmg: 35, ap: 0.65, rpm: 666, auto: true, mag: 25, reserve: 100, reload: 3.5, deploy: 1.0, speed: 230, rangeMod: 0.75, pen: 30, spread: 0.6, inStand: 13, inCrouch: 9, inMove: 40, inJump: 60, inFire: 9, recovery: 0.35, pattern: 'ump45', punch: 0.55, kill: 600, snd: 'smg' },
  p90: { name: 'P90', slot: 1, type: 'smg', price: 2350, dmg: 26, ap: 0.69, rpm: 857, auto: true, mag: 50, reserve: 100, reload: 3.3, deploy: 1.0, speed: 230, rangeMod: 0.86, pen: 30, spread: 0.6, inStand: 12, inCrouch: 9, inMove: 34, inJump: 60, inFire: 8, recovery: 0.35, pattern: 'p90', punch: 0.45, kill: 300, snd: 'smg' },
  galil: { name: 'Galil AR', slot: 1, type: 'rifle', team: 'T', price: 1800, dmg: 30, ap: 0.775, rpm: 666, auto: true, mag: 35, reserve: 90, reload: 2.95, deploy: 1.0, speed: 215, rangeMod: 0.98, pen: 55, spread: 0.6, inStand: 7.4, inCrouch: 5.6, inMove: 160, inJump: 130, inFire: 8.5, recovery: 0.40, pattern: 'galil', punch: 0.6, kill: 300, snd: 'galil' },
  famas: { name: 'FAMAS', slot: 1, type: 'rifle', team: 'CT', price: 2050, dmg: 30, ap: 0.7, rpm: 666, auto: true, mag: 25, reserve: 90, reload: 3.3, deploy: 1.0, speed: 220, rangeMod: 0.96, pen: 55, spread: 0.6, inStand: 6.4, inCrouch: 4.9, inMove: 150, inJump: 125, inFire: 8.0, recovery: 0.38, pattern: 'famas', punch: 0.55, kill: 300, snd: 'famas' },
  ak47: { name: 'AK-47', slot: 1, type: 'rifle', team: 'T', price: 2700, dmg: 36, ap: 0.775, rpm: 600, auto: true, mag: 30, reserve: 90, reload: 2.43, deploy: 1.0, speed: 215, rangeMod: 0.98, pen: 62, spread: 0.6, inStand: 6.4, inCrouch: 4.8, inMove: 175, inJump: 140, inFire: 7.8, recovery: 0.42, pattern: 'ak47', punch: 0.7, kill: 300, snd: 'ak47' },
  m4a4: { name: 'M4A4', slot: 1, type: 'rifle', team: 'CT', price: 3100, dmg: 33, ap: 0.7, rpm: 666, auto: true, mag: 30, reserve: 90, reload: 3.07, deploy: 1.0, speed: 225, rangeMod: 0.97, pen: 60, spread: 0.6, inStand: 5.0, inCrouch: 3.7, inMove: 140, inJump: 120, inFire: 7.0, recovery: 0.43, pattern: 'm4a4', punch: 0.6, kill: 300, snd: 'm4a4' },
  m4a1s: { name: 'M4A1-S', slot: 1, type: 'rifle', team: 'CT', price: 2900, dmg: 38, ap: 0.7, rpm: 600, auto: true, mag: 20, reserve: 80, reload: 3.07, deploy: 1.0, speed: 225, rangeMod: 0.99, pen: 60, spread: 0.6, inStand: 4.0, inCrouch: 3.0, inMove: 123, inJump: 113, inFire: 5.8, recovery: 0.39, pattern: 'm4a1s', punch: 0.5, kill: 300, snd: 'm4a1s', silenced: true },
  sg553: { name: 'SG 553', slot: 1, type: 'rifle', team: 'T', price: 3000, dmg: 30, ap: 1.0, rpm: 666, scopedRpm: 545, auto: true, mag: 30, reserve: 90, reload: 2.8, deploy: 1.0, speed: 210, scopedSpeed: 150, rangeMod: 0.98, pen: 62, spread: 0.6, inStand: 6.2, inCrouch: 4.6, inMove: 150, inJump: 130, inFire: 7.4, recovery: 0.4, scope: true, zoom: [45], pattern: 'sg553', punch: 0.6, kill: 300, snd: 'galil' },
  aug: { name: 'AUG', slot: 1, type: 'rifle', team: 'CT', price: 3300, dmg: 28, ap: 0.9, rpm: 666, scopedRpm: 600, auto: true, mag: 30, reserve: 90, reload: 3.8, deploy: 1.0, speed: 220, scopedSpeed: 150, rangeMod: 0.98, pen: 60, spread: 0.6, inStand: 5.2, inCrouch: 3.9, inMove: 140, inJump: 120, inFire: 7.0, recovery: 0.4, scope: true, zoom: [45], pattern: 'aug', punch: 0.55, kill: 300, snd: 'famas' },
  ssg08: { name: 'SSG 08', slot: 1, type: 'sniper', price: 1700, dmg: 88, ap: 0.85, rpm: 48, auto: false, mag: 10, reserve: 90, reload: 3.7, deploy: 1.0, speed: 230, scopedSpeed: 230, rangeMod: 0.98, pen: 70, spread: 0.3, inStand: 2.2, inCrouch: 1.6, inMove: 85, inJump: 50, inFire: 30, recovery: 0.5, noScope: 45, zoom: [40, 15], pattern: 'none', punch: 2.2, kill: 300, snd: 'ssg', bolt: true },
  awp: { name: 'AWP', slot: 1, type: 'sniper', price: 4750, dmg: 115, ap: 0.975, rpm: 41, auto: false, mag: 5, reserve: 30, reload: 3.67, deploy: 1.25, speed: 200, scopedSpeed: 100, rangeMod: 0.99, pen: 95, spread: 0.2, inStand: 1.6, inCrouch: 1.2, inMove: 172, inJump: 180, inFire: 60, recovery: 0.35, noScope: 90, zoom: [40, 10], pattern: 'none', punch: 3.0, kill: 100, snd: 'awp', bolt: true },
  he: { name: 'HE Grenade', slot: 4, type: 'grenade', price: 300, speed: 245, deploy: 0.6, kill: 300 },
  flash: { name: 'Flashbang', slot: 4, type: 'grenade', price: 200, speed: 245, deploy: 0.6, max: 2 },
  smoke: { name: 'Smoke Grenade', slot: 4, type: 'grenade', price: 300, speed: 245, deploy: 0.6 },
  molotov: { name: 'Molotov', slot: 4, type: 'grenade', team: 'T', price: 400, speed: 245, deploy: 0.6 },
  incgrenade: { name: 'Incendiary Grenade', slot: 4, type: 'grenade', team: 'CT', price: 500, speed: 245, deploy: 0.6 },
  c4: { name: 'C4 Explosive', slot: 5, type: 'c4', price: 0, speed: 250, deploy: 0.8 },
};
for (const id in WEAPONS) {
  const w = WEAPONS[id];
  w.id = id;
  if (w.rpm) w.cycle = 60 / w.rpm;
  if (w.pattern) w.pat = PATTERNS[w.pattern];
  if (w.scopedRpm) w.cycleScoped = 60 / w.scopedRpm;
}

const EQUIPMENT = {
  vest: { name: 'Kevlar Vest', price: 650 },
  vesthelm: { name: 'Kevlar + Helmet', price: 1000 },
  defuser: { name: 'Defuse Kit', price: 400, team: 'CT' },
};

// Buy menu layout, CS2 style categories.
const BUY_MENU = [
  { name: 'Pistols', items: { T: ['glock', 'tec9', 'p250', 'deagle'], CT: ['usp', 'fiveseven', 'p250', 'deagle'] } },
  { name: 'Mid-Tier', items: { T: ['nova', 'xm1014', 'mac10', 'ump45', 'p90'], CT: ['nova', 'xm1014', 'mp9', 'ump45', 'p90'] } },
  { name: 'Rifles', items: { T: ['galil', 'ak47', 'ssg08', 'sg553', 'awp'], CT: ['famas', 'm4a4', 'm4a1s', 'ssg08', 'aug', 'awp'] } },
  { name: 'Grenades', items: { T: ['flash', 'smoke', 'he', 'molotov'], CT: ['flash', 'smoke', 'he', 'incgrenade'] } },
  { name: 'Equipment', items: { T: ['vest', 'vesthelm'], CT: ['vest', 'vesthelm', 'defuser'] } },
];

// Recoil offset for a (fractional) spray index.
function recoilAt(w, idx) {
  const p = w.pat;
  if (!p || p.length < 2) return [0, 0];
  if (idx <= 0) return [0, 0];
  const i = Math.min(Math.floor(idx), p.length - 1), f = idx - Math.floor(idx);
  const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// Damage after range falloff, hit group and armour.
function computeDamage(w, dist, group, target, penMul = 1) {
  let d = w.dmg * Math.pow(w.rangeMod || 1, dist / 500) * penMul;
  const mult = group === 'head' ? 4 : group === 'stomach' ? 1.25 : group === 'legs' ? 0.75 : 1;
  d *= mult;
  let armorHit = false;
  if (target.armor > 0 && (group !== 'legs') && (group !== 'head' || target.helmet)) {
    armorHit = true;
    const ratio = w.ap;
    let hp = d * ratio;
    let armorDmg = (d - hp) * 0.5;
    if (armorDmg > target.armor) { hp = d - target.armor * 2; armorDmg = target.armor; }
    return { hp: Math.max(1, Math.round(hp)), armor: Math.round(armorDmg), armorHit };
  }
  return { hp: Math.max(1, Math.round(d)), armor: 0, armorHit };
}

if (typeof module !== 'undefined') module.exports = { WEAPONS, EQUIPMENT, BUY_MENU, PATTERNS, recoilAt, computeDamage };

// ---------------- models (browser only) ----------------
const WeaponModels = (() => {
  if (typeof THREE === 'undefined') return null;
  const C = hex => new THREE.Color(hex).convertSRGBToLinear();
  const M = {};
  function mats() {
    if (M.metal) return M;
    const grain = Tex.get('grain'); grain.encoding = THREE.sRGBEncoding;
    M.metal = new THREE.MeshPhongMaterial({ color: C('#44474d'), shininess: 60, specular: C('#666666') });
    M.dark = new THREE.MeshPhongMaterial({ color: C('#2a2b2f'), shininess: 45, specular: C('#555555') });
    M.poly = new THREE.MeshPhongMaterial({ color: C('#35373a'), shininess: 14, specular: C('#2a2a2a') });
    M.wood = new THREE.MeshPhongMaterial({ map: grain, color: C('#c89a70'), shininess: 25, specular: C('#2a1a10') });
    M.silver = new THREE.MeshPhongMaterial({ color: C('#b9bec4'), shininess: 90, specular: C('#aaaaaa') });
    M.olive = new THREE.MeshPhongMaterial({ color: C('#3f4c30'), shininess: 20, specular: C('#222222') });
    M.slate = new THREE.MeshPhongMaterial({ color: C('#44525e'), shininess: 25, specular: C('#333333') });
    M.tan = new THREE.MeshPhongMaterial({ color: C('#a8926a'), shininess: 15 });
    M.brass = new THREE.MeshPhongMaterial({ color: C('#c29a45'), shininess: 80, specular: C('#886633') });
    M.glass = new THREE.MeshPhongMaterial({ color: C('#1d2833'), shininess: 100, specular: C('#aaaaaa') });
    M.blade = new THREE.MeshPhongMaterial({ color: C('#c8ccd0'), shininess: 120, specular: C('#ffffff') });
    M.green = new THREE.MeshPhongMaterial({ color: C('#4b5a36'), shininess: 25 });
    M.grey = new THREE.MeshPhongMaterial({ color: C('#6b6f73'), shininess: 40 });
    M.red = new THREE.MeshPhongMaterial({ color: C('#a3261d'), shininess: 30 });
    M.blue = new THREE.MeshPhongMaterial({ color: C('#2e5fa0'), shininess: 30 });
    M.white = new THREE.MeshPhongMaterial({ color: C('#d8d4c8'), shininess: 20 });
    M.bottle = new THREE.MeshPhongMaterial({ color: C('#6b4a1c'), shininess: 100, specular: C('#ffffff'), transparent: true, opacity: 0.85 });
    M.c4 = new THREE.MeshPhongMaterial({ color: C('#b8a476'), shininess: 10 });
    M.led = new THREE.MeshBasicMaterial({ color: C('#ff2a1a') });
    return M;
  }
  function box(g, w, h, l, m, x, y, z, rx = 0, ry = 0, rz = 0) {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    me.position.set(x, y, z); me.rotation.set(rx, ry, rz);
    g.add(me); return me;
  }
  function cyl(g, r, l, m, x, y, z, seg = 12, axis = 'z') {
    const geo = new THREE.CylinderGeometry(r, r, l, seg);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); g.add(me); return me;
  }

  // Each builder returns { group, muzzle, mag, grip, fore, eject }.
  // Gun space: barrel points -z, y up, x right. Units are world units (about an inch).
  const B = {};
  B.ak47 = () => {
    const m = mats(), g = new THREE.Group();
    box(g, 1.6, 2.4, 11, m.metal, 0, 0, 0);
    box(g, 1.5, 0.7, 9, m.metal, 0, 1.4, 0.5);
    box(g, 2.0, 2.0, 7, m.wood, 0, -0.1, -9);
    box(g, 1.3, 1.0, 6.5, m.wood, 0, 1.5, -9.2);
    box(g, 0.6, 0.6, 9, m.dark, 0, 0.4, -16.5);
    box(g, 0.45, 0.45, 8, m.dark, 0, 1.4, -15.5);
    box(g, 0.4, 1.4, 0.5, m.dark, 0, 1.2, -20);
    box(g, 0.9, 0.9, 1.4, m.dark, 0, 0.4, -21.5);
    box(g, 0.8, 0.6, 0.8, m.dark, 0, 1.9, -4);
    box(g, 1.5, 2.4, 9.5, m.wood, 0, -0.9, 10, -0.12);
    box(g, 1.6, 4.0, 1.2, m.dark, 0, -1.6, 14.8, -0.12);
    box(g, 1.2, 3.5, 1.6, m.wood, 0, -2.6, 3.3, 0.35);
    box(g, 0.3, 0.3, 2.4, m.dark, 0, -1.6, 1.4);
    const mag = new THREE.Group(); mag.position.set(0, -1.2, -2.6);
    box(mag, 1.1, 3, 2.2, m.metal, 0, -1.5, 0);
    box(mag, 1.1, 3, 2.2, m.metal, 0, -4.2, -0.9, 0.35);
    box(mag, 1.1, 2.8, 2.2, m.metal, 0, -6.5, -2.5, 0.65);
    g.add(mag);
    return { group: g, muzzle: [0, 0.4, -22.4], mag, grip: [0, -3.2, 3.6], fore: [0, -0.9, -9], eject: [0.9, 1.2, 0] };
  };
  B.galil = () => {
    const m = mats(), g = new THREE.Group();
    box(g, 1.6, 2.4, 11, m.metal, 0, 0, 0);
    box(g, 1.5, 0.7, 9, m.metal, 0, 1.4, 0.5);
    box(g, 2.1, 2.2, 8, m.poly, 0, 0, -9.2);
    box(g, 0.6, 0.6, 9, m.dark, 0, 0.5, -17);
    box(g, 0.5, 1.6, 0.5, m.dark, 0, 1.4, -20.5);
    box(g, 0.9, 0.9, 1.6, m.dark, 0, 0.5, -22);
    box(g, 0.4, 0.4, 9, m.dark, 0, 0.7, 10);
    box(g, 0.4, 0.4, 9, m.dark, 0, -1.2, 10, -0.18);
    box(g, 1.4, 4.0, 1.2, m.poly, 0, -0.9, 14.6);
    box(g, 1.2, 3.5, 1.6, m.poly, 0, -2.6, 3.3, 0.35);
    const mag = new THREE.Group(); mag.position.set(0, -1.2, -2.6);
    box(mag, 1.1, 3.4, 2.2, m.dark, 0, -1.7, 0);
    box(mag, 1.1, 3.2, 2.2, m.dark, 0, -4.8, -0.7, 0.25);
    g.add(mag);
    return { group: g, muzzle: [0, 0.5, -23], mag, grip: [0, -3.2, 3.6], fore: [0, -1.0, -9.2], eject: [0.9, 1.2, 0] };
  };
  function m4base(sil) {
    const m = mats(), g = new THREE.Group();
    box(g, 1.5, 2.2, 8, m.metal, 0, -0.2, 0);
    box(g, 1.4, 1.6, 9, m.metal, 0, 1.4, -0.5);
    box(g, 0.9, 0.4, 9, m.dark, 0, 2.35, -0.5);
    box(g, 2.0, 2.2, 8, m.poly, 0, 1.0, -8.8);
    box(g, 1.2, 0.35, 8, m.dark, 0, 2.25, -8.8);
    box(g, 0.55, 0.55, 7, m.dark, 0, 1.1, -16);
    box(g, 0.4, 1.8, 0.5, m.dark, 0, 2.7, -12.4);
    box(g, 0.6, 0.9, 0.9, m.dark, 0, 2.9, 3);
    box(g, 1.0, 1.0, 6, m.dark, 0, 1.0, 7);
    box(g, 1.4, 3.3, 3.5, m.poly, 0, 0.2, 10.6);
    box(g, 1.2, 3.4, 1.6, m.poly, 0, -2.4, 2.2, 0.35);
    box(g, 1.4, 1.2, 2.6, m.metal, 0, -1.6, -3);
    if (sil) cyl(g, 0.75, 7.5, m.dark, 0, 1.1, -22.6, 14);
    else box(g, 0.8, 0.8, 1.4, m.dark, 0, 1.1, -20.1);
    const mag = new THREE.Group(); mag.position.set(0, -2, -3);
    box(mag, 1.0, 5.0, 2.2, m.metal, 0, -2.5, -0.3, 0.12);
    g.add(mag);
    return { group: g, muzzle: [0, 1.1, sil ? -26.4 : -21], mag, grip: [0, -3.0, 2.6], fore: [0, -0.3, -8.8], eject: [0.9, 1.5, 0] };
  }
  B.m4a4 = () => m4base(false);
  B.m4a1s = () => m4base(true);
  B.famas = () => {
    const m = mats(), g = new THREE.Group();
    box(g, 1.9, 3.0, 17, m.slate, 0, 0, 1);
    box(g, 0.7, 0.6, 13, m.dark, 0, 3.4, -1);
    box(g, 0.7, 2.2, 0.8, m.dark, 0, 2.3, -7);
    box(g, 0.7, 2.2, 0.8, m.dark, 0, 2.3, 5);
    box(g, 0.6, 0.6, 7, m.dark, 0, 0.6, -10.5);
    box(g, 0.9, 0.9, 1.2, m.dark, 0, 0.6, -14.3);
    box(g, 1.2, 3.4, 1.6, m.poly, 0, -2.6, -3, 0.25);
    box(g, 2.0, 3.8, 1.4, m.poly, 0, -0.3, 9.9);
    const mag = new THREE.Group(); mag.position.set(0, -1.4, 3.5);
    box(mag, 1.0, 4.2, 2.1, m.metal, 0, -2, 0, -0.1);
    g.add(mag);
    return { group: g, muzzle: [0, 0.6, -15], mag, grip: [0, -3.6, -2.8], fore: [0, -1.4, -7], eject: [0.9, 1.0, 3] };
  };
  B.ump45 = () => {
    const m = mats(), g = new THREE.Group();
    box(g, 1.8, 3.0, 10, m.poly, 0, 0.3, 0);
    box(g, 1.0, 0.45, 8, m.dark, 0, 2.0, -0.5);
    box(g, 0.65, 0.65, 3, m.dark, 0, 0.8, -6.4);
    box(g, 1.2, 3.4, 1.6, m.poly, 0, -2.4, 2.4, 0.25);
    box(g, 1.6, 2.6, 7, m.poly, 0, 0.2, 8.2, -0.05);
    const mag = new THREE.Group(); mag.position.set(0, -1.4, -2.6);
    box(mag, 1.1, 5.2, 2.0, m.dark, 0, -2.5, -0.3, 0.1);
    g.add(mag);
    return { group: g, muzzle: [0, 0.8, -8], mag, grip: [0, -3.0, 2.6], fore: [0, -1.0, -5], eject: [0.9, 1.3, -1] };
  };
  B.p90 = () => {
    const m = mats(), g = new THREE.Group();
    box(g, 2.2, 3.4, 14, m.poly, 0, 0.2, 1.5);
    box(g, 1.2, 1.1, 10, m.dark, 0, 2.3, 0.5);
    box(g, 0.6, 0.6, 2.6, m.dark, 0, 0.8, -6.6);
    box(g, 2.0, 1.6, 5, m.poly, 0, -1.8, -3.6);
    box(g, 1.2, 3.6, 1.6, m.poly, 0, -2.2, -0.4, -0.1);
    const mag = new THREE.Group(); mag.position.set(0, 2.2, 3);
    box(mag, 1.6, 0.8, 9, m.tan, 0, 0.4, -2);
    g.add(mag);
    return { group: g, muzzle: [0, 0.8, -8], mag, grip: [0, -3.0, -0.2], fore: [0, -2.4, -4], eject: [0, -1.5, 2] };
  };
  function shotgun(pump) {
    const m = mats(), g = new THREE.Group();
    box(g, 1.7, 2.4, 9, m.metal, 0, 0.2, 0);
    box(g, 0.8, 0.8, 18, m.dark, 0, 0.9, -13);
    box(g, 0.7, 0.7, 15, m.dark, 0, -0.3, -11.5);
    box(g, 1.6, 1.6, 6, pump ? m.poly : m.metal, 0, -0.4, -12);
    box(g, 1.4, 2.8, 10, pump ? m.wood : m.poly, 0, -0.9, 9.6, -0.12);
    box(g, 1.2, 3.2, 1.6, m.poly, 0, -2.3, 3.2, 0.3);
    box(g, 0.3, 0.9, 0.4, m.dark, 0, 1.6, -21.5);
    return { group: g, muzzle: [0, 0.9, -22.5], mag: null, grip: [0, -3.0, 3.4], fore: [0, -1.2, -12], eject: [0.9, 1.0, 0] };
  }
  B.nova = () => shotgun(true);
  B.xm1014 = () => shotgun(false);
  function scopedRifle(bodyMat, bull) {
    const m = mats(), g = new THREE.Group();
    if (bull) {
      box(g, 2.0, 3.0, 17, bodyMat, 0, 0, 2);
      box(g, 0.6, 0.6, 7, m.dark, 0, 0.6, -10.5);
      box(g, 1.8, 3.6, 1.6, bodyMat, 0, -1.6, -4, -0.3);
      box(g, 1.2, 3.2, 1.6, m.poly, 0, -2.5, 0.5, 0.25);
    } else {
      box(g, 1.7, 2.5, 12, bodyMat, 0, 0, 0);
      box(g, 2.0, 2.2, 7, m.poly, 0, 0.1, -9.5);
      box(g, 0.6, 0.6, 7, m.dark, 0, 0.5, -15.5);
      box(g, 1.3, 3.6, 8, bodyMat, 0, -0.4, 10, -0.1);
      box(g, 1.2, 3.4, 1.6, m.poly, 0, -2.6, 3.4, 0.35);
    }
    cyl(g, 0.8, 7, m.dark, 0, 3.0, -1, 12);
    cyl(g, 1.05, 1.6, m.dark, 0, 3.0, -4.5, 12);
    box(g, 0.6, 1.4, 1.4, m.dark, 0, 1.9, -1);
    const mag = new THREE.Group(); mag.position.set(0, -1.4, bull ? 3.8 : -2.4);
    box(mag, 1.1, 4.8, 2.1, m.metal, 0, -2.3, -0.3, 0.12);
    g.add(mag);
    return { group: g, muzzle: [0, 0.6, bull ? -14.4 : -19.4], mag, grip: bull ? [0, -3.2, 0.8] : [0, -3.2, 3.6], fore: bull ? [0, -2.9, -4.2] : [0, -1.0, -9.5], eject: [0.9, 1.0, 1] };
  }
  B.sg553 = () => scopedRifle(mats().tan, false);
  B.aug = () => scopedRifle(mats().green, true);
  B.mp9 = () => {
    const m = mats(), g = new THREE.Group();
    box(g, 1.6, 2.6, 8, m.poly, 0, 0.2, 0);
    box(g, 0.9, 0.4, 6, m.dark, 0, 1.7, -0.5);
    box(g, 0.6, 0.6, 3, m.dark, 0, 0.6, -5.3);
    box(g, 1.0, 3.0, 1.2, m.poly, 0, -2.2, -3.2, -0.1);
    box(g, 1.2, 3.2, 1.6, m.poly, 0, -2.4, 2.0, 0.2);
    box(g, 0.3, 0.3, 7, m.dark, 0.7, 0.8, 7.2);
    box(g, 0.3, 0.3, 7, m.dark, -0.7, 0.8, 7.2);
    box(g, 1.6, 2.4, 0.5, m.dark, 0, 0.2, 10.6);
    const mag = new THREE.Group(); mag.position.set(0, -2.8, 2.2);
    box(mag, 0.9, 4.5, 1.2, m.dark, 0, -2.2, 0.4, 0.2);
    g.add(mag);
    return { group: g, muzzle: [0, 0.6, -7], mag, grip: [0, -3.0, 2.2], fore: [0, -3.2, -3.2], eject: [0.8, 1.2, -1] };
  };
  B.mac10 = () => {
    const m = mats(), g = new THREE.Group();
    box(g, 1.8, 3.2, 7, m.dark, 0, 0.4, -0.5);
    box(g, 0.6, 0.6, 2.2, m.metal, 0, 0.8, -5);
    box(g, 1.4, 4.2, 1.8, m.dark, 0, -3.0, 1.8, 0.1);
    box(g, 0.2, 0.5, 6, m.tan, 0.9, 1.0, 1);
    const mag = new THREE.Group(); mag.position.set(0, -4.6, 1.9);
    box(mag, 1.0, 5.2, 1.3, m.metal, 0, -1.8, 0, 0.1);
    g.add(mag);
    return { group: g, muzzle: [0, 0.8, -6.3], mag, grip: [0, -3.0, 1.8], fore: [0, -0.8, -3.2], eject: [0.9, 1.4, -1] };
  };
  function pistol(slideMat, frameMat, len, sil, big) {
    const m = mats(), g = new THREE.Group();
    const s = big ? 1.25 : 1;
    box(g, 1.1 * s, 1.2 * s, len, slideMat, 0, 1.0 * s, -len / 2 + 2.4);
    box(g, 1.05 * s, 0.8 * s, len - 0.6, frameMat, 0, 0.1, -len / 2 + 2.2);
    box(g, 1.1 * s, 3.8 * s, 1.9 * s, frameMat, 0, -2.0 * s, 1.6, 0.3);
    box(g, 0.3, 0.3, 1.8, frameMat, 0, -0.9, -0.2);
    box(g, 0.25, 0.5, 0.3, m.dark, 0, 1.8 * s, -len + 2.8);
    if (sil) cyl(g, 0.6, 5.5, m.dark, 0, 1.0 * s, -len + 2.4 - 2.75, 12);
    const mag = new THREE.Group(); mag.position.set(0, -3.6 * s, 2.1);
    box(mag, 0.9 * s, 1.2, 1.6 * s, frameMat, 0, -0.2, 0, 0.3);
    g.add(mag);
    return { group: g, muzzle: [0, 1.0 * s, -len + 2.4 - (sil ? 5.6 : 0.2)], mag, grip: [0, -2.4, 1.8], fore: [0, -2.6, 1.2], eject: [0.7, 1.3, -1] };
  }
  B.glock = () => pistol(mats().dark, mats().poly, 7, false);
  B.usp = () => pistol(mats().dark, mats().poly, 7.5, true);
  B.p250 = () => pistol(mats().dark, mats().tan, 7.2, false);
  B.deagle = () => pistol(mats().silver, mats().silver, 9.8, false, true);
  B.tec9 = () => pistol(mats().dark, mats().metal, 9, false);
  B.fiveseven = () => pistol(mats().metal, mats().poly, 7.4, false);
  function sniper(bodyMat, big) {
    const m = mats(), g = new THREE.Group();
    const s = big ? 1.15 : 1;
    box(g, 1.7 * s, 2.3 * s, 14, bodyMat, 0, 0, 0);
    box(g, 1.7 * s, 1.4, 11, bodyMat, 0, 1.2, 12);
    box(g, 1.7 * s, 1.2, 10, bodyMat, 0, -2.2, 12.5, 0.12);
    box(g, 1.8 * s, 4.4, 1.4, bodyMat, 0, -0.4, 17.4);
    box(g, 1.2, 3.2, 1.6, bodyMat, 0, -2.4, 5.5, 0.35);
    box(g, 0.75 * s, 0.75 * s, 20, m.dark, 0, 0.4, -17);
    if (big) box(g, 1.2, 1.2, 2.4, m.dark, 0, 0.4, -27.6);
    cyl(g, 0.9 * s, 11, m.dark, 0, 3.0, -0.5, 14);
    cyl(g, 1.35 * s, 2.6, m.dark, 0, 3.0, -6.8, 14);
    cyl(g, 1.2 * s, 2.2, m.dark, 0, 3.0, 5.4, 14);
    box(g, 0.6, 1.4, 1.6, m.dark, 0, 2.0, -3);
    box(g, 0.6, 1.4, 1.6, m.dark, 0, 2.0, 3);
    box(g, 2.2, 0.35, 0.35, m.metal, 1.2, 0.8, 2.2);
    cyl(g, 0.45, 0.8, m.metal, 2.3, 0.8, 2.2, 8, 'x').rotation.z = Math.PI / 2;
    const mag = new THREE.Group(); mag.position.set(0, -1.6, 0.8);
    box(mag, 1.2, 2.4, 3, m.dark, 0, -0.8, 0);
    g.add(mag);
    return { group: g, muzzle: [0, 0.4, big ? -28.8 : -27], mag, grip: [0, -3.1, 6], fore: [0, -1.6, -6], eject: [1.0, 1.0, 1] };
  }
  B.awp = () => sniper(mats().olive, true);
  B.ssg08 = () => sniper(mats().slate, false);
  B.knife = () => {
    const m = mats(), g = new THREE.Group();
    box(g, 0.9, 1.1, 4.6, m.dark, 0, 0, 1.8);
    box(g, 1.4, 1.6, 0.35, m.metal, 0, 0.1, -0.5);
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.5); sh.lineTo(6.2, -0.5); sh.lineTo(7.4, 0.35); sh.lineTo(5.5, 0.75); sh.lineTo(0, 0.75); sh.lineTo(0, -0.5);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: false });
    geo.translate(0, 0, -0.07);
    const blade = new THREE.Mesh(geo, m.blade);
    blade.rotation.set(0, Math.PI / 2, 0);
    blade.position.set(0, 0.1, -0.7);
    g.add(blade);
    return { group: g, muzzle: [0, 0, -7], mag: null, grip: [0, 0, 1.8], fore: [0, 0, 1.8], eject: [0, 0, 0] };
  };
  function nade(bodyMat, bandMat, shape) {
    const m = mats(), g = new THREE.Group();
    if (shape === 'sphere') {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.45, 14, 10), bodyMat); g.add(s);
    } else if (shape === 'bottle') {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.25, 4.2, 12), m.bottle); b.position.y = 0; g.add(b);
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.9, 2.2, 10), m.bottle); n.position.y = 3.1; g.add(n);
      box(g, 0.9, 2.2, 0.9, m.white, 0, 4.9, 0, 0.3);
      return { group: g, muzzle: [0, 0, 0], mag: null, grip: [0, -1, 0], fore: [0, -1, 0], eject: [0, 0, 0] };
    } else {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 4.2, 14), bodyMat); g.add(c);
      if (bandMat) { const b = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.8, 14), bandMat); b.position.y = 0.8; g.add(b); }
    }
    box(g, 0.8, 0.8, 0.8, m.metal, 0, shape === 'sphere' ? 1.6 : 2.4, 0);
    box(g, 0.35, 3.4, 0.9, m.metal, 0.9, shape === 'sphere' ? 0.4 : 1, 0, 0, 0, -0.15);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 6, 12), m.silver);
    ring.position.set(-0.8, shape === 'sphere' ? 1.9 : 2.7, 0); g.add(ring);
    return { group: g, muzzle: [0, 0, 0], mag: null, grip: [0, -1, 0], fore: [0, -1, 0], eject: [0, 0, 0] };
  }
  B.he = () => nade(mats().green, null, 'sphere');
  B.flash = () => nade(mats().grey, mats().blue, 'cyl');
  B.smoke = () => nade(mats().grey, mats().green, 'cyl');
  B.molotov = () => nade(null, null, 'bottle');
  B.incgrenade = () => nade(mats().grey, mats().red, 'cyl');
  B.c4 = () => {
    const m = mats(), g = new THREE.Group();
    for (let i = 0; i < 3; i++) box(g, 1.9, 2.0, 6, m.c4, -2 + i * 2, 0, 0);
    box(g, 3.4, 0.4, 3.6, m.dark, 0, 1.2, -0.6);
    for (let i = 0; i < 9; i++) box(g, 0.6, 0.2, 0.6, m.grey, -0.9 + (i % 3) * 0.9, 1.45, -1.5 + Math.floor(i / 3) * 0.9);
    const led = box(g, 0.5, 0.3, 0.5, m.led, 1.2, 1.5, 0.8);
    box(g, 0.2, 0.2, 5, m.red, 2.6, 1.0, 0);
    box(g, 0.2, 0.2, 5, m.blue, -2.6, 1.0, 0);
    return { group: g, muzzle: [0, 0, 0], mag: null, grip: [0, -1.2, 1], fore: [0, -1.2, -1], eject: [0, 0, 0], led };
  };

  function build(id) {
    const r = B[id]();
    r.group.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    if (r.mag) r.mag.userData.noMerge = true;
    if (r.led) r.led.userData.noMerge = true;
    MeshUtil.merge(r.group, { deep: true });
    if (r.mag) MeshUtil.merge(r.mag, { deep: true });
    const mz = new THREE.Object3D(); mz.position.fromArray(r.muzzle); r.group.add(mz); r.muzzleObj = mz;
    return r;
  }
  return { build, mats };
})();
