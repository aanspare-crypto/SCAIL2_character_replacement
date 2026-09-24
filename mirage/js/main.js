'use strict';
// Glue: menus, input, camera, models, effects and the frame loop.

(() => {
  const $ = id => document.getElementById(id);
  const DEG = Math.PI / 180;
  const clampv = (v, a, b) => v < a ? a : v > b ? b : v;
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const showErr = (msg) => { const e = $('err'); e.textContent = msg; e.hidden = false; };
  window.addEventListener('error', e => showErr('Error: ' + (e.message || e.error)));

  if (typeof THREE === 'undefined') {
    $('loading').textContent = 'Could not load three.js. This game needs a network connection for its 3D library.';
    return;
  }

  // ---------- settings ----------
  const DEF = { team: 'CT', mode: 'competitive', difficulty: 'normal', quality: 'high', sens: 2, vol: 0.7, xhair: '#4cff4c', xstyle: 'static', voice: '1', ff: '0' };
  let S = Object.assign({}, DEF);
  try { Object.assign(S, JSON.parse(localStorage.getItem('mirage5v5') || '{}')); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem('mirage5v5', JSON.stringify(S)); } catch (e) { /* storage unavailable */ } };

  // ---------- init ----------
  Render.init($('view'), S.quality);
  FX.init(Render.scene, Render.camera, Render.renderer);
  VM.init(Render.vmScene);
  HUD.init();
  Bots.init();
  Sound.setVolume(S.vol);
  Sound.voice = S.voice !== '0';
  Sound.radioVoice = S.voice === '1';
  HUD.setCrosshairColor(S.xhair);
  HUD.settings.dynamic = S.xstyle === 'dynamic';
  const cam = Render.camera;

  let mode = 'menu';
  let paused = false;
  const keys = {};
  const mouse = { l: false, r: false, dx: 0, dy: 0 };
  const punch = { p: 0, y: 0, vp: 0, vy: 0, shake: 0 };
  const spec = { idx: 0, third: false, target: null, deathT: 0, killer: null };
  let hurtFlash = 0;
  const models = new Map();
  const itemModels = new Map();
  const nadeModels = new Map();
  let bombModel = null, bombGlow = null;

  // ---------- menu ----------
  function syncMenu() {
    document.querySelectorAll('.seg').forEach(seg => {
      const k = seg.dataset.opt;
      seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S[k])));
    });
    $('sens').value = S.sens; $('sensv').textContent = (+S.sens).toFixed(2);
    $('sens2').value = S.sens; $('sensv2').textContent = (+S.sens).toFixed(2);
    $('vol').value = S.vol; $('volv').textContent = Math.round(S.vol * 100);
    $('vol2').value = S.vol; $('volv2').textContent = Math.round(S.vol * 100);
    $('xhair').value = S.xhair; $('xstyle').value = S.xstyle; $('voice').value = S.voice; $('ff').value = S.ff;
  }
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S[seg.dataset.opt] = b.dataset.v; save(); syncMenu();
    if (seg.dataset.opt === 'quality') Render.setQuality(S.quality);
    Sound.ui('click');
  }));
  const bindSlider = (id, key, out, fmt, apply) => $(id).addEventListener('input', e => { S[key] = +e.target.value; save(); syncMenu(); if (apply) apply(); });
  bindSlider('sens', 'sens'); bindSlider('sens2', 'sens');
  bindSlider('vol', 'vol', null, null, () => Sound.setVolume(S.vol)); bindSlider('vol2', 'vol', null, null, () => Sound.setVolume(S.vol));
  $('xhair').addEventListener('change', e => { S.xhair = e.target.value; save(); HUD.setCrosshairColor(S.xhair); });
  $('xstyle').addEventListener('change', e => { S.xstyle = e.target.value; save(); HUD.settings.dynamic = S.xstyle === 'dynamic'; });
  $('voice').addEventListener('change', e => { S.voice = e.target.value; save(); Sound.voice = S.voice !== '0'; Sound.radioVoice = S.voice === '1'; });
  $('ff').addEventListener('change', e => { S.ff = e.target.value; save(); });
  syncMenu();
  if (window.matchMedia && !window.matchMedia('(pointer: fine)').matches) $('playnote').textContent = 'This game needs a keyboard and mouse.';

  function lockPointer() {
    const c = $('view');
    try { const r = c.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => { try { c.requestPointerLock(); } catch (e) { /* ignore */ } }); } catch (e) { try { c.requestPointerLock(); } catch (e2) { /* ignore */ } }
  }
  // Fullscreen first (so Ctrl+W and friends can be captured), then the mouse.
  function enterFullscreenAndLock() {
    const d = document.documentElement;
    if (!document.fullscreenElement && d.requestFullscreen) {
      d.requestFullscreen().then(() => {
        if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'Tab']).catch(() => {});
        lockPointer();
      }).catch(() => lockPointer());
    } else lockPointer();
  }
  document.addEventListener('pointerlockerror', () => { if (mode === 'play') HUD.message('Click the game to capture the mouse', 3); });

  function startMatch() {
    Sound.init();
    Bots.setDifficulty(S.difficulty);
    Game.newMatch({ mode: S.mode, difficulty: S.difficulty, playerTeam: S.team, ff: S.ff === '1', playerName: 'You' });
    mode = 'play'; paused = false;
    $('menu').hidden = true; $('endscreen').hidden = true; $('pause').hidden = true;
    $('hud').hidden = false;
    enterFullscreenAndLock();
  }
  $('play').addEventListener('click', startMatch);
  $('again').addEventListener('click', startMatch);
  $('tomenu').addEventListener('click', () => toMenu());
  $('resume').addEventListener('click', () => { paused = false; $('pause').hidden = true; lockPointer(); });
  $('quit').addEventListener('click', () => toMenu());
  function toMenu() {
    mode = 'menu'; paused = false;
    $('pause').hidden = true; $('endscreen').hidden = true; $('hud').hidden = true; $('menu').hidden = false;
    HUD.openBuy(false); HUD.showScore(false);
    $('scope').hidden = true; $('scope2').hidden = true;
    for (const [, ch] of models) Render.scene.remove(ch.root);
    models.clear();
    clearItems();
    Game.players = [];
    VM.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  window.addEventListener('beforeunload', e => { if (mode === 'play') { e.preventDefault(); e.returnValue = ''; } });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === $('view');
    if (!locked && mode === 'play' && !Game.matchEnded) {
      if (HUD.buyOpen) HUD.openBuy(false);
      paused = true; $('pause').hidden = false; HUD.showScore(false);
      for (const k in keys) keys[k] = false;
      mouse.l = mouse.r = false;
    }
  });
  $('view').addEventListener('click', () => { if (mode === 'play' && !document.pointerLockElement && !paused) lockPointer(); });

  // ---------- input ----------
  const local = () => Game.local;
  function viewTarget() {
    const l = local();
    if (l && l.alive) return l;
    return spec.target;
  }
  window.addEventListener('keydown', e => {
    if (mode !== 'play') return;
    const code = e.code;
    if (['Tab', 'Space', 'KeyB', 'ControlLeft', 'ControlRight', 'Slash', 'KeyF'].includes(code) || (e.ctrlKey && code !== 'KeyR')) e.preventDefault();
    if (code === 'Escape') {
      if (HUD.buyOpen) { HUD.openBuy(false); return; }
      if (!paused) { paused = true; $('pause').hidden = false; if (document.pointerLockElement) document.exitPointerLock(); }
      return;
    }
    if (paused) return;
    if (e.repeat && code !== 'KeyW' && code !== 'KeyA' && code !== 'KeyS' && code !== 'KeyD') return;
    keys[code] = true;
    const l = local();
    if (!l) return;
    if (code === 'Tab') HUD.showScore(true);
    if (HUD.buyOpen) {
      const m = code.match(/^(?:Digit|Numpad)(\d)$/);
      if (m) { const id = HUD.buyKey(+m[1]); if (id) doBuy(id); return; }
      if (code === 'KeyB') { HUD.openBuy(false); return; }
    }
    if (!l.alive) {
      if (code === 'Space') spec.third = !spec.third;
      return;
    }
    const c = l.cmd;
    const dm = code.match(/^Digit([1-5])$/);
    if (dm) c.slot = +dm[1];
    else if (code === 'KeyQ') c.slot = l.last && (l.last === 4 ? l.nades.length : l.slots[l.last]) ? l.last : null;
    else if (code === 'KeyR') c.reload = true;
    else if (code === 'KeyG') c.drop = true;
    else if (code === 'KeyF') c.inspect = true;
    else if (code === 'KeyE') { if (!(l.team === 'CT' && Game.bomb.state === 'planted' && Math.hypot(l.body.x - Game.bomb.x, l.body.z - Game.bomb.z) < 90)) Game.tryUsePickup(l); }
    else if (code === 'KeyB') { if (Game.canBuy(l)) HUD.openBuy(true); else HUD.message(Game.inBuyZone(l) ? 'The buy time has expired' : 'You are not in a buy zone', 2); }
  });
  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'Tab') HUD.showScore(false);
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });
  window.addEventListener('mousedown', e => {
    if (mode !== 'play' || paused || !document.pointerLockElement) return;
    if (HUD.buyOpen) { if (e.button === 0) { const id = HUD.cursorClick(); if (id) doBuy(id); } return; }
    const l = local();
    if (l && !l.alive) { if (e.button === 0) nextSpectate(1); if (e.button === 2) nextSpectate(-1); return; }
    if (e.button === 0) mouse.l = true;
    if (e.button === 2) mouse.r = true;
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
  window.addEventListener('contextmenu', e => { if (mode === 'play') e.preventDefault(); });
  window.addEventListener('wheel', e => {
    if (mode !== 'play' || paused) return;
    const l = local(); if (!l || !l.alive || HUD.buyOpen) return;
    l.cmd.next = e.deltaY > 0 ? 1 : -1;
  }, { passive: true });
  window.addEventListener('mousemove', e => {
    if (mode !== 'play' || paused || document.pointerLockElement !== $('view')) return;
    if (HUD.buyOpen) { HUD.moveCursor(e.movementX, e.movementY); return; }
    mouse.dx += e.movementX; mouse.dy += e.movementY;
  });
  function doBuy(id) {
    const l = local();
    if (Game.buy(l, id)) Sound.ui('buy');
  }

  function applyMouse() {
    const l = local();
    if (!l || !l.alive) { mouse.dx = mouse.dy = 0; return; }
    const w = Game.curDef(l);
    let zoomMul = 1;
    if ((w.type === 'sniper' || w.scope) && l.ws.zoom > 0) zoomMul = Math.tan(fovFor(w.zoom[l.ws.zoom - 1]) * DEG / 2) / Math.tan(73.74 * DEG / 2);
    const k = S.sens * 0.022 * DEG * zoomMul;
    l.yaw -= mouse.dx * k;
    l.pitch = clampv(l.pitch - mouse.dy * k, -89 * DEG, 89 * DEG);
    lastMouse.dx = mouse.dx; lastMouse.dy = mouse.dy;
    mouse.dx = mouse.dy = 0;
  }
  const lastMouse = { dx: 0, dy: 0 };
  function buildCmd() {
    const l = local();
    if (!l || !l.alive) return;
    const c = l.cmd;
    const busy = HUD.buyOpen;
    c.fwd = busy ? 0 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    c.side = busy ? 0 : (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    c.jump = !busy && !!keys.Space;
    c.duck = !!(keys.KeyC || keys.ControlLeft || keys.ControlRight);
    c.walk = !!(keys.ShiftLeft || keys.ShiftRight);
    c.fire = !busy && mouse.l;
    c.fire2 = !busy && mouse.r;
    c.use = !!keys.KeyE;
  }
  function fovFor(h) { return 2 * Math.atan(Math.tan(h * DEG / 2) * 0.75) / DEG; }

  // ---------- spectating ----------
  function specCandidates() {
    const l = local();
    const team = l ? l.team : 'CT';
    let c = Game.players.filter(p => p.alive && p.team === team && p !== l);
    if (!c.length) c = Game.players.filter(p => p.alive && p !== l);
    return c;
  }
  function nextSpectate(d) {
    const c = specCandidates();
    if (!c.length) return;
    spec.idx = (spec.idx + d + c.length) % c.length;
    spec.target = c[spec.idx];
    spec.deathT = 99;
    if (spec.target) VM.set(Game.curId(spec.target), spec.target.team);
  }

  // ---------- models ----------
  function rebuildModels() {
    for (const [, ch] of models) Render.scene.remove(ch.root);
    models.clear();
    for (const p of Game.players) {
      const ch = Characters.build(p.team, p.variant);
      ch.team = p.team;
      Render.scene.add(ch.root);
      models.set(p.id, ch);
    }
  }
  function clearItems() {
    for (const [, m] of itemModels) Render.scene.remove(m);
    itemModels.clear();
    for (const [, m] of nadeModels) Render.scene.remove(m);
    nadeModels.clear();
    if (bombModel) bombModel.visible = false;
  }
  const tv = new THREE.Vector3();
  function muzzleWorld(p) {
    const ch = models.get(p.id);
    if (ch && ch.gun && ch.gun.muzzleObj) { ch.gun.muzzleObj.getWorldPosition(tv); return [tv.x, tv.y, tv.z]; }
    const e = Game.eye(p); return [e[0], e[1] - 8, e[2]];
  }
  function viewMuzzle(p) {
    const e = Game.eye(p), f = Game.dirFrom(p.yaw, p.pitch);
    const r = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    return [e[0] + f[0] * 24 + r[0] * 5, e[1] + f[1] * 24 - 5, e[2] + f[2] * 24 + r[2] * 5];
  }
  function firstPersonOf(p) { return p === viewTarget() && !(p !== local() && spec.third) && (p.alive); }

  // ---------- game events ----------
  Game.on('matchStart', () => { rebuildModels(); clearItems(); HUD.hideDeath(); });
  Game.on('halftime', () => { rebuildModels(); HUD.banner('Halftime', 'Switching sides', null, 4); });
  Game.on('roundReset', () => { FX.reset(); clearItems(); });
  Game.on('roundStart', d => {
    HUD.hideDeath();
    spec.target = null; spec.deathT = 0;
    const l = local();
    for (const [, ch] of models) { ch.deathT = 0; ch.root.rotation.x = 0; ch.root.rotation.z = 0; }
    if (l) {
      VM.set(Game.curId(l), l.team); VM.deploy(0.6);
      HUD.message(l.slots[5] ? 'You have the bomb. Plant it at A or B' : d.pistol ? 'Pistol round' : `Round ${d.round}`, 3);
      Sound.ui('round');
    }
  });
  Game.on('freezeEnd', () => { const l = local(); if (l && l.alive) HUD.message(l.team === 'T' ? 'Plant the bomb or eliminate the enemy team' : 'Defend the bombsites', 3); if (HUD.buyOpen && !Game.canBuy(l)) HUD.openBuy(false); });

  let impactBudget = 0;
  Game.on('shot', d => {
    const p = d.p, w = WEAPONS[d.id];
    const fp = firstPersonOf(p);
    const pos = [p.body.x, p.body.y + 56, p.body.z];
    Sound.shot(w.snd, fp ? null : pos, w.silenced, fp);
    const m = fp ? viewMuzzle(p) : muzzleWorld(p);
    if (!fp) {
      const f = Game.dirFrom(p.yaw, p.pitch);
      if (!w.silenced) FX.muzzle(m[0], m[1], m[2], f[0], f[1], f[2], w.type === 'sniper');
      FX.light(m[0], m[1], m[2], w.silenced ? 0 : 1.6, 0.05, 450);
    } else {
      VM.shot(w);
      punch.vp += (w.punch || 0.5) * 0.9 * DEG * 12;
      punch.vy += (Math.random() - 0.5) * (w.punch || 0.5) * 0.4 * DEG * 12;
    }
    if (d.ends && d.ends.length > 1) { for (let i = 0; i < 3; i++) { const e = d.ends[i]; if (e) FX.tracer(m[0], m[1], m[2], e[0], e[1], e[2]); } }
    else if (d.end && (!fp || Math.random() < 0.5)) FX.tracer(m[0], m[1], m[2], d.end[0], d.end[1], d.end[2]);
  });
  Game.on('impact', d => {
    FX.impact(d.x, d.y, d.z, d.nx, d.ny, d.nz, d.mat);
    if (impactBudget < 30) { impactBudget++; Sound.impact([d.x, d.y, d.z], d.mat); }
  });
  Game.on('blood', d => {
    FX.blood(d.x, d.y, d.z, d.dx, d.dy, d.dz, d.head);
    const l = local();
    if (d.v === l) return;
    Sound.flesh(null, d.head, d.helmet);
  });
  Game.on('hurt', d => {
    const ch = models.get(d.v.id);
    if (ch && d.dir) {
      // flinch away from the shot
      const fx = -Math.sin(d.v.yaw), fz = -Math.cos(d.v.yaw);
      ch.hitT = 0.25; ch.hitDir = (d.dir[0] * fx + d.dir[2] * fz) > 0 ? -1 : 1; ch.hitSide = Math.random() < 0.5 ? -1 : 1;
    }
    const l = local();
    if (d.v === l) {
      Sound.hurt();
      hurtFlash = Math.min(1, hurtFlash + d.hp / 60);
      if (d.a && d.a !== l) {
        const a = Math.atan2(-(d.a.body.x - l.body.x), -(d.a.body.z - l.body.z));
        HUD.damageFrom(-angDiff(l.yaw, a));
      }
      if (d.weapon !== 'fire') { punch.vp += (1.5 + d.hp * 0.05) * DEG * 10; punch.vy += (Math.random() - 0.5) * 2 * DEG * 10; }
    }
  });
  Game.on('kill', d => {
    HUD.killfeed(d);
    const l = local();
    if (d.victim === l) {
      HUD.deathPanel(d);
      setTimeout(() => { if (!l.alive) HUD.hideDeath(); }, 6000);
      spec.deathT = 0; spec.killer = d.killer; spec.target = null;
      HUD.openBuy(false);
      $('scope').hidden = true; $('scope2').hidden = true;
    } else if (d.killer === l) {
      Sound.ui('kill');
      if (d.victim.team !== l.team) HUD.moneyPop(WEAPONS[d.weapon] ? (WEAPONS[d.weapon].kill || 300) : 300);
      else HUD.moneyPop(-300);
    }
    const ch = models.get(d.victim.id);
    if (ch) {
      // fall away from the killer when we know where the shot came from
      const v = d.victim, k = d.killer;
      let dir = Math.random() < 0.6 ? -1 : 1;
      if (k && k !== v) {
        const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
        dir = ((v.body.x - k.body.x) * fx + (v.body.z - k.body.z) * fz) > 0 ? -1 : 1;
      }
      ch.deathDir = dir; ch.deathSide = (Math.random() - 0.5) * 2; ch.deathT = 0;
      const bx = v.body.x + Math.sin(v.yaw) * 32 * dir, bz = v.body.z + Math.cos(v.yaw) * 32 * dir, by = v.body.y;
      setTimeout(() => { if (!v.alive) FX.decal('pool', bx, World.floorAt(bx, bz, by + 30) + 0.3, bz, 0, 1, 0, 0.7 + Math.random() * 0.5); }, 700);
    }
    if (spec.target === d.victim) setTimeout(() => { if (spec.target === d.victim) nextSpectate(1); }, 1500);
  });
  Game.on('reload', d => {
    const fp = firstPersonOf(d.p);
    const pos = fp ? null : [d.p.body.x, d.p.body.y + 50, d.p.body.z];
    if (d.shell) { Sound.mech('magin', pos, fp); if (fp) VM.shell(); return; }
    Sound.mech('magout', pos, fp);
    setTimeout(() => Sound.mech('magin', pos, fp), d.time * 550);
    setTimeout(() => Sound.mech('bolt', pos, fp), d.time * 830);
    if (fp) VM.reload(d.time);
  });
  Game.on('deploy', d => {
    const fp = d.p === viewTarget();
    if (fp) { VM.set(d.id, d.p.team); VM.deploy(WEAPONS[d.id] ? WEAPONS[d.id].deploy : 1); }
    if (d.p === local()) Sound.mech('deploy', null, true);
  });
  Game.on('dryfire', d => { if (d.p === local()) Sound.mech('empty', null, true); });
  Game.on('knife', d => { const fp = firstPersonOf(d.p); if (fp) VM.knife(d.stab); Sound.mech('knife', fp ? null : [d.p.body.x, d.p.body.y + 50, d.p.body.z], fp); });
  Game.on('pin', d => { if (firstPersonOf(d.p)) { VM.pin(); Sound.mech('pin', null, true); } });
  Game.on('nadeThrow', d => {
    const fp = firstPersonOf(d.p);
    Sound.mech('throw', fp ? null : [d.n.x, d.n.y, d.n.z], fp);
    if (fp) VM.thrown();
    const g = WeaponModels.build(d.n.id).group;
    g.scale.setScalar(1.1);
    Render.scene.add(g);
    nadeModels.set(d.n, g);
  });
  Game.on('nadeBounce', d => Sound.mech('bounce', [d.n.x, d.n.y, d.n.z]));
  Game.on('he', d => { FX.explosion(d.x, d.y, d.z, false); Sound.explosion([d.x, d.y, d.z], false); shakeFrom(d.x, d.y, d.z, 700, 4); });
  Game.on('flash', d => { FX.flashPop(d.x, d.y, d.z); Sound.flashbang([d.x, d.y, d.z]); });
  Game.on('flashed', d => { if (d.p === viewTarget()) { flash.until = Game.time + d.dur; flash.dur = d.dur; if (d.p === local()) Sound.ring(d.dur); } });
  Game.on('smoke', d => { FX.smokeCloud(d.x, d.y, d.z, d.dur); Sound.smoke([d.x, d.y, d.z]); });
  Game.on('molotov', d => { d.f.fx = FX.fireArea(d.x, d.y, d.z, d.f.r, d.f.dur); Sound.glass([d.x, d.y, d.z]); });
  Game.on('glass', d => Sound.glass([d.x, d.y, d.z]));
  Game.on('fireOut', f => { if (f.fx) { f.fx.dur = f.fx.t + 0.3; if (f.fx.stop) f.fx.stop(); } });
  Game.on('keypad', d => Sound.keypad([d.p.body.x, d.p.body.y + 30, d.p.body.z]));
  Game.on('plantStart', d => { if (d.p === local()) HUD.message('Planting…', 1.5); });
  Game.on('planted', d => {
    if (d.p === local()) HUD.moneyPop(300);
    Sound.say('Bomb has been planted');
    HUD.message('The bomb has been planted', 3, 'warn');
    placeBomb(d.x, d.y, d.z);
  });
  Game.on('beep', d => { Sound.beep([d.x, d.y + 4, d.z], d.hi); if (bombGlow) bombGlow.userData.t = 0.12; });
  Game.on('defuseStart', d => { if (d.p === local()) HUD.message(d.p.defuser ? 'Defusing with kit (5 s)' : 'Defusing (10 s)', 2); Sound.defuseTick([Game.bomb.x, Game.bomb.y, Game.bomb.z]); });
  Game.on('defuseTick', b => Sound.defuseTick([b.x, b.y, b.z]));
  Game.on('defused', d => { Sound.say('Bomb has been defused'); if (d.p === local()) HUD.moneyPop(300); });
  Game.on('explode', d => {
    FX.explosion(d.x, d.y, d.z, true); Sound.explosion([d.x, d.y, d.z], true);
    if (bombModel) bombModel.visible = false;
    shakeFrom(d.x, d.y, d.z, 3500, 14);
  });
  const REASON = { elim: 'Enemy team eliminated', bomb: 'Target bombed', defuse: 'Bomb defused', time: 'Target saved' };
  Game.on('roundEnd', d => {
    const l = local();
    HUD.hideDeath();
    const title = d.winner === 'CT' ? 'Counter-Terrorists Win' : 'Terrorists Win';
    const mvp = d.mvp ? `MVP: <b class="${d.mvp.team.toLowerCase()}">${d.mvp.name}</b> · ${d.mvp.st.rk} kill${d.mvp.st.rk === 1 ? '' : 's'}` : '';
    HUD.banner(title, `${REASON[d.reason]}${mvp ? ' · ' + mvp : ''}${d.halftime ? ' · Halftime next' : ''}`, d.winner, 5.5);
    Sound.say(d.winner === 'CT' ? 'Counter-terrorists win' : 'Terrorists win');
    if (l) {
      Sound.ui(l.team === d.winner ? 'win' : 'lose');
      if (l.roundReward) HUD.moneyPop(l.roundReward);
    }
  });
  Game.on('matchEnd', d => {
    const l = local();
    const won = l && d.winner === l.team;
    $('endtitle').textContent = d.winner === 'draw' ? 'Draw' : won ? 'Victory' : 'Defeat';
    $('endtitle').style.color = d.winner === 'draw' ? '#dfe3e7' : won ? '#8fe08f' : '#ff8a7a';
    const lt = l ? l.team : 'CT';
    $('endscore').innerHTML = `<span class="${lt.toLowerCase()}">${Game.score[lt]}</span> : <span class="${Game.other(lt).toLowerCase()}">${Game.score[Game.other(lt)]}</span>`;
    HUD.showScore(true); HUD.renderScoreboardNow();
    const sb = $('scoreboard');
    $('endboard').innerHTML = sb.innerHTML;
    HUD.showScore(false);
    $('endscreen').hidden = false; $('hud').hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
  });
  Game.on('buyFail', d => { if (d.p === local()) { HUD.message(d.err, 2); Sound.ui('deny'); } });
  Game.on('buy', d => { if (d.p === local() && (d.item === 'vest' || d.item === 'vesthelm')) Sound.mech('kevlar', null, true); });
  Game.on('pickup', d => { if (d.p === local()) { Sound.mech('pickup', null, true); if (d.id === 'c4') HUD.message('You picked up the bomb', 2); } });
  Game.on('step', d => {
    const fp = d.p === viewTarget() && !spec.third;
    Sound.step(fp ? null : [d.p.body.x, d.p.body.y + 2, d.p.body.z], d.surface, fp);
  });
  Game.on('land', d => {
    const fp = d.p === viewTarget();
    Sound.land(fp ? null : [d.p.body.x, d.p.body.y, d.p.body.z], fp);
    if (fp) { VM.land(d.p.body.landSpeed); if (d.p === local()) punch.vp -= Math.min(1.5, d.p.body.landSpeed / 400) * DEG * 14; }
  });
  Game.on('notice', d => { if (d.p === local()) HUD.message(d.text, 2); });
  Game.on('inspect', d => { if (firstPersonOf(d.p)) VM.inspect(); });
  Game.on('zoom', d => { if (d.p === local()) Sound.mech('scope', null, true); });
  Game.on('itemSpawn', it => {
    let g;
    if (it.kind === 'kit') {
      g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(7, 2.5, 5), new THREE.MeshPhongMaterial({ color: Render.C('#2a3440'), shininess: 30 }));
      m.castShadow = true; g.add(m);
    } else g = WeaponModels.build(it.kind === 'c4' ? 'c4' : it.inst.id).group;
    g.rotation.set(0, it.yaw, it.kind === 'weapon' ? Math.PI / 2 : 0);
    g.position.set(it.x, it.y, it.z);
    Render.scene.add(g);
    itemModels.set(it.uid, g);
  });
  Game.on('itemRemove', it => { const g = itemModels.get(it.uid); if (g) { Render.scene.remove(g); itemModels.delete(it.uid); } });
  Bots.radio = (p, t) => { const l = local(); if (l && p.team === l.team) { HUD.radio(p, t); Sound.ui('radio'); Sound.radio(t, p.id); } };
  Sound.setOcclusion(pos => !World.losClear(cam.position.x, cam.position.y, cam.position.z, pos[0], pos[1], pos[2]));

  function placeBomb(x, y, z) {
    if (!bombModel) {
      bombModel = WeaponModels.build('c4').group;
      bombModel.scale.setScalar(1.3);
      const sm = new THREE.SpriteMaterial({ map: Tex.get('soft'), color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      bombGlow = new THREE.Sprite(sm); bombGlow.scale.set(14, 14, 1); bombGlow.position.set(1.2, 2.2, 0.8); bombGlow.userData.t = 0;
      bombModel.add(bombGlow);
      Render.scene.add(bombModel);
    }
    bombModel.position.set(x, y + 1.4, z);
    bombModel.rotation.set(0, Math.random() * 6.28, 0);
    bombModel.visible = true;
  }

  const flash = { until: 0, dur: 0 };
  function shakeFrom(x, y, z, r, amt) {
    const d = Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z);
    if (d < r) punch.shake = Math.max(punch.shake, amt * (1 - d / r));
  }

  const ghostMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  function setGhost(ch, on) {
    const key = on ? 'on:' + ch.gunId : 'off';
    if (ch.ghostKey === key) return;
    ch.ghostKey = key;
    ch.root.traverse(o => {
      if (!o.isMesh) return;
      if (on) { if (o.material !== ghostMat) { o.userData.mat = o.material; o.material = ghostMat; } }
      else if (o.userData.mat) { o.material = o.userData.mat; o.userData.mat = null; }
    });
  }
  // ---------- per-frame model sync ----------
  function syncModels(dt) {
    const vt = viewTarget();
    for (const p of Game.players) {
      const ch = models.get(p.id);
      if (!ch) continue;
      const b = p.body;
      ch.root.position.set(b.x, b.y, b.z);
      if (p.alive) ch.root.rotation.y = p.yaw;
      Characters.setWeapon(ch, p.alive ? Game.curId(p) : null);
      ch.backC4.visible = !!p.slots[5] && Game.curId(p) !== 'c4';
      ch.kit.visible = p.defuser && p.alive;
      Characters.animate(ch, { dt, speed: Math.hypot(b.vx, b.vz), duck: b.duck, onGround: b.onGround, pitch: p.pitch, alive: p.alive });
      // the first-person body stays invisible but still casts its shadow
      const hideBody = p === vt && p.alive && !(p !== local() && spec.third);
      setGhost(ch, hideBody);
    }
    for (const it of Game.items) {
      const g = itemModels.get(it.uid);
      if (g) { g.position.set(it.x, it.y + (it.kind === 'weapon' ? 1.2 : 1), it.z); if (!it.rest) g.rotation.x += dt * 6; }
    }
    const live = new Set(Game.nades);
    for (const [n, g] of nadeModels) {
      if (!live.has(n)) { Render.scene.remove(g); nadeModels.delete(n); continue; }
      g.position.set(n.x, n.y, n.z);
      if (!n.rest) { g.rotation.x += dt * 9; g.rotation.z += dt * 5; }
    }
    if (bombGlow) {
      bombGlow.userData.t -= dt;
      bombGlow.visible = bombGlow.userData.t > 0;
    }
    const B = Game.bomb;
    if (bombModel && B && B.state !== 'planted' && B.state !== 'exploded') bombModel.visible = false;
  }

  // ---------- camera ----------
  let curFov = 73.74;
  const menuT = { t: 0 };
  const MENU_PATH = [
    [[3660, 330, 1500], [2600, 120, 1650]],
    [[2450, 260, 1700], [1500, 150, 1700]],
    [[1900, 420, 2500], [2100, 60, 3000]],
    [[2500, 300, 3400], [1800, 60, 2900]],
    [[1300, 380, 2900], [700, 60, 2800]],
    [[700, 360, 1400], [550, 40, 700]],
    [[1100, 380, 400], [500, 40, 600]],
    [[3300, 420, 1000], [3600, 100, 1700]],
  ];
  function menuCamera(dt) {
    menuT.t += dt * 0.055;
    const n = MENU_PATH.length;
    const i = Math.floor(menuT.t) % n, f = menuT.t - Math.floor(menuT.t);
    const a = MENU_PATH[i], b = MENU_PATH[(i + 1) % n];
    const e = f * f * (3 - 2 * f);
    const lerp = (u, v) => u.map((x, k) => x + (v[k] - x) * e);
    const p = lerp(a[0], b[0]), t = lerp(a[1], b[1]);
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(t[0], t[1], t[2]);
    cam.fov = 73.74; cam.updateProjectionMatrix();
    Render.setIndoorLight(0);
  }

  function updateCamera(dt) {
    const l = local();
    const vt = viewTarget();
    // recoil view punch spring
    punch.vp -= punch.p * 180 * dt; punch.vy -= punch.y * 180 * dt;
    punch.vp *= Math.exp(-dt * 22); punch.vy *= Math.exp(-dt * 22);
    punch.p += punch.vp * dt; punch.y += punch.vy * dt;
    punch.shake *= Math.exp(-dt * 4);
    let fovTarget = 73.74;
    let showVM = false;
    if (l && l.alive) {
      const b = l.body;
      const w = Game.curDef(l);
      const rc = recoilAt(w, l.ws.recoilIdx);
      cam.position.set(b.x, b.y + eyeHeight(b) + b.eyeLag, b.z);
      const sh = punch.shake;
      cam.rotation.set(l.pitch + (rc[1] * 0.45) * DEG + punch.p + (Math.random() - 0.5) * sh * 0.01, l.yaw - rc[0] * 0.45 * DEG + punch.y + (Math.random() - 0.5) * sh * 0.01, 0, 'YXZ');
      const zoomed = (w.type === 'sniper' || w.scope) && l.ws.zoom > 0;
      if (zoomed) fovTarget = fovFor(w.zoom[l.ws.zoom - 1]);
      showVM = !zoomed;
      $('scope').hidden = !(zoomed && w.type === 'sniper');
      $('scope2').hidden = !(zoomed && w.scope);
    } else if (l) {
      $('scope').hidden = true; $('scope2').hidden = true;
      spec.deathT += dt;
      if (spec.deathT < 2.2 && !spec.target) {
        // death cam: look at the killer from above the body
        const b = l.body, k = spec.killer;
        const tx = k ? k.body.x : b.x, ty = k ? k.body.y + 50 : b.y, tz = k ? k.body.z : b.z;
        const back = Math.atan2(-(tx - b.x), -(tz - b.z));
        let cx2 = b.x + Math.sin(back) * 90, cz2 = b.z + Math.cos(back) * 90, cy2 = b.y + 110;
        const hh = World.raycast(b.x, b.y + 60, b.z, (cx2 - b.x) / 150, 50 / 150, (cz2 - b.z) / 150, 150);
        if (hh) { const k2 = Math.max(0.2, (hh.t - 10) / 150); cx2 = b.x + (cx2 - b.x) * k2; cz2 = b.z + (cz2 - b.z) * k2; cy2 = b.y + 60 + 50 * k2; }
        cam.position.set(cx2, cy2, cz2);
        cam.lookAt(tx, ty, tz);
      } else {
        if (!spec.target || !spec.target.alive) {
          const c = specCandidates();
          spec.target = c.length ? c[spec.idx % c.length] : null;
          if (spec.target) VM.set(Game.curId(spec.target), spec.target.team);
        }
        const t = spec.target;
        if (t) {
          const b = t.body;
          if (spec.third) {
            const f = Game.dirFrom(t.yaw, t.pitch * 0.5);
            const hx = b.x, hy = b.y + eyeHeight(b), hz = b.z;
            let dist = 110;
            const h = World.raycast(hx, hy + 10, hz, -f[0], -f[1] + 0.25, -f[2], dist);
            if (h) dist = Math.max(20, h.t - 8);
            cam.position.set(hx - f[0] * dist, hy + 10 + 0.25 * dist - f[1] * dist, hz - f[2] * dist);
            cam.lookAt(hx + f[0] * 200, hy + f[1] * 200, hz + f[2] * 200);
          } else {
            cam.position.set(b.x, b.y + eyeHeight(b), b.z);
            cam.rotation.set(t.pitch, t.yaw, 0, 'YXZ');
            const w = Game.curDef(t);
            if ((w.type === 'sniper' || w.scope) && t.ws.zoom > 0) { fovTarget = fovFor(w.zoom[t.ws.zoom - 1]); $(w.scope ? 'scope2' : 'scope').hidden = false; }
            else showVM = true;
          }
        }
      }
    }
    curFov += (fovTarget - curFov) * Math.min(1, dt * 18);
    if (Math.abs(cam.fov - curFov) > 0.01) { cam.fov = curFov; cam.updateProjectionMatrix(); }
    // indoor lighting for the viewmodel
    const up = World.raycast(cam.position.x, cam.position.y, cam.position.z, 0, 1, 0, 400);
    const sunBlocked = !World.losClear(cam.position.x, cam.position.y, cam.position.z, cam.position.x + Render.sunDir.x * 3000, cam.position.y + Render.sunDir.y * 3000, cam.position.z + Render.sunDir.z * 3000);
    indoor += ((up ? 0.6 : 0) + (sunBlocked ? 0.4 : 0) - indoor) * Math.min(1, dt * 4);
    Render.setIndoorLight(indoor);
    return showVM && !!vt;
  }
  let indoor = 0;

  // ---------- overlays ----------
  function overlays(dt) {
    const now = Game.time;
    const rem = flash.until - now;
    let fo = 0;
    if (rem > 0) fo = Math.min(1, rem / 1.4) * Math.min(1, flash.dur / 1.5 + 0.25);
    $('flashfx').style.opacity = fo.toFixed(3);
    const dens = FX.smokeDensityAt(cam.position.x, cam.position.y, cam.position.z);
    $('smokefx').style.opacity = Math.min(0.97, dens * 1.3).toFixed(3);
    hurtFlash *= Math.exp(-dt * 3);
    const l = local();
    const low = l && l.alive && l.hp <= 25 ? 0.25 : 0;
    $('hurtfx').style.opacity = Math.min(1, hurtFlash + low).toFixed(3);
  }

  // What the crosshair is on: a player (for the name label) or a weapon on the floor.
  let aimT = 0, aimCache = { player: null, item: null };
  function aimedAt(p) {
    aimT -= 1;
    if (aimT > 0) return aimCache;
    aimT = 4;
    aimCache = { player: null, item: null };
    if (!p || !p.alive) return aimCache;
    const e = Game.eye(p), d = Game.dirFrom(p.yaw, p.pitch);
    const wh = World.raycast(e[0], e[1], e[2], d[0], d[1], d[2], 3000);
    const maxT = wh ? wh.t : 3000;
    let best = null, bt = maxT;
    for (const q of Game.players) {
      if (q === p || !q.alive) continue;
      const h = hitTestPlayer(q, e[0], e[1], e[2], d[0], d[1], d[2], bt);
      if (h && h.t < bt) { bt = h.t; best = q; }
    }
    if (best && !Game.smokeBlocks(e[0], e[1], e[2], best.body.x, best.body.y + 50, best.body.z)) aimCache.player = best;
    if (p === local()) {
      for (const it of Game.items) {
        if (it.kind !== 'weapon' || WEAPONS[it.inst.id].type === 'grenade') continue;
        const vx = it.x - e[0], vy = it.y - e[1], vz = it.z - e[2], dist = Math.hypot(vx, vy, vz);
        if (dist > 110 || (vx * d[0] + vy * d[1] + vz * d[2]) / dist < 0.9) continue;
        aimCache.item = it; break;
      }
    }
    return aimCache;
  }

  // ---------- loop ----------
  let last = performance.now();
  let started = false;
  // Drop the graphics preset once if the frame rate is poor.
  const perf = { t: 0, frames: 0, sum: 0, done: false };
  function watchPerf(dt) {
    if (perf.done || mode !== 'play' || paused) return;
    perf.t += dt; perf.frames++; perf.sum += dt;
    if (perf.t < 2) { perf.frames = 0; perf.sum = 0; return; }
    if (perf.t < 6) return;
    const avg = perf.sum / Math.max(1, perf.frames);
    perf.t = 0; perf.frames = 0; perf.sum = 0;
    if (avg > 1 / 42 && Render.quality !== 'low') {
      const q = Render.quality === 'high' ? 'medium' : 'low';
      Render.setQuality(q); S.quality = q; syncMenu();
      HUD.message(`Graphics set to ${q[0].toUpperCase() + q.slice(1)} to keep the frame rate up`, 3.5);
      if (q === 'low') perf.done = true;
    } else perf.done = true;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
    last = now;
    watchPerf(dt);
    impactBudget = Math.max(0, impactBudget - dt * 60);
    let showVM = false;
    if (mode === 'play' && Game.players.length) {
      if (!paused) applyMouse();
      if (HUD.buyOpen && !(local() && Game.canBuy(local()))) { HUD.openBuy(false); HUD.message('The buy time has expired', 2); }
      buildCmd();
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let i = 0; i < n; i++) { Bots.update(dt / n); Game.update(dt / n); }
      syncModels(dt);
      showVM = updateCamera(dt);
      const vt = viewTarget();
      const b = vt ? vt.body : null;
      if (vt && firstPersonOf(vt)) {
        const id = Game.curId(vt);
        VM.set(id, vt.team);
        VM.update({ dt, speed: Math.hypot(b.vx, b.vz), onGround: b.onGround, mdx: vt === local() ? lastMouse.dx : 0, mdy: vt === local() ? lastMouse.dy : 0, duck: b.ducked, planting: vt.plantT > 0, defusing: Game.bomb.defuser === vt, visible: showVM });
      } else VM.update({ dt, speed: 0, onGround: true, mdx: 0, mdy: 0, visible: false });
      lastMouse.dx = lastMouse.dy = 0;
      const aim = aimedAt(vt);
      HUD.update({ p: vt, x: cam.position.x, z: cam.position.z, yaw: vt ? vt.yaw : cam.rotation.y, third: spec.third, aimed: aim.player, item: aim.item }, dt);
      overlays(dt);
      Sound.setListener(cam.position.x, cam.position.y, cam.position.z, cam.rotation.y, cam.rotation.x);
    } else {
      menuCamera(dt);
    }
    FX.update(dt, cam.fov, Render.renderer.getDrawingBufferSize(tmpSize).y);
    Render.render(showVM);
    if (!started) {
      started = true;
      $('loading').hidden = true;
      $('menu').hidden = false;
      $('play').disabled = false; $('play').textContent = 'Play';
    }
  }
  const tmpSize = new THREE.Vector2();
  requestAnimationFrame(frame);

  // test hooks
  // Runs the simulation without rendering (used by automated tests).
  function fastForward(sec) {
    const n = Math.round(sec * 120);
    for (let i = 0; i < n; i++) { buildCmd(); Bots.update(1 / 120); Game.update(1 / 120); }
    syncModels(0.016);
  }
  window.__mirage = { Game, Bots, Render, FX, VM, HUD, startMatch, S, keys, mouse, spec, fastForward };
})();
