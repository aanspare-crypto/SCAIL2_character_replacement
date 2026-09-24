'use strict';
// Source-style player movement shared by the player and the bots.
if (typeof module !== 'undefined' && typeof World === 'undefined') Object.assign(globalThis, require('./world.js'));

const MV = {
  gravity: 800, accel: 5.5, airAccel: 12, friction: 5.2, stopSpeed: 80, jump: 301.993, airCap: 30,
  walkMul: 0.52, duckMul: 0.34, stand: 72, crouch: 54, eyeStand: 64, eyeCrouch: 46, safeFall: 580, fatalFall: 1024,
};

function makeBody(x, y, z) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, hw: 16, height: MV.stand, onGround: true, ducked: false, duck: 0, stepped: 0, landSpeed: 0, hitWall: false, jumpHeld: false, velMod: 1, stepDist: 0, eyeLag: 0 };
}

function bodyFree(e, y0, y1) {
  return !World.boxBlocked(e.x - e.hw + 0.5, y0, e.z - e.hw + 0.5, e.x + e.hw - 0.5, y1, e.z + e.hw - 0.5);
}

function updateDuck(e, want, dt) {
  if (want && !e.ducked) {
    e.ducked = true;
    e.height = MV.crouch;
    if (!e.onGround && bodyFree(e, e.y + 18, e.y + 18 + MV.crouch)) { e.y += 18; e.duck = 1; }
  } else if (!want && e.ducked) {
    if (e.onGround) {
      if (bodyFree(e, e.y + 1, e.y + MV.stand)) { e.ducked = false; e.height = MV.stand; }
    } else if (bodyFree(e, e.y - 18, e.y + MV.crouch - 18)) {
      e.y -= 18; e.ducked = false; e.height = MV.stand; e.duck = 0;
    } else if (bodyFree(e, e.y + 1, e.y + MV.stand)) { e.ducked = false; e.height = MV.stand; }
  }
  const target = e.ducked ? 1 : 0;
  const rate = dt * 6.5;
  e.duck += Math.max(-rate, Math.min(rate, target - e.duck));
}

function eyeHeight(e) { return MV.eyeStand + (MV.eyeCrouch - MV.eyeStand) * e.duck; }

// cmd: { fwd, side, yaw, jump (held), duck, walk }. maxSpeed from the held weapon.
function playerMove(e, cmd, dt, maxSpeed) {
  updateDuck(e, cmd.duck, dt);
  if (e.velMod < 1) e.velMod = Math.min(1, e.velMod + dt * 1.4);
  let cap = maxSpeed * e.velMod;
  if (e.ducked) cap *= MV.duckMul;
  else if (cmd.walk) cap *= MV.walkMul;

  const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
  const fx = -sy, fz = -cy, rx = cy, rz = -sy;
  let wx = fx * cmd.fwd + rx * cmd.side, wz = fz * cmd.fwd + rz * cmd.side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0.001) { wx /= wl; wz /= wl; }
  const wish = wl > 0.001 ? cap : 0;

  e.jumped = false;
  if (!cmd.jump) e.jumpHeld = false;
  if (e.onGround) {
    if (cmd.jump && !e.jumpHeld && !e.noJump) {
      e.jumpHeld = true;
      e.vy = MV.jump;
      e.onGround = false;
      e.jumped = true;
    } else {
      const sp = Math.hypot(e.vx, e.vz);
      if (sp > 0.1) {
        const control = Math.max(sp, MV.stopSpeed);
        const ns = Math.max(0, sp - control * MV.friction * dt);
        e.vx *= ns / sp; e.vz *= ns / sp;
      } else { e.vx = 0; e.vz = 0; }
    }
  }
  if (e.onGround && !e.jumped) {
    if (wish > 0) {
      const cur = e.vx * wx + e.vz * wz;
      const add = wish - cur;
      if (add > 0) {
        const acc = Math.min(MV.accel * dt * Math.max(wish, 150), add);
        e.vx += acc * wx; e.vz += acc * wz;
      }
    }
    const sp = Math.hypot(e.vx, e.vz);
    if (sp > cap && sp > 1) { const k = Math.max(cap, sp - 900 * dt) / sp; e.vx *= k; e.vz *= k; }
  } else if (wish > 0) {
    const ws = Math.min(wish, MV.airCap);
    const cur = e.vx * wx + e.vz * wz;
    const add = ws - cur;
    if (add > 0) {
      const acc = Math.min(MV.airAccel * wish * dt, add);
      e.vx += acc * wx; e.vz += acc * wz;
    }
  }
  const ox = e.x, oz = e.z;
  e.hitWall = false;
  e.stepped = 0;
  World.moveBody(e, dt, MV.gravity);
  if (e.stepped > 0) e.eyeLag -= e.stepped;
  e.eyeLag *= Math.exp(-dt * 14);
  const moved = Math.hypot(e.x - ox, e.z - oz);
  return moved;
}

// Horizontal speed
function bodySpeed(e) { return Math.hypot(e.vx, e.vz); }

// Push overlapping bodies apart (players cannot walk through each other).
function separateBodies(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (a.y + a.height < b.y + 4 || b.y + b.height < a.y + 4) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const ox = 32 - Math.abs(dx), oz = 32 - Math.abs(dz);
      if (ox <= 0 || oz <= 0) continue;
      // separate along the axis of least overlap, pushing each body half way
      const push = (e, ax, amt) => {
        const save = e.onGround;
        const s = { x: e.x, y: e.y, z: e.z, vx: 0, vy: 0, vz: 0, hw: e.hw, height: e.height, onGround: true };
        if (ax === 0) s.vx = amt * 60; else s.vz = amt * 60;
        World.moveBody(s, 1 / 60, 0);
        e.x = s.x; e.z = s.z; e.onGround = save;
      };
      if (ox < oz) { const s = dx > 0 ? 1 : dx < 0 ? -1 : (i % 2 ? 1 : -1); push(a, 0, -s * ox / 2); push(b, 0, s * ox / 2); }
      else { const s = dz > 0 ? 1 : dz < 0 ? -1 : (i % 2 ? 1 : -1); push(a, 2, -s * oz / 2); push(b, 2, s * oz / 2); }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { MV, makeBody, playerMove, eyeHeight, bodySpeed, separateBodies, updateDuck };
