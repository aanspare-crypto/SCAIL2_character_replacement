'use strict';
// Visual effects: particles, decals, tracers, flashes, smoke volumes and fire.

const FX = (() => {
  const F = {};
  let scene, camera;
  const systems = {};

  const VS = `
    attribute float size; attribute vec4 pcolor; varying vec4 vColor; uniform float scale;
    void main() { vColor = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = max(1.0, size * scale / max(1.0, -mv.z)); gl_Position = projectionMatrix * mv; }`;
  const FS = `
    uniform sampler2D map; varying vec4 vColor;
    void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.004) discard; }`;

  class Particles {
    constructor(max, tex, additive, sorted) {
      this.max = max; this.list = []; this.sorted = sorted;
      const g = new THREE.BufferGeometry();
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      this.geo = g;
      this.mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, scale: { value: 600 } }, vertexShader: VS, fragmentShader: FS,
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.points = new THREE.Points(g, this.mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = additive ? 5 : 4;
      scene.add(this.points);
    }
    spawn(p) {
      if (this.list.length >= this.max) this.list.shift();
      p.age = 0;
      p.vx = p.vx || 0; p.vy = p.vy || 0; p.vz = p.vz || 0;
      p.grav = p.grav || 0; p.drag = p.drag || 0;
      if (p.s1 === undefined) p.s1 = p.s0;
      if (p.a1 === undefined) p.a1 = 0;
      if (p.fadeIn === undefined) p.fadeIn = 0;
      this.list.push(p);
      return p;
    }
    update(dt, cx, cy, cz) {
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i];
        p.age += dt;
        if (p.age >= p.life) { L.splice(i, 1); continue; }
        p.vy -= p.grav * dt;
        if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
      }
      if (this.sorted) {
        for (const p of L) p.d = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
        L.sort((a, b) => b.d - a.d);
      }
      const n = L.length;
      for (let i = 0; i < n; i++) {
        const p = L[i], f = p.age / p.life;
        this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
        let a = p.a0 + (p.a1 - p.a0) * f;
        if (p.fadeIn && p.age < p.fadeIn) a *= p.age / p.fadeIn;
        if (p.fadeOut && p.life - p.age < p.fadeOut) a *= (p.life - p.age) / p.fadeOut;
        if (p.alphaMul) a *= p.alphaMul;
        this.col[i * 4] = p.r; this.col[i * 4 + 1] = p.g; this.col[i * 4 + 2] = p.b; this.col[i * 4 + 3] = a;
        this.size[i] = p.s0 + (p.s1 - p.s0) * (p.ease ? 1 - (1 - f) * (1 - f) : f);
      }
      this.geo.setDrawRange(0, n);
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.pcolor.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
    }
  }

  // decals
  const decalPools = {};
  function decalPool(name, tex, n, size) {
    const m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const geo = new THREE.PlaneGeometry(size, size);
    const list = [];
    for (let i = 0; i < n; i++) { const me = new THREE.Mesh(geo, m); me.visible = false; me.renderOrder = 2; scene.add(me); list.push(me); }
    decalPools[name] = { list, i: 0 };
  }
  const tmpV = new THREE.Vector3();
  F.decal = (name, x, y, z, nx, ny, nz, scale = 1) => {
    const P = decalPools[name]; const me = P.list[P.i]; P.i = (P.i + 1) % P.list.length;
    me.visible = true;
    me.position.set(x + nx * 0.25, y + ny * 0.25, z + nz * 0.25);
    me.lookAt(tmpV.set(x + nx, y + ny, z + nz));
    me.rotateZ(Math.random() * Math.PI * 2);
    me.scale.setScalar(scale);
  };
  F.clearDecals = () => { for (const k in decalPools) for (const m of decalPools[k].list) m.visible = false; };

  // tracers
  let tracerGeo, tracerPos, tracerCol;
  const tracers = [];
  const MAXT = 96;
  function initTracers() {
    tracerGeo = new THREE.BufferGeometry();
    tracerPos = new Float32Array(MAXT * 6); tracerCol = new Float32Array(MAXT * 6);
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    tracerGeo.setAttribute('color', new THREE.BufferAttribute(tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const ls = new THREE.LineSegments(tracerGeo, m); ls.frustumCulled = false; ls.renderOrder = 6;
    scene.add(ls);
  }
  F.tracer = (x0, y0, z0, x1, y1, z1) => {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz);
    if (L < 60) return;
    if (tracers.length >= MAXT) tracers.shift();
    tracers.push({ x0, y0, z0, dx: dx / L, dy: dy / L, dz: dz / L, L, age: 0 });
  };
  function updateTracers(dt) {
    let n = 0;
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.age += dt;
      const head = t.age * 26000, tail = head - 260;
      if (tail > t.L) { tracers.splice(i, 1); continue; }
    }
    for (const t of tracers) {
      const head = Math.min(t.L, t.age * 26000), tail = Math.max(0, head - 260);
      const o = n * 6;
      tracerPos[o] = t.x0 + t.dx * tail; tracerPos[o + 1] = t.y0 + t.dy * tail; tracerPos[o + 2] = t.z0 + t.dz * tail;
      tracerPos[o + 3] = t.x0 + t.dx * head; tracerPos[o + 4] = t.y0 + t.dy * head; tracerPos[o + 5] = t.z0 + t.dz * head;
      tracerCol[o] = 0.25; tracerCol[o + 1] = 0.2; tracerCol[o + 2] = 0.08;
      tracerCol[o + 3] = 1.0; tracerCol[o + 4] = 0.85; tracerCol[o + 5] = 0.45;
      n++;
    }
    tracerGeo.setDrawRange(0, n * 2);
    tracerGeo.attributes.position.needsUpdate = true;
    tracerGeo.attributes.color.needsUpdate = true;
  }

  // flash lights
  const lights = [];
  function initLights() {
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffc070, 0, 700, 2);
      l.userData = { t: 0, life: 0, peak: 0 };
      scene.add(l); lights.push(l);
    }
  }
  F.light = (x, y, z, peak, life, dist = 700, color = 0xffc070) => {
    let best = lights[0];
    for (const l of lights) if (l.userData.t >= l.userData.life) { best = l; break; }
    best.position.set(x, y, z); best.distance = dist; best.color.setHex(color);
    best.userData.t = 0; best.userData.life = life; best.userData.peak = peak;
    best.intensity = peak;
  };
  function updateLights(dt) {
    for (const l of lights) {
      const u = l.userData;
      if (u.t >= u.life) { l.intensity = 0; continue; }
      u.t += dt;
      l.intensity = u.peak * Math.max(0, 1 - u.t / u.life);
      if (u.flicker) l.intensity *= 0.75 + Math.random() * 0.5;
    }
  }

  // Smoke clouds (also used by bots for vision checks).
  F.smokes = [];
  F.fires = [];

  F.init = (sc, cam) => {
    scene = sc; camera = cam;
    const soft = Tex.get('soft'), smoke = Tex.get('smoke'), flash = Tex.get('flash'), fire = Tex.get('fire'), blood = Tex.get('blood');
    systems.spark = new Particles(600, soft, true, false);
    systems.fire = new Particles(500, fire, true, false);
    systems.flash = new Particles(80, flash, true, false);
    systems.dust = new Particles(500, soft, false, true);
    systems.smoke = new Particles(700, smoke, false, true);
    systems.blood = new Particles(300, blood, false, false);
    decalPool('hole', Tex.get('hole'), 180, 4);
    decalPool('blood', Tex.get('blood'), 40, 26);
    decalPool('scorch', Tex.get('scorch'), 12, 150);
    decalPool('pool', Tex.get('bloodpool'), 12, 64);
    initTracers();
    initLights();
  };
  F.reset = () => {
    for (const k in systems) systems[k].list.length = 0;
    tracers.length = 0;
    F.smokes.length = 0;
    for (const f of F.fires) if (f.stop) f.stop();
    F.fires.length = 0;
    F.clearDecals();
  };

  const rr = (a, b) => a + Math.random() * (b - a);
  F.muzzle = (x, y, z, dx, dy, dz, big) => {
    systems.flash.spawn({ x: x + dx * 4, y: y + dy * 4, z: z + dz * 4, life: 0.05, s0: big ? 40 : 26, s1: big ? 48 : 30, r: 1, g: 0.85, b: 0.55, a0: 1, a1: 0.4 });
    systems.dust.spawn({ x, y, z, vx: dx * 60 + rr(-10, 10), vy: dy * 60 + 20, vz: dz * 60 + rr(-10, 10), life: 0.5, s0: 6, s1: 22, r: 0.8, g: 0.78, b: 0.74, a0: 0.25, a1: 0, drag: 2 });
  };
  F.impact = (x, y, z, nx, ny, nz, mat) => {
    const wood = mat === 'crate' || mat === 'wood' || mat === 'booth';
    const metal = mat === 'van' || mat === 'car' || mat === 'metal';
    const n = metal ? 7 : 4;
    for (let i = 0; i < n; i++) systems.spark.spawn({ x, y, z, vx: nx * rr(60, 200) + rr(-120, 120), vy: ny * rr(60, 200) + rr(30, 160), vz: nz * rr(60, 200) + rr(-120, 120), life: rr(0.1, 0.3), s0: rr(1.2, 2.6), r: 1, g: 0.8, b: 0.45, a0: metal ? 1 : 0.6, grav: 600 });
    const c = wood ? [0.55, 0.38, 0.22] : [0.72, 0.64, 0.52];
    for (let i = 0; i < 3; i++) systems.dust.spawn({ x: x + nx * 2, y: y + ny * 2, z: z + nz * 2, vx: nx * rr(20, 70) + rr(-15, 15), vy: ny * rr(20, 70) + rr(5, 30), vz: nz * rr(20, 70) + rr(-15, 15), life: rr(0.6, 1.2), s0: rr(4, 8), s1: rr(18, 34), r: c[0], g: c[1], b: c[2], a0: 0.55, a1: 0, drag: 2.5, grav: -8 });
    if (wood) for (let i = 0; i < 3; i++) systems.dust.spawn({ x, y, z, vx: nx * 120 + rr(-60, 60), vy: rr(40, 140), vz: nz * 120 + rr(-60, 60), life: 0.5, s0: 2, r: 0.4, g: 0.26, b: 0.14, a0: 1, a1: 1, grav: 700 });
    F.decal('hole', x, y, z, nx, ny, nz, rr(0.8, 1.2));
  };
  F.blood = (x, y, z, dx, dy, dz, head) => {
    const n = head ? 9 : 5;
    for (let i = 0; i < n; i++) systems.blood.spawn({ x, y, z, vx: dx * rr(40, 140) + rr(-50, 50), vy: rr(-10, 90), vz: dz * rr(40, 140) + rr(-50, 50), life: rr(0.25, 0.6), s0: rr(3, 6), s1: rr(8, 14), r: 1, g: 1, b: 1, a0: 0.95, a1: 0, grav: 500 });
    systems.dust.spawn({ x, y, z, vx: dx * 30, vy: 10, vz: dz * 30, life: 0.35, s0: 8, s1: head ? 34 : 22, r: 0.55, g: 0.04, b: 0.04, a0: 0.55, a1: 0, drag: 3 });
    // splatter on a wall behind the target
    const h = World.raycast(x, y, z, dx, dy - 0.1, dz, 150);
    if (h) F.decal('blood', x + dx * h.t, y + (dy - 0.1) * h.t, z + dz * h.t, h.nx, h.ny, h.nz, rr(0.6, 1.2));
  };
  F.explosion = (x, y, z, big) => {
    const k = big ? 2.6 : 1;
    systems.flash.spawn({ x, y: y + 20, z, life: 0.25 * k, s0: 220 * k, s1: 420 * k, r: 1, g: 0.9, b: 0.7, a0: 1, a1: 0 });
    for (let i = 0; i < 26 * k; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = rr(150, 520) * k;
      systems.fire.spawn({ x, y: y + 16, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp * 0.8 + 40, vz: Math.sin(a) * Math.cos(e) * sp, life: rr(0.3, 0.7) * (big ? 1.4 : 1), s0: rr(40, 90) * k, s1: rr(90, 160) * k, r: 1, g: rr(0.5, 0.8), b: 0.3, a0: 1, a1: 0, drag: 4 });
    }
    for (let i = 0; i < 18 * k; i++) {
      const a = Math.random() * Math.PI * 2, sp = rr(60, 220) * k;
      systems.smoke.spawn({ x, y: y + 20, z, vx: Math.cos(a) * sp, vy: rr(30, 140) * k, vz: Math.sin(a) * sp, life: rr(2, 4) * (big ? 1.6 : 1), s0: rr(60, 110) * k, s1: rr(200, 320) * k, r: 0.35, g: 0.32, b: 0.3, a0: 0.75, a1: 0, drag: 1.6, ease: true });
    }
    for (let i = 0; i < 30 * k; i++) systems.spark.spawn({ x, y: y + 10, z, vx: rr(-500, 500) * k, vy: rr(100, 600) * k, vz: rr(-500, 500) * k, life: rr(0.4, 1.1), s0: rr(2, 4), r: 1, g: 0.7, b: 0.3, a0: 1, grav: 800 });
    F.light(x, y + 60, z, big ? 8 : 4, big ? 1.0 : 0.35, big ? 3000 : 900, 0xffaa55);
    F.decal('scorch', x, World.floorAt(x, z, y + 40) + 0.5, z, 0, 1, 0, big ? 2.4 : 1);
  };
  F.flashPop = (x, y, z) => {
    systems.flash.spawn({ x, y, z, life: 0.18, s0: 300, s1: 500, r: 1, g: 1, b: 1, a0: 1, a1: 0 });
    F.light(x, y, z, 9, 0.25, 1400, 0xffffff);
    for (let i = 0; i < 12; i++) systems.spark.spawn({ x, y, z, vx: rr(-300, 300), vy: rr(-100, 300), vz: rr(-300, 300), life: rr(0.2, 0.5), s0: 3, r: 1, g: 1, b: 0.9, a0: 1, grav: 400 });
  };
  // Smoke volume: bots use F.smokes for line-of-sight checks.
  F.smokeCloud = (x, y, z, dur) => {
    const s = { x, y: y + 70, z, r: 165, t: 0, dur, particles: [] };
    F.smokes.push(s);
    for (let i = 0; i < 72; i++) {
      const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * 140, h = rr(10, 160);
      const tx = x + Math.cos(a) * rad, tz = z + Math.sin(a) * rad;
      const f = World.floorAt(tx, tz, y + 100);
      const ty = Math.max(f + 24, y + h * (1 - rad / 260));
      const l = rr(0.8, 0.93) * (0.92 + 0.08 * (h / 160));
      s.particles.push(systems.smoke.spawn({ x: x + rr(-10, 10), y: y + 20, z: z + rr(-10, 10), vx: (tx - x) * 1.7, vy: (ty - y) * 1.5, vz: (tz - z) * 1.7, drag: 1.9, life: dur + rr(-1, 1), s0: rr(70, 100), s1: rr(230, 300), ease: true, r: l, g: l, b: l * 0.985, a0: 1, a1: 0.95, fadeIn: 0.35, fadeOut: 2.5 }));
    }
    return s;
  };
  F.fireArea = (x, y, z, r, dur) => {
    const f = { x, y, z, r, t: 0, dur, spawnAcc: 0, stop: Sound.fire([x, y + 10, z], dur) };
    F.fires.push(f);
    F.decal('scorch', x, y + 0.5, z, 0, 1, 0, r / 70);
    return f;
  };
  function updateFires(dt) {
    for (let i = F.fires.length - 1; i >= 0; i--) {
      const f = F.fires[i];
      f.t += dt;
      if (f.t >= f.dur) { F.fires.splice(i, 1); continue; }
      f.spawnAcc += dt * 70;
      while (f.spawnAcc > 1) {
        f.spawnAcc--;
        const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * f.r;
        const px = f.x + Math.cos(a) * rad, pz = f.z + Math.sin(a) * rad;
        const fy = World.floorAt(px, pz, f.y + 40);
        if (Math.abs(fy - f.y) > 40) continue;
        systems.fire.spawn({ x: px, y: fy + 4, z: pz, vy: rr(40, 110), vx: rr(-10, 10), vz: rr(-10, 10), life: rr(0.35, 0.8), s0: rr(24, 44), s1: rr(6, 14), r: 1, g: rr(0.55, 0.85), b: 0.35, a0: 0.95, a1: 0 });
        if (Math.random() < 0.08) systems.smoke.spawn({ x: px, y: fy + 40, z: pz, vy: rr(60, 120), life: rr(1.5, 2.5), s0: 40, s1: 140, r: 0.22, g: 0.2, b: 0.19, a0: 0.4, a1: 0, ease: true });
      }
      if (Math.random() < dt * 20) F.light(f.x, f.y + 40, f.z, 2.2, 0.12, 500, 0xff8a3a);
    }
  }
  F.updateSmokes = dt => {
    for (let i = F.smokes.length - 1; i >= 0; i--) {
      const s = F.smokes[i];
      s.t += dt;
      if (s.t > s.dur) F.smokes.splice(i, 1);
    }
  };
  // Is the segment a-b blocked by a smoke cloud?
  F.smokeBlocks = (ax, ay, az, bx, by, bz) => {
    for (const s of F.smokes) {
      if (s.t < 1.2 || s.t > s.dur - 1.5) continue;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const L2 = dx * dx + dy * dy + dz * dz;
      let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - s.x, py = (ay + dy * t - s.y) * 1.6, pz = az + dz * t - s.z;
      if (px * px + py * py + pz * pz < s.r * s.r) return true;
    }
    return false;
  };
  // How deep inside smoke is a point (0..1)?
  F.smokeDensityAt = (x, y, z) => {
    let d = 0;
    for (const s of F.smokes) {
      if (s.t < 0.8) continue;
      const k = Math.hypot(x - s.x, (y - s.y) * 1.4, z - s.z) / (s.r * 1.1);
      const fade = Math.min(1, (s.dur - s.t) / 2.5);
      if (k < 1) d = Math.max(d, (1 - k * k) * fade);
    }
    return d;
  };

  F.update = (dt, fovV, heightPx) => {
    const scale = heightPx / (2 * Math.tan(fovV * Math.PI / 360));
    const c = camera.position;
    for (const k in systems) { systems[k].mat.uniforms.scale.value = scale; systems[k].update(dt, c.x, c.y, c.z); }
    updateTracers(dt);
    updateLights(dt);
    updateFires(dt);
    F.updateSmokes(dt);
  };
  F.systems = systems;
  return F;
})();
