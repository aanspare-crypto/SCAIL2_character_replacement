'use strict';
// Player models, animation and hitboxes.

// Hitboxes in the player's local frame (forward is -z), standing height 72.
const HITBOXES = [
  { g: 'head', c: [0, 65.6, -0.6], h: [4.3, 5.1, 4.5] },
  { g: 'chest', c: [0, 51, 0], h: [8.5, 8, 5.4] },
  { g: 'stomach', c: [0, 38.5, 0], h: [7.2, 4.5, 5] },
  { g: 'arms', c: [2, 48, -10], h: [5.5, 4, 7.5] },
  { g: 'legs', c: [0, 17, 0], h: [7.2, 17, 5] },
];

// Ray against a player's hitboxes. Returns { t, group } or null.
function hitTestPlayer(p, ox, oy, oz, dx, dy, dz, maxT) {
  const b = p.body;
  const k = b.height / 72;
  // quick sphere reject
  const cxw = b.x, cyw = b.y + 36 * k, czw = b.z;
  const lx = cxw - ox, ly = cyw - oy, lz = czw - oz;
  const tc = lx * dx + ly * dy + lz * dz;
  if (tc < -50 || tc > maxT + 50) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tc * tc;
  if (d2 > 60 * 60) return null;
  const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
  // into local space: rotate by -yaw
  const rx = ox - b.x, rz = oz - b.z;
  const lox = rx * cs - rz * sn, loz = rx * sn + rz * cs, loy = oy - b.y;
  const ldx = dx * cs - dz * sn, ldz = dx * sn + dz * cs, ldy = dy;
  let best = null;
  for (const hb of HITBOXES) {
    const cy = hb.c[1] * k, hy = hb.h[1] * (hb.g === 'legs' ? k : 1);
    const cyy = hb.g === 'head' ? b.height - (72 - hb.c[1]) : cy;
    const mins = [hb.c[0] - hb.h[0], cyy - hy, hb.c[2] - hb.h[2]], maxs = [hb.c[0] + hb.h[0], cyy + hy, hb.c[2] + hb.h[2]];
    let t0 = -1e9, t1 = 1e9;
    const o = [lox, loy, loz], d = [ldx, ldy, ldz];
    let ok = true;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < mins[a] || o[a] > maxs[a]) { ok = false; break; } continue; }
      let ta = (mins[a] - o[a]) / d[a], tb = (maxs[a] - o[a]) / d[a];
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
    if (!ok || t1 < 0 || t0 > maxT) continue;
    const t = Math.max(0, t0);
    if (!best || t < best.t) best = { t, group: hb.g };
  }
  return best;
}

if (typeof module !== 'undefined') module.exports = { HITBOXES, hitTestPlayer };

const Characters = (() => {
  if (typeof THREE === 'undefined') return null;
  const C = hex => new THREE.Color(hex).convertSRGBToLinear();
  const matCache = {};
  const lm = (hex, shin) => {
    const k = hex + (shin || 0);
    if (!matCache[k]) matCache[k] = shin ? new THREE.MeshPhongMaterial({ color: C(hex), shininess: shin, specular: C('#333333') }) : new THREE.MeshLambertMaterial({ color: C(hex) });
    return matCache[k];
  };
  const STYLE = {
    T: { pants: '#7f7052', jacket: '#5a4631', vest: '#8f7d57', pouch: '#6f6040', head: '#1d1c1b', skin: '#b1866a', boots: '#2b2218', gloves: '#3a2e22', accents: ['#7a2a22', '#3d5a3a', '#6b5a3a', '#2d2d2d', '#8a6a2a'] },
    CT: { pants: '#3b4655', jacket: '#2c3746', vest: '#1c2027', pouch: '#262b33', head: '#29313b', skin: '#c49d7d', boots: '#161616', gloves: '#141414', accents: ['#2f4f7a', '#4a5a4a', '#3a3a4a', '#5a4a3a', '#2a3a5a'] },
  };

  function boxMesh(w, h, d, m) { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.castShadow = true; return me; }
  const Y = new THREE.Vector3(0, 1, 0);
  function limb(a, b, w, m) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va); const len = dir.length();
    const me = boxMesh(w, len + w * 0.5, w, m);
    me.position.copy(va).add(vb).multiplyScalar(0.5);
    me.quaternion.setFromUnitVectors(Y, dir.normalize());
    return me;
  }
  function ik(S, H, a, b, pole) {
    const s = new THREE.Vector3(...S), h = new THREE.Vector3(...H);
    const u = h.clone().sub(s); let d = u.length(); u.normalize();
    d = Math.min(d, a + b - 0.05); d = Math.max(d, Math.abs(a - b) + 0.05);
    const x = (a * a - b * b + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, a * a - x * x));
    const p = new THREE.Vector3(...pole); p.addScaledVector(u, -p.dot(u)).normalize();
    const e = s.clone().addScaledVector(u, x).addScaledVector(p, hh);
    const hand = s.clone().addScaledVector(u, d);
    return [e.toArray(), hand.toArray()];
  }

  // Poses: hand targets in the aim frame (origin at shoulder height, forward -z).
  const POSES = {
    rifle: { R: [4, -9, -7], L: [4, -6.3, -18.5] },
    pistol: { R: [1.5, -4, -17], L: [0.5, -4.5, -16] },
    knife: { R: [7.5, -12, -9], L: [-9, -16, -2] },
  };

  function cylMesh(rTop, rBot, h, m, seg = 9, sz = 1) { const g = new THREE.CylinderGeometry(rTop, rBot, h, seg); if (sz !== 1) g.scale(1, 1, sz); return new THREE.Mesh(g, m); }
  function sphMesh(r, m, sx = 1, sy = 1, sz = 1, ws = 12, hs = 9, cap = Math.PI) { const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, cap); g.scale(sx, sy, sz); return new THREE.Mesh(g, m); }
  function rlimb(a, b, r0, r1, m) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va); const len = dir.length();
    const me = cylMesh(r1, r0, len + 1, m, 9);
    me.position.copy(va).add(vb).multiplyScalar(0.5);
    me.quaternion.setFromUnitVectors(Y, dir.normalize());
    return me;
  }
  const at = (me, x, y, z) => { me.position.set(x, y, z); return me; };

  function build(team, variant) {
    const st = STYLE[team];
    const accent = st.accents[variant % st.accents.length];
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const pelvis = new THREE.Group(); pelvis.position.y = 36; root.add(pelvis);
    pelvis.add(at(boxMesh(13.5, 8, 8.6, lm(st.pants)), 0, 0, 0));
    pelvis.add(at(boxMesh(14.2, 2.2, 9.2, lm('#1b1a18')), 0, 3, 0));
    pelvis.add(at(boxMesh(2.2, 1.8, 0.6, lm('#8a8070', 30)), 0, 3, -4.7));
    const legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 3.9, -2, 0); pelvis.add(hip);
      hip.add(at(cylMesh(3.9, 3.1, 17.5, lm(st.pants)), 0, -8.3, 0));
      hip.add(at(boxMesh(1.8, 5.5, 4.8, lm(st.pouch)), sx * 3.6, -9, 0.3));
      if (sx > 0) hip.add(at(boxMesh(2.2, 7, 4, lm('#1c1c1c')), 3.9, -5, 0.5));
      const knee = new THREE.Group(); knee.position.y = -17; hip.add(knee);
      knee.add(at(cylMesh(3.0, 2.5, 14.5, lm(st.pants)), 0, -7.2, 0));
      knee.add(at(sphMesh(2.5, lm(team === 'CT' ? '#161616' : st.pouch), 1.15, 1.25, 0.75), 0, -0.8, -2.5));
      knee.add(at(cylMesh(2.9, 2.9, 3.2, lm(st.boots)), 0, -13.4, 0));
      knee.add(at(boxMesh(5.8, 4.2, 8.6, lm(st.boots)), 0, -15.8, -1.1));
      knee.add(at(sphMesh(2.9, lm(st.boots), 1, 0.72, 1.25), 0, -16.4, -4.6));
      legs.push({ hip, knee });
    }
    const spine = new THREE.Group(); spine.position.y = 3; pelvis.add(spine);
    spine.add(at(cylMesh(6.9, 6.3, 9, lm(st.jacket), 12, 0.7), 0, 4.2, 0));
    spine.add(at(boxMesh(15, 11.5, 9.2, lm(st.jacket)), 0, 13.6, 0));
    for (const sx of [-1, 1]) spine.add(at(sphMesh(3.5, lm(st.jacket)), sx * 7.4, 17.6, 0));
    if (team === 'CT') {
      spine.add(at(boxMesh(15.6, 12.4, 11.2, lm(st.vest)), 0, 12.6, 0));
      for (let i = 0; i < 3; i++) spine.add(at(boxMesh(4.2, 5, 2.4, lm(st.pouch)), -5 + i * 5, 8.8, -6.6));
      spine.add(at(boxMesh(10, 3.2, 0.5, lm(accent)), 0, 16.3, -5.7));
      spine.add(at(boxMesh(4.2, 3.4, 1.4, lm('#20242a')), -4.8, 14.2, -6.2));
    } else {
      spine.add(at(boxMesh(14.8, 7, 3.2, lm(st.vest)), 0, 8.8, -5.6));
      for (let i = 0; i < 3; i++) spine.add(at(boxMesh(4.2, 5, 1.8, lm(st.pouch)), -5 + i * 5, 8.8, -7.6));
      for (const sx of [-1, 1]) spine.add(at(boxMesh(2.2, 13, 11.6, lm(st.vest)), sx * 4.6, 14, 0));
      if (variant % 2 === 0) spine.add(at(boxMesh(10, 12, 4.4, lm(st.pouch)), 0, 12, 6.6));
    }
    spine.add(at(boxMesh(3.6, 2.2, 0.4, lm(accent)), 8.3, 16, 0)).rotation.y = Math.PI / 2;
    spine.add(at(cylMesh(2.4, 2.7, 3.4, lm(st.skin)), 0, 21, 0));

    // Aim frame at shoulder height; head, arms and gun rotate with pitch.
    const aim = new THREE.Group(); aim.position.y = 18; spine.add(aim);
    const head = new THREE.Group(); head.position.y = 4.5; aim.add(head);
    if (team === 'CT') {
      head.add(at(sphMesh(4.3, lm(st.skin), 1, 1.12, 1.08), 0, 4.8, 0));
      head.add(at(boxMesh(1, 1.9, 1.3, lm(st.skin)), 0, 4, -4.6));
      head.add(at(sphMesh(4.95, lm(st.head, 20), 1, 0.95, 1.1, 14, 8, Math.PI * 0.56), 0, 5.4, 0.2));
      head.add(at(boxMesh(9.6, 1, 1.6, lm(st.head, 20)), 0, 7.4, -4.6));
      head.add(at(boxMesh(8, 1.9, 1.4, lm('#0a0a0a', 70)), 0, 5.4, -4.3));
      for (const sx of [-1, 1]) head.add(at(sphMesh(1.6, lm('#222222')), sx * 4.7, 4.6, 0.3));
      head.add(at(boxMesh(6.8, 2.8, 1, lm('#2a2a2a')), 0, 1.8, -4.2));
    } else {
      head.add(at(sphMesh(4.4, lm(st.head), 1, 1.12, 1.08), 0, 4.8, 0));
      head.add(at(boxMesh(6, 1.7, 1.2, lm(st.skin)), 0, 5.6, -4));
      head.add(at(boxMesh(1.4, 0.6, 1.3, lm('#121212')), -1.7, 5.6, -4.4));
      head.add(at(boxMesh(1.4, 0.6, 1.3, lm('#121212')), 1.7, 5.6, -4.4));
      head.add(at(cylMesh(4.6, 4.9, 3.4, lm(variant % 2 ? accent : '#c8b896'), 12), 0, 0.6, 0));
      if (variant % 3 === 0) head.add(at(sphMesh(4.7, lm('#2d2a26'), 1, 0.8, 1.1, 12, 6, Math.PI * 0.5), 0, 7.2, 0));
    }
    const armSets = {};
    for (const pose in POSES) {
      const g = new THREE.Group(); aim.add(g); g.visible = false;
      for (const sx of [-1, 1]) {
        const S = [sx * 8.2, -0.4, 0], H = sx > 0 ? POSES[pose].R : POSES[pose].L;
        const [E, Hh] = ik(S, H, 12, 12.5, [sx * 1, -1.2, 0.6]);
        g.add(rlimb(S, E, 2.9, 2.5, lm(st.jacket)));
        g.add(at(sphMesh(2.5, lm(st.jacket)), ...E));
        g.add(rlimb(E, Hh, 2.4, 2.0, lm(team === 'T' && variant % 2 ? st.skin : st.jacket)));
        g.add(at(boxMesh(3.2, 3.6, 3.9, lm(st.gloves)), ...Hh));
      }
      armSets[pose] = g;
    }
    const gunMount = new THREE.Group(); aim.add(gunMount);
    const backC4 = WeaponModels.build('c4').group; backC4.position.set(0, 12, team === 'T' && variant % 2 === 0 ? 9.8 : 7.5); backC4.rotation.set(0.1, 0, Math.PI / 2); backC4.visible = false; spine.add(backC4);
    const kit = boxMesh(5, 4, 2.5, lm('#2a2f36')); kit.position.set(-6, -1, 5); kit.visible = false; pelvis.add(kit);

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    kit.userData.noMerge = true; backC4.userData.noMerge = true;
    const opt = { bakeColor: true };
    for (const g of [pelvis, spine, head, ...legs.map(l => l.hip), ...legs.map(l => l.knee), ...Object.values(armSets)]) MeshUtil.merge(g, opt);
    return { root, pelvis, spine, aim, head, legs, armSets, gunMount, backC4, kit, pose: null, gun: null, gunId: null, phase: 0, deathT: 0, deathDir: 1, deathSide: 0 };
  }

  function setWeapon(ch, id) {
    if (ch.gunId === id) return;
    ch.gunId = id;
    if (ch.gun) ch.gunMount.remove(ch.gun.group);
    const w = WEAPONS[id];
    const pose = !w ? 'knife' : w.type === 'pistol' ? 'pistol' : (w.type === 'rifle' || w.type === 'smg' || w.type === 'sniper' || w.type === 'shotgun') ? 'rifle' : 'knife';
    for (const k in ch.armSets) ch.armSets[k].visible = k === pose;
    ch.pose = pose;
    if (!id) { ch.gun = null; return; }
    const m = WeaponModels.build(id);
    const grip = m.grip, hand = POSES[pose].R;
    m.group.position.set(hand[0] - grip[0], hand[1] - grip[1], hand[2] - grip[2]);
    if (pose === 'knife') { m.group.rotation.set(-0.4, 0, 0); if (w && w.type !== 'knife') m.group.position.set(hand[0], hand[1] + 1.5, hand[2]); }
    ch.gunMount.add(m.group);
    ch.gun = m;
  }

  // state: { speed, maxSpeed, duck (0..1), onGround, pitch, alive, dt }
  function animate(ch, s) {
    const dt = s.dt;
    if (!s.alive) {
      ch.deathT = Math.min(1, ch.deathT + dt * 2.6);
      const e = ch.deathT * ch.deathT * (3 - 2 * ch.deathT);
      ch.root.rotation.x = ch.deathDir * (Math.PI / 2 - 0.05) * e;
      ch.root.rotation.z = ch.deathSide * 0.4 * e;
      ch.aim.rotation.x = 0.4 * e;
      for (const L of ch.legs) { L.hip.rotation.x *= 0.9; L.knee.rotation.x = 0.3 * e; }
      return;
    }
    ch.deathT = 0; ch.root.rotation.x = 0; ch.root.rotation.z = 0;
    const sp = s.speed, amp = Math.min(1, sp / 200);
    ch.phase += dt * (sp / 34) * (s.duck > 0.5 ? 1.2 : 1);
    const duck = s.duck;
    const air = !s.onGround;
    for (let i = 0; i < 2; i++) {
      const L = ch.legs[i], ph = ch.phase + (i ? Math.PI : 0);
      let hipX = Math.sin(ph) * 0.62 * amp, kneeX = Math.max(0, -Math.cos(ph)) * 0.9 * amp + 0.05;
      if (air) { hipX = -0.45; kneeX = 0.8; }
      hipX = hipX * (1 - duck) + (-1.25 + Math.sin(ph) * 0.3 * amp) * duck;
      kneeX = kneeX * (1 - duck) + 2.05 * duck;
      L.hip.rotation.x = hipX; L.knee.rotation.x = kneeX;
    }
    ch.pelvis.position.y = 36 - 18 * duck + Math.abs(Math.sin(ch.phase)) * 1.2 * amp * (1 - duck);
    ch.spine.rotation.x = -0.12 * duck - 0.06 * amp;
    ch.aim.rotation.x = Math.max(-1.2, Math.min(1.2, s.pitch)) - ch.spine.rotation.x;
    ch.spine.rotation.y = 0;
  }

  return { build, setWeapon, animate, POSES };
})();
