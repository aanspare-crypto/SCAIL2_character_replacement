'use strict';
// Collision world, ray casting and navigation. No rendering here, so it also runs under Node for tests.
if (typeof module !== 'undefined' && typeof LEGEND === 'undefined') Object.assign(globalThis, require('./map.js'));

const STEP_HEIGHT = 18;
const HASH = 128;
const NAV = 32;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hash2(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

const World = (() => {
  const W = MAP_W, H = MAP_H;
  const grid = buildGrid();
  const regions = {};
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = grid[r][c];
    if (!LEGEND[ch]) continue;
    const R = regions[ch] || (regions[ch] = { c0: c, r0: r, c1: c, r1: r });
    R.c0 = Math.min(R.c0, c); R.r0 = Math.min(R.r0, r); R.c1 = Math.max(R.c1, c); R.r1 = Math.max(R.r1, r);
  }

  function regionHeight(ch, x, z) {
    const L = LEGEND[ch];
    if (!L.ramp) return L.h;
    const R = regions[ch], [ax, a, b] = L.ramp;
    if (ax === 'x') { const x0 = R.c0 * CELL, x1 = (R.c1 + 1) * CELL; return a + (b - a) * clamp((x - x0) / (x1 - x0), 0, 1); }
    const z0 = R.r0 * CELL, z1 = (R.r1 + 1) * CELL; return a + (b - a) * clamp((z - z0) / (z1 - z0), 0, 1);
  }

  // Per-cell info
  const info = [];
  for (let r = 0; r < H; r++) {
    const row = [];
    for (let c = 0; c < W; c++) {
      const ch = grid[r][c], L = LEGEND[ch];
      const o = { ch, kind: L ? 'floor' : ch === '=' ? 'rail' : ch === '%' ? 'window' : 'wall', fh: 0, roofY: L && L.roofY || 0, top: 0, leg: L || null };
      if (L) o.fh = regionHeight(ch, cx(c), cz(r));
      row.push(o);
    }
    info.push(row);
  }
  const at = (r, c) => (r >= 0 && r < H && c >= 0 && c < W) ? info[r][c] : null;
  // Rails and windows sit on the higher neighbouring floor.
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const o = info[r][c];
    if (o.kind !== 'rail' && o.kind !== 'window') continue;
    let m = -1e9;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = at(r + dr, c + dc); if (n && n.kind === 'floor') m = Math.max(m, n.fh); }
    o.fh = m > -1e9 ? m : 0;
  }
  // Building tops: follow the floors nearby so rooflines step with the terrain.
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const o = info[r][c];
    let m = 0;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const n = at(r + dr, c + dc);
      if (!n) continue;
      if (n.kind === 'floor') {
        const L = n.leg, hi = L.ramp ? Math.max(L.ramp[1], L.ramp[2]) : L.h;
        m = Math.max(m, n.roofY ? n.roofY + 64 : hi + 288);
      } else if (n.kind !== 'wall') m = Math.max(m, n.fh + 288);
    }
    if (m === 0) m = 384;
    m += Math.floor(hash2(Math.floor(c / 5), Math.floor(r / 4)) * 4) * 32;
    o.top = Math.ceil(m / 32) * 32;
  }

  // ---------- blocks ----------
  const blocks = [];
  function addBlock(b) { b.id = blocks.length; if (b.pen === undefined) b.pen = 0; blocks.push(b); return b; }

  function greedy(keyAt) {
    const used = new Uint8Array(W * H), rects = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const k = keyAt(r, c);
      if (!k || used[r * W + c]) continue;
      let w = 1; while (c + w < W && !used[r * W + c + w] && keyAt(r, c + w) === k) w++;
      let h = 1;
      outer: while (r + h < H) { for (let i = 0; i < w; i++) if (used[(r + h) * W + c + i] || keyAt(r + h, c + i) !== k) break outer; h++; }
      for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) used[rr * W + cc] = 1;
      rects.push({ c0: c, r0: r, c1: c + w - 1, r1: r + h - 1, key: k });
    }
    return rects;
  }
  const rectBox = (R, y0, y1, extra) => Object.assign({ x0: R.c0 * CELL, z0: R.r0 * CELL, x1: (R.c1 + 1) * CELL, z1: (R.r1 + 1) * CELL, y0, y1 }, extra);

  // flat floors
  for (const R of greedy((r, c) => { const o = info[r][c]; return o.kind === 'floor' && !o.leg.ramp ? 'f|' + o.fh + '|' + o.leg.mat : null; })) {
    const [, fh, mat] = R.key.split('|');
    addBlock(rectBox(R, FLOOR_BOTTOM, +fh, { kind: 'floor', mat }));
  }
  // ramps and stairs, one block per region
  for (const ch in regions) {
    const L = LEGEND[ch];
    if (!L.ramp) continue;
    const R = regions[ch], [ax, a, b] = L.ramp;
    addBlock(rectBox(R, FLOOR_BOTTOM, Math.max(a, b), { kind: 'floor', mat: L.mat, ramp: { axis: ax, a, b }, stairs: !!L.stairs }));
  }
  // walls
  for (const R of greedy((r, c) => info[r][c].kind === 'wall' ? 'w|' + info[r][c].top : null)) {
    addBlock(rectBox(R, FLOOR_BOTTOM, +R.key.split('|')[1], { kind: 'wall', mat: 'wall', pen: 0.15 }));
  }
  // rails
  for (const R of greedy((r, c) => info[r][c].kind === 'rail' ? 'r|' + info[r][c].fh : null)) {
    const fh = +R.key.split('|')[1];
    addBlock(rectBox(R, FLOOR_BOTTOM, fh + 40, { kind: 'rail', mat: 'rail', pen: 0.3 }));
  }
  // window walls: sill and lintel
  for (const R of greedy((r, c) => info[r][c].kind === 'window' ? 'k|' + info[r][c].fh + '|' + info[r][c].top : null)) {
    const [, fh, top] = R.key.split('|').map(Number);
    addBlock(rectBox(R, FLOOR_BOTTOM, fh + 48, { kind: 'rail', mat: 'sill', pen: 0.3 }));
    addBlock(rectBox(R, fh + 128, top, { kind: 'wall', mat: 'wall', pen: 0.15 }));
  }
  // roofs over indoor cells
  for (const R of greedy((r, c) => { const o = info[r][c]; return o.kind === 'floor' && o.roofY ? 'c|' + o.roofY + '|' + o.top : null; })) {
    const [, ry, top] = R.key.split('|').map(Number);
    addBlock(rectBox(R, ry, Math.max(top, ry + 32), { kind: 'roof', mat: 'wall', pen: 0.15 }));
  }

  // ---------- spatial hash ----------
  const HW = Math.ceil(W * CELL / HASH), HH = Math.ceil(H * CELL / HASH);
  const hash = [];
  for (let i = 0; i < HW * HH; i++) hash.push([]);
  let stampArr = new Uint32Array(4096), stamp = 1;
  function insert(b) {
    const i0 = clamp(Math.floor(b.x0 / HASH), 0, HW - 1), i1 = clamp(Math.floor((b.x1 - 0.01) / HASH), 0, HW - 1);
    const j0 = clamp(Math.floor(b.z0 / HASH), 0, HH - 1), j1 = clamp(Math.floor((b.z1 - 0.01) / HASH), 0, HH - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) hash[j * HW + i].push(b);
    if (b.id >= stampArr.length) { const n = new Uint32Array(stampArr.length * 2); n.set(stampArr); stampArr = n; }
  }
  blocks.forEach(insert);

  // floor height from the painted grid (ignores props)
  function gridFloor(x, z) {
    const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
    const o = at(r, c);
    if (!o || o.kind !== 'floor') return null;
    return regionHeight(o.ch, x, z);
  }
  function cellAt(x, z) { return at(Math.floor(z / CELL), Math.floor(x / CELL)); }

  // props
  const props = [];
  for (const p of PROPS) {
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
    let base = 1e9;
    for (const [sx, sz] of [[x0 + 2, z0 + 2], [x1 - 2, z0 + 2], [x0 + 2, z1 - 2], [x1 - 2, z1 - 2], [p.x, p.z]]) {
      const f = gridFloor(sx, sz); if (f !== null) base = Math.min(base, f);
    }
    if (base === 1e9) base = 0;
    base += p.stack || 0;
    const pen = { crate: 2, wood: 2, booth: 1.2, van: 0.8, car: 0.8, plaster: 0.6, stone: 0.12, palm: 0.5 }[p.mat] || 0.2;
    const b = addBlock({ x0, x1, z0, z1, y0: p.stack ? base : base - 4, y1: base + p.h, kind: 'prop', mat: p.mat, pen, name: p.n });
    insert(b);
    props.push(b);
  }

  function query(x0, z0, x1, z1, out) {
    stamp++;
    if (stamp > 4e9) { stampArr.fill(0); stamp = 1; }
    out.length = 0;
    const i0 = clamp(Math.floor(x0 / HASH), 0, HW - 1), i1 = clamp(Math.floor(x1 / HASH), 0, HW - 1);
    const j0 = clamp(Math.floor(z0 / HASH), 0, HH - 1), j1 = clamp(Math.floor(z1 / HASH), 0, HH - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const list = hash[j * HW + i];
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        if (stampArr[b.id] === stamp) continue;
        stampArr[b.id] = stamp;
        if (b.x1 > x0 && b.x0 < x1 && b.z1 > z0 && b.z0 < z1) out.push(b);
      }
    }
    return out;
  }

  // Highest point of a block over an xz footprint.
  function topOver(b, x0, z0, x1, z1) {
    const R = b.ramp;
    if (!R) return b.y1;
    if (R.axis === 'x') { const k = (R.b - R.a) / (b.x1 - b.x0); const xs = k >= 0 ? Math.min(x1, b.x1) : Math.max(x0, b.x0); return R.a + k * (xs - b.x0); }
    const k = (R.b - R.a) / (b.z1 - b.z0); const zs = k >= 0 ? Math.min(z1, b.z1) : Math.max(z0, b.z0); return R.a + k * (zs - b.z0);
  }
  function topAt(b, x, z) {
    const R = b.ramp;
    if (!R) return b.y1;
    if (R.axis === 'x') return R.a + (R.b - R.a) * clamp((x - b.x0) / (b.x1 - b.x0), 0, 1);
    return R.a + (R.b - R.a) * clamp((z - b.z0) / (b.z1 - b.z0), 0, 1);
  }

  const tmp = [], tmp2 = [];
  // Highest surface under the footprint that is not above fromY (+ tolerance).
  function groundBelow(x, z, hw, fromY) {
    let g = -1e9;
    query(x - hw, z - hw, x + hw, z + hw, tmp);
    for (const b of tmp) {
      const t = topOver(b, x - hw, z - hw, x + hw, z + hw);
      if (t <= fromY + 0.5 && t > g) g = t;
    }
    return g;
  }
  // Does a box collide with any block? ignore: blocks overlapping at the start position.
  function boxBlocked(x0, y0, z0, x1, y1, z1) {
    query(x0, z0, x1, z1, tmp2);
    for (const b of tmp2) {
      if (b.y0 >= y1) continue;
      if (topOver(b, x0, z0, x1, z1) <= y0) continue;
      return b;
    }
    return null;
  }

  // Move a body (x,y,z feet, hw half-width, height) with velocity for dt. Handles steps, ramps, ceilings.
  const near = [];
  function moveAxis(e, axis, delta) {
    if (delta === 0) return false;
    const hw = e.hw;
    const nx = axis === 0 ? e.x + delta : e.x, nz = axis === 2 ? e.z + delta : e.z;
    const feet = e.y, head = e.y + e.height;
    const stepLimit = e.onGround ? STEP_HEIGHT : 2;
    query(Math.min(e.x, nx) - hw, Math.min(e.z, nz) - hw, Math.max(e.x, nx) + hw, Math.max(e.z, nz) + hw, near);
    let stepTo = feet;
    for (const b of near) {
      if (!(b.x1 > nx - hw && b.x0 < nx + hw && b.z1 > nz - hw && b.z0 < nz + hw)) continue;
      if (b.y0 >= head - 0.01) continue;
      const top = topOver(b, nx - hw, nz - hw, nx + hw, nz + hw);
      if (top <= feet + 0.01) continue;
      // Already overlapping this block before the move: let the body walk out of it.
      if (b.x1 > e.x - hw && b.x0 < e.x + hw && b.z1 > e.z - hw && b.z0 < e.z + hw && !b.ramp) {
        const oldTop = b.y1;
        if (oldTop > feet + 0.01 && b.y0 < head - 0.01) continue;
      }
      if (top <= feet + stepLimit && b.y0 <= feet + 0.01) { if (top > stepTo) stepTo = top; continue; }
      return true;
    }
    if (stepTo > feet) {
      if (boxBlocked(nx - hw, stepTo + 0.01, nz - hw, nx + hw, stepTo + e.height, nz + hw)) return true;
      e.y = stepTo;
      e.stepped = (e.stepped || 0) + (stepTo - feet);
    }
    if (axis === 0) e.x = nx; else e.z = nz;
    return false;
  }

  function moveBody(e, dt, gravity) {
    const dist = Math.hypot(e.vx, e.vz) * dt;
    const n = Math.max(1, Math.ceil(dist / 6));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
      if (moveAxis(e, 0, e.vx * sdt)) { e.hitWall = true; e.vx = 0; }
      if (moveAxis(e, 2, e.vz * sdt)) { e.hitWall = true; e.vz = 0; }
    }
    const wasOnGround = e.onGround;
    if (!e.onGround || e.vy > 0) e.vy -= gravity * dt;
    let ny = e.y + e.vy * dt;
    const hw = e.hw;
    if (e.vy > 0) {
      query(e.x - hw, e.z - hw, e.x + hw, e.z + hw, near);
      for (const b of near) {
        if (b.y0 >= e.y + e.height - 0.5 && b.y0 < ny + e.height) { ny = b.y0 - e.height; e.vy = 0; }
      }
    }
    const g = groundBelow(e.x, e.z, hw, Math.max(e.y, ny) + (e.vy <= 0 ? 0 : 0));
    e.landSpeed = 0;
    if (ny <= g) {
      if (!wasOnGround) e.landSpeed = -e.vy;
      ny = g; e.vy = 0; e.onGround = true;
    } else if (wasOnGround && e.vy <= 0 && e.y - g <= STEP_HEIGHT + 0.5) {
      ny = g; e.vy = 0; e.onGround = true;
    } else e.onGround = false;
    e.y = ny;
  }

  // ---------- ray casting ----------
  const hit = { t: 0, tExit: 0, nx: 0, ny: 0, nz: 0, block: null };
  function intersectBlock(b, ox, oy, oz, dx, dy, dz, out) {
    let tE = -1e9, tX = 1e9, nx = 0, ny = 0, nz = 0;
    // x slab
    if (Math.abs(dx) < 1e-9) { if (ox <= b.x0 || ox >= b.x1) return false; }
    else {
      let t1 = (b.x0 - ox) / dx, t2 = (b.x1 - ox) / dx, s = -1;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
      if (t1 > tE) { tE = t1; nx = s; ny = 0; nz = 0; }
      if (t2 < tX) tX = t2;
    }
    if (Math.abs(dz) < 1e-9) { if (oz <= b.z0 || oz >= b.z1) return false; }
    else {
      let t1 = (b.z0 - oz) / dz, t2 = (b.z1 - oz) / dz, s = -1;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
      if (t1 > tE) { tE = t1; nx = 0; ny = 0; nz = s; }
      if (t2 < tX) tX = t2;
    }
    if (Math.abs(dy) < 1e-9) { if (oy <= b.y0 || oy >= b.y1) return false; }
    else {
      let t1 = (b.y0 - oy) / dy, t2 = (b.y1 - oy) / dy, s = -1;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
      if (t1 > tE) { tE = t1; nx = 0; ny = s; nz = 0; }
      if (t2 < tX) tX = t2;
    }
    if (b.ramp) {
      const R = b.ramp;
      let k, c, fo, fd, pnx, pnz;
      if (R.axis === 'x') { k = (R.b - R.a) / (b.x1 - b.x0); c = R.a - k * b.x0; fo = oy - k * ox - c; fd = dy - k * dx; pnx = -k; pnz = 0; }
      else { k = (R.b - R.a) / (b.z1 - b.z0); c = R.a - k * b.z0; fo = oy - k * oz - c; fd = dy - k * dz; pnx = 0; pnz = -k; }
      if (Math.abs(fd) < 1e-12) { if (fo > 0) return false; }
      else {
        const ts = -fo / fd;
        if (fd > 0) { if (ts < tX) tX = ts; }
        else if (ts > tE) { tE = ts; const L = Math.hypot(pnx, 1, pnz); nx = pnx / L; ny = 1 / L; nz = pnz / L; }
      }
    }
    if (tE > tX || tX < 0) return false;
    out.t = tE; out.tExit = tX; out.nx = nx; out.ny = ny; out.nz = nz; out.block = b;
    return true;
  }

  const ih = { t: 0, tExit: 0, nx: 0, ny: 0, nz: 0, block: null };
  // Returns the nearest block hit along the ray within maxT or null. skip(b) can ignore blocks.
  function raycast(ox, oy, oz, dx, dy, dz, maxT, skip) {
    stamp++;
    let best = null;
    let ci = Math.floor(ox / HASH), cj = Math.floor(oz / HASH);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    let tmx = Math.abs(dx) > 1e-9 ? ((ci + (dx > 0 ? 1 : 0)) * HASH - ox) / dx : 1e9;
    let tmz = Math.abs(dz) > 1e-9 ? ((cj + (dz > 0 ? 1 : 0)) * HASH - oz) / dz : 1e9;
    const tdx = Math.abs(dx) > 1e-9 ? HASH / Math.abs(dx) : 1e9, tdz = Math.abs(dz) > 1e-9 ? HASH / Math.abs(dz) : 1e9;
    for (let guard = 0; guard < 400; guard++) {
      if (ci >= 0 && ci < HW && cj >= 0 && cj < HH) {
        const list = hash[cj * HW + ci];
        for (let k = 0; k < list.length; k++) {
          const b = list[k];
          if (stampArr[b.id] === stamp) continue;
          stampArr[b.id] = stamp;
          if (skip && skip(b)) continue;
          if (!intersectBlock(b, ox, oy, oz, dx, dy, dz, ih)) continue;
          if (ih.t < 0 || ih.t > maxT) continue;
          if (!best || ih.t < hit.t) { best = b; hit.t = ih.t; hit.tExit = ih.tExit; hit.nx = ih.nx; hit.ny = ih.ny; hit.nz = ih.nz; hit.block = b; }
        }
      }
      const tn = Math.min(tmx, tmz);
      if (best && hit.t <= tn) break;
      if (tn > maxT) break;
      if (tmx < tmz) { ci += si; tmx += tdx; if (ci < -1 || ci > HW) break; }
      else { cj += sj; tmz += tdz; if (cj < -1 || cj > HH) break; }
    }
    return best ? hit : null;
  }
  function losClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 1) return true;
    return !raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 1);
  }

  // ---------- navigation grid ----------
  const NW = Math.ceil(W * CELL / NAV), NH = Math.ceil(H * CELL / NAV);
  const navH = new Float32Array(NW * NH);
  const navOk = new Uint8Array(NW * NH);
  const navPenalty = new Float32Array(NW * NH);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const x = (i + 0.5) * NAV, z = (j + 0.5) * NAV;
    const f = gridFloor(x, z);
    if (f === null) continue;
    navH[j * NW + i] = f;
    if (boxBlocked(x - 15, f + STEP_HEIGHT + 1, z - 15, x + 15, f + 72, z + 15)) continue;
    navOk[j * NW + i] = 1;
  }
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    if (!navOk[j * NW + i]) continue;
    let p = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NW || jj >= NH || !navOk[jj * NW + ii]) p++;
    }
    navPenalty[j * NW + i] = p * 5;
  }
  // Path points are nudged away from blocked neighbours so bodies clear door frames.
  const navOX = new Float32Array(NW * NH), navOZ = new Float32Array(NW * NH);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const k = j * NW + i;
    if (!navOk[k]) continue;
    const ok = (ii, jj) => ii >= 0 && jj >= 0 && ii < NW && jj < NH && navOk[jj * NW + ii];
    navOX[k] = (ok(i - 1, j) ? 0 : 10) - (ok(i + 1, j) ? 0 : 10);
    navOZ[k] = (ok(i, j - 1) ? 0 : 10) - (ok(i, j + 1) ? 0 : 10);
  }
  const navPoint = k => ({ x: (k % NW + 0.5) * NAV + navOX[k], z: ((k / NW | 0) + 0.5) * NAV + navOZ[k], y: navH[k] });
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function canStep(a, b) {
    const d = navH[b] - navH[a];
    return d <= 21 && d >= -220;
  }
  function navIndex(x, z) { const i = Math.floor(x / NAV), j = Math.floor(z / NAV); if (i < 0 || j < 0 || i >= NW || j >= NH) return -1; return j * NW + i; }
  function nearestNav(x, z, y) {
    const i0 = Math.floor(x / NAV), j0 = Math.floor(z / NAV);
    let best = -1, bd = 1e9;
    for (let r = 0; r <= 6; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= NW || j >= NH) continue;
        const k = j * NW + i;
        if (!navOk[k]) continue;
        const px = (i + 0.5) * NAV, pz = (j + 0.5) * NAV;
        const d = Math.hypot(px - x, pz - z) + (y !== undefined ? Math.abs(navH[k] - y) * 2 : 0);
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }
  // binary heap A*
  const gScore = new Float32Array(NW * NH), parent = new Int32Array(NW * NH), seen = new Uint32Array(NW * NH), closed = new Uint32Array(NW * NH);
  let searchId = 0;
  const heap = [], heapF = [];
  function hpush(n, f) {
    heap.push(n); heapF.push(f);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= heapF[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [heapF[p], heapF[i]] = [heapF[i], heapF[p]]; i = p; }
  }
  function hpop() {
    const top = heap[0], ln = heap.pop(), lf = heapF.pop();
    if (heap.length) {
      heap[0] = ln; heapF[0] = lf;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heapF[l] < heapF[m]) m = l;
        if (r < heap.length && heapF[r] < heapF[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; [heapF[m], heapF[i]] = [heapF[i], heapF[m]]; i = m;
      }
    }
    return top;
  }
  function astar(s, t, costFn) {
    searchId++;
    heap.length = 0; heapF.length = 0;
    const tx = t % NW, tz = (t / NW) | 0;
    gScore[s] = 0; parent[s] = -1; seen[s] = searchId;
    hpush(s, 0);
    let iter = 0;
    while (heap.length) {
      const n = hpop();
      if (closed[n] === searchId) continue;
      closed[n] = searchId;
      if (n === t) break;
      if (++iter > 40000) return null;
      const ni = n % NW, nj = (n / NW) | 0;
      for (let d = 0; d < 8; d++) {
        const di = DIRS[d][0], dj = DIRS[d][1];
        const ii = ni + di, jj = nj + dj;
        if (ii < 0 || jj < 0 || ii >= NW || jj >= NH) continue;
        const m = jj * NW + ii;
        if (!navOk[m] || closed[m] === searchId) continue;
        if (d >= 4 && (!navOk[nj * NW + ii] || !navOk[jj * NW + ni])) continue;
        if (!canStep(n, m)) continue;
        if (d >= 4 && (!canStep(n, nj * NW + ii) || !canStep(n, jj * NW + ni))) continue;
        let g = gScore[n] + (d >= 4 ? 1.4142 : 1) * NAV + navPenalty[m];
        if (costFn) g += costFn((ii + 0.5) * NAV, (jj + 0.5) * NAV);
        if (seen[m] !== searchId || g < gScore[m]) {
          seen[m] = searchId; gScore[m] = g; parent[m] = n;
          hpush(m, g + Math.hypot(ii - tx, jj - tz) * NAV);
        }
      }
    }
    if (closed[t] !== searchId) return null;
    const out = [];
    for (let n = t; n !== -1; n = parent[n]) out.push(n);
    out.reverse();
    return out;
  }
  function navWalkable(x, z) { const k = navIndex(x, z); return k >= 0 && navOk[k] ? k : -1; }
  function straightOk(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 1) return true;
    const px = -dz / L * 12, pz = dx / L * 12;
    const steps = Math.ceil(L / 8);
    let prevH = null;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps, x = ax + dx * f, z = az + dz * f;
      const k = navWalkable(x, z);
      if (k < 0 || navWalkable(x + px, z + pz) < 0 || navWalkable(x - px, z - pz) < 0) return false;
      const h = navH[k];
      if (prevH !== null && Math.abs(h - prevH) > 10) return false;
      prevH = h;
    }
    return true;
  }
  function findPath(fx, fy, fz, tx, ty, tz, costFn) {
    const s = nearestNav(fx, fz, fy), t = nearestNav(tx, tz, ty);
    if (s < 0 || t < 0) return null;
    const nodes = astar(s, t, costFn);
    if (!nodes) return null;
    const pts = nodes.map(navPoint);
    // string pulling
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !straightOk(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      i = j;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }
  function randomNavPointNear(x, z, radius, rnd) {
    for (let tries = 0; tries < 30; tries++) {
      const a = rnd() * Math.PI * 2, r = rnd() * radius;
      const k = navWalkable(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (k >= 0) return navPoint(k);
    }
    return navPoint(nearestNav(x, z));
  }

  function calloutAt(x, z) {
    let o = cellAt(x, z);
    if (o && o.leg) return o.leg.name;
    for (let r = 1; r < 3; r++) for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      o = cellAt(x + dx * CELL, z + dz * CELL);
      if (o && o.leg) return o.leg.name;
    }
    return '';
  }
  function floorAt(x, z, fromY) {
    if (fromY === undefined) { const g = gridFloor(x, z); fromY = g === null ? 1e6 : g + 60; }
    return groundBelow(x, z, 1, fromY);
  }
  function inRect(R, x, z) { return x >= R.x0 && x <= R.x1 && z >= R.z0 && z <= R.z1; }
  function bombsiteAt(x, z) { for (const k in BOMBSITES) if (inRect(BOMBSITES[k], x, z)) return k; return null; }

  return {
    W, H, grid, info, regions, blocks, props, regionHeight, gridFloor, cellAt, query, topOver, topAt,
    groundBelow, boxBlocked, moveBody, raycast, intersectBlock, losClear,
    NW, NH, navOk, navH, navIndex, nearestNav, navPoint, findPath, straightOk, randomNavPointNear,
    calloutAt, floorAt, inRect, bombsiteAt, width: W * CELL, depth: H * CELL,
  };
})();

if (typeof module !== 'undefined') module.exports = { World, STEP_HEIGHT, clamp, hash2 };
