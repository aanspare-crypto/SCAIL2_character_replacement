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

  function build(team, variant) {
    const st = STYLE[team];
    const accent = st.accents[variant % st.accents.length];
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const pelvis = new THREE.Group(); pelvis.position.y = 36; root.add(pelvis);
    const pm = boxMesh(14, 8, 9, lm(st.pants)); pelvis.add(pm);
    const belt = boxMesh(14.6, 2, 9.6, lm('#1a1a1a')); belt.position.y = 3; pelvis.add(belt);
    const legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 3.8, -2, 0); pelvis.add(hip);
      const thigh = boxMesh(6.4, 17, 7, lm(st.pants)); thigh.position.y = -8.5; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -17; hip.add(knee);
      const shin = boxMesh(5.6, 15, 6.2, lm(st.pants)); shin.position.y = -7.5; knee.add(shin);
      const pad = boxMesh(6, 4, 2, lm(team === 'CT' ? '#1a1a1a' : st.pouch)); pad.position.set(0, -1, -3.4); knee.add(pad);
      const boot = boxMesh(6.2, 4.5, 10.5, lm(st.boots)); boot.position.set(0, -15.5, -1.8); knee.add(boot);
      legs.push({ hip, knee });
    }
    const spine = new THREE.Group(); spine.position.y = 3; pelvis.add(spine);
    const torso = boxMesh(15.5, 20, 9.5, lm(st.jacket)); torso.position.y = 9.5; spine.add(torso);
    const vest = boxMesh(16.5, 13.5, 11, lm(st.vest)); vest.position.y = 12; spine.add(vest);
    for (let i = 0; i < 3; i++) { const p = boxMesh(4, 4.5, 2.2, lm(st.pouch)); p.position.set(-5 + i * 5, 6.5, -6.2); spine.add(p); }
    const patch = boxMesh(3.5, 2.2, 0.4, lm(accent)); patch.position.set(8.4, 16, 0); patch.rotation.y = Math.PI / 2; spine.add(patch);
    const neck = boxMesh(4.5, 3, 4.5, lm(st.skin)); neck.position.y = 21; spine.add(neck);

    // Aim frame at shoulder height; head, arms and gun rotate with pitch.
    const aim = new THREE.Group(); aim.position.y = 18; spine.add(aim);
    const head = new THREE.Group(); head.position.y = 4.5; aim.add(head);
    const skull = boxMesh(8.2, 9.6, 9, lm(team === 'T' ? st.head : st.skin)); skull.position.y = 4.6; head.add(skull);
    if (team === 'CT') {
      const helmet = boxMesh(9.4, 4.4, 10.2, lm(st.head, 20)); helmet.position.set(0, 8.4, 0.2); head.add(helmet);
      const brim = boxMesh(9.6, 1.2, 2, lm(st.head, 20)); brim.position.set(0, 6.5, -4.8); head.add(brim);
      const goggles = boxMesh(8.6, 2.2, 1.2, lm('#0b0b0b', 60)); goggles.position.set(0, 4.8, -4.6); head.add(goggles);
      const mask = boxMesh(8.4, 3.2, 1, lm('#2a2a2a')); mask.position.set(0, 1.6, -4.6); head.add(mask);
    } else {
      const eyes = boxMesh(6.4, 1.8, 0.6, lm(st.skin)); eyes.position.set(0, 5.4, -4.6); head.add(eyes);
      const scarf = boxMesh(9.4, 3.2, 9.6, lm(variant % 2 ? accent : '#c8b896')); scarf.position.set(0, 0.8, 0); head.add(scarf);
      if (variant % 3 === 0) { const cap = boxMesh(8.8, 2.6, 9.6, lm('#2d2a26')); cap.position.set(0, 9.6, 0); head.add(cap); }
    }
    const armSets = {};
    for (const pose in POSES) {
      const g = new THREE.Group(); aim.add(g); g.visible = false;
      for (const sx of [-1, 1]) {
        const S = [sx * 9.2, 0, 0], H = sx > 0 ? POSES[pose].R : POSES[pose].L;
        const [E, Hh] = ik(S, H, 12, 12.5, [sx * 1, -1.2, 0.6]);
        g.add(limb(S, E, 5.2, lm(st.jacket)));
        g.add(limb(E, Hh, 4.6, lm(st.jacket)));
        const hand = boxMesh(3.6, 3.8, 4.2, lm(st.gloves)); hand.position.set(...Hh); g.add(hand);
      }
      armSets[pose] = g;
    }
    const gunMount = new THREE.Group(); aim.add(gunMount);
    const backC4 = WeaponModels.build('c4').group; backC4.position.set(0, 12, 7.5); backC4.rotation.set(0.1, 0, Math.PI / 2); backC4.visible = false; spine.add(backC4);
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
    const pose = !w ? 'knife' : w.type === 'pistol' ? 'pistol' : (w.type === 'rifle' || w.type === 'smg' || w.type === 'sniper') ? 'rifle' : 'knife';
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
