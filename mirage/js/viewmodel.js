'use strict';
// First-person weapon and arms, rendered in their own scene on top of the world.

const VM = (() => {
  const V = {};
  const C = hex => new THREE.Color(hex).convertSRGBToLinear();
  let scene, holder, pivot, model = null, curId = null, curTeam = null;
  let flash, flashLight, flashT = 0;
  const shells = [];
  const st = { shell: -1, draw: 1, drawDur: 1, reload: -1, reloadDur: 1, kick: 0, kickRot: 0, inspect: -1, bolt: -1, swing: -1, swingType: 0, nade: 0, throwT: -1, bob: 0, swayX: 0, swayY: 0, land: 0, plant: 0, hidden: false };

  const BASE = {
    rifle: { p: [6.8, -6.2, -14.5], r: [0.03, 0.12, -0.05] },
    smg: { p: [6.2, -5.2, -13], r: [0.03, 0.12, -0.05] },
    sniper: { p: [7.0, -6.4, -15], r: [0.03, 0.11, -0.05] },
    pistol: { p: [5.4, -4.7, -15.2], r: [0.04, 0.1, -0.03] },
    knife: { p: [6.5, -5.2, -12.5], r: [0.25, 0.35, 0.55] },
    grenade: { p: [5.5, -4.8, -12], r: [0.1, 0.2, 0.1] },
    c4: { p: [0.5, -5.5, -14], r: [0.9, 0, 0] },
  };
  const SLEEVE = { T: '#5a4631', CT: '#2c3746' }, GLOVE = { T: '#3a2e22', CT: '#141414' };

  V.init = (vmScene) => {
    scene = vmScene;
    holder = new THREE.Group(); scene.add(holder);
    pivot = new THREE.Group(); holder.add(pivot);
    const fm = new THREE.SpriteMaterial({ map: Tex.get('flash'), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    flash = new THREE.Sprite(fm); flash.visible = false; flash.renderOrder = 10;
    flashLight = new THREE.PointLight(C('#ffb060'), 0, 60, 2);
    scene.add(flashLight);
    const sg = new THREE.CylinderGeometry(0.22, 0.22, 1.1, 6); sg.rotateZ(Math.PI / 2);
    const sm = new THREE.MeshPhongMaterial({ color: C('#c9a042'), shininess: 90, specular: C('#886633') });
    for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(sg, sm); m.visible = false; scene.add(m); shells.push({ m, t: 0, v: new THREE.Vector3(), w: new THREE.Vector3() }); }
  };

  const Y = new THREE.Vector3(0, 1, 0);
  function limb(g, a, b, w, m) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va), len = d.length();
    const me = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.52, w * 0.6, len, 10), m);
    me.position.copy(va).add(vb).multiplyScalar(0.5);
    me.quaternion.setFromUnitVectors(Y, d.normalize());
    g.add(me);
    return me;
  }
  function addArms(m, team, type) {
    const sleeve = new THREE.MeshLambertMaterial({ color: C(SLEEVE[team]) });
    const glove = new THREE.MeshPhongMaterial({ color: C(GLOVE[team]), shininess: 15 });
    const cuff = new THREE.MeshLambertMaterial({ color: C(team === 'T' ? '#2d251b' : '#1c2229') });
    const g = m.grip, f = m.fore;
    const arms = new THREE.Group();
    // right arm from the grip back toward the lower right
    const re = [g[0] + 5, g[1] - 9, g[2] + 13];
    limb(arms, [g[0] + 0.6, g[1] - 1.2, g[2] + 1.2], re, 3.3, sleeve);
    limb(arms, [g[0] + 0.3, g[1] - 0.6, g[2] + 1.6], [g[0] + 0.6, g[1] - 1.8, g[2] + 3.8], 3.6, cuff);
    const hg = new THREE.SphereGeometry(1.7, 10, 8); hg.scale(0.85, 1.05, 1.1);
    const rh = new THREE.Mesh(hg, glove); rh.position.set(g[0] + 0.2, g[1] + 0.2, g[2]); arms.add(rh);
    const fg = new THREE.CylinderGeometry(0.55, 0.55, 3, 8); fg.rotateZ(Math.PI / 2);
    const rf = new THREE.Mesh(fg, glove); rf.position.set(g[0] - 0.5, g[1] + 0.9, g[2] - 1.4); arms.add(rf);
    if (type !== 'knife' && type !== 'grenade') {
      const le = [f[0] - 8, f[1] - 9, f[2] + 11];
      limb(arms, [f[0] - 0.8, f[1] - 1.2, f[2] + 0.8], le, 3.3, sleeve);
      limb(arms, [f[0] - 0.6, f[1] - 0.8, f[2] + 1.0], [f[0] - 1.6, f[1] - 2.2, f[2] + 3.2], 3.6, cuff);
      const lg = new THREE.SphereGeometry(1.8, 10, 8); lg.scale(0.95, 0.9, 1.2);
      const lh = new THREE.Mesh(lg, glove); lh.position.set(f[0] - 0.5, f[1] - 0.5, f[2]); arms.add(lh);
      const lf = new THREE.Mesh(fg, glove); lf.position.set(f[0] + 0.4, f[1] + 0.4, f[2] - 0.6); arms.add(lf);
    }
    m.group.add(arms);
  }

  V.set = (id, team) => {
    if (id === curId && team === curTeam) return;
    curId = id; curTeam = team;
    if (model) pivot.remove(model.group);
    model = null;
    if (!id) return;
    const w = WEAPONS[id];
    model = WeaponModels.build(id);
    model.type = w.type === 'grenade' ? 'grenade' : w.type;
    addArms(model, team, model.type);
    model.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    const b = BASE[model.type] || BASE.rifle;
    model.group.position.set(0, 0, 0);
    pivot.add(model.group);
    pivot.userData.base = b;
    if (model.mag) model.magBase = model.mag.position.clone();
    model.muzzleObj.add(flash);
    flash.position.set(0, 0, -2);
    st.reload = -1; st.inspect = -1; st.bolt = -1; st.swing = -1; st.throwT = -1; st.nade = 0; st.hidden = false;
  };

  V.deploy = (dur) => { st.draw = 0; st.drawDur = dur || 1; st.reload = -1; st.inspect = -1; st.throwT = -1; st.nade = 0; st.hidden = false; };
  V.shot = (w) => {
    const k = w.type === 'sniper' ? 2.8 : w.type === 'shotgun' ? 2.5 : w.id === 'deagle' ? 2.4 : w.type === 'pistol' ? 1.4 : 1;
    st.kick = Math.min(3, st.kick + k); st.kickRot = Math.min(0.4, st.kickRot + 0.05 * k);
    flashT = 0.05; flash.visible = !w.silenced;
    flash.material.rotation = Math.random() * Math.PI * 2;
    const s = w.silenced ? 0 : (w.type === 'pistol' ? 6 : 9) * (0.8 + Math.random() * 0.4);
    flash.scale.set(s, s, 1);
    if (!w.silenced) flashLight.intensity = 2.2;
    st.inspect = -1;
    if (w.bolt || w.id === 'nova') st.bolt = 0;
    if (model) ejectShell();
  };
  V.reload = (dur) => { st.reload = 0; st.reloadDur = dur; st.inspect = -1; };
  V.shell = () => { st.shell = 0; st.inspect = -1; };
  V.inspect = () => { st.inspect = 0; };
  V.knife = (stab) => { st.swing = 0; st.swingType = stab ? 1 : Math.random() < 0.5 ? 2 : 3; };
  V.pin = () => { st.nade = 1; };
  V.thrown = () => { st.nade = 0; st.throwT = 0; };
  V.land = (v) => { st.land = Math.min(1, v / 600); };

  const tmp = new THREE.Vector3();
  function ejectShell() {
    const sh = shells.find(s => !s.m.visible) || shells[0];
    const e = model.eject;
    tmp.set(e[0], e[1], e[2]);
    model.group.localToWorld(tmp);
    sh.m.position.copy(tmp);
    sh.m.visible = true; sh.t = 0;
    sh.v.set(18 + Math.random() * 10, 14 + Math.random() * 8, 4 + Math.random() * 4);
    sh.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
  }

  const ease = t => t * t * (3 - 2 * t);
  // s: { dt, speed, maxSpeed, onGround, mdx, mdy, duck, zoom, planting, defusing, visible }
  V.update = (s) => {
    const dt = s.dt;
    // shells
    for (const sh of shells) {
      if (!sh.m.visible) continue;
      sh.t += dt;
      if (sh.t > 0.7) { sh.m.visible = false; continue; }
      sh.v.y -= 90 * dt;
      sh.m.position.addScaledVector(sh.v, dt);
      sh.m.rotation.x += sh.w.x * dt; sh.m.rotation.y += sh.w.y * dt; sh.m.rotation.z += sh.w.z * dt;
    }
    flashT -= dt;
    if (flashT <= 0) flash.visible = false;
    flashLight.intensity *= Math.exp(-dt * 40);
    if (model) { tmp.set(...model.muzzle); model.group.localToWorld(tmp); flashLight.position.copy(tmp); }
    holder.visible = !!model && s.visible && !st.hidden;
    if (!model) return;
    const base = pivot.userData.base;
    let px = base.p[0], py = base.p[1], pz = base.p[2];
    let rx = base.r[0], ry = base.r[1], rz = base.r[2];
    // walking bob
    const run = s.onGround ? Math.min(1, s.speed / 250) : 0;
    st.bob += dt * (s.speed / 250) * 9.5;
    px += Math.sin(st.bob) * 0.45 * run;
    py += -Math.abs(Math.cos(st.bob)) * 0.4 * run - (s.duck ? 0.4 : 0);
    rz += Math.sin(st.bob) * 0.012 * run;
    // idle breathing
    const tt = performance.now() / 1000;
    py += Math.sin(tt * 1.6) * 0.06;
    // mouse sway
    st.swayX += (-s.mdx * 0.0016 - st.swayX) * Math.min(1, dt * 10);
    st.swayY += (-s.mdy * 0.0016 - st.swayY) * Math.min(1, dt * 10);
    ry += st.swayX; rx += st.swayY;
    px += st.swayX * -8; py += st.swayY * 6;
    // landing dip
    st.land *= Math.exp(-dt * 7);
    py -= st.land * 1.4;
    // recoil kick
    st.kick *= Math.exp(-dt * 16); st.kickRot *= Math.exp(-dt * 14);
    pz += st.kick * 1.1; rx += st.kickRot; py += st.kick * 0.1;
    // draw
    if (st.draw < 1) {
      st.draw = Math.min(1, st.draw + dt / Math.max(0.2, st.drawDur * 0.75));
      const e = 1 - ease(st.draw);
      py -= 7 * e; rx -= 0.9 * e; rz -= 0.3 * e;
    }
    // reload
    if (st.reload >= 0) {
      st.reload += dt / st.reloadDur;
      const t = st.reload;
      if (t >= 1) { st.reload = -1; if (model.mag) { model.mag.position.copy(model.magBase); model.mag.visible = true; } }
      else {
        const tilt = t < 0.15 ? ease(t / 0.15) : t > 0.8 ? 1 - ease((t - 0.8) / 0.2) : 1;
        rz += 0.45 * tilt; rx += 0.12 * tilt; py -= 1.2 * tilt; px -= 1.2 * tilt;
        if (model.mag) {
          if (t < 0.2) { model.mag.position.copy(model.magBase); model.mag.visible = true; }
          else if (t < 0.38) { model.mag.position.copy(model.magBase); model.mag.position.y -= 14 * ease((t - 0.2) / 0.18); }
          else if (t < 0.48) model.mag.visible = false;
          else if (t < 0.7) { model.mag.visible = true; model.mag.position.copy(model.magBase); model.mag.position.y -= 12 * (1 - ease((t - 0.48) / 0.22)); }
          else model.mag.position.copy(model.magBase);
        }
        if (t > 0.82 && t < 0.92) pz += 0.8 * Math.sin((t - 0.82) / 0.1 * Math.PI);
      }
    }
    // shotgun shell insert
    if (st.shell >= 0) {
      st.shell += dt / 0.45;
      if (st.shell >= 1) st.shell = -1;
      else { const a = Math.sin(st.shell * Math.PI); rz += 0.25 * a; py -= 0.8 * a; rx += 0.08 * a; }
    }
    // bolt action
    if (st.bolt >= 0) {
      st.bolt += dt / 1.1;
      if (st.bolt >= 1) st.bolt = -1;
      else if (st.bolt > 0.15) { const b = Math.sin((st.bolt - 0.15) / 0.85 * Math.PI); rz += 0.3 * b; py -= 1 * b; px -= 0.5 * b; }
    }
    // inspect
    if (st.inspect >= 0) {
      st.inspect += dt / 3.2;
      const t = st.inspect;
      if (t >= 1) st.inspect = -1;
      else {
        const a = t < 0.45 ? ease(t / 0.45) : t < 0.55 ? 1 : 1 - ease((t - 0.55) / 0.45);
        ry -= 1.15 * a; rz += 0.55 * a; px -= 3.5 * a; pz += 1.5 * a; py += 1.2 * a;
        if (model.type === 'knife') { rz += Math.sin(t * Math.PI * 2) * 1.2; }
      }
    }
    // knife swing
    if (st.swing >= 0) {
      st.swing += dt / (st.swingType === 1 ? 0.55 : 0.32);
      const t = st.swing;
      if (t >= 1) st.swing = -1;
      else {
        const a = Math.sin(t * Math.PI);
        if (st.swingType === 1) { pz -= 6 * a; py += 1.5 * a; rx -= 0.4 * a; }
        else { const dir = st.swingType === 2 ? 1 : -1; ry += 0.9 * a * dir; rz -= 1.0 * a * dir; px -= 4 * a * dir; pz -= 2 * a; }
      }
    }
    // grenade handling
    if (model.type === 'grenade') {
      if (st.nade) { pz += 3; py += 2.5; rx -= 0.5; px += 1; }
      if (st.throwT >= 0) {
        st.throwT += dt / 0.35;
        if (st.throwT >= 1) { st.throwT = -1; st.hidden = true; }
        else { pz -= 8 * st.throwT; py += 3 * Math.sin(st.throwT * Math.PI); rx += 0.8 * st.throwT; }
      }
    }
    // planting
    if (s.planting) { st.plant += dt; py -= 1.5; pz -= 1; py += Math.abs(Math.sin(st.plant * 10)) * 0.4; }
    else st.plant = 0;
    if (s.defusing) { py -= 12; }
    pivot.position.set(px, py, pz);
    pivot.rotation.set(rx, ry, rz);
  };
  V.clear = () => { V.set(null, null); curId = null; };
  V.BASE = BASE;
  V.debug = () => ({ curId, visible: holder.visible, pos: pivot.position.toArray(), rot: pivot.rotation.toArray(), st: Object.assign({}, st), children: pivot.children.length });
  return V;
})();
