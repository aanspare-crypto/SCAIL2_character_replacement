'use strict';
// Scene, lighting, world geometry and decoration.

const Render = (() => {
  const R = {};
  const C = hex => new THREE.Color(hex).convertSRGBToLinear();
  R.C = C;
  const srgb = t => { t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; return t; };
  let seed = 99;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  // ---------- materials ----------
  const MATDEF = {
    plaster: { tex: 'plaster', S: 320, bump: 0.8 },
    sandstone: { tex: 'sandstone', S: 256, bump: 1.4 },
    plasterWhite: { tex: 'plasterWhite', S: 320, bump: 0.6 },
    slab: { tex: 'slab', S: 256, bump: 1.2 },
    pave: { tex: 'pave', S: 256, bump: 1.2 },
    sand: { tex: 'sand', S: 384, bump: 0.9 },
    tile: { tex: 'tile', S: 128, bump: 0.5, shin: 40 },
    wood: { tex: 'wood', S: 128, bump: 0.7 },
    concrete: { tex: 'concrete', S: 256, bump: 0.5 },
    rail: { tex: 'rail', S: 128, bump: 0.4 },
    crate: { tex: 'crate', S: 0, bump: 1.0 },
    metal: { tex: 'metal', S: 128, bump: 0.3, shin: 50 },
    bark: { tex: 'bark', S: 0, bump: 1.0 },
  };
  const mats = {};
  function mat(name) {
    if (mats[name]) return mats[name];
    const d = MATDEF[name];
    const t = srgb(Tex.get(d.tex));
    const m = new THREE.MeshPhongMaterial({ map: t, bumpMap: t, bumpScale: d.bump, vertexColors: true, shininess: d.shin || 6, specular: C(d.shin ? '#303030' : '#0c0c0c') });
    mats[name] = m;
    return m;
  }
  R.mat = mat;

  // ---------- geometry builder ----------
  class GB {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; }
    // v: 4 vertices [x,y,z]; uv: 4 [u,v]; col: 4 brightness or [r,g,b]
    quad(v, nx, ny, nz, uv, col) {
      for (let k = 0; k < 4; k++) {
        this.p.push(v[k][0], v[k][1], v[k][2]);
        this.n.push(nx, ny, nz);
        this.u.push(uv[k][0], uv[k][1]);
        const c = col[k];
        if (typeof c === 'number') this.c.push(c, c, c); else this.c.push(c[0], c[1], c[2]);
      }
      const b = this.v;
      this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
      this.v += 4;
    }
    tri(v, nx, ny, nz, uv, col) {
      for (let k = 0; k < 3; k++) {
        this.p.push(v[k][0], v[k][1], v[k][2]); this.n.push(nx, ny, nz); this.u.push(uv[k][0], uv[k][1]);
        const c = col[k]; if (typeof c === 'number') this.c.push(c, c, c); else this.c.push(c[0], c[1], c[2]);
      }
      const b = this.v; this.i.push(b, b + 1, b + 2); this.v += 3;
    }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      return g;
    }
  }
  R.GB = GB;

  function worldUV(x, y, z, nx, ny, nz, S) {
    if (Math.abs(ny) > 0.5) return [x / S, z / S];
    if (Math.abs(nx) > 0.5) return [(nx > 0 ? -z : z) / S, y / S];
    return [(nz > 0 ? x : -x) / S, y / S];
  }

  // Side faces of an axis-aligned box: [normal, v0 bottom-left, v1 bottom-right] (viewed from outside); top y1.
  function sideFaces(b) {
    const { x0, z0, x1, z1 } = b;
    return [
      { n: [1, 0, 0], a: [x1, z1], b: [x1, z0] },
      { n: [-1, 0, 0], a: [x0, z0], b: [x0, z1] },
      { n: [0, 0, 1], a: [x0, z1], b: [x1, z1] },
      { n: [0, 0, -1], a: [x1, z0], b: [x0, z0] },
    ];
  }

  // Which parts of a side face can be seen, and the floor level in front of it.
  function faceInfo(f, top) {
    const [ax, az] = f.a, [bx, bz] = f.b;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 32));
    let visible = false, base = 1e9, outdoor = 0, indoor = 0, floorSamples = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = ax + (bx - ax) * t + f.n[0] * 2, pz = az + (bz - az) * t + f.n[2] * 2;
      const o = World.cellAt(px, pz);
      if (!o) continue;
      if (o.kind === 'floor') {
        const h = World.regionHeight(o.ch, px, pz);
        floorSamples++;
        if (o.roofY) indoor++; else outdoor++;
        if (h < top - 1) { visible = true; base = Math.min(base, h); }
      } else if (o.kind === 'wall') {
        if (o.top < top) { visible = true; base = Math.min(base, o.top); }
      } else {
        const t2 = o.fh + 40;
        if (t2 < top) { visible = true; base = Math.min(base, o.fh); }
      }
    }
    if (base === 1e9) base = 0;
    return { visible, base, outdoor: floorSamples && outdoor >= indoor, floorSamples, len };
  }

  function bandColor(y, base, tint) {
    let k;
    if (y <= base) k = 0.52;
    else if (y <= base + 72) k = 0.52 + (y - base) / 72 * 0.4;
    else k = Math.min(1.1, 0.92 + (y - base - 72) / 500 * 0.18);
    return [k * tint[0], k * tint[1], k * tint[2]];
  }

  function emitSide(gb, f, y0, y1, base, S, tint) {
    const [ax, az] = f.a, [bx, bz] = f.b;
    const cuts = [y0];
    for (const c of [base, base + 72]) if (c > y0 + 1 && c < y1 - 1) cuts.push(c);
    cuts.push(y1);
    const [nx, , nz] = f.n;
    for (let i = 0; i < cuts.length - 1; i++) {
      const ya = cuts[i], yb = cuts[i + 1];
      const v = [[ax, ya, az], [bx, ya, bz], [bx, yb, bz], [ax, yb, az]];
      gb.quad(v, nx, 0, nz, v.map(p => worldUV(p[0], p[1], p[2], nx, 0, nz, S)), v.map(p => bandColor(p[1], base, tint)));
    }
  }
  function emitTop(gb, b, y, S, tint) {
    const v = [[b.x0, y, b.z0], [b.x0, y, b.z1], [b.x1, y, b.z1], [b.x1, y, b.z0]];
    gb.quad(v, 0, 1, 0, v.map(p => [p[0] / S, p[2] / S]), [tint, tint, tint, tint]);
  }
  function emitBottom(gb, b, y, S, tint) {
    const v = [[b.x0, y, b.z0], [b.x1, y, b.z0], [b.x1, y, b.z1], [b.x0, y, b.z1]];
    gb.quad(v, 0, -1, 0, v.map(p => [p[0] / S, p[2] / S]), [tint, tint, tint, tint]);
  }
  // Plain box with world-space UVs (for props and details)
  function emitBox(gb, x0, y0, z0, x1, y1, z1, S, tint, skipBottom = true) {
    const b = { x0, y0, z0, x1, y1, z1 };
    for (const f of sideFaces(b)) {
      const [ax, az] = f.a, [bx, bz] = f.b, [nx, , nz] = f.n;
      const v = [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]];
      gb.quad(v, nx, 0, nz, v.map(p => worldUV(p[0], p[1], p[2], nx, 0, nz, S)), [tint, tint, tint, tint]);
    }
    emitTop(gb, b, y1, S, tint);
    if (!skipBottom) emitBottom(gb, b, y0, S, tint);
  }
  // Box with 0..1 UVs per face (crates)
  function emitBoxUnit(gb, x0, y0, z0, x1, y1, z1, tint) {
    const b = { x0, y0, z0, x1, y1, z1 };
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const f of sideFaces(b)) {
      const [ax, az] = f.a, [bx, bz] = f.b, [nx, , nz] = f.n;
      gb.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], nx, 0, nz, uv, [tint, tint, tint, tint]);
    }
    gb.quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], 0, 1, 0, uv, [tint, tint, tint, tint]);
  }
  R.emitBox = emitBox; R.emitBoxUnit = emitBoxUnit;

  // ---------- scene ----------
  let renderer, scene, camera, vmScene, vmCam, sun, hemi, vmSun, vmHemi, vmAmb;
  R.quality = 'high';

  function init(canvas, quality) {
    R.quality = quality;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.autoClear = false;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = quality === 'high';

    scene = new THREE.Scene();
    scene.background = C('#9fc3e3');
    scene.fog = new THREE.Fog(C('#d9cdb5'), 2600, 16000);

    camera = new THREE.PerspectiveCamera(73.74, 16 / 9, 2, 30000);
    camera.rotation.order = 'YXZ';

    hemi = new THREE.HemisphereLight(C('#cfe2f5'), C('#8d7555'), 0.72);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(C('#fff0d4'), 2.3);
    const cxm = World.width / 2, czm = World.depth / 2;
    const dir = new THREE.Vector3(0.52, 0.78, 0.36).normalize();
    R.sunDir = dir;
    sun.position.set(cxm + dir.x * 4000, dir.y * 4000, czm + dir.z * 4000);
    sun.target.position.set(cxm, 0, czm);
    scene.add(sun); scene.add(sun.target);
    if (renderer.shadowMap.enabled) {
      sun.castShadow = true;
      const s = quality === 'high' ? 4096 : 2048;
      sun.shadow.mapSize.set(s, s);
      const sc = sun.shadow.camera;
      sc.left = -3100; sc.right = 3100; sc.top = 3100; sc.bottom = -3100; sc.near = 200; sc.far = 9000;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 1.2;
    }

    vmScene = new THREE.Scene();
    vmCam = new THREE.PerspectiveCamera(56, 16 / 9, 0.3, 600);
    vmHemi = new THREE.HemisphereLight(C('#d6e6f5'), C('#6d5a44'), 0.9);
    vmSun = new THREE.DirectionalLight(C('#fff0d4'), 1.6);
    vmSun.position.set(0.4, 1, 0.3);
    vmAmb = new THREE.AmbientLight(C('#ffffff'), 0.08);
    vmScene.add(vmHemi, vmSun, vmAmb);

    R.renderer = renderer; R.scene = scene; R.camera = camera; R.vmScene = vmScene; R.vmCam = vmCam; R.sun = sun;
    buildSky();
    buildWorld();
    buildSkyline();
    resize();
    window.addEventListener('resize', resize);
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
  }
  R.init = init;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    vmCam.aspect = w / h; vmCam.updateProjectionMatrix();
    if (R.onResize) R.onResize(w, h);
  }
  R.resize = resize;

  R.setIndoorLight = k => {
    // k: 0 outdoor .. 1 deep indoor
    vmSun.intensity = 1.6 * (1 - k * 0.85);
    vmHemi.intensity = 0.9 * (1 - k * 0.45);
  };

  R.render = (showVM) => {
    renderer.clear();
    renderer.render(scene, camera);
    if (showVM) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
  };
  R.setQuality = (q) => {
    if (q === R.quality) return;
    R.quality = q;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 1.5 : 1));
    const sh = q !== 'low';
    renderer.shadowMap.enabled = sh;
    renderer.shadowMap.autoUpdate = q === 'high';
    sun.castShadow = sh;
    if (sh) {
      const s = q === 'high' ? 4096 : 2048;
      const sc = sun.shadow.camera;
      sc.left = -3100; sc.right = 3100; sc.top = 3100; sc.bottom = -3100; sc.near = 200; sc.far = 9000; sc.updateProjectionMatrix();
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 1.2;
      if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    }
    scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    renderer.shadowMap.needsUpdate = true;
    resize();
  };
  R.refreshShadows = () => { if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true; };

  // ---------- sky ----------
  function buildSky() {
    const t = srgb(Tex.get('sky'));
    const g = new THREE.SphereGeometry(24000, 32, 16);
    const m = new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(g, m);
    sky.position.set(World.width / 2, 0, World.depth / 2);
    sky.renderOrder = -10;
    scene.add(sky);
    R.sky = sky;
    // sun glow
    const sm = new THREE.SpriteMaterial({ map: Tex.get('soft'), color: C('#fff6dc'), fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true });
    const sp = new THREE.Sprite(sm);
    sp.scale.set(2600, 2600, 1);
    sp.position.copy(sky.position).addScaledVector(R.sunDir, 20000);
    scene.add(sp);
    // clouds
    const cm = new THREE.SpriteMaterial({ map: Tex.get('smoke'), color: C('#ffffff'), fog: false, depthWrite: false, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 18; i++) {
      const c = new THREE.Sprite(cm);
      const a = rnd() * Math.PI * 2, r = 9000 + rnd() * 9000;
      c.position.set(World.width / 2 + Math.cos(a) * r, 5000 + rnd() * 3500, World.depth / 2 + Math.sin(a) * r);
      const s = 4000 + rnd() * 5000;
      c.scale.set(s * 1.8, s * 0.6, 1);
      scene.add(c);
    }
  }

  // ---------- world ----------
  const WALL_MATS = ['plaster', 'sandstone', 'plasterWhite'];
  function wallMatFor(b) {
    const cxm = (b.x0 + b.x1) / 2;
    const h = hash2(Math.floor(b.x0 / 64) + 7, Math.floor(b.z0 / 64) + 13);
    const tside = cxm / World.width; // 0 = CT (west) .. 1 = T (east)
    if (h < 0.25 + tside * 0.25) return 'sandstone';
    if (h < 0.62 + tside * 0.15) return 'plaster';
    return 'plasterWhite';
  }
  function tintFor(b, amt = 0.08) {
    const h = hash2(Math.floor(b.x0 / 32) + 3, Math.floor(b.z0 / 32) + 5);
    const k = 1 - amt + h * amt * 2;
    return [k, k * (0.98 + h * 0.03), k * (0.95 + h * 0.05)];
  }

  const decor = { window: [], pane: [], door: [], rug: [], awning: [] };
  function planeQuad(gb, cxp, cyp, czp, nx, nz, w, h) {
    // vertical plane facing (nx,nz), centred at (cxp,cyp,czp)
    const rx = nz, rz = -nx; // right vector when viewed from the front
    const hw = w / 2, hh = h / 2;
    const v = [
      [cxp - rx * hw, cyp - hh, czp - rz * hw], [cxp + rx * hw, cyp - hh, czp + rz * hw],
      [cxp + rx * hw, cyp + hh, czp + rz * hw], [cxp - rx * hw, cyp + hh, czp - rz * hw],
    ];
    gb.quad(v, nx, 0, nz, [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1, 1]);
  }

  const aoGB = { list: [] };
  function aoQuad(x0, z0, x1, z1, y00, y01, y11, y10, along) {
    // quad lying on the floor; v = 0 at the wall edge
    aoGB.list.push([x0, z0, x1, z1, y00, y01, y11, y10, along]);
  }
  // Soft contact shadow on the floor in front of a face.
  function aoAlongFace(f, fi, top, width) {
    const [ax, az] = f.a, [bx, bz] = f.b, [nx, , nz] = f.n;
    const len = fi.len, n = Math.max(1, Math.round(len / 32));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const pa = [ax + (bx - ax) * t0, az + (bz - az) * t0], pb = [ax + (bx - ax) * t1, az + (bz - az) * t1];
      const mx = (pa[0] + pb[0]) / 2 + nx * 4, mz = (pa[1] + pb[1]) / 2 + nz * 4;
      const o = World.cellAt(mx, mz);
      if (!o || o.kind !== 'floor') continue;
      const h = (x, z) => { const g = World.gridFloor(x, z); return g === null ? null : g; };
      const hA = h(pa[0] + nx * 1, pa[1] + nz * 1), hB = h(pb[0] + nx * 1, pb[1] + nz * 1);
      const hC = h(pb[0] + nx * width, pb[1] + nz * width), hD = h(pa[0] + nx * width, pa[1] + nz * width);
      if (hA === null || hB === null || hC === null || hD === null) continue;
      if (Math.max(hA, hB) >= top - 1) continue;
      aoGB.list.push([pa[0] + nx * 0.3, pa[1] + nz * 0.3, pb[0] + nx * 0.3, pb[1] + nz * 0.3, pb[0] + nx * width, pb[1] + nz * width, pa[0] + nx * width, pa[1] + nz * width, hA, hB, hC, hD]);
    }
  }

  function decorateFace(f, fi, top, gb) {
    const [ax, az] = f.a, [bx, bz] = f.b, [nx, , nz] = f.n;
    const len = fi.len;
    if (fi.floorSamples) aoAlongFace(f, fi, top, 44);
    if (!fi.outdoor || len < 96) return;
    const base = fi.base;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    const P = (t, out) => [ax + (bx - ax) * t + nx * out, az + (bz - az) * t + nz * out];
    const at3 = (t, out, y) => { const q = P(t, out); return [q[0], y, q[1]]; };
    const fbox = (g, S, t, w, y0, y1, o0, o1, tint) => {
      const c = P(t, 0);
      const xA = c[0] - tx * w / 2 + nx * o0, xB = c[0] + tx * w / 2 + nx * o1;
      const zA = c[1] - tz * w / 2 + nz * o0, zB = c[1] + tz * w / 2 + nz * o1;
      emitBox(g, Math.min(xA, xB), y0, Math.min(zA, zB), Math.max(xA, xB), y1, Math.max(zA, zB), S, tint);
    };
    const stone = [0.92, 0.9, 0.86];
    // plinth along the street
    fbox(gb('sandstone'), 128, 0.5, len, base - 6, base + 11, 0, 2.2, [0.8, 0.77, 0.72]);
    // windows with 3D frames, sills and shutters
    const W = 70, H = 100;
    if (top - base > 300) {
      const n = Math.floor(len / 170);
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.4) continue;
        const t = (i + 0.5) / n;
        const [px, pz] = P(t, 8);
        const o = World.cellAt(px, pz);
        if (!o || o.kind !== 'floor' || o.roofY) continue;
        const wy = base + 225 + (rnd() < 0.3 ? 20 : 0);
        if (wy + H / 2 + 14 > top - 18) continue;
        const du = u => t + u / len;
        decor.pane.push([...at3(t, 0.4, wy), nx, nz, W, H, Math.floor(rnd() * 2)]);
        fbox(gb('rail'), 64, du(-(W / 2 + 4)), 8, wy - H / 2, wy + H / 2, 0, 4, stone);
        fbox(gb('rail'), 64, du(W / 2 + 4), 8, wy - H / 2, wy + H / 2, 0, 4, stone);
        fbox(gb('rail'), 64, t, W + 18, wy + H / 2, wy + H / 2 + 10, 0, 5, stone);
        fbox(gb('rail'), 64, t, W + 22, wy - H / 2 - 7, wy - H / 2, 0, 9, stone);
        if (rnd() < 0.6) {
          // shutters folded back flat against the wall
          const col = rnd() < 0.5 ? [0.45, 0.72, 0.9] : [0.55, 0.8, 0.5];
          fbox(gb('wood'), 64, du(-(W / 2 + 8 + W / 4)), W / 2, wy - H / 2 + 2, wy + H / 2 - 2, 0.3, 2.6, col);
          fbox(gb('wood'), 64, du(W / 2 + 8 + W / 4), W / 2, wy - H / 2 + 2, wy + H / 2 - 2, 0.3, 2.6, col);
        }
      }
    }
    // wooden roof beams
    if (top - base > 280 && len >= 160 && rnd() < 0.32) {
      for (let u = 36; u < len - 30; u += 46) fbox(gb('wood'), 64, u / len, 7, top - 52, top - 44, 0, 16, [0.8, 0.72, 0.62]);
    }
    // balcony
    if (len >= 256 && top - base > 380 && rnd() < 0.16) {
      const t = 0.3 + rnd() * 0.4, by = base + 205;
      const [px, pz] = P(t, 8);
      const o = World.cellAt(px, pz);
      if (o && o.kind === 'floor' && !o.roofY) {
        fbox(gb('rail'), 64, t, 150, by, by + 9, 0, 36, stone);
        const wood = [0.7, 0.6, 0.5];
        fbox(gb('wood'), 64, t, 150, by + 38, by + 42, 32, 36, wood);
        for (let k = -70; k <= 70; k += 14) fbox(gb('wood'), 64, t + k / len, 2.5, by + 9, by + 38, 32.5, 35, wood);
        fbox(gb('wood'), 64, t - 73 / len, 3, by + 9, by + 42, 0, 36, wood);
        fbox(gb('wood'), 64, t + 73 / len, 3, by + 9, by + 42, 0, 36, wood);
        decor.door.push([...at3(t, 0.5, by + 62), nx, nz, 56, 104, Math.floor(rnd() * 2)]);
      }
    }
    // air conditioner
    if (top - base > 260 && len >= 128 && rnd() < 0.07) {
      const t = 0.2 + rnd() * 0.6;
      fbox(gb('metal'), 64, t, 34, base + 175, base + 199, 0, 18, [0.95, 0.95, 0.95]);
    }
    // closed doors with frames, rugs
    if (len >= 192 && rnd() < 0.35) {
      const t = 0.2 + rnd() * 0.6;
      const [px, pz] = P(t, 40);
      const o = World.cellAt(px, pz);
      if (o && o.kind === 'floor' && !o.roofY && Math.abs(World.regionHeight(o.ch, px, pz) - base) < 4) {
        decor.door.push([...at3(t, 0.5, base + 60), nx, nz, 60, 120, Math.floor(rnd() * 2)]);
        const du = u => t + u / len;
        fbox(gb('rail'), 64, du(-35), 8, base, base + 124, 0, 3.5, stone);
        fbox(gb('rail'), 64, du(35), 8, base, base + 124, 0, 3.5, stone);
        fbox(gb('rail'), 64, t, 78, base + 120, base + 130, 0, 4.5, stone);
        if (rnd() < 0.55) decor.awning.push([...at3(t, 0.6, base + 150), nx, nz, 116, Math.floor(rnd() * 2)]);
      }
    } else if (len >= 128 && rnd() < 0.18) {
      const t = 0.2 + rnd() * 0.6;
      const [px, pz] = P(t, 0.6);
      decor.rug.push([px, base + 110, pz, nx, nz, 56, 112, Math.floor(rnd() * 3)]);
    }
  }

  function buildWorld() {
    const gbs = {};
    const gb = n => gbs[n] || (gbs[n] = new GB());
    const LO = -130;
    for (const b of World.blocks) {
      if (b.kind === 'floor') {
        const M = b.mat;
        const S = MATDEF[M].S;
        const tint = tintFor(b, 0.05);
        if (b.ramp && b.stairs) emitStairs(gb(M), gb('sandstone'), b, S, tint);
        else if (b.ramp) emitRamp(gb(M), gb('sandstone'), b, S, tint);
        else {
          emitTop(gb(M), b, b.y1, S, tint);
          for (const f of sideFaces(b)) {
            const fi = faceInfo(f, b.y1);
            if (fi.visible) emitSide(gb('sandstone'), f, Math.max(LO, fi.base - 8), b.y1, fi.base, 256, tint);
          }
        }
      } else if (b.kind === 'wall' || b.kind === 'roof') {
        const M = wallMatFor(b), S = MATDEF[M].S, tint = tintFor(b);
        for (const f of sideFaces(b)) {
          const fi = faceInfo(f, b.y1);
          if (!fi.visible) continue;
          const y0 = b.kind === 'roof' ? b.y0 : Math.max(LO, fi.base - 8, b.y0);
          emitSide(gb(M), f, y0, b.y1, b.kind === 'roof' ? b.y0 - 200 : fi.base, S, tint);
          if (b.kind === 'wall') decorateFace(f, fi, b.y1, gb);
          // cornice along the roofline
          if (fi.outdoor && b.kind === 'wall') {
            const [ax, az] = f.a, [bx, bz] = f.b, [nx, , nz] = f.n;
            const x0 = Math.min(ax, bx) + (nx < 0 ? -5 : 0), x1 = Math.max(ax, bx) + (nx > 0 ? 5 : 0);
            const z0 = Math.min(az, bz) + (nz < 0 ? -5 : 0), z1 = Math.max(az, bz) + (nz > 0 ? 5 : 0);
            emitBox(gb('rail'), x0, b.y1 - 14, z0, x1, b.y1 + 2, z1, 128, [0.95, 0.93, 0.9]);
          }
        }
        emitTop(gb(M), b, b.y1, S, [0.8, 0.78, 0.74]);
        if (b.kind === 'roof') emitBottom(gb('plasterWhite'), b, b.y0, 320, [0.8, 0.78, 0.75]);
      } else if (b.kind === 'rail') {
        const tint = tintFor(b, 0.04);
        for (const f of sideFaces(b)) {
          const fi = faceInfo(f, b.y1);
          if (fi.visible) emitSide(gb('sandstone'), f, Math.max(LO, fi.base - 8), b.y1 - 6, fi.base, 256, tint);
        }
        emitBox(gb('rail'), b.x0 - 3, b.y1 - 6, b.z0 - 3, b.x1 + 3, b.y1 + 1, b.z1 + 3, 128, [1, 1, 1]);
      } else if (b.kind === 'prop') emitProp(gb, b);
    }
    buildDoorFrames(gb);
    const group = new THREE.Group();
    for (const n in gbs) {
      const mesh = new THREE.Mesh(gbs[n].build(), mat(n));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    scene.add(group);
    R.worldGroup = group;
    buildDecor();
  }

  // Stone frames around openings from outdoor streets into buildings.
  function buildDoorFrames(gb) {
    const I = World.info, H = World.H, W = World.W;
    const indoor = o => o && o.kind === 'floor' && o.roofY;
    const outdoor = o => o && o.kind === 'floor' && !o.roofY;
    const isWall = o => !o || o.kind === 'wall';
    const g = gb('rail');
    const tint = [0.93, 0.9, 0.85];
    // horizontal boundaries (between rows) and vertical boundaries (between columns)
    for (const dir of ['x', 'z']) {
      const spans = [];
      if (dir === 'x') {
        for (let c = 0; c < W - 1; c++) for (let r = 0; r < H; r++) {
          const a = I[r][c], b = I[r][c + 1];
          let side = 0;
          if (indoor(a) && outdoor(b)) side = 1; else if (outdoor(a) && indoor(b)) side = -1;
          if (!side) continue;
          const last = spans[spans.length - 1];
          if (last && last.line === c + 1 && last.side === side && last.end === r && last.roof === (side > 0 ? a : b).roofY) last.end = r + 1;
          else spans.push({ line: c + 1, side, start: r, end: r + 1, roof: (side > 0 ? a : b).roofY });
        }
      } else {
        for (let r = 0; r < H - 1; r++) for (let c = 0; c < W; c++) {
          const a = I[r][c], b = I[r + 1][c];
          let side = 0;
          if (indoor(a) && outdoor(b)) side = 1; else if (outdoor(a) && indoor(b)) side = -1;
          if (!side) continue;
          const last = spans[spans.length - 1];
          if (last && last.line === r + 1 && last.side === side && last.end === c && last.roof === (side > 0 ? a : b).roofY) last.end = c + 1;
          else spans.push({ line: r + 1, side, start: c, end: c + 1, roof: (side > 0 ? a : b).roofY });
        }
      }
      for (const sp of spans) {
        if (sp.end - sp.start > 4) continue;
        const L = sp.line * CELL, s0 = sp.start * CELL, s1 = sp.end * CELL;
        // floor height just outside the opening
        const mid = (s0 + s1) / 2;
        const ox = dir === 'x' ? L + sp.side * 16 : mid, oz = dir === 'x' ? mid : L + sp.side * 16;
        const fl = World.gridFloor(ox, oz);
        if (fl === null) continue;
        const top = sp.roof;
        const out0 = sp.side > 0 ? L : L - 5, out1 = sp.side > 0 ? L + 5 : L;
        const box = (a0, a1, y0, y1, o0 = out0, o1 = out1) => {
          if (dir === 'x') emitBox(g, o0, y0, a0, o1, y1, a1, 64, tint);
          else emitBox(g, a0, y0, o0, a1, y1, o1, 64, tint);
        };
        box(s0 - 10, s1 + 10, top - 6, top + 12);
        const cellBefore = dir === 'x' ? I[sp.start - 1] && I[sp.start - 1][sp.line - (sp.side > 0 ? 1 : 0)] : I[sp.line - (sp.side > 0 ? 1 : 0)] && I[sp.line - (sp.side > 0 ? 1 : 0)][sp.start - 1];
        const cellAfter = dir === 'x' ? I[sp.end] && I[sp.end][sp.line - (sp.side > 0 ? 1 : 0)] : I[sp.line - (sp.side > 0 ? 1 : 0)] && I[sp.line - (sp.side > 0 ? 1 : 0)][sp.end];
        if (isWall(cellBefore)) box(s0 - 9, s0, fl - 4, top);
        if (isWall(cellAfter)) box(s1, s1 + 9, fl - 4, top);
      }
    }
  }

  function emitRamp(gb, side, b, S, tint) {
    const { ramp } = b, LO = -130;
    const { x0, z0, x1, z1 } = b;
    let v;
    if (ramp.axis === 'x') v = [[x0, ramp.a, z0], [x0, ramp.a, z1], [x1, ramp.b, z1], [x1, ramp.b, z0]];
    else v = [[x0, ramp.a, z0], [x0, ramp.a, z1], [x1, ramp.a, z1], [x1, ramp.a, z0]].map((p, i) => [p[0], (i === 1 || i === 2) ? ramp.b : ramp.a, p[2]]);
    const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const L = Math.hypot(...n); n = n.map(q => q / L);
    gb.quad(v, n[0], n[1], n[2], v.map(p => [p[0] / S, p[2] / S]), [tint, tint, tint, tint]);
    // sides: draw as boxes cut by the slope using thin vertical strips
    const steps = 8;
    for (const f of sideFaces(b)) {
      const fi = faceInfo(f, Math.max(ramp.a, ramp.b));
      if (!fi.visible) continue;
      const [ax, az] = f.a, [bx, bz] = f.b, [nx, , nz] = f.n;
      for (let i = 0; i < steps; i++) {
        const ta = i / steps, tb = (i + 1) / steps;
        const pa = [ax + (bx - ax) * ta, az + (bz - az) * ta], pb = [ax + (bx - ax) * tb, az + (bz - az) * tb];
        const ha = World.topAt(b, pa[0], pa[1]), hb = World.topAt(b, pb[0], pb[1]);
        const q = [[pa[0], LO, pa[1]], [pb[0], LO, pb[1]], [pb[0], hb, pb[1]], [pa[0], ha, pa[1]]];
        side.quad(q, nx, 0, nz, q.map(p => worldUV(p[0], p[1], p[2], nx, 0, nz, 256)), q.map(p => bandColor(p[1], fi.base, tint)));
      }
    }
  }

  function emitStairs(gb, side, b, S, tint) {
    const { ramp } = b;
    const n = Math.max(2, Math.ceil(Math.abs(ramp.b - ramp.a) / 16));
    for (let i = 0; i < n; i++) {
      const h = ramp.a + (ramp.b - ramp.a) * (i + 0.5) / n;
      let x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
      if (ramp.axis === 'x') { x0 = b.x0 + (b.x1 - b.x0) * i / n; x1 = b.x0 + (b.x1 - b.x0) * (i + 1) / n; }
      else { z0 = b.z0 + (b.z1 - b.z0) * i / n; z1 = b.z0 + (b.z1 - b.z0) * (i + 1) / n; }
      const sb = { x0, z0, x1, z1 };
      emitTop(gb, sb, h, S, tint);
      for (const f of sideFaces(sb)) {
        const fi = faceInfo(f, h);
        // inner riser faces between steps: always draw the ones facing downhill
        const mx = (f.a[0] + f.b[0]) / 2 + f.n[0] * 2, mz = (f.a[1] + f.b[1]) / 2 + f.n[2] * 2;
        const inside = mx > b.x0 && mx < b.x1 && mz > b.z0 && mz < b.z1;
        if (inside) {
          const hn = World.topAt(b, mx, mz);
          if (hn < h) { const nb = ramp.a + (ramp.b - ramp.a) * ((ramp.axis === 'x' ? (mx - b.x0) / (b.x1 - b.x0) : (mz - b.z0) / (b.z1 - b.z0))); emitSide(side, f, Math.min(h, nb) - 16, h, h - 16, 128, [tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85]); }
          continue;
        }
        if (!fi.visible) continue;
        emitSide(side, f, Math.max(-130, fi.base - 8), h, fi.base, 256, tint);
      }
    }
  }

  function emitProp(gb, b) {
    const tint = tintFor(b, 0.1);
    if (b.mat !== 'palm' && !b.stack) for (const f of sideFaces(b)) { const fi = faceInfo(f, b.y1); fi.len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]); aoAlongFace(f, fi, b.y1, b.mat === 'van' || b.mat === 'car' ? 30 : 16); }
    const { x0, y0, z0, x1, y1, z1 } = b;
    switch (b.mat) {
      case 'crate': emitBoxUnit(gb('crate'), x0, y0, z0, x1, y1, z1, tint); break;
      case 'wood': {
        const g = gb('wood');
        const h = y1 - y0;
        emitBox(g, x0, y1 - Math.min(10, h * 0.4), z0, x1, y1, z1, 64, tint);
        const lw = 5;
        for (const [lx, lz] of [[x0, z0], [x1 - lw, z0], [x0, z1 - lw], [x1 - lw, z1 - lw]]) emitBox(g, lx, y0, lz, lx + lw, y1 - 4, lz + lw, 64, [tint[0] * 0.7, tint[1] * 0.7, tint[2] * 0.7]);
        if (h > 30) emitBox(g, x0 + 2, y0 + 8, z0 + 2, x1 - 2, y0 + 12, z1 - 2, 64, [0.6, 0.6, 0.6]);
        break;
      }
      case 'stone': emitBox(gb('sandstone'), x0, y0, z0, x1, y1, z1, 128, tint); emitBox(gb('rail'), x0 - 3, y1 - 6, z0 - 3, x1 + 3, y1 + 2, z1 + 3, 64, [1, 1, 1]); break;
      case 'plaster': emitBox(gb('plasterWhite'), x0, y0, z0, x1, y1, z1, 160, tint); break;
      case 'booth': {
        emitBox(gb('wood'), x0, y0, z0, x1, y0 + 56, z1, 64, tint);
        for (const [px, pz] of [[x0, z0], [x1 - 6, z0], [x0, z1 - 6], [x1 - 6, z1 - 6]]) emitBox(gb('wood'), px, y0 + 56, pz, px + 6, y1 - 8, pz + 6, 64, tint);
        emitBox(gb('metal'), x0 - 10, y1 - 8, z0 - 10, x1 + 10, y1, z1 + 10, 128, [0.55, 0.62, 0.7]);
        emitBox(gb('rail'), x0 - 2, y0 + 56, z0 - 2, x1 + 2, y0 + 60, z1 + 2, 64, [1, 1, 1]);
        break;
      }
      case 'van': case 'car': buildVehicle(b); break;
      case 'palm': buildPalm(b); break;
      default: emitBox(gb('concrete'), x0, y0, z0, x1, y1, z1, 128, tint);
    }
  }

  function buildVehicle(b) {
    const g = new THREE.Group();
    const w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.y1 - b.y0;
    const long = d > w;
    const L = long ? d : w, Wd = long ? w : d;
    const van = b.mat === 'van';
    const body = new THREE.MeshPhongMaterial({ color: C(van ? (b.x0 < 1000 && b.z0 < 1000 ? '#dcdcd4' : '#5d7da0') : '#9a3b2a'), shininess: 60, specular: C('#444444') });
    const glass = new THREE.MeshPhongMaterial({ color: C('#1d2833'), shininess: 90, specular: C('#888888') });
    const tire = new THREE.MeshLambertMaterial({ color: C('#1a1a1a') });
    const chrome = new THREE.MeshPhongMaterial({ color: C('#c9c9c9'), shininess: 80 });
    const add = (geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; g.add(me); return me; };
    const clear = 14;
    if (van) {
      add(new THREE.BoxGeometry(Wd, h - clear - 4, L), body, 0, clear + (h - clear - 4) / 2, 0);
      add(new THREE.BoxGeometry(Wd + 1, 26, L * 0.22), glass, 0, h - 30, L / 2 - L * 0.13);
      add(new THREE.BoxGeometry(Wd + 1, 22, L * 0.5), glass, 0, h - 28, -L * 0.12);
      add(new THREE.BoxGeometry(Wd - 10, 1, L * 0.2), glass, 0, h - 23, L / 2 + 0.2);
    } else {
      add(new THREE.BoxGeometry(Wd, h * 0.45, L), body, 0, clear + h * 0.22, 0);
      add(new THREE.BoxGeometry(Wd * 0.92, h * 0.4, L * 0.5), body, 0, clear + h * 0.45 + h * 0.2 - 4, -L * 0.05);
      add(new THREE.BoxGeometry(Wd * 0.93, h * 0.28, L * 0.46), glass, 0, clear + h * 0.45 + h * 0.18 - 4, -L * 0.05);
    }
    const wheel = new THREE.CylinderGeometry(15, 15, 10, 16);
    wheel.rotateZ(Math.PI / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(wheel, tire, sx * (Wd / 2 - 4), 15, sz * (L / 2 - 30));
    add(new THREE.BoxGeometry(Wd, 8, 4), chrome, 0, clear + 8, L / 2);
    add(new THREE.BoxGeometry(Wd, 8, 4), chrome, 0, clear + 8, -L / 2);
    MeshUtil.merge(g, { deep: true });
    g.position.set((b.x0 + b.x1) / 2, b.y0 + 4, (b.z0 + b.z1) / 2);
    if (!long) g.rotation.y = Math.PI / 2;
    scene.add(g);
  }

  function buildPalm(b) {
    const g = new THREE.Group();
    const h = b.y1 - b.y0;
    const bark = mat('bark');
    const segs = 6;
    let px = 0, pz = 0, py = 0;
    const lean = rnd() * Math.PI * 2;
    for (let i = 0; i < segs; i++) {
      const sh = h / segs, r0 = 11 - i * 0.9, r1 = 11 - (i + 1) * 0.9;
      const geo = new THREE.CylinderGeometry(r1, r0, sh, 8);
      const cols = []; for (let k = 0; k < geo.attributes.position.count; k++) cols.push(1, 1, 1);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const m = new THREE.Mesh(geo, bark);
      const off = (i * i) * 0.9;
      m.position.set(Math.cos(lean) * off, py + sh / 2, Math.sin(lean) * off);
      m.castShadow = true;
      g.add(m);
      py += sh; px = Math.cos(lean) * off; pz = Math.sin(lean) * off;
    }
    const fm = new THREE.MeshLambertMaterial({ map: srgb(Tex.get('frond')), side: THREE.DoubleSide, alphaTest: 0.4, transparent: false });
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * Math.PI * 2 + rnd() * 0.3;
      const geo = new THREE.PlaneGeometry(56, 170, 1, 4);
      // droop
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) { const yy = pos.getY(k) + 85; pos.setZ(k, -Math.pow(yy / 170, 2) * 70); }
      geo.translate(0, 85, 0);
      geo.rotateX(-Math.PI / 2 + 0.35 + rnd() * 0.3);
      const m = new THREE.Mesh(geo, fm);
      m.position.set(px, py, pz);
      m.rotation.y = a;
      m.castShadow = true;
      g.add(m);
    }
    MeshUtil.merge(g, { deep: true });
    g.position.set((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2);
    scene.add(g);
  }

  function buildDecor() {
    // contact shadows
    if (aoGB.list.length) {
      const g = new GB();
      for (const q of aoGB.list) {
        const [x0, z0, x1, z1, x2, z2, x3, z3, h0, h1, h2, h3] = q;
        g.quad([[x0, h0 + 0.35, z0], [x1, h1 + 0.35, z1], [x2, h2 + 0.35, z2], [x3, h3 + 0.35, z3]], 0, 1, 0, [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1, 1]);
      }
      const m = new THREE.MeshBasicMaterial({ map: Tex.get('ao'), color: 0x000000, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(g.build(), m);
      mesh.renderOrder = 1;
      scene.add(mesh);
    }
    const kinds = [['window', 'window', 2], ['pane', 'pane', 2], ['door', 'door', 2], ['rug', 'rug', 3]];
    for (const [key, tex, nv] of kinds) {
      for (let v = 0; v < nv; v++) {
        const list = decor[key].filter(d => d[7] === v);
        if (!list.length) continue;
        const gb = new GB();
        for (const d of list) planeQuad(gb, d[0], d[1], d[2], d[3], d[4], d[5], d[6]);
        const m = new THREE.MeshLambertMaterial({ map: srgb(Tex.variant(tex, v)), transparent: key === 'window', alphaTest: key === 'window' ? 0.5 : 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true });
        const mesh = new THREE.Mesh(gb.build(), m);
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }
    // awnings: sloped cloth over doors
    for (let v = 0; v < 2; v++) {
      const list = decor.awning.filter(d => d[6] === v);
      if (!list.length) continue;
      const gb = new GB();
      for (const [px, py, pz, nx, nz, w] of list) {
        const rx = -nz, rz = nx, hw = w / 2, out = 44;
        const q = [[px - rx * hw, py, pz - rz * hw], [px + rx * hw, py, pz + rz * hw], [px + rx * hw + nx * out, py - 22, pz + rz * hw + nz * out], [px - rx * hw + nx * out, py - 22, pz - rz * hw + nz * out]];
        gb.quad(q, nx * 0.45, 0.9, nz * 0.45, [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1, 1]);
      }
      const m = new THREE.MeshLambertMaterial({ map: srgb(Tex.variant('awning', v)), side: THREE.DoubleSide, vertexColors: true });
      const mesh = new THREE.Mesh(gb.build(), m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // Distant buildings, domes and a minaret beyond the playable walls.
  function buildSkyline() {
    const gbs = {};
    const gb = n => gbs[n] || (gbs[n] = new GB());
    const Wd = World.width, D = World.depth;
    const ring = [];
    for (let x = -1400; x < Wd + 1400; x += 260 + rnd() * 200) { ring.push([x, -300 - rnd() * 900]); ring.push([x, D + 300 + rnd() * 900]); }
    for (let z = -1000; z < D + 1000; z += 260 + rnd() * 200) { ring.push([-300 - rnd() * 900, z]); ring.push([Wd + 300 + rnd() * 900, z]); }
    for (const [x, z] of ring) {
      const w = 200 + rnd() * 260, d = 200 + rnd() * 260, h = 420 + rnd() * 420;
      const M = rnd() < 0.4 ? 'sandstone' : rnd() < 0.5 ? 'plaster' : 'plasterWhite';
      const k = 0.85 + rnd() * 0.2;
      emitBox(gb(M), x - w / 2, -100, z - d / 2, x + w / 2, h, z + d / 2, MATDEF[M].S, [k, k, k]);
      emitBox(gb('rail'), x - w / 2 - 5, h - 14, z - d / 2 - 5, x + w / 2 + 5, h + 2, z + d / 2 + 5, 128, [0.95, 0.95, 0.95]);
    }
    for (const n in gbs) { const m = new THREE.Mesh(gbs[n].build(), mat(n)); m.receiveShadow = true; scene.add(m); }
    const domeMat = new THREE.MeshPhongMaterial({ color: C('#3f8a8f'), shininess: 40, specular: C('#335555') });
    const domeSand = new THREE.MeshPhongMaterial({ color: C('#d9c49a'), shininess: 10 });
    const domes = [[-900, 1600, 380, domeMat], [Wd + 900, 900, 300, domeSand], [1800, -1000, 340, domeMat], [2600, D + 900, 280, domeSand], [Wd + 700, D - 400, 260, domeMat]];
    for (const [x, z, r, m] of domes) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 520, 24), mat('plasterWhite'));
      base.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(base.geometry.attributes.position.count * 3).fill(0.95), 3));
      base.position.set(x, 260, z); scene.add(base);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
      dome.position.set(x, 520, z); scene.add(dome);
    }
    // minaret
    const mx = -700, mz = 400;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(70, 80, 1500, 12), domeSand);
    tower.position.set(mx, 750, mz); scene.add(tower);
    const balcony = new THREE.Mesh(new THREE.CylinderGeometry(110, 90, 40, 12), domeSand);
    balcony.position.set(mx, 1300, mz); scene.add(balcony);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(75, 220, 12), domeMat);
    cap.position.set(mx, 1610, mz); scene.add(cap);
  }

  return R;
})();
