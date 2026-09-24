'use strict';
// Bot AI: team strategy (executes, holds, rotations, retakes), buying and per-bot combat.
if (typeof module !== 'undefined' && typeof Game === 'undefined') {
  Object.assign(globalThis, require('./map.js'), require('./world.js'), require('./movement.js'), require('./weapons.js'), require('./characters.js'), require('./game.js'));
}

const Bots = (() => {
  const B = {};
  const DEG = Math.PI / 180;
  const rnd = Math.random;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const clampv = (v, a, b) => v < a ? a : v > b ? b : v;
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

  const DIFF = {
    easy: { react: [0.5, 0.85], turn: 260, smooth: 5, err: 5.5, settle: 1.0, head: 0.08, comp: 0.25, fov: 0.45, tolMul: 1.8, spray: 5, hear: 0.6 },
    normal: { react: [0.3, 0.52], turn: 420, smooth: 8, err: 3.4, settle: 0.6, head: 0.28, comp: 0.55, fov: 0.35, tolMul: 1.35, spray: 9, hear: 0.85 },
    hard: { react: [0.2, 0.34], turn: 620, smooth: 11, err: 2.2, settle: 0.4, head: 0.5, comp: 0.75, fov: 0.25, tolMul: 1.1, spray: 14, hear: 1 },
    expert: { react: [0.13, 0.22], turn: 900, smooth: 15, err: 1.4, settle: 0.26, head: 0.72, comp: 0.88, fov: 0.2, tolMul: 0.95, spray: 20, hear: 1 },
  };
  let D = DIFF.normal;
  B.setDifficulty = d => { D = DIFF[d] || DIFF.normal; };

  const ZONES = {
    A: ['A Site', 'A Ramp', 'Palace', 'Stairs'],
    B: ['B Site', 'B Apps', 'B Short', 'Kitchen', 'Market', 'Arch'],
  };
  const ROUTES = {
    A: { ramp: ['t_ramp_low', 't_ramp_top'], palace: ['t_palace', 't_palace2'], mid: ['t_connector_low'] },
    B: { apps: ['t_apps', 't_apps2'], short: ['t_short'], underpass: ['t_underpass'] },
  };
  const DEFAULT_T = ['t_top_mid', 't_ramp_low', 't_palace', 't_apps', 't_underpass'];
  const CT_HOLDS = { A: ['ct_a_ticket', 'ct_a_jungle', 'ct_a_stairs', 'ct_a_ct', 'ct_a_firebox', 'ct_a_triple'], MID: ['ct_window', 'ct_connector', 'ct_short'], B: ['ct_b_van', 'ct_b_bench', 'ct_b_market', 'ct_b_kitchen', 'ct_b_arch'] };
  const RETAKE = { A: ['ct_a_ct', 'ct_a_jungle', 'ct_a_ticket'], B: ['ct_b_market', 'ct_b_arch', 'ct_b_kitchen'] };
  const POSTPLANT = { A: ['pp_a_ramp', 'pp_a_palace', 'pp_a_sandwich', 'pp_a_triple'], B: ['pp_b_apps', 'pp_b_short', 'pp_b_van', 'pp_b_site'] };
  const PLANTS = { A: ['plant_a', 'plant_a2'], B: ['plant_b', 'plant_b2'] };

  function spot(name) { const s = SPOTS[name]; const y = World.gridFloor(s.p[0], s.p[1]); return { x: s.p[0], z: s.p[1], y: y === null ? 0 : y, look: s.look ? { x: s.look[0], z: s.look[1], y: (World.gridFloor(s.look[0], s.look[1]) || 0) + 56 } : null, name }; }
  function near(pos, r) { const q = World.randomNavPointNear(pos.x, pos.z, r, rnd); return { x: q.x, y: q.y, z: q.z, look: pos.look }; }
  function siteCenter(site) { const S = BOMBSITES[site]; const x = S.label[0], z = S.label[1]; return { x, z, y: World.gridFloor(x, z) || 0 }; }

  // ---------- team state ----------
  const TS = { T: {}, CT: {} };
  B.TS = TS;
  const intel = { T: [], CT: [] };
  B.intel = intel;
  let radioT = 0;
  B.radio = null; // (p, text) hook for the HUD

  function say(p, text, prio) {
    if (!B.radio) return;
    if (!prio && Game.time - radioT < 2.5) return;
    if (!prio && p.ai && Game.time - (p.ai.lastRadio || -99) < 8) return;
    radioT = Game.time;
    if (p.ai) p.ai.lastRadio = Game.time;
    B.radio(p, text);
  }

  function initAI(p) {
    p.ai = {
      obj: null, path: null, pi: 0, pathKey: '', repathT: 0, target: null, seenT: 0, reactUntil: 0,
      errY: 0, errP: 0, aimHead: false, burst: 0, pauseUntil: 0, strafe: 1, strafeT: 0, lastSeen: null,
      stuckT: 0, lastX: p.body.x, lastZ: p.body.z, unstuckT: 0, visT: rnd() * 0.1, hearT: 0, heard: null,
      lookYaw: p.yaw, lookPitch: 0, idleLook: null, idleT: 0, hurtBy: null, hurtT: -10, fireToggle: false,
      nadeJob: null, lastRadio: -99, crouchSpray: false, arrived: false, holdCrouch: rnd() < 0.3, wantPistol: false,
    };
  }

  // ---------- buying ----------
  function botBuy(p, pistolRound, teamAvg) {
    const T = p.team === 'T';
    const buy = id => Game.buy(p, id);
    if (pistolRound) {
      const r = rnd();
      if (r < 0.5) buy('vest');
      else if (r < 0.75) { buy('p250'); if (p.money >= 200) buy('flash'); }
      else { if (!T && rnd() < 0.5) buy('defuser'); buy(pick(['flash', 'smoke', 'he'])); if (p.money >= 200) buy('flash'); }
      return;
    }
    const hasPrimary = !!p.slots[1];
    const rifle = T ? 'ak47' : (p.ai.m4 || (p.ai.m4 = rnd() < 0.5 ? 'm4a4' : 'm4a1s'));
    const rifleCost = WEAPONS[rifle].price;
    const eco = teamAvg < 2300 && p.money < 3800 && !hasPrimary;
    if (!hasPrimary && !eco) {
      if (p.ai.awper && p.money >= 4750 + 1000) buy('awp');
      else if (p.money >= rifleCost + 1000) buy(rifle);
      else if (p.money >= rifleCost + 650 && rnd() < 0.5) buy(rifle);
      else if (p.money >= (T ? 1800 : 2050) + 650) buy(T ? 'galil' : 'famas');
      else if (p.money >= (T ? 1050 : 1250) + 650) buy(T ? 'mac10' : 'mp9');
    }
    if (eco) {
      if (p.money >= 1100 && rnd() < 0.45) buy(rnd() < 0.5 ? 'p250' : 'deagle');
      if (p.money >= 950 && rnd() < 0.4) buy('vest');
      return;
    }
    if (p.slots[1] || p.money >= 1000) {
      if (p.armor < 100 || !p.helmet) { if (!buy('vesthelm')) buy('vest'); }
    }
    if (!T && !p.defuser && p.money >= 400 && rnd() < 0.6) buy('defuser');
    const nades = T ? ['smoke', 'flash', 'molotov', 'he', 'flash'] : ['smoke', 'flash', 'incgrenade', 'he', 'flash'];
    for (const n of nades) { if (p.money < 500) break; if (rnd() < 0.75) buy(n); }
    if (!p.slots[1] && p.money >= 700 && rnd() < 0.5) buy('deagle');
    p.cur = p.slots[1] ? 1 : 2;
  }

  // ---------- round start ----------
  B.roundStart = (pistol) => {
    intel.T.length = 0; intel.CT.length = 0;
    const bots = Game.players.filter(p => p.isBot);
    for (const p of Game.players) if (!p.ai) initAI(p);
    for (const p of bots) { const keep = { m4: p.ai.m4, awper: p.ai.awper }; initAI(p); Object.assign(p.ai, keep); }
    for (const team of ['T', 'CT']) {
      const mates = Game.players.filter(p => p.team === team);
      if (!mates.some(p => p.ai.awper)) { const c = pick(mates.filter(p => p.isBot)); if (c) c.ai.awper = true; }
      const avg = mates.reduce((s, p) => s + p.money, 0) / mates.length;
      for (const p of mates) if (p.isBot) botBuy(p, pistol, avg);
    }
    planT(); planCT();
  };

  function planT() {
    const S = TS.T = { phase: 'setup', site: rnd() < 0.55 ? 'A' : 'B', style: pick(['rush', 'default', 'default', 'split', 'split']), executeAt: 0, planted: false };
    const ts = Game.players.filter(p => p.team === 'T');
    const bots = ts.filter(p => p.isBot);
    const routes = Object.keys(ROUTES[S.site]);
    if (S.style === 'default') {
      S.executeAt = 28 + rnd() * 30;
      const spots = DEFAULT_T.slice().sort(() => rnd() - 0.5);
      bots.forEach((p, i) => { p.ai.role = 'control'; p.ai.hold = spots[i % spots.length]; p.ai.route = null; });
    } else {
      S.executeAt = S.style === 'rush' ? 0 : 999;
      // main route for the bomb carrier, others split across routes
      const main = S.site === 'A' ? pick(['ramp', 'ramp', 'palace']) : pick(['apps', 'apps', 'short']);
      bots.forEach((p, i) => {
        let r = main;
        if (S.style === 'split') r = i % 2 === 0 ? main : pick(routes.filter(x => x !== main));
        else if (i === bots.length - 1 && rnd() < 0.5) r = pick(routes);
        if (p.slots[5]) r = main;
        p.ai.role = 'exec'; p.ai.route = r; p.ai.hold = null;
      });
    }
    // lurker
    if (S.style !== 'rush' && bots.length >= 4 && rnd() < 0.5) {
      const l = bots.find(p => !p.slots[5]);
      if (l) { l.ai.role = 'lurk'; l.ai.hold = S.site === 'A' ? pick(['t_apps', 't_underpass', 't_top_mid']) : pick(['t_top_mid', 't_palace', 't_ramp_low']); }
    }
    for (const p of bots) p.ai.stage = null;
  }

  function planCT() {
    const S = TS.CT = { rotated: null, retake: null, retakeGo: false, retakeAt: 0 };
    const cts = Game.players.filter(p => p.team === 'CT');
    const bots = cts.filter(p => p.isBot);
    const hasHuman = cts.some(p => !p.isBot);
    const roles = hasHuman ? ['A', 'B', 'MID', pick(['A', 'B'])] : ['A', 'B', 'MID', 'A', 'B'];
    const used = new Set();
    const awper = bots.find(p => p.ai.awper && p.slots[1] && p.slots[1].id === 'awp');
    bots.sort((a, b) => (b === awper) - (a === awper));
    bots.forEach((p, i) => {
      let zone = roles[i % roles.length];
      let options = CT_HOLDS[zone].filter(s => !used.has(s));
      if (p === awper) { zone = pick(['MID', 'A', 'B']); options = [{ MID: 'ct_window', A: 'ct_a_jungle', B: 'ct_b_market' }[zone]]; }
      const s = pick(options.length ? options : CT_HOLDS[zone]);
      used.add(s);
      p.ai.role = 'hold'; p.ai.zone = zone; p.ai.hold = s; p.ai.homeHold = s;
    });
  }

  // ---------- team logic, runs a few times per second ----------
  let teamT = 0;
  function teamThink() {
    const now = Game.time;
    for (const t of ['T', 'CT']) { const L = intel[t]; while (L.length && now - L[0].t > 8) L.shift(); }
    const clock = Game.roundClock;
    const bomb = Game.bomb;
    // ---- T ----
    const S = TS.T;
    const ts = Game.alive('T').filter(p => p.isBot);
    if (bomb.state === 'planted' && S.phase !== 'post') {
      S.phase = 'post'; S.site = bomb.site;
      const spots = POSTPLANT[bomb.site].slice().sort(() => rnd() - 0.5);
      ts.forEach((p, i) => { p.ai.role = 'post'; p.ai.hold = spots[i % spots.length]; p.ai.obj = null; });
    }
    if (Game.phase === 'live') {
      if (S.phase === 'setup' && clock >= S.executeAt) {
        if (S.style === 'default') {
          // choose the site where the fewest CTs have been seen
          const seen = { A: 0, B: 0 };
          for (const s of intel.T) { if (ZONES.A.includes(s.zone)) seen.A++; if (ZONES.B.includes(s.zone)) seen.B++; }
          if (seen.A !== seen.B) S.site = seen.A < seen.B ? 'A' : 'B';
          const routes = Object.keys(ROUTES[S.site]);
          ts.forEach((p, i) => { if (p.ai.role !== 'lurk') { p.ai.role = 'exec'; p.ai.route = p.slots[5] ? routes[0] : routes[i % routes.length]; p.ai.stage = null; } });
          S.phase = 'gather'; S.gatherUntil = clock + 14;
          const carrier = ts.find(p => p.slots[5]);
          if (carrier) say(carrier, `Going ${S.site}, stick together`, true);
        } else if (S.style === 'rush') { S.phase = 'execute'; const c = ts[0]; if (c) say(c, `Rush ${S.site}! Go go go!`, true); }
        else { S.phase = 'gather'; S.gatherUntil = clock + 30; }
      }
      if (S.phase === 'gather') {
        const execs = ts.filter(p => p.ai.role === 'exec');
        const arrived = execs.filter(p => p.ai.arrived).length;
        if ((execs.length && arrived >= Math.ceil(execs.length * 0.75)) || clock > S.gatherUntil || clock > 78) {
          S.phase = 'execute';
          const c = execs[0]; if (c) say(c, `Executing ${S.site}`, true);
        }
      }
      if (clock > 85 && S.phase !== 'post') { S.phase = 'execute'; for (const p of ts) if (p.ai.role === 'lurk' || p.ai.role === 'control') p.ai.role = 'exec'; }
    }
    // ---- CT ----
    const C = TS.CT;
    const cts = Game.alive('CT').filter(p => p.isBot);
    if (bomb.state === 'planted') {
      if (C.retake !== bomb.site) {
        C.retake = bomb.site; C.retakeGo = false; C.retakeAt = Game.time;
        const spots = RETAKE[bomb.site];
        cts.forEach((p, i) => { p.ai.role = 'retake'; p.ai.hold = spots[i % spots.length]; p.ai.obj = null; p.ai.arrived = false; });
        const c = cts[0]; if (c) say(c, `Bomb planted ${bomb.site}, regroup for retake`, true);
      }
      const arrived = cts.filter(p => p.ai.arrived || distTo(p, siteCenter(bomb.site)) < 900).length;
      if (!C.retakeGo && (arrived >= Math.min(2, cts.length) || bomb.timer < 26 || Game.time - C.retakeAt > 12)) C.retakeGo = true;
    } else if (Game.phase === 'live') {
      // rotations on information
      const seen = { A: new Set(), B: new Set() };
      for (const s of intel.CT) { if (now - s.t > 5) continue; if (ZONES.A.includes(s.zone)) seen.A.add(s.pid); if (ZONES.B.includes(s.zone)) seen.B.add(s.pid); if (s.bomb) { seen[s.zone && ZONES.A.includes(s.zone) ? 'A' : 'B'].add('bomb' + s.pid); } }
      for (const site of ['A', 'B']) {
        if (C.rotated === site) continue;
        if (seen[site].size >= 2) {
          C.rotated = site;
          let n = 0;
          for (const p of cts) {
            if (p.ai.zone === site) continue;
            if (p.ai.zone === 'MID' || n < 1 || cts.length <= 3) {
              p.ai.role = 'rotate'; p.ai.zone = site; p.ai.hold = pick(CT_HOLDS[site].slice(0, 4)); p.ai.obj = null; p.ai.arrived = false; n++;
            }
          }
          const c = cts.find(p => p.ai.role === 'rotate'); if (c) say(c, `Rotating ${site}`);
        }
      }
      // late round with no info: CTs push toward the enemy last seen
      if (clock > 95 && Game.alive('T').length <= 2) {
        const last = intel.CT[intel.CT.length - 1];
        if (last) for (const p of cts) if (p.ai.role !== 'hunt' && rnd() < 0.3) { p.ai.role = 'hunt'; p.ai.huntPos = { x: last.x, y: last.y, z: last.z }; p.ai.obj = null; }
      }
    }
    // dropped bomb: nearest T bot fetches it
    if (bomb.state === 'dropped') {
      let best = null, bd = 1e9;
      for (const p of ts) { const d = Math.hypot(p.body.x - bomb.x, p.body.z - bomb.z); if (d < bd && !(p.ai.target && Game.time - p.ai.seenT < 1)) { bd = d; best = p; } }
      for (const p of ts) p.ai.fetch = p === best;
    } else for (const p of ts) p.ai.fetch = false;
  }

  const distTo = (p, q) => Math.hypot(p.body.x - q.x, p.body.z - q.z);

  // Decide where a bot wants to be right now.
  function objective(p) {
    const ai = p.ai, bomb = Game.bomb;
    if (Game.phase === 'freeze') return null;
    // bomb fetch
    if (p.team === 'T' && ai.fetch && bomb.state === 'dropped') return { x: bomb.x, y: bomb.y, z: bomb.z, key: 'fetch', run: true };
    // weapon upgrade from the floor
    if (!p.slots[1] && !ai.target) {
      for (const it of Game.items) {
        if (it.kind !== 'weapon' || !it.rest) continue;
        const w = WEAPONS[it.inst.id];
        if (w.slot !== 1) continue;
        if (Math.hypot(it.x - p.body.x, it.z - p.body.z) < 700) return { x: it.x, y: it.y, z: it.z, key: 'item' + it.uid, run: true };
      }
    }
    if (p.team === 'T') {
      const S = TS.T;
      if (ai.role === 'post') {
        if (bomb.defuser && bomb.state === 'planted') return { x: bomb.x, y: bomb.y, z: bomb.z, key: 'stopdefuse', run: true };
        return holdObj(p, ai.hold);
      }
      // bomb carrier in execute: go plant
      if (p.slots[5] && (S.phase === 'execute' || Game.roundClock > 80)) {
        if (!ai.plantSpot) ai.plantSpot = pick(PLANTS[S.site]);
        const s = spot(ai.plantSpot);
        return { x: s.x, y: s.y, z: s.z, key: 'plant' + ai.plantSpot, plant: true, run: true };
      }
      if (ai.role === 'control' || ai.role === 'lurk') return holdObj(p, ai.hold);
      if (ai.role === 'exec') {
        if (S.phase === 'execute') {
          if (!ai.entry || ai.entrySite !== S.site) {
            const plantOwner = Game.players.find(q => q.slots[5] && q.alive);
            ai.entrySite = S.site;
            const c = siteCenter(S.site);
            ai.entry = near(c, 320);
          }
          // after entering the site, hold a post-plant style position around the bomb carrier
          return { x: ai.entry.x, y: ai.entry.y, z: ai.entry.z, key: 'entry' + ai.entrySite, run: true, look: null, arriveHold: true };
        }
        const stages = ROUTES[S.site][ai.route] || Object.values(ROUTES[S.site])[0];
        if (!ai.stage) ai.stage = pick(stages);
        return holdObj(p, ai.stage, true);
      }
      return holdObj(p, 't_top_mid');
    }
    // CT
    const C = TS.CT;
    if (ai.role === 'retake') {
      if (C.retakeGo) {
        // closest CT defuses, others clear around the bomb
        const cts = Game.alive('CT');
        let closest = null, cd = 1e9;
        for (const q of cts) { const d = Math.hypot(q.body.x - bomb.x, q.body.z - bomb.z); if (d < cd && q.isBot) { cd = d; closest = q; } }
        const need = Game.bombDefuseTime(p) + 0.6;
        if (bomb.timer < need && !bomb.defuser) return holdObj(p, p.ai.homeHold || 'ct_a_ct');
        if (closest === p) return { x: bomb.x, y: bomb.y, z: bomb.z, key: 'defuse', defuse: true, run: true };
        if (!ai.entry || ai.entrySite !== bomb.site) { ai.entrySite = bomb.site; ai.entry = near({ x: bomb.x, z: bomb.z }, 300); }
        return { x: ai.entry.x, y: ai.entry.y, z: ai.entry.z, key: 'retakeEntry', run: true, arriveHold: true };
      }
      return holdObj(p, ai.hold, true);
    }
    if (ai.role === 'hunt' && ai.huntPos) return { x: ai.huntPos.x, y: ai.huntPos.y, z: ai.huntPos.z, key: 'hunt', run: true };
    return holdObj(p, ai.hold);
  }
  function holdObj(p, name, run) {
    const s = spot(name);
    return { x: s.x, y: s.y, z: s.z, look: s.look, key: 'hold' + name, hold: true, run };
  }

  // ---------- movement helpers ----------
  function followPath(p, obj, cmd, dt) {
    const ai = p.ai, b = p.body;
    if (!ai.path || ai.pathKey !== obj.key || Game.time > ai.repathT) {
      const cost = Game.fires.length ? (x, z) => Game.inFire(x, 0, z, 60) ? 4000 : 0 : null;
      ai.path = World.findPath(b.x, b.y, b.z, obj.x, obj.y, obj.z, cost);
      ai.pi = 0; ai.pathKey = obj.key; ai.repathT = Game.time + 6 + rnd() * 3;
      if (!ai.path) { ai.repathT = Game.time + 1; return false; }
    }
    const P = ai.path;
    while (ai.pi < P.length) {
      const w = P[ai.pi];
      const d = Math.hypot(w.x - b.x, w.z - b.z);
      if (d < (ai.pi === P.length - 1 ? 14 : 26)) ai.pi++;
      else break;
    }
    if (ai.pi >= P.length) return true;
    const w = P[ai.pi];
    const dx = w.x - b.x, dz = w.z - b.z;
    const moveYaw = Math.atan2(-dx, -dz);
    // express the move direction relative to where the bot is looking
    const rel = angDiff(p.yaw, moveYaw);
    cmd.fwd = Math.cos(rel); cmd.side = -Math.sin(rel);
    ai.moveYaw = moveYaw;
    // unstuck
    const mv = Math.hypot(b.x - ai.lastX, b.z - ai.lastZ);
    ai.lastX = b.x; ai.lastZ = b.z;
    if (mv < 20 * dt && Game.phase !== 'freeze') ai.stuckT += dt; else ai.stuckT = Math.max(0, ai.stuckT - dt * 2);
    if (ai.stuckT > 0.6) {
      ai.unstuckT = Game.time + 0.45; ai.stuckT = 0; ai.unstuckSide = rnd() < 0.5 ? -1 : 1;
      if (rnd() < 0.3) ai.repathT = 0;
    }
    if (Game.time < ai.unstuckT) { cmd.side = ai.unstuckSide; cmd.fwd = 0.3; if (rnd() < 0.04) cmd.jump = true; }
    return false;
  }

  function stopMoving(p, cmd) {
    // counter-strafe: push against current velocity
    const b = p.body;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < 30) { cmd.fwd = 0; cmd.side = 0; return; }
    const vy = Math.atan2(-b.vx, -b.vz);
    const rel = angDiff(p.yaw, vy);
    cmd.fwd = -Math.cos(rel); cmd.side = Math.sin(rel);
  }

  function turnTo(p, yaw, pitch, dt, speedMul = 1) {
    const ai = p.ai;
    const k = 1 - Math.exp(-dt * D.smooth * speedMul);
    let dy = angDiff(p.yaw, yaw) * k, dp = (pitch - p.pitch) * k;
    const maxStep = D.turn * DEG * dt * speedMul;
    dy = clampv(dy, -maxStep, maxStep); dp = clampv(dp, -maxStep, maxStep);
    p.yaw += dy; p.pitch = clampv(p.pitch + dp, -1.5, 1.5);
  }
  function lookAtPoint(p, x, y, z, dt, sp = 0.6) {
    const e = Game.eye(p);
    const dx = x - e[0], dy = y - e[1], dz = z - e[2];
    turnTo(p, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), dt, sp);
  }

  // ---------- perception ----------
  function scan(p) {
    const ai = p.ai;
    let best = null, bd = 1e9;
    for (const e of Game.players) {
      if (!e.alive || e.team === p.team) continue;
      const d = Math.hypot(e.body.x - p.body.x, e.body.z - p.body.z);
      const cos = ai.target === e ? -0.2 : D.fov;
      if (!Game.canSee(p, e, cos)) continue;
      let score = d;
      if (e === ai.target) score *= 0.6;
      if (e.killedBy === null && ai.hurtBy === e) score *= 0.5;
      if (score < bd) { bd = score; best = e; }
      intel[p.team].push({ pid: e.id, x: e.body.x, y: e.body.y, z: e.body.z, t: Game.time, zone: World.calloutAt(e.body.x, e.body.z), bomb: !!e.slots[5] });
      if (intel[p.team].length > 80) intel[p.team].shift();
    }
    return best;
  }

  function hear(p) {
    const ai = p.ai;
    for (let i = Game.noises.length - 1; i >= 0; i--) {
      const n = Game.noises[i];
      if (Game.time - n.t > 0.6) break;
      if (!n.p || n.team === p.team) continue;
      const d = Math.hypot(n.x - p.body.x, n.z - p.body.z);
      if (d < n.r * D.hear) { ai.heard = { x: n.x, z: n.z, y: n.p.body.y + 50, t: Game.time }; return; }
    }
  }

  // ---------- combat ----------
  function aimPoint(p, e) {
    const b = e.body;
    if (p.ai.aimHead) return [b.x, b.y + b.height - 6.5, b.z];
    return [b.x, b.y + b.height * 0.66, b.z];
  }
  function friendlyInLine(p, e) {
    const a = Game.eye(p), t = aimPoint(p, e);
    const dx = t[0] - a[0], dy = t[1] - a[1], dz = t[2] - a[2], L = Math.hypot(dx, dy, dz);
    for (const q of Game.players) {
      if (q === p || !q.alive || q.team !== p.team) continue;
      const h = hitTestPlayer(q, a[0], a[1], a[2], dx / L, dy / L, dz / L, L);
      if (h) return true;
    }
    return false;
  }

  function combat(p, e, cmd, dt) {
    const ai = p.ai, ws = p.ws;
    const now = Game.time;
    const w = Game.curDef(p);
    const eye = Game.eye(p);
    const t = aimPoint(p, e);
    const dx = t[0] - eye[0], dy = t[1] - eye[1], dz = t[2] - eye[2];
    const dist = Math.hypot(dx, dy, dz);
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    // aim error settles over time, grows when the target strafes
    const k = Math.exp(-dt / D.settle);
    ai.errY *= k; ai.errP *= k;
    const tv = Math.hypot(e.body.vx, e.body.vz);
    ai.errY += (rnd() - 0.5) * tv * 0.00004 * (D.err / 2);
    if (now < ai.reactUntil) {
      // still reacting: drift toward the target but don't fire
      turnTo(p, wantYaw + ai.errY * 2, wantPitch + ai.errP * 2, dt, 0.35);
      return;
    }
    turnTo(p, wantYaw + ai.errY, wantPitch + ai.errP, dt, 1);
    const off = Math.hypot(angDiff(p.yaw, wantYaw) * Math.cos(wantPitch), p.pitch - wantPitch);
    const size = (ai.aimHead ? 5 : 9) / Math.max(dist, 1);
    const tol = Math.atan(size) * D.tolMul + 0.004;
    // weapon choices
    if (w.type === 'knife' || w.type === 'grenade' || w.type === 'c4') {
      if (w.type !== 'knife' || dist > 60) { Game.selectSlot(p, p.slots[1] ? 1 : 2); return; }
    }
    const inst = Game.curInst(p);
    if (inst && inst.ammo === 0 && p.cur === 1 && p.slots[2] && p.slots[2].ammo > 0 && dist < 900) { Game.selectSlot(p, 2); return; }
    if (inst && inst.ammo === 0 && !ws.reloadEnd) { cmd.reload = true; }
    if (w.type === 'sniper') {
      if (ws.zoom === 0 && dist > 350 && now >= ws.boltEnd && !ws.reloadEnd) { cmd.fire2 = !ws.trig2; }
    }
    // movement during a fight
    const spray = w.type === 'smg' || w.type === 'pistol' || dist < 450;
    const canShoot = off < tol && now >= ai.pauseUntil && !ws.reloadEnd && now >= ws.deployEnd && !friendlyInLine(p, e);
    if (canShoot) {
      if (spray && (w.type === 'smg' || w.type === 'pistol')) { cmd.side = ai.strafe * 0.6; cmd.fwd = 0; }
      else stopMoving(p, cmd);
      if (ai.crouchSpray && dist < 900 && w.type !== 'sniper') cmd.duck = true;
      const sp = Math.hypot(p.body.vx, p.body.vz);
      const accurate = w.type === 'smg' || w.type === 'pistol' || sp < w.speed * 0.36 || dist < 250;
      if (accurate) {
        if (w.auto) {
          if (ai.burst <= 0) ai.burst = dist > 1500 ? 1 : dist > 800 ? 2 + Math.floor(rnd() * 3) : D.spray + Math.floor(rnd() * 6);
          cmd.fire = true;
          if (ws.lastShot > (ai.lastShotSeen || -1)) { ai.lastShotSeen = ws.lastShot; ai.burst--; if (ai.burst <= 0) { ai.pauseUntil = now + (dist > 1500 ? 0.4 : dist > 800 ? 0.28 : 0.12); } }
        } else {
          const gap = w.type === 'sniper' ? 0.05 : dist > 1000 ? 0.38 : dist > 500 ? 0.24 : 0.12;
          if (now - ws.lastShot > gap + w.cycle) { ai.fireToggle = !ai.fireToggle; cmd.fire = ai.fireToggle; }
          if (w.type === 'sniper' && ws.zoom === 0 && dist > 350) cmd.fire = false;
        }
      }
    } else {
      cmd.fire = false;
      if (now - ai.strafeT > 0) { ai.strafe = -ai.strafe; ai.strafeT = now + 0.25 + rnd() * 0.45; }
      if (w.type !== 'sniper' || ws.zoom === 0) { cmd.side = ai.strafe; cmd.fwd = 0; }
      else stopMoving(p, cmd);
    }
    if (Game.inFire(p.body.x, p.body.y, p.body.z, 10)) { cmd.fwd = -1; cmd.side = ai.strafe; }
  }

  // ---------- utility ----------
  function solveThrow(from, to, T) {
    const g = Game.NADE_GRAVITY;
    return [(to[0] - from[0]) / T, (to[1] - from[1]) / T + 0.5 * g * T, (to[2] - from[2]) / T];
  }
  function arcClear(from, v, T) {
    const g = Game.NADE_GRAVITY;
    let px = from[0], py = from[1], pz = from[2];
    const n = 16;
    for (let i = 1; i <= n; i++) {
      const t = T * i / n;
      const x = from[0] + v[0] * t, y = from[1] + v[1] * t - 0.5 * g * t * t, z = from[2] + v[2] * t;
      const dx = x - px, dy = y - py, dz = z - pz, L = Math.hypot(dx, dy, dz);
      const h = World.raycast(px, py, pz, dx / L, dy / L, dz / L, L);
      if (h && i < n - 1) return false;
      px = x; py = y; pz = z;
    }
    return true;
  }
  function tryThrow(p, type, target) {
    const idx = p.nades.indexOf(type);
    if (idx < 0) return false;
    const e = Game.eye(p);
    const tgt = [target[0], (World.gridFloor(target[0], target[1]) || 0) + 8, target[1]];
    const d = Math.hypot(tgt[0] - e[0], tgt[2] - e[2]);
    for (const T of [d / 650, d / 520, d / 420, d / 350, d / 800]) {
      const tt = clampv(T, 0.5, 3.2);
      const v = solveThrow(e, tgt, tt);
      if (Math.hypot(...v) > 1100) continue;
      if (!arcClear(e, v, tt)) continue;
      p.nades.splice(idx, 1); p.nadeIdx = 0;
      p.yaw = Math.atan2(-(tgt[0] - e[0]), -(tgt[2] - e[2]));
      Game.throwNadeFrom(p, type, e, v);
      if (p.cur === 4) Game.selectSlot(p, p.slots[1] ? 1 : 2, true);
      return true;
    }
    return false;
  }
  function lineupsAt(p) {
    const S = TS.T;
    if (!LINEUPS[S.site]) return [];
    return LINEUPS[S.site].filter(l => l.from === p.ai.stage || l.from === p.ai.hold);
  }

  // ---------- per-bot think ----------
  B.think = (p, dt) => {
    if (!p.ai) initAI(p);
    const ai = p.ai, cmd = p.cmd;
    const now = Game.time;
    cmd.fwd = 0; cmd.side = 0; cmd.jump = false; cmd.duck = false; cmd.walk = false; cmd.fire = false; cmd.fire2 = false; cmd.use = false; cmd.reload = false;
    p.recoilComp = D.comp;
    if (Game.phase === 'freeze') { lookAtPoint(p, p.body.x - Math.sin(p.yaw) * 100, Game.eye(p)[1], p.body.z - Math.cos(p.yaw) * 100, dt); return; }
    if (Game.phase === 'over') {
      // after the round: save weapons, stop shooting
    }
    // perception (throttled)
    ai.visT -= dt;
    let e = ai.target && ai.target.alive ? ai.target : null;
    if (ai.visT <= 0) {
      ai.visT = 0.09 + rnd() * 0.03;
      const flashed = p.flashUntil - now > 0.5;
      const seen = flashed ? null : scan(p);
      if (seen) {
        if (seen !== ai.target || now - ai.seenT > 1.2) {
          // new contact: reaction time and initial aim error
          // holding a still, pre-aimed angle reacts faster than running into a fight
          const e0 = Game.eye(p), sx = seen.body.x - e0[0], sz = seen.body.z - e0[2];
          const off0 = Math.abs(angDiff(p.yaw, Math.atan2(-sx, -sz)));
          const still = Math.hypot(p.body.vx, p.body.vz) < 40;
          let rm = 1, em = 1;
          if (still && off0 < 22 * DEG) { rm = 0.55; em = 0.5; } else if (!still) { rm = 1.2; em = 1.2; }
          const r = D.react[0] + rnd() * (D.react[1] - D.react[0]);
          ai.reactUntil = now + r * rm * (ai.lastSeen && ai.lastSeen.pid === seen.id && now - ai.lastSeen.t < 3 ? 0.4 : 1);
          ai.errY = (rnd() - 0.5) * 2 * D.err * DEG * em; ai.errP = (rnd() - 0.5) * 1.2 * D.err * DEG * em;
          ai.aimHead = rnd() < D.head;
          ai.burst = 0;
          ai.crouchSpray = rnd() < 0.3 && D.head > 0.4;
          if (seen !== ai.target) say(p, `Enemy spotted${World.calloutAt(seen.body.x, seen.body.z) ? ', ' + World.calloutAt(seen.body.x, seen.body.z) : ''}`);
        }
        ai.target = seen; ai.seenT = now;
        ai.lastSeen = { pid: seen.id, x: seen.body.x, y: seen.body.y + 50, z: seen.body.z, t: now };
      } else if (ai.target && now - ai.seenT > 0.35) ai.target = null;
      e = ai.target && ai.target.alive && now - ai.seenT < 0.35 ? ai.target : null;
      ai.hearT -= 0.1;
      if (ai.hearT <= 0) { ai.hearT = 0.25; hear(p); }
    }
    // reload when safe
    const inst = Game.curInst(p), w = Game.curDef(p);
    if (!e && inst && w.mag && inst.ammo < w.mag * 0.4 && inst.reserve > 0 && !p.ws.reloadEnd && now - ai.seenT > 1.5) cmd.reload = true;
    if (!e && p.cur === 2 && p.slots[1] && (p.slots[1].ammo > 0 || p.slots[1].reserve > 0) && now - ai.seenT > 1) Game.selectSlot(p, 1);
    if (!e && (p.cur === 3 || p.cur === 4 || p.cur === 5) && !ai.planting && !ai.nadeJob) Game.selectSlot(p, p.slots[1] ? 1 : 2);

    // flashed: back off and spray at the last known spot
    if (p.flashUntil - now > 0.5) {
      cmd.fwd = -0.6; cmd.side = ai.strafe;
      if (ai.lastSeen && now - ai.lastSeen.t < 1.5 && w.auto) { lookAtPoint(p, ai.lastSeen.x, ai.lastSeen.y, ai.lastSeen.z, dt, 0.3); cmd.fire = rnd() < 0.5; }
      return;
    }
    if (e) { combat(p, e, cmd, dt); ai.planting = false; return; }

    const obj = objective(p);
    ai.obj = obj;
    // bomb interactions
    const bomb = Game.bomb;
    if (obj && obj.defuse) {
      const d = Math.hypot(p.body.x - bomb.x, p.body.z - bomb.z);
      if (d < 50) {
        lookAtPoint(p, bomb.x, bomb.y, bomb.z, dt, 0.5);
        cmd.use = true; cmd.duck = rnd() < 0.02 ? !cmd.duck : cmd.duck;
        if (!bomb.defuser) say(p, 'Defusing the bomb, cover me', true);
        return;
      }
    }
    if (obj && obj.plant && p.slots[5]) {
      const site = World.bombsiteAt(p.body.x, p.body.z);
      const d = Math.hypot(p.body.x - obj.x, p.body.z - obj.z);
      if (site && (d < 40 || (site && ai.stuckT > 0.3))) {
        if (p.cur !== 5) Game.selectSlot(p, 5);
        cmd.fire = true; ai.planting = true;
        lookAtPoint(p, p.body.x - Math.sin(p.yaw) * 40, p.body.y, p.body.z - Math.cos(p.yaw) * 40, dt, 0.4);
        if (p.plantT < dt * 2) say(p, 'Planting the bomb', true);
        return;
      }
    }
    ai.planting = false;
    if (!obj) return;
    // grenade jobs at staging spots
    if (ai.nadeJob) {
      const j = ai.nadeJob;
      if (now > j.at) { tryThrow(p, j.type, j.to); ai.nadeJob = null; }
      else { lookAtPoint(p, j.to[0], (World.gridFloor(j.to[0], j.to[1]) || 0) + 200, j.to[1], dt, 0.5); return; }
    }
    const arrived = followPath(p, obj, cmd, dt);
    const wasArrived = ai.arrived;
    ai.arrived = arrived;
    if (arrived) {
      cmd.fwd = 0; cmd.side = 0;
      if (obj.hold && ai.holdCrouch && p.team === 'CT') cmd.duck = true;
      if (!wasArrived && p.team === 'T' && TS.T.phase !== 'post') {
        const ls = lineupsAt(p).filter(l => p.nades.includes(l.type));
        if (ls.length) { const l = ls[0]; ai.nadeJob = { type: l.type, to: l.to, at: now + 0.4 + rnd() * 1.5 }; }
      }
      if (obj.arriveHold && obj.key && obj.key.startsWith('entry')) {
        // inside the site: look around toward the CT side
        const c = siteCenter(TS.T.site || 'A');
        const look = p.team === 'T' ? { x: c.x - 600, z: c.z } : { x: bomb.x, z: bomb.z };
        idleLook(p, look, dt);
      } else if (obj.look) idleLook(p, obj.look, dt);
      else idleLook(p, null, dt);
    } else {
      // look where we're going, or at a heard noise / last seen enemy
      if (ai.heard && now - ai.heard.t < 1.8) lookAtPoint(p, ai.heard.x, ai.heard.y, ai.heard.z, dt, 0.5);
      else if (ai.lastSeen && now - ai.lastSeen.t < 2.5) lookAtPoint(p, ai.lastSeen.x, ai.lastSeen.y, ai.lastSeen.z, dt, 0.6);
      else if (ai.hurtBy && now - ai.hurtT < 1.5 && ai.hurtBy.alive) lookAtPoint(p, ai.hurtBy.body.x, ai.hurtBy.body.y + 50, ai.hurtBy.body.z, dt, 0.8);
      else {
        const P = ai.path;
        let lx, lz, ly;
        if (P && ai.pi < P.length) {
          const q = P[Math.min(ai.pi + 1, P.length - 1)];
          lx = q.x; lz = q.z; ly = q.y + 60;
          const dnext = Math.hypot(q.x - p.body.x, q.z - p.body.z);
          if (obj.look && Math.hypot(obj.x - p.body.x, obj.z - p.body.z) < 450) { lx = obj.look.x; lz = obj.look.z; ly = obj.look.y; }
          else if (dnext < 80) { const q2 = P[Math.min(ai.pi + 2, P.length - 1)]; lx = q2.x; lz = q2.z; ly = q2.y + 60; }
        } else { lx = obj.x; lz = obj.z; ly = obj.y + 60; }
        lookAtPoint(p, lx, ly, lz, dt, 0.35);
      }
      // quiet approach when close to enemies we know about
      if (!obj.run && ai.lastSeen && now - ai.lastSeen.t < 6 && Math.hypot(ai.lastSeen.x - p.body.x, ai.lastSeen.z - p.body.z) < 900) cmd.walk = true;
    }
    if (Game.inFire(p.body.x, p.body.y, p.body.z, 20)) { const fx = Game.fires[0]; if (fx) { const a = Math.atan2(-(p.body.x - fx.x), -(p.body.z - fx.z)); const rel = angDiff(p.yaw, a); cmd.fwd = Math.cos(rel); cmd.side = -Math.sin(rel); } }
  };

  function idleLook(p, look, dt) {
    const ai = p.ai, now = Game.time;
    if (ai.heard && now - ai.heard.t < 2.5) { lookAtPoint(p, ai.heard.x, ai.heard.y, ai.heard.z, dt, 0.6); return; }
    if (ai.lastSeen && now - ai.lastSeen.t < 4) { lookAtPoint(p, ai.lastSeen.x, ai.lastSeen.y, ai.lastSeen.z, dt, 0.6); return; }
    if (ai.hurtBy && now - ai.hurtT < 2 && ai.hurtBy.alive) { lookAtPoint(p, ai.hurtBy.body.x, ai.hurtBy.body.y + 50, ai.hurtBy.body.z, dt, 0.9); return; }
    if (now > ai.idleT || !ai.idleLook) {
      ai.idleT = now + 1.5 + rnd() * 3;
      if (look) ai.idleLook = { x: look.x + (rnd() - 0.5) * 220, y: (look.y || (World.gridFloor(look.x, look.z) || 0) + 56) + (rnd() - 0.5) * 30, z: look.z + (rnd() - 0.5) * 220 };
      else { const a = p.yaw + (rnd() - 0.5) * 2.4; ai.idleLook = { x: p.body.x - Math.sin(a) * 500, y: p.body.y + 60, z: p.body.z - Math.cos(a) * 500 }; }
    }
    lookAtPoint(p, ai.idleLook.x, ai.idleLook.y, ai.idleLook.z, dt, 0.25);
  }

  let tAcc = 0;
  B.update = (dt) => {
    tAcc += dt;
    if (tAcc > 0.25) { tAcc = 0; teamThink(); }
  };
  B.onHurt = (d) => {
    const v = d.v;
    if (!v.isBot || !v.ai || !d.a || d.a.team === v.team) return;
    v.ai.hurtBy = d.a; v.ai.hurtT = Game.time;
    if (!v.ai.target) v.ai.lastSeen = { pid: d.a.id, x: d.a.body.x, y: d.a.body.y + 50, z: d.a.body.z, t: Game.time - 1 };
  };
  B.onKill = (d) => {
    const k = d.killer, v = d.victim;
    if (k && k.isBot && k.ai && k.team !== v.team) {
      k.ai.target = null;
      const alive = Game.alive(v.team).length;
      if (rnd() < 0.35) say(k, alive ? `Got one, ${alive} left` : 'That was the last one', false);
    }
    if (v.isBot && v.team) {
      const mates = Game.alive(v.team).filter(p => p.isBot);
      for (const m of mates) if (m.ai && Math.hypot(m.body.x - v.body.x, m.body.z - v.body.z) < 1500 && k) m.ai.lastSeen = { pid: k.id, x: k.body.x, y: k.body.y + 50, z: k.body.z, t: Game.time - 1 };
    }
  };
  B.onPlanted = () => { teamThink(); };
  // Callouts at the start of a round so a human teammate knows the plan.
  B.onFreezeEnd = () => {
    const S = TS.T;
    const tb = Game.alive('T').filter(p => p.isBot);
    if (tb.length) {
      const style = { rush: `Rush ${S.site}, all together!`, split: `Split ${S.site}, half go ${S.site === 'A' ? 'palace' : 'short'}`, default: 'Default, spread out and wait for my call' }[S.style];
      say(pick(tb), style, true);
    }
    const cb = Game.alive('CT').filter(p => p.isBot);
    if (cb.length) {
      const c = pick(cb);
      setTimeout(() => { if (c.alive && c.ai && c.ai.hold) say(c, `I'll hold ${World.calloutAt(SPOTS[c.ai.hold].p[0], SPOTS[c.ai.hold].p[1]) || c.ai.hold}`, true); }, 50);
    }
  };

  B.init = () => {
    Game.botThink = B.think;
    Game.on('roundStart', d => B.roundStart(d.pistol));
    Game.on('hurt', B.onHurt);
    Game.on('kill', B.onKill);
    Game.on('planted', B.onPlanted);
    Game.on('freezeEnd', () => B.onFreezeEnd());
    Game.on('matchStart', () => { for (const p of Game.players) p.ai = null; });
  };
  B.DIFF = DIFF;
  return B;
})();

if (typeof module !== 'undefined') module.exports = { Bots };
