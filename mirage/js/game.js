'use strict';
// Match rules, economy, weapons, damage, grenades and the bomb. Pure logic: the browser layer listens to events.
if (typeof module !== 'undefined' && typeof World === 'undefined') {
  Object.assign(globalThis, require('./map.js'), require('./world.js'), require('./movement.js'), require('./weapons.js'), require('./characters.js'));
}

const Game = (() => {
  const G = { players: [], items: [], nades: [], fires: [], smokes: [], time: 0, listeners: {}, noises: [] };
  const DEG = Math.PI / 180;
  const rnd = Math.random;
  const clampv = (v, a, b) => v < a ? a : v > b ? b : v;
  const other = t => t === 'T' ? 'CT' : 'T';
  G.other = other;

  G.on = (t, fn) => (G.listeners[t] = G.listeners[t] || []).push(fn);
  G.emit = (t, d) => { const L = G.listeners[t]; if (L) for (const f of L) f(d); };

  const MODES = {
    competitive: { winRounds: 13, maxRounds: 24, half: 12, freeze: 15, roundTime: 115 },
    short: { winRounds: 9, maxRounds: 16, half: 8, freeze: 10, roundTime: 115 },
  };
  const WIN = { elim: 3250, bomb: 3500, defuse: 3500, time: 3250 };
  const LOSS = [1400, 1900, 2400, 2900, 3400];
  const BOT_NAMES = ['Albert', 'Crasswater', 'Gunner', 'Elmer', 'Marv', 'Zach', 'Ringo', 'Vitaliy', 'Rock', 'Shark', 'Harvey', 'Moe', 'Ivan', 'Zeke', 'Kurt', 'Quinn', 'Rex', 'Vinny', 'Yogi', 'Wolf', 'Brett', 'Colin', 'Otto', 'Pat'];
  const RADAR_COLORS = ['#4fb4ff', '#43d15d', '#f2d544', '#ff9b3d', '#b56df2'];

  G.cfg = { mode: 'competitive', difficulty: 'normal', playerTeam: 'CT', ff: false, bombTime: 40, plantTime: 3.2, defuseTime: 10, kitTime: 5, buyTime: 20 };

  function emptyCmd() { return { fwd: 0, side: 0, jump: false, duck: false, walk: false, fire: false, fire2: false, use: false, reload: false, drop: false, slot: null, next: 0, inspect: false }; }
  function newWS() { return { nextFire: 0, reloadEnd: 0, deployEnd: 0, recoilIdx: 0, fireInacc: 0, lastShot: -10, trig: false, trig2: false, zoom: 0, nade: null, inspectEnd: 0, boltEnd: 0 }; }

  function newPlayer(id, name, team, isBot) {
    return {
      id, name, team, isBot, variant: id % 5, color: '#ffffff',
      body: makeBody(0, 0, 0), yaw: 0, pitch: 0,
      alive: false, hp: 100, armor: 0, helmet: false, defuser: false, money: 800,
      st: { k: 0, d: 0, a: 0, hs: 0, dmg: 0, mvp: 0, score: 0, rk: 0 },
      slots: { 1: null, 2: null, 3: { id: 'knife' }, 5: null }, nades: [], nadeIdx: 0, cur: 2, last: 3,
      ws: newWS(), cmd: emptyCmd(), flashUntil: 0, flashDur: 0, spottedUntil: 0,
      dmgGiven: {}, dmgTaken: {}, hitsGiven: {}, hitsTaken: {}, plantT: 0, defuseT: 0,
      lastHurt: -10, stepAcc: 0, pickupBlock: 0, fireDmgAcc: 0,
    };
  }
  G.newPlayer = newPlayer;

  // ---------- inventory ----------
  const gun = id => ({ id, ammo: WEAPONS[id].mag, reserve: WEAPONS[id].reserve });
  G.gun = gun;
  function curId(p) {
    if (p.cur === 4) return p.nades[p.nadeIdx] || null;
    const s = p.slots[p.cur];
    return s ? s.id : null;
  }
  G.curId = curId;
  G.curDef = p => WEAPONS[curId(p)] || WEAPONS.knife;
  G.curInst = p => p.cur === 4 ? null : p.slots[p.cur];
  function weaponSpeed(p) {
    const w = G.curDef(p);
    if (w.type === 'sniper' && p.ws.zoom > 0) return w.scopedSpeed;
    return w.speed || 250;
  }
  G.weaponSpeed = weaponSpeed;

  function resetInventory(p) {
    p.slots[1] = null;
    p.slots[2] = gun(p.team === 'T' ? 'glock' : 'usp');
    p.slots[5] = null;
    p.nades = []; p.nadeIdx = 0;
    p.armor = 0; p.helmet = false; p.defuser = false;
  }
  function selectSlot(p, slot, silent) {
    if (slot === 4) {
      if (!p.nades.length) return false;
      if (p.cur === 4) p.nadeIdx = (p.nadeIdx + 1) % p.nades.length;
    } else if (!p.slots[slot]) return false;
    if (p.cur !== slot) p.last = p.cur;
    p.cur = slot;
    const w = G.curDef(p);
    const ws = p.ws;
    ws.reloadEnd = 0; ws.zoom = 0; ws.nade = null; ws.inspectEnd = 0;
    ws.deployEnd = G.time + (w.deploy || 1);
    ws.nextFire = Math.max(ws.nextFire, ws.deployEnd);
    p.plantT = 0;
    if (!silent) G.emit('deploy', { p, id: curId(p) });
    return true;
  }
  G.selectSlot = selectSlot;
  function bestSlot(p) { return p.slots[1] ? 1 : p.slots[2] ? 2 : 3; }

  // ---------- match flow ----------
  G.newMatch = (cfg) => {
    Object.assign(G.cfg, cfg || {});
    G.mode = MODES[G.cfg.mode] || MODES.competitive;
    G.players = [];
    G.score = { T: 0, CT: 0 };
    G.lossStreak = { T: 1, CT: 1 };
    G.round = 0;
    G.history = [];
    G.matchOver = false;
    G.halftimePending = false;
    G.time = 0;
    const names = BOT_NAMES.slice().sort(() => rnd() - 0.5);
    let id = 0;
    const hasLocal = G.cfg.playerTeam === 'T' || G.cfg.playerTeam === 'CT';
    for (const team of ['CT', 'T']) {
      for (let i = 0; i < 5; i++) {
        const isLocal = hasLocal && team === G.cfg.playerTeam && i === 0;
        const p = newPlayer(id++, isLocal ? (G.cfg.playerName || 'You') : names.pop(), team, !isLocal);
        p.color = RADAR_COLORS[i];
        if (isLocal) G.local = p;
        G.players.push(p);
      }
    }
    if (!hasLocal) G.local = null;
    for (const p of G.players) { resetInventory(p); p.money = 800; }
    G.emit('matchStart', {});
    startRound();
  };

  function spawnPlayer(p, sp, i) {
    const s = SPAWNS[p.team][i % 5];
    const x = s[0] + (rnd() - 0.5) * 20, z = s[1] + (rnd() - 0.5) * 20;
    const y = World.floorAt(x, z);
    p.body = makeBody(x, y, z);
    const tx = p.team === 'T' ? cx(30) : cx(30), tz = p.team === 'T' ? cz(27) : cz(46);
    p.yaw = Math.atan2(-(tx - x), -(tz - z));
    p.pitch = 0;
  }

  function startRound() {
    if (G.halftimePending) {
      G.halftimePending = false;
      for (const p of G.players) { p.team = other(p.team); resetInventory(p); p.money = 800; p.alive = false; }
      const s = G.score.T; G.score.T = G.score.CT; G.score.CT = s;
      G.lossStreak = { T: 1, CT: 1 };
      G.emit('halftime', {});
    }
    G.round++;
    const pistol = G.round === 1 || G.round === G.mode.half + 1;
    G.items = []; G.nades = []; G.fires = []; G.smokes = []; G.noises = [];
    G.emit('roundReset', {});
    const order = { T: 0, CT: 0 };
    const idx = { T: [0, 1, 2, 3, 4].sort(() => rnd() - 0.5), CT: [0, 1, 2, 3, 4].sort(() => rnd() - 0.5) };
    for (const p of G.players) {
      if (pistol || !p.alive) resetInventory(p);
      p.slots[5] = null;
      p.alive = true; p.hp = 100;
      spawnPlayer(p, null, idx[p.team][order[p.team]++]);
      p.ws = newWS();
      p.cur = bestSlot(p); p.last = 3;
      p.flashUntil = 0; p.flashDur = 0; p.dmgGiven = {}; p.dmgTaken = {}; p.hitsGiven = {}; p.hitsTaken = {};
      p.st.rk = 0; p.plantT = 0; p.defuseT = 0; p.lastHurt = -10; p.pickupBlock = 0; p.fireDmgAcc = 0;
      p.cmd = emptyCmd();
      p.killedBy = null;
      p.roundStartMoney = p.money;
    }
    const ts = G.players.filter(p => p.team === 'T');
    const carrier = ts[Math.floor(rnd() * ts.length)];
    carrier.slots[5] = { id: 'c4' };
    G.bomb = { state: 'carried', carrier, x: 0, y: 0, z: 0, timer: 0, site: null, beepT: 0, defuser: null, planter: null, defusedBy: null };
    G.phase = 'freeze';
    G.phaseT = G.mode.freeze;
    G.roundTime = G.mode.roundTime;
    G.buyUntil = G.mode.freeze + G.cfg.buyTime;
    G.roundClock = 0;
    G.winner = null;
    G.emit('roundStart', { round: G.round, pistol });
  }
  G.startRound = startRound;

  function endRound(winner, reason) {
    if (G.phase === 'over') return;
    G.phase = 'over';
    G.phaseT = 7;
    G.winner = winner;
    G.score[winner]++;
    const loser = other(winner);
    for (const p of G.players) {
      if (p.team === winner) addMoney(p, WIN[reason]);
      else {
        let bonus = LOSS[Math.min(G.lossStreak[loser], 4)];
        if (reason === 'time' && p.team === 'T' && p.alive) bonus = 0;
        addMoney(p, bonus);
        if (p.team === 'T' && (G.bomb.state === 'defused' || (G.bomb.state === 'planted' && reason === 'elim'))) addMoney(p, 800);
      }
    }
    G.lossStreak[loser] = Math.min(4, G.lossStreak[loser] + 1);
    G.lossStreak[winner] = Math.max(0, G.lossStreak[winner] - 1);
    // MVP
    let mvp = null;
    if (reason === 'bomb' && G.bomb.planter) mvp = G.bomb.planter;
    else if (reason === 'defuse' && G.bomb.defusedBy) mvp = G.bomb.defusedBy;
    else {
      let best = -1;
      for (const p of G.players) if (p.team === winner && (p.st.rk > best || (p.st.rk === best && mvp && (p.dmgRound || 0) > (mvp.dmgRound || 0)))) { best = p.st.rk; mvp = p; }
    }
    if (mvp) { mvp.st.mvp++; mvp.st.score += 2; }
    G.history.push({ winner, reason });
    G.lastMvp = mvp;
    const total = G.score.T + G.score.CT;
    if (G.score[winner] >= G.mode.winRounds) G.matchOver = winner;
    else if (total >= G.mode.maxRounds) G.matchOver = 'draw';
    else if (total === G.mode.half) G.halftimePending = true;
    G.emit('roundEnd', { winner, reason, mvp, halftime: G.halftimePending, matchOver: G.matchOver });
  }

  function addMoney(p, amt) { p.money = clampv(p.money + amt, 0, 16000); }
  G.addMoney = addMoney;

  // ---------- buying ----------
  G.inBuyZone = p => World.inRect(BUY_ZONES[p.team], p.body.x, p.body.z);
  G.canBuy = p => p.alive && (G.phase === 'freeze' || (G.phase === 'live' && G.roundClock < G.cfg.buyTime)) && G.inBuyZone(p);
  G.buyPrice = (p, item) => {
    if (WEAPONS[item]) return WEAPONS[item].price;
    if (item === 'vesthelm' && p.armor >= 100 && !p.helmet) return 350;
    return EQUIPMENT[item].price;
  };
  G.buyCheck = (p, item) => {
    if (!G.canBuy(p)) return 'You can only buy in the buy zone during buy time';
    const w = WEAPONS[item], e = EQUIPMENT[item];
    const def = w || e;
    if (!def) return 'Unknown item';
    if (def.team && def.team !== p.team) return 'Not available for your team';
    const price = G.buyPrice(p, item);
    if (p.money < price) return 'Insufficient funds';
    if (w) {
      if (w.type === 'grenade') {
        const n = p.nades.filter(x => x === item).length;
        if (p.nades.length >= 4) return 'You cannot carry any more grenades';
        if (n >= (w.max || 1)) return 'You cannot carry any more of that grenade';
        if ((item === 'molotov' || item === 'incgrenade') && (p.nades.includes('molotov') || p.nades.includes('incgrenade'))) return 'You cannot carry any more of that grenade';
      } else if (p.slots[w.slot] && p.slots[w.slot].id === item) return 'You already have that weapon';
    } else if (item === 'vest' && p.armor >= 100) return 'You already have kevlar';
    else if (item === 'vesthelm' && p.armor >= 100 && p.helmet) return 'You already have kevlar and a helmet';
    else if (item === 'defuser' && p.defuser) return 'You already have a defuse kit';
    return null;
  };
  G.buy = (p, item) => {
    const err = G.buyCheck(p, item);
    if (err) { G.emit('buyFail', { p, item, err }); return false; }
    const price = G.buyPrice(p, item);
    p.money -= price;
    const w = WEAPONS[item];
    if (w) {
      if (w.type === 'grenade') { p.nades.push(item); if (!p.isBot && p.cur !== 4 && p.nades.length === 1) { /* keep current */ } }
      else {
        if (p.slots[w.slot]) dropItem(p, w.slot, true);
        p.slots[w.slot] = gun(item);
        selectSlot(p, w.slot);
      }
    } else if (item === 'vest') { p.armor = 100; }
    else if (item === 'vesthelm') { p.armor = 100; p.helmet = true; }
    else if (item === 'defuser') p.defuser = true;
    G.emit('buy', { p, item, price });
    return true;
  };

  // ---------- items on the ground ----------
  let itemId = 0;
  function spawnItem(kind, inst, x, y, z, vx, vy, vz) {
    const it = { uid: itemId++, kind, inst, x, y, z, vx, vy, vz, rest: false, yaw: rnd() * Math.PI * 2, t: 0 };
    G.items.push(it);
    G.emit('itemSpawn', it);
    return it;
  }
  function removeItem(it) {
    const i = G.items.indexOf(it);
    if (i >= 0) { G.items.splice(i, 1); G.emit('itemRemove', it); }
  }
  function dropItem(p, slot, gentle) {
    let inst, kind;
    if (slot === 5) { inst = p.slots[5]; if (!inst) return null; p.slots[5] = null; kind = 'c4'; }
    else if (slot === 4) { const id = p.nades[p.nadeIdx]; if (!id) return null; p.nades.splice(p.nadeIdx, 1); p.nadeIdx = 0; inst = { id }; kind = 'weapon'; }
    else { inst = p.slots[slot]; if (!inst || slot === 3) return null; p.slots[slot] = null; kind = 'weapon'; }
    const b = p.body, eye = b.y + eyeHeight(b);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const sp = gentle ? 60 : 230;
    const it = spawnItem(kind, inst, b.x + fx * 12, eye - 12, b.z + fz * 12, fx * sp + b.vx * 0.5, gentle ? 40 : 110, fz * sp + b.vz * 0.5);
    p.pickupBlock = G.time + 0.9;
    if (kind === 'c4') { G.bomb.state = 'dropped'; G.bomb.carrier = null; G.bomb.item = it; }
    if (p.cur === slot && p.alive) {
      if (!(slot === 4 && p.nades.length)) selectSlot(p, bestSlot(p));
    }
    G.emit('drop', { p, it });
    return it;
  }
  G.dropItem = dropItem;

  function updateItems(dt) {
    for (const it of G.items) {
      it.t += dt;
      if (it.rest) continue;
      it.vy -= 800 * dt;
      const nx = it.x + it.vx * dt, ny = it.y + it.vy * dt, nz = it.z + it.vz * dt;
      const dx = nx - it.x, dy = ny - it.y, dz = nz - it.z, L = Math.hypot(dx, dy, dz);
      if (L > 0.01) {
        const h = World.raycast(it.x, it.y, it.z, dx / L, dy / L, dz / L, L + 2);
        if (h) {
          it.x += dx / L * Math.max(0, h.t - 2); it.y += dy / L * Math.max(0, h.t - 2); it.z += dz / L * Math.max(0, h.t - 2);
          if (h.ny > 0.6) { it.rest = true; it.y = World.floorAt(it.x, it.z, it.y + 4) + 1; it.vx = it.vy = it.vz = 0; }
          else { const vn = it.vx * h.nx + it.vy * h.ny + it.vz * h.nz; it.vx -= 1.5 * vn * h.nx; it.vy -= 1.5 * vn * h.ny; it.vz -= 1.5 * vn * h.nz; it.vx *= 0.5; it.vz *= 0.5; }
          continue;
        }
      }
      it.x = nx; it.y = ny; it.z = nz;
      if (it.y < -400) { it.rest = true; }
    }
    // pickups
    for (const p of G.players) {
      if (!p.alive || G.time < p.pickupBlock) continue;
      const b = p.body;
      for (const it of G.items) {
        if (Math.abs(it.x - b.x) > 40 || Math.abs(it.z - b.z) > 40 || it.y < b.y - 30 || it.y > b.y + 72) continue;
        if (it.kind === 'c4') {
          if (p.team !== 'T') continue;
          p.slots[5] = it.inst; G.bomb.state = 'carried'; G.bomb.carrier = p; G.bomb.item = null;
          removeItem(it); G.emit('pickup', { p, id: 'c4' }); break;
        }
        const w = WEAPONS[it.inst.id];
        if (w.type === 'grenade') {
          if (p.nades.length >= 4 || p.nades.filter(x => x === w.id).length >= (w.max || 1)) continue;
          p.nades.push(w.id); removeItem(it); G.emit('pickup', { p, id: w.id }); break;
        }
        if (p.slots[w.slot]) continue;
        p.slots[w.slot] = it.inst; removeItem(it); G.emit('pickup', { p, id: w.id });
        if (p.isBot || G.curDef(p).type === 'knife') selectSlot(p, w.slot);
        break;
      }
    }
  }
  // Swap the current weapon for the item being looked at.
  G.tryUsePickup = (p) => {
    const b = p.body, eye = [b.x, b.y + eyeHeight(b), b.z];
    const d = dirFrom(p.yaw, p.pitch);
    let best = null, bd = 110;
    for (const it of G.items) {
      if (it.kind !== 'weapon') continue;
      const w = WEAPONS[it.inst.id]; if (w.type === 'grenade') continue;
      const vx = it.x - eye[0], vy = it.y - eye[1], vz = it.z - eye[2];
      const dist = Math.hypot(vx, vy, vz);
      if (dist > bd) continue;
      const dot = (vx * d[0] + vy * d[1] + vz * d[2]) / dist;
      if (dot < 0.9) continue;
      best = it; bd = dist;
    }
    if (!best) return false;
    const w = WEAPONS[best.inst.id];
    if (p.slots[w.slot]) dropItem(p, w.slot, true);
    p.slots[w.slot] = best.inst; removeItem(best);
    p.pickupBlock = G.time + 0.5;
    selectSlot(p, w.slot);
    G.emit('pickup', { p, id: w.id });
    return true;
  };

  // ---------- helpers ----------
  function dirFrom(yaw, pitch) {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }
  G.dirFrom = dirFrom;
  G.eye = p => [p.body.x, p.body.y + eyeHeight(p.body) , p.body.z];

  function inaccuracy(p, w) {
    const b = p.body;
    let v = b.ducked ? w.inCrouch : w.inStand;
    if (w.type === 'sniper' && p.ws.zoom === 0) v += w.noScope;
    const sp = Math.hypot(b.vx, b.vz), mx = w.speed;
    const mf = clampv((sp - mx * 0.34) / (mx * 0.66), 0, 1);
    v += w.inMove * mf * mf;
    if (!b.onGround) v += w.inJump * (w.id === 'ssg08' && Math.abs(b.vy) < 60 ? 0.1 : 1);
    v += p.ws.fireInacc;
    return v;
  }
  G.inaccuracy = inaccuracy;

  // ---------- shooting ----------
  function surfaceOf(b) {
    if (!b) return 'stone';
    if (b.kind === 'prop') return b.mat;
    return b.mat;
  }
  function fireBullet(p, w) {
    const eye = G.eye(p);
    const [ry, rp] = recoilAt(w, p.ws.recoilIdx);
    const comp = p.recoilComp || 0;
    const yaw = p.yaw - ry * DEG * (1 - comp), pitch = p.pitch + rp * DEG * (1 - comp);
    const inacc = inaccuracy(p, w) / 1000;
    const f = dirFrom(yaw, pitch);
    const rgt = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const up = [rgt[1] * f[2] - rgt[2] * f[1], rgt[2] * f[0] - rgt[0] * f[2], rgt[0] * f[1] - rgt[1] * f[0]];
    const a1 = rnd() * Math.PI * 2, r1 = rnd() * inacc, a2 = rnd() * Math.PI * 2, r2 = rnd() * (w.spread / 1000);
    const ox = Math.cos(a1) * r1 + Math.cos(a2) * r2, oy = Math.sin(a1) * r1 + Math.sin(a2) * r2;
    let dx = f[0] + rgt[0] * ox + up[0] * oy, dy = f[1] + rgt[1] * ox + up[1] * oy, dz = f[2] + rgt[2] * ox + up[2] * oy;
    const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
    return traceBullet(p, w, eye[0], eye[1], eye[2], dx, dy, dz);
  }

  function traceBullet(p, w, ox, oy, oz, dx, dy, dz) {
    let mul = 1, travelled = 0, remaining = 8192, pens = 0;
    const hitSet = new Set([p]);
    let end = null;
    for (let iter = 0; iter < 8; iter++) {
      const wh = World.raycast(ox, oy, oz, dx, dy, dz, remaining);
      const wallT = wh ? wh.t : remaining;
      const whCopy = wh ? { t: wh.t, tExit: wh.tExit, nx: wh.nx, ny: wh.ny, nz: wh.nz, block: wh.block } : null;
      let best = null, bestP = null;
      for (const q of G.players) {
        if (!q.alive || hitSet.has(q)) continue;
        const h = hitTestPlayer(q, ox, oy, oz, dx, dy, dz, wallT);
        if (h && (!best || h.t < best.t)) { best = h; bestP = q; }
      }
      if (best) {
        const hx = ox + dx * best.t, hy = oy + dy * best.t, hz = oz + dz * best.t;
        const smoke = G.smokeCheck ? G.smokeCheck(p, bestP) : false;
        hitPlayer(p, bestP, w, travelled + best.t, best.group, mul, pens > 0, [dx, dy, dz], [hx, hy, hz], smoke);
        hitSet.add(bestP);
        mul *= 0.6;
        const adv = best.t + 8;
        ox += dx * adv; oy += dy * adv; oz += dz * adv; travelled += adv; remaining -= adv;
        if (remaining <= 0) break;
        continue;
      }
      if (!whCopy) { end = [ox + dx * remaining, oy + dy * remaining, oz + dz * remaining]; break; }
      const hx = ox + dx * whCopy.t, hy = oy + dy * whCopy.t, hz = oz + dz * whCopy.t;
      const mat = surfaceOf(whCopy.block);
      G.emit('impact', { x: hx, y: hy, z: hz, nx: whCopy.nx, ny: whCopy.ny, nz: whCopy.nz, mat, p });
      if (!end) end = [hx, hy, hz];
      const b = whCopy.block, thick = whCopy.tExit - whCopy.t;
      const eff = b.pen > 0 ? thick / b.pen : 1e9;
      if (eff < w.pen && pens < 3 && thick < 200) {
        mul *= Math.max(0.15, 1 - eff / w.pen) * 0.85;
        const adv = whCopy.tExit + 0.5;
        const ex = ox + dx * whCopy.tExit, ey = oy + dy * whCopy.tExit, ez = oz + dz * whCopy.tExit;
        G.emit('impact', { x: ex, y: ey, z: ez, nx: dx, ny: dy, nz: dz, mat, exit: true, p });
        ox += dx * adv; oy += dy * adv; oz += dz * adv; travelled += adv; remaining -= adv; pens++;
        continue;
      }
      break;
    }
    return end;
  }

  function hitPlayer(a, v, w, dist, group, mul, wallbang, dir, pos, smoke) {
    if (!G.cfg.ff && a.team === v.team && a !== v) {
      G.emit('blood', { x: pos[0], y: pos[1], z: pos[2], dx: dir[0], dy: dir[1], dz: dir[2], head: false, v });
      return;
    }
    const dmg = computeDamage(w, dist, group, v, mul);
    if (a.team === v.team) { dmg.hp = Math.max(1, Math.round(dmg.hp / 3)); dmg.armor = Math.round(dmg.armor / 3); }
    G.emit('blood', { x: pos[0], y: pos[1], z: pos[2], dx: dir[0], dy: dir[1], dz: dir[2], head: group === 'head', v, helmet: dmg.armorHit && group === 'head' });
    applyDamage(v, a, dmg.hp, dmg.armor, w.id, group, { wallbang, dir, smoke, armorHit: dmg.armorHit });
  }

  function applyDamage(v, a, hp, armor, weapon, group, o = {}) {
    if (!v.alive) return;
    const real = Math.min(hp, v.hp);
    v.hp -= hp;
    v.armor = Math.max(0, v.armor - armor);
    if (v.armor <= 0) v.helmet = false;
    v.lastHurt = G.time;
    v.body.velMod = Math.min(v.body.velMod, weapon === 'fire' ? 0.7 : group === 'legs' ? 0.55 : 0.45);
    if (a && a !== v) {
      a.dmgGiven[v.id] = (a.dmgGiven[v.id] || 0) + real;
      a.hitsGiven[v.id] = (a.hitsGiven[v.id] || 0) + 1;
      v.dmgTaken[a.id] = (v.dmgTaken[a.id] || 0) + real;
      v.hitsTaken[a.id] = (v.hitsTaken[a.id] || 0) + 1;
      if (a.team !== v.team) { a.st.dmg += real; a.dmgRound = (a.dmgRound || 0) + real; }
    }
    G.emit('hurt', { v, a, hp: real, group, weapon, dir: o.dir, armorHit: o.armorHit });
    if (v.hp <= 0) kill(v, a, weapon, group === 'head', o);
  }
  G.applyDamage = applyDamage;

  function kill(v, a, weapon, headshot, o = {}) {
    v.alive = false; v.hp = 0;
    v.st.d++;
    v.killedBy = a;
    v.deathTime = G.time;
    v.ws.zoom = 0;
    // drop best weapon, bomb and a grenade
    const b = v.body;
    const drop = (inst, kind) => spawnItem(kind, inst, b.x + (rnd() - 0.5) * 16, b.y + 40, b.z + (rnd() - 0.5) * 16, (rnd() - 0.5) * 80 + b.vx * 0.4, 60, (rnd() - 0.5) * 80 + b.vz * 0.4);
    if (v.slots[1]) { drop(v.slots[1], 'weapon'); v.slots[1] = null; }
    else if (v.slots[2]) { drop(v.slots[2], 'weapon'); v.slots[2] = null; }
    if (v.nades.length) { drop({ id: v.nades[v.nades.length - 1] }, 'weapon'); }
    v.nades = [];
    if (v.slots[5]) {
      const it = drop(v.slots[5], 'c4'); v.slots[5] = null;
      G.bomb.state = 'dropped'; G.bomb.carrier = null; G.bomb.item = it;
    }
    let assister = null;
    if (a && a !== v) {
      if (a.team !== v.team) {
        a.st.k++; a.st.rk++; a.st.score += 2;
        if (headshot) a.st.hs++;
        const w = WEAPONS[weapon];
        addMoney(a, w ? (w.kill || 300) : 300);
      } else { a.st.k--; a.st.score -= 2; addMoney(a, -300); }
      // assists: 41+ damage from a teammate of the killer
      for (const q of G.players) {
        if (q === a || q.team === v.team) continue;
        if ((q.dmgGiven[v.id] || 0) >= 41) { q.st.a++; q.st.score += 1; if (!assister) assister = q; }
      }
    }
    G.emit('kill', { killer: a, victim: v, weapon, headshot, wallbang: !!o.wallbang, smoke: !!o.smoke, assister, flashed: a && a.flashUntil > G.time });
  }

  // ---------- knife ----------
  function knifeAttack(p, stab) {
    const w = WEAPONS.knife;
    const eye = G.eye(p), d = dirFrom(p.yaw, p.pitch);
    const reach = stab ? 34 : 48;
    const wh = World.raycast(eye[0], eye[1], eye[2], d[0], d[1], d[2], reach + 10);
    const maxT = wh ? Math.min(wh.t, reach) : reach;
    let best = null, bp = null;
    for (const q of G.players) {
      if (!q.alive || q === p) continue;
      for (const off of [[0, 0], [0.12, 0], [-0.12, 0], [0, -0.12]]) {
        const dd = dirFrom(p.yaw + off[0], p.pitch + off[1]);
        const h = hitTestPlayer(q, eye[0], eye[1], eye[2], dd[0], dd[1], dd[2], maxT);
        if (h && (!best || h.t < best.t)) { best = h; bp = q; }
      }
    }
    G.emit('knife', { p, stab, hit: !!bp });
    if (bp) {
      const fx = -Math.sin(bp.yaw), fz = -Math.cos(bp.yaw);
      const tx = bp.body.x - p.body.x, tz = bp.body.z - p.body.z, tl = Math.hypot(tx, tz) || 1;
      const back = (fx * tx + fz * tz) / tl > 0.45;
      let dmg = stab ? (back ? 180 : 65) : (back ? 90 : (G.time - p.ws.lastShot < 0.6 ? 25 : 40));
      if (!G.cfg.ff && bp.team === p.team) return;
      let armor = 0;
      if (bp.armor > 0) { armor = Math.round(dmg * 0.15 * 0.5); dmg = Math.round(dmg * 0.85); }
      G.emit('blood', { x: bp.body.x, y: bp.body.y + 48, z: bp.body.z, dx: d[0], dy: d[1], dz: d[2], head: false, v: bp });
      applyDamage(bp, p, dmg, armor, 'knife', 'chest', { dir: d });
    } else if (wh && wh.t < reach) {
      G.emit('impact', { x: eye[0] + d[0] * wh.t, y: eye[1] + d[1] * wh.t, z: eye[2] + d[2] * wh.t, nx: wh.nx, ny: wh.ny, nz: wh.nz, mat: surfaceOf(wh.block), knife: true, p });
    }
  }

  // ---------- grenades ----------
  function throwNade(p, strength) {
    const id = p.nades[p.nadeIdx];
    if (!id) return;
    p.nades.splice(p.nadeIdx, 1); p.nadeIdx = 0;
    const b = p.body, eye = G.eye(p);
    let pitch = p.pitch / DEG;
    pitch = pitch + 10 * (90 - Math.abs(pitch)) / 90;
    const d = dirFrom(p.yaw, pitch * DEG);
    const vel = clampv(750 * (strength * 0.7 + 0.3), 15, 750) * 0.9;
    const n = {
      id, owner: p, team: p.team, x: eye[0] + d[0] * 16, y: eye[1] + d[1] * 16 - 4, z: eye[2] + d[2] * 16,
      vx: d[0] * vel + b.vx * 1.25, vy: d[1] * vel + b.vy * 1.25, vz: d[2] * vel + b.vz * 1.25, t: 0, rest: false, done: false,
    };
    // start just behind the eye if the throw point is inside a wall
    const h = World.raycast(eye[0], eye[1], eye[2], d[0], d[1], d[2], 18);
    if (h) { n.x = eye[0] + d[0] * (h.t - 4); n.y = eye[1] + d[1] * (h.t - 4); n.z = eye[2] + d[2] * (h.t - 4); }
    G.nades.push(n);
    G.emit('nadeThrow', { p, n });
    G.noise(eye[0], eye[2], 600, p);
    p.ws.nade = null;
    if (p.nades.length) { p.cur = 4; p.ws.deployEnd = G.time + 0.6; }
    else selectSlot(p, p.last && p.last !== 4 && (p.slots[p.last]) ? p.last : bestSlot(p), true);
  }
  G.throwNadeFrom = (p, id, pos, vel) => {
    const n = { id, owner: p, team: p.team, x: pos[0], y: pos[1], z: pos[2], vx: vel[0], vy: vel[1], vz: vel[2], t: 0, rest: false, done: false };
    G.nades.push(n);
    G.emit('nadeThrow', { p, n });
    return n;
  };
  G.NADE_GRAVITY = 320;

  function updateNades(dt) {
    for (const n of G.nades) {
      if (n.done) continue;
      n.t += dt;
      if (!n.rest) {
        const sp = Math.hypot(n.vx, n.vy, n.vz);
        const steps = Math.max(1, Math.ceil(sp * dt / 12));
        const sdt = dt / steps;
        for (let s = 0; s < steps && !n.rest && !n.done; s++) {
          n.vy -= G.NADE_GRAVITY * sdt;
          const mx = n.vx * sdt, my = n.vy * sdt, mz = n.vz * sdt, L = Math.hypot(mx, my, mz);
          if (L < 1e-4) continue;
          const h = World.raycast(n.x, n.y, n.z, mx / L, my / L, mz / L, L + 2);
          if (h) {
            n.x += mx / L * Math.max(0, h.t - 1.5); n.y += my / L * Math.max(0, h.t - 1.5); n.z += mz / L * Math.max(0, h.t - 1.5);
            const vn = n.vx * h.nx + n.vy * h.ny + n.vz * h.nz;
            if ((n.id === 'molotov' || n.id === 'incgrenade') && h.ny > 0.7) { detonate(n); break; }
            n.vx -= 1.45 * vn * h.nx; n.vy -= 1.45 * vn * h.ny; n.vz -= 1.45 * vn * h.nz;
            n.vx *= 0.72; n.vz *= 0.72; n.vy *= 0.8;
            if (Math.abs(vn) > 60) G.emit('nadeBounce', { n });
            if (h.ny > 0.7 && Math.hypot(n.vx, n.vy, n.vz) < 40) { n.rest = true; n.vx = n.vy = n.vz = 0; }
          } else { n.x += mx; n.y += my; n.z += mz; }
          // bounce off players lightly
          for (const q of G.players) {
            if (!q.alive || q === n.owner && n.t < 0.3) continue;
            const b = q.body;
            if (Math.abs(n.x - b.x) < 16 && Math.abs(n.z - b.z) < 16 && n.y > b.y && n.y < b.y + b.height) { n.vx *= -0.3; n.vz *= -0.3; break; }
          }
          if (n.y < -600) n.done = true;
        }
      }
      if (n.done) continue;
      if (n.id === 'he' || n.id === 'flash') { if (n.t >= 1.6) detonate(n); }
      else if (n.id === 'smoke') { if ((n.rest && n.t > 1.2) || n.t > 4) detonate(n); }
      else if (n.id === 'molotov' || n.id === 'incgrenade') { if (n.t >= 2.0) detonate(n); }
    }
    G.nades = G.nades.filter(n => !n.done);
  }

  function detonate(n) {
    n.done = true;
    const x = n.x, y = n.y, z = n.z;
    if (n.id === 'he') {
      G.emit('he', { x, y, z, n });
      for (const q of G.players) {
        if (!q.alive) continue;
        const b = q.body;
        const d = Math.hypot(b.x - x, b.y + 36 - y, b.z - z);
        if (d > 350) continue;
        if (!World.losClear(x, y + 4, z, b.x, b.y + 40, b.z) && !World.losClear(x, y + 4, z, b.x, b.y + 64, b.z)) continue;
        if (!G.cfg.ff && q.team === n.team && q !== n.owner) continue;
        let dmg = 98 * (1 - d / 350);
        let armor = 0;
        if (q.armor > 0) { armor = Math.round(dmg * 0.25); dmg *= 0.5; }
        if (dmg >= 1) applyDamage(q, n.owner, Math.round(dmg), armor, 'he', 'chest', { dir: [(b.x - x) / (d || 1), 0, (b.z - z) / (d || 1)] });
      }
      G.noise(x, z, 3000, n.owner);
    } else if (n.id === 'flash') {
      G.emit('flash', { x, y, z, n });
      for (const q of G.players) {
        if (!q.alive) continue;
        const e = G.eye(q);
        const d = Math.hypot(e[0] - x, e[1] - y, e[2] - z);
        if (d > 2200) continue;
        if (!World.losClear(x, y + 2, z, e[0], e[1], e[2])) continue;
        const dir = dirFrom(q.yaw, q.pitch);
        const tx = (x - e[0]) / d, ty = (y - e[1]) / d, tz = (z - e[2]) / d;
        const dot = dir[0] * tx + dir[1] * ty + dir[2] * tz;
        const face = dot > 0.8 ? 1 : dot > 0.35 ? 0.8 : dot > -0.3 ? 0.45 : 0.18;
        const distF = d < 300 ? 1 : Math.max(0, 1 - (d - 300) / 1900);
        const dur = 4.9 * face * distF;
        if (dur < 0.25) continue;
        if (q.flashUntil - G.time < dur) { q.flashUntil = G.time + dur; q.flashDur = dur; }
        G.emit('flashed', { p: q, dur, by: n.owner });
      }
    } else if (n.id === 'smoke') {
      const s = { x, y, z, t: 0, dur: 18 };
      G.smokes.push(s);
      // put out fires inside the smoke
      G.fires = G.fires.filter(f => { const out = Math.hypot(f.x - x, f.z - z) < f.r + 130; if (out) G.emit('fireOut', f); return !out; });
      G.emit('smoke', { x, y, z, dur: 18, s });
    } else {
      const fy = World.floorAt(x, z, y + 10);
      if (y - fy > 250) { G.emit('glass', { x, y, z }); return; }
      for (const s of G.smokes) if (Math.hypot(s.x - x, s.z - z) < 150 && s.t < s.dur - 1) { G.emit('glass', { x, y: fy, z, out: true }); return; }
      const f = { x, y: fy, z, r: 135, t: 0, dur: 7, owner: n.owner, team: n.team, id: n.id };
      G.fires.push(f);
      G.emit('molotov', { x, y: fy, z, f });
    }
  }

  function updateAreaEffects(dt) {
    for (const s of G.smokes) s.t += dt;
    G.smokes = G.smokes.filter(s => s.t < s.dur);
    for (const f of G.fires) {
      f.t += dt;
      for (const q of G.players) {
        if (!q.alive) continue;
        const b = q.body;
        if (Math.hypot(b.x - f.x, b.z - f.z) > f.r || Math.abs(b.y - f.y) > 60) continue;
        if (!G.cfg.ff && q.team === f.team && q !== f.owner) continue;
        q.fireDmgAcc += 36 * dt;
        if (q.fireDmgAcc >= 4) { const d = Math.floor(q.fireDmgAcc); q.fireDmgAcc -= d; applyDamage(q, f.owner, d, 0, f.id, 'chest', {}); }
      }
    }
    G.fires = G.fires.filter(f => f.t < f.dur);
  }
  G.smokeBlocks = (ax, ay, az, bx, by, bz) => {
    for (const s of G.smokes) {
      if (s.t < 1.2 || s.t > s.dur - 1.5) continue;
      const sx = s.x, sy = s.y + 70, sz = s.z;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const L2 = dx * dx + dy * dy + dz * dz || 1;
      const t = clampv(((sx - ax) * dx + (sy - ay) * dy + (sz - az) * dz) / L2, 0, 1);
      const px = ax + dx * t - sx, py = (ay + dy * t - sy) * 1.5, pz = az + dz * t - sz;
      if (px * px + py * py + pz * pz < 150 * 150) return true;
    }
    return false;
  };
  G.smokeCheck = (a, v) => { const e = G.eye(a); return G.smokeBlocks(e[0], e[1], e[2], v.body.x, v.body.y + 50, v.body.z); };
  G.inFire = (x, y, z, pad = 0) => G.fires.some(f => Math.hypot(x - f.x, z - f.z) < f.r + pad && Math.abs(y - f.y) < 80);

  // ---------- bomb ----------
  function updateBomb(dt) {
    const B = G.bomb;
    if (B.state === 'carried' && B.carrier) { const b = B.carrier.body; B.x = b.x; B.y = b.y; B.z = b.z; }
    if (B.state === 'dropped' && B.item) { B.x = B.item.x; B.y = B.item.y; B.z = B.item.z; }
    if (B.state !== 'planted') return;
    B.timer -= dt;
    const frac = Math.max(0, B.timer / G.cfg.bombTime);
    B.beepT -= dt;
    if (B.beepT <= 0 && B.timer > 0) {
      B.beepT = B.timer < 1.5 ? 0.12 : 0.13 + 0.9 * Math.pow(frac, 1.25);
      G.emit('beep', { x: B.x, y: B.y, z: B.z, hi: B.timer < 10 });
    }
    // defusing
    const d = B.defuser;
    if (d) {
      if (!d.alive || !d.cmd.use || Math.hypot(d.body.x - B.x, d.body.z - B.z) > 80 || Math.hypot(d.body.vx, d.body.vz) > 20) {
        B.defuser = null; d.defuseT = 0; G.emit('defuseAbort', { p: d });
      } else {
        d.defuseT += dt;
        B.defuseTicks = (B.defuseTicks || 0) + dt;
        if (B.defuseTicks > 0.5) { B.defuseTicks = 0; G.emit('defuseTick', B); }
        const need = d.defuser ? G.cfg.kitTime : G.cfg.defuseTime;
        if (d.defuseT >= need) {
          B.state = 'defused'; B.defusedBy = d; B.defuser = null;
          addMoney(d, 300); d.st.score += 2;
          G.emit('defused', { p: d });
          endRound('CT', 'defuse');
          return;
        }
      }
    }
    if (B.timer <= 0) {
      B.state = 'exploded';
      G.emit('explode', { x: B.x, y: B.y, z: B.z });
      for (const q of G.players) {
        if (!q.alive) continue;
        const b = q.body;
        const dd = Math.hypot(b.x - B.x, b.y - B.y, b.z - B.z);
        let dmg = 500 * Math.exp(-(dd * dd) / (2 * 580 * 580));
        if (q.armor > 0) dmg *= 0.62;
        if (dmg >= 1) applyDamage(q, null, Math.round(dmg), Math.round(dmg * 0.2), 'bomb', 'chest', { force: true });
      }
      endRound('T', 'bomb');
    }
  }
  G.bombDefuseTime = p => p.defuser ? G.cfg.kitTime : G.cfg.defuseTime;

  // ---------- per-player weapon logic ----------
  function weaponTick(p, dt) {
    const cmd = p.cmd, ws = p.ws, b = p.body;
    const now = G.time;
    // slot selection
    if (cmd.slot) { selectSlot(p, cmd.slot); cmd.slot = null; }
    if (cmd.next) {
      const order = [1, 2, 3, 4, 5].filter(s => s === 4 ? p.nades.length : p.slots[s]);
      const i = order.indexOf(p.cur);
      const n = order[(i + (cmd.next > 0 ? 1 : order.length - 1)) % order.length];
      if (n !== p.cur || n === 4) selectSlot(p, n);
      cmd.next = 0;
    }
    if (cmd.drop) {
      cmd.drop = false;
      if (p.cur === 1 || p.cur === 2 || p.cur === 5 || p.cur === 4) dropItem(p, p.cur, false);
    }
    const id = curId(p);
    if (!id) { selectSlot(p, bestSlot(p), true); return; }
    const w = WEAPONS[id];
    const inst = G.curInst(p);
    // decay recoil and bloom
    if (w.cycle) {
      if (now - ws.lastShot > w.cycle * 1.15) ws.recoilIdx = Math.max(0, ws.recoilIdx - dt * (w.type === 'pistol' ? 7 : 14));
      ws.fireInacc *= Math.exp(-dt / Math.max(0.05, w.recovery / 2.6));
    }
    if (cmd.inspect) { cmd.inspect = false; if (now > ws.deployEnd && !ws.reloadEnd) { ws.inspectEnd = now + 3.2; G.emit('inspect', { p }); } }
    // reload
    if (ws.reloadEnd && now >= ws.reloadEnd) {
      const need = w.mag - inst.ammo, take = Math.min(need, inst.reserve);
      inst.ammo += take; inst.reserve -= take; ws.reloadEnd = 0;
      G.emit('reloadDone', { p, id });
    }
    const startReload = () => {
      if (!inst || !w.mag || ws.reloadEnd || inst.ammo >= w.mag || inst.reserve <= 0) return false;
      ws.reloadEnd = now + w.reload; ws.zoom = 0; ws.inspectEnd = 0;
      G.emit('reload', { p, id, time: w.reload });
      return true;
    };
    if (cmd.reload) { cmd.reload = false; startReload(); }
    if (cmd.use && p.team === 'CT' && G.bomb.state === 'planted' && !G.bomb.defuser && b.onGround) {
      const B = G.bomb;
      if (Math.hypot(b.x - B.x, b.z - B.z) < 72 && Math.abs(b.y - B.y) < 80) {
        B.defuser = p; p.defuseT = 0; B.defuseTicks = 0;
        G.emit('defuseStart', { p });
      }
    }
    if (G.bomb.defuser === p) return;
    const deployed = now >= ws.deployEnd;
    const frozen = G.phase === 'freeze';

    if (w.type === 'c4') {
      const site = World.bombsiteAt(b.x, b.z);
      if (cmd.fire && site && b.onGround && G.phase === 'live' && deployed) {
        if (p.plantT === 0) G.emit('plantStart', { p, site });
        p.plantT += dt;
        if (Math.floor((p.plantT - dt) / 0.45) !== Math.floor(p.plantT / 0.45)) G.emit('keypad', { p });
        if (p.plantT >= G.cfg.plantTime) {
          p.slots[5] = null; p.plantT = 0;
          const B = G.bomb;
          Object.assign(B, { state: 'planted', carrier: null, x: b.x, y: World.floorAt(b.x, b.z, b.y + 4), z: b.z, timer: G.cfg.bombTime, site, beepT: 0.5, planter: p });
          addMoney(p, 300); p.st.score += 2;
          G.phase = 'planted';
          G.emit('planted', { p, site, x: b.x, y: B.y, z: b.z });
          selectSlot(p, bestSlot(p));
        }
      } else {
        if (p.plantT > 0) G.emit('plantAbort', { p });
        p.plantT = 0;
        if (cmd.fire && !site && !ws.trig && !p.isBot) G.emit('notice', { p, text: 'You must be at a bombsite to plant the bomb' });
      }
      ws.trig = cmd.fire;
      return;
    }
    if (frozen) { ws.trig = cmd.fire; ws.trig2 = cmd.fire2; return; }

    if (w.type === 'knife') {
      if (deployed && now >= ws.nextFire) {
        if (cmd.fire2) { ws.nextFire = now + w.rate2; ws.lastShot = now; knifeAttack(p, true); }
        else if (cmd.fire) { ws.nextFire = now + (now - ws.lastShot < 0.6 ? 0.5 : w.rate); ws.lastShot = now; knifeAttack(p, false); }
      }
      return;
    }
    if (w.type === 'grenade') {
      if (!deployed) return;
      if (!ws.nade && (cmd.fire || cmd.fire2)) { ws.nade = { since: now }; G.emit('pin', { p }); }
      if (ws.nade) {
        const s = cmd.fire && cmd.fire2 ? 0.66 : cmd.fire ? 1 : cmd.fire2 ? 0.33 : ws.nade.strength;
        if (cmd.fire || cmd.fire2) ws.nade.strength = s;
        if (!cmd.fire && !cmd.fire2 && now - ws.nade.since > 0.35) throwNade(p, ws.nade.strength || 1);
      }
      return;
    }
    // guns
    if (w.type === 'sniper' && cmd.fire2 && !ws.trig2 && deployed && !ws.reloadEnd && now >= ws.boltEnd) {
      ws.zoom = (ws.zoom + 1) % 3;
      G.emit('zoom', { p, level: ws.zoom });
    }
    ws.trig2 = cmd.fire2;
    if (cmd.fire && deployed && !ws.reloadEnd) {
      if ((w.auto || !ws.trig) && now >= ws.nextFire) {
        if (inst.ammo <= 0) {
          if (!ws.trig) G.emit('dryfire', { p });
          if (!startReload()) ws.nextFire = now + 0.2;
        } else {
          let shots = 0;
          while (now >= ws.nextFire && inst.ammo > 0 && shots < 4) {
            shots++;
            inst.ammo--;
            ws.inspectEnd = 0;
            const end = fireBullet(p, w);
            ws.recoilIdx = Math.min(ws.recoilIdx + 1, (w.pat ? w.pat.length - 1 : 0));
            ws.fireInacc += w.inFire;
            ws.lastShot = now;
            ws.nextFire = (now - ws.nextFire < w.cycle) ? ws.nextFire + w.cycle : now + w.cycle;
            const e = G.eye(p);
            G.emit('shot', { p, id, end, eye: e });
            G.noise(b.x, b.z, w.silenced ? 900 : 3200, p);
            if (!w.auto) break;
          }
          if (w.bolt) {
            ws.boltEnd = now + w.cycle * 0.9;
            if (ws.zoom) { ws.rezoom = ws.zoom; ws.zoom = 0; }
          }
          if (inst.ammo === 0 && !p.isBot) { /* CS2 auto reload happens on the next trigger pull */ }
        }
      }
    }
    if (ws.rezoom && now >= ws.boltEnd && !cmd.fire) { ws.zoom = ws.rezoom; ws.rezoom = 0; }
    if (!cmd.fire && inst && inst.ammo === 0 && inst.reserve > 0 && !ws.reloadEnd && now - ws.lastShot > 0.25) startReload();
    ws.trig = cmd.fire;
  }

  // ---------- noise for bots ----------
  G.noise = (x, z, radius, p) => {
    G.noises.push({ x, z, r: radius, p, team: p ? p.team : null, t: G.time });
    if (G.noises.length > 60) G.noises.shift();
  };

  // ---------- spotting (radar) ----------
  let spotAcc = 0;
  function updateSpotting(dt) {
    spotAcc += dt;
    if (spotAcc < 0.12) return;
    spotAcc = 0;
    const viewTeam = G.local ? G.local.team : 'CT';
    for (const e of G.players) {
      if (!e.alive || e.team === viewTeam) continue;
      for (const s of G.players) {
        if (!s.alive || s.team !== viewTeam) continue;
        if (G.canSee(s, e, 0.25)) { e.spottedUntil = G.time + 0.4; break; }
      }
    }
    const B = G.bomb;
    if (viewTeam === 'CT' && (B.state === 'dropped' || B.state === 'planted')) {
      for (const s of G.players) {
        if (!s.alive || s.team !== 'CT') continue;
        const e = G.eye(s);
        if (Math.hypot(B.x - e[0], B.z - e[2]) < 2500 && World.losClear(e[0], e[1], e[2], B.x, B.y + 6, B.z)) { B.spottedByCT = true; break; }
      }
    }
  }
  // Can s see e? cosFov is the cosine of half the field of view (0.25 ~ 150 degrees).
  G.canSee = (s, e, cosFov = 0.25, maxD = 4500) => {
    const a = G.eye(s);
    const eb = e.body;
    const dx = eb.x - a[0], dz = eb.z - a[2];
    const d = Math.hypot(dx, dz);
    if (d > maxD) return false;
    if (s.flashUntil - G.time > 1.2) return false;
    const f = dirFrom(s.yaw, 0);
    if (d > 60 && (f[0] * dx + f[2] * dz) / d < cosFov) return false;
    const pts = [eb.y + eb.height - 6, eb.y + eb.height * 0.62, eb.y + 14];
    for (const y of pts) {
      if (World.losClear(a[0], a[1], a[2], eb.x, y, eb.z) && !(G.smokeBlocks && G.smokeBlocks(a[0], a[1], a[2], eb.x, y, eb.z))) return true;
    }
    return false;
  };

  // ---------- footsteps ----------
  function surfaceUnder(b) {
    const g = World.gridFloor(b.x, b.z);
    if (g !== null && b.y > g + 8) {
      const blocks = World.query(b.x - 1, b.z - 1, b.x + 1, b.z + 1, []);
      for (const bl of blocks) if (bl.kind === 'prop' && Math.abs(bl.y1 - b.y) < 4) return bl.mat === 'van' || bl.mat === 'car' ? 'metal' : 'wood';
    }
    const o = World.cellAt(b.x, b.z);
    const m = o && o.leg ? o.leg.mat : 'pave';
    return m === 'wood' || m === 'tile' ? 'wood' : m === 'sand' ? 'sand' : 'stone';
  }
  G.surfaceUnder = surfaceUnder;

  // ---------- main update ----------
  G.update = (dt) => {
    if (!G.players.length) return;
    G.time += dt;
    const phase = G.phase;
    if (phase === 'freeze') {
      G.phaseT -= dt;
      if (G.phaseT <= 0) { G.phase = 'live'; G.roundClock = 0; G.emit('freezeEnd', {}); }
    } else if (phase === 'live') {
      G.roundClock += dt;
      if (G.roundClock >= G.roundTime) endRound('CT', 'time');
    } else if (phase === 'over') {
      G.phaseT -= dt;
      if (G.phaseT <= 0) {
        if (G.matchOver) { if (!G.matchEnded) { G.matchEnded = true; G.emit('matchEnd', { winner: G.matchOver }); } }
        else startRound();
        return;
      }
    }
    if (G.phase === 'planted') G.roundClock += dt;

    // commands and movement
    for (const p of G.players) {
      if (!p.alive) continue;
      if (p.isBot && G.botThink) G.botThink(p, dt);
      const cmd = p.cmd, b = p.body;
      const frozen = G.phase === 'freeze';
      const locked = frozen || p.plantT > 0 || G.bomb.defuser === p;
      const mc = locked ? { fwd: 0, side: 0, yaw: p.yaw, jump: false, duck: cmd.duck, walk: false } : { fwd: cmd.fwd, side: cmd.side, yaw: p.yaw, jump: cmd.jump, duck: cmd.duck, walk: cmd.walk };
      if (locked && !frozen) { b.vx *= 0.5; b.vz *= 0.5; }
      const wasGround = b.onGround;
      const moved = playerMove(b, mc, dt, weaponSpeed(p));
      // footsteps: running only
      const sp = Math.hypot(b.vx, b.vz);
      if (b.onGround && sp > weaponSpeed(p) * 0.56 && !b.ducked) {
        p.stepAcc += moved;
        if (p.stepAcc > 64) { p.stepAcc = 0; G.emit('step', { p, surface: surfaceUnder(b) }); G.noise(b.x, b.z, 1100, p); }
      } else p.stepAcc = Math.min(p.stepAcc, 40);
      if (!wasGround && b.onGround && b.landSpeed > 220) {
        G.emit('land', { p });
        if (!cmd.walk && !b.ducked) G.noise(b.x, b.z, 900, p);
        if (b.landSpeed > MV.safeFall) {
          const dmg = Math.round((b.landSpeed - MV.safeFall) * 100 / (MV.fatalFall - MV.safeFall));
          if (dmg > 0) applyDamage(p, null, dmg, 0, 'fall', 'legs', {});
        }
      }
      if (b.jumped) G.noise(b.x, b.z, 700, p);
      if (b.y < -500 && p.alive) applyDamage(p, null, 1000, 0, 'fall', 'chest', { force: true });
    }
    separateBodies(G.players.filter(p => p.alive).map(p => p.body));
    for (const p of G.players) if (p.alive) weaponTick(p, dt);
    updateItems(dt);
    updateNades(dt);
    updateAreaEffects(dt);
    updateBomb(dt);
    updateSpotting(dt);
    // round end by elimination
    if (G.phase === 'live' || G.phase === 'planted') {
      const aliveT = G.players.some(p => p.alive && p.team === 'T');
      const aliveCT = G.players.some(p => p.alive && p.team === 'CT');
      if (!aliveCT) endRound('T', 'elim');
      else if (!aliveT && G.bomb.state !== 'planted') endRound('CT', 'elim');
    }
  };

  G.alive = team => G.players.filter(p => p.alive && p.team === team);
  G.teamOf = team => G.players.filter(p => p.team === team);
  return G;
})();

if (typeof module !== 'undefined') module.exports = { Game };
