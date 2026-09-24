'use strict';
// Procedural canvas textures. Everything is drawn at load; there are no image files.

const Tex = (() => {
  let seed = 1337;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const rr = (a, b) => a + rnd() * (b - a);
  const cache = {};

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})`; }

  function speckle(ctx, w, h, n, size, colorFn) {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colorFn();
      const s = rr(size[0], size[1]);
      ctx.fillRect(rnd() * w, rnd() * h, s, s);
    }
  }
  function blotches(ctx, w, h, n, r0, r1, colorFn) {
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, r = rr(r0, r1);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = colorFn();
      g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      // wrap so the texture tiles
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
        ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
      }
    }
  }
  function crack(ctx, x, y, len, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x, y);
    let a = rnd() * Math.PI * 2;
    for (let i = 0; i < len; i++) { a += rr(-0.6, 0.6); x += Math.cos(a) * 4; y += Math.sin(a) * 4; ctx.lineTo(x, y); }
    ctx.stroke();
  }

  function finish(c, repeat = true) {
    const t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }

  const makers = {
    plaster() {
      const c = canvas(512, 512), x = c.getContext('2d');
      x.fillStyle = '#d6bf94'; x.fillRect(0, 0, 512, 512);
      blotches(x, 512, 512, 60, 20, 90, () => hsl(rr(30, 42), rr(25, 45), rr(55, 80), rr(0.08, 0.22)));
      blotches(x, 512, 512, 18, 30, 120, () => hsl(30, 20, rr(35, 50), rr(0.05, 0.12)));
      speckle(x, 512, 512, 9000, [1, 2], () => hsl(35, 30, rr(40, 90), rr(0.1, 0.35)));
      for (let i = 0; i < 7; i++) crack(x, rnd() * 512, rnd() * 512, rr(6, 22), 'rgba(80,60,40,0.35)', 1);
      // exposed brick patches where plaster fell off
      for (let i = 0; i < 3; i++) {
        const px = rnd() * 440, py = rnd() * 440, pw = rr(40, 80), ph = rr(24, 50);
        x.fillStyle = 'rgba(160,120,80,0.55)'; x.fillRect(px, py, pw, ph);
        x.strokeStyle = 'rgba(90,65,45,0.5)'; x.lineWidth = 1;
        for (let yy = py; yy < py + ph; yy += 8) { x.beginPath(); x.moveTo(px, yy); x.lineTo(px + pw, yy); x.stroke(); }
      }
      return finish(c);
    },
    sandstone() {
      const c = canvas(512, 512), x = c.getContext('2d');
      x.fillStyle = '#b89668'; x.fillRect(0, 0, 512, 512);
      const rowH = 64;
      for (let row = 0; row < 8; row++) {
        let px = row % 2 ? -rr(30, 90) : 0;
        while (px < 512) {
          const w = rr(90, 170);
          const l = rr(58, 72), hue = rr(30, 38), sat = rr(30, 45);
          x.fillStyle = hsl(hue, sat, l);
          x.fillRect(px + 2, row * rowH + 2, w - 4, rowH - 4);
          const g = x.createLinearGradient(0, row * rowH, 0, row * rowH + rowH);
          g.addColorStop(0, 'rgba(255,240,210,0.18)'); g.addColorStop(1, 'rgba(60,40,20,0.18)');
          x.fillStyle = g; x.fillRect(px + 2, row * rowH + 2, w - 4, rowH - 4);
          px += w;
        }
      }
      speckle(x, 512, 512, 12000, [1, 2], () => hsl(32, 30, rr(30, 85), rr(0.1, 0.3)));
      blotches(x, 512, 512, 20, 30, 90, () => hsl(28, 25, rr(30, 45), rr(0.05, 0.15)));
      return finish(c);
    },
    plasterWhite() {
      const c = canvas(512, 512), x = c.getContext('2d');
      x.fillStyle = '#e4dccb'; x.fillRect(0, 0, 512, 512);
      blotches(x, 512, 512, 50, 20, 100, () => hsl(rr(35, 45), rr(15, 30), rr(60, 85), rr(0.1, 0.25)));
      speckle(x, 512, 512, 8000, [1, 2], () => hsl(40, 15, rr(50, 95), rr(0.1, 0.3)));
      for (let i = 0; i < 6; i++) crack(x, rnd() * 512, rnd() * 512, rr(6, 20), 'rgba(90,80,70,0.3)', 1);
      return finish(c);
    },
    slab() {
      const c = canvas(512, 512), x = c.getContext('2d');
      x.fillStyle = '#7d6c55'; x.fillRect(0, 0, 512, 512);
      const n = 4, s = 512 / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        x.fillStyle = hsl(rr(30, 38), rr(18, 30), rr(58, 70));
        x.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
        for (let k = 0; k < 3; k++) {
          const gx = i * s + rr(10, s - 10), gy = j * s + rr(10, s - 10), r = rr(15, 45);
          const g = x.createRadialGradient(gx, gy, 0, gx, gy, r);
          g.addColorStop(0, hsl(30, 20, rr(40, 55), 0.25)); g.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g; x.fillRect(gx - r, gy - r, r * 2, r * 2);
        }
        if (rnd() < 0.35) crack(x, i * s + rr(10, s - 10), j * s + rr(10, s - 10), rr(4, 12), 'rgba(60,45,30,0.5)', 1);
      }
      speckle(x, 512, 512, 14000, [1, 2], () => hsl(32, 20, rr(35, 85), rr(0.1, 0.3)));
      return finish(c);
    },
    pave() {
      const c = canvas(512, 512), x = c.getContext('2d');
      x.fillStyle = '#6f604c'; x.fillRect(0, 0, 512, 512);
      const bh = 32;
      for (let row = 0; row < 16; row++) {
        let px = row % 2 ? -32 : 0;
        while (px < 512) {
          const w = 64;
          x.fillStyle = hsl(rr(28, 38), rr(20, 32), rr(50, 64));
          x.fillRect(px + 2, row * bh + 2, w - 4, bh - 4);
          px += w;
        }
      }
      speckle(x, 512, 512, 12000, [1, 2], () => hsl(30, 20, rr(30, 80), rr(0.1, 0.3)));
      blotches(x, 512, 512, 30, 20, 70, () => hsl(30, 25, rr(35, 50), rr(0.08, 0.2)));
      return finish(c);
    },
    sand() {
      const c = canvas(512, 512), x = c.getContext('2d');
      x.fillStyle = '#b4976b'; x.fillRect(0, 0, 512, 512);
      blotches(x, 512, 512, 80, 20, 90, () => hsl(rr(28, 38), rr(25, 40), rr(45, 72), rr(0.1, 0.25)));
      speckle(x, 512, 512, 22000, [1, 3], () => hsl(rr(25, 40), rr(15, 35), rr(30, 85), rr(0.15, 0.45)));
      for (let i = 0; i < 120; i++) { x.fillStyle = hsl(30, 15, rr(35, 70), 0.7); x.beginPath(); x.arc(rnd() * 512, rnd() * 512, rr(1.5, 4), 0, 7); x.fill(); }
      return finish(c);
    },
    tile() {
      const c = canvas(256, 256), x = c.getContext('2d');
      const s = 64;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const alt = (i + j) % 2;
        x.fillStyle = alt ? '#a8573a' : '#d9c7a3'; x.fillRect(i * s, j * s, s, s);
        x.fillStyle = alt ? '#8f4630' : '#2f6d8a';
        x.save(); x.translate(i * s + s / 2, j * s + s / 2); x.rotate(Math.PI / 4);
        x.fillRect(-s * 0.2, -s * 0.2, s * 0.4, s * 0.4); x.restore();
        x.strokeStyle = 'rgba(40,30,20,0.6)'; x.lineWidth = 2; x.strokeRect(i * s + 1, j * s + 1, s - 2, s - 2);
      }
      speckle(x, 256, 256, 3000, [1, 2], () => hsl(30, 20, rr(20, 90), rr(0.05, 0.2)));
      blotches(x, 256, 256, 12, 10, 40, () => hsl(30, 20, 30, 0.12));
      return finish(c);
    },
    wood() {
      const c = canvas(256, 256), x = c.getContext('2d');
      const pw = 32;
      for (let i = 0; i < 8; i++) {
        x.fillStyle = hsl(rr(22, 30), rr(35, 50), rr(28, 40)); x.fillRect(i * pw, 0, pw, 256);
        for (let k = 0; k < 14; k++) {
          x.strokeStyle = hsl(24, 40, rr(18, 45), 0.35); x.lineWidth = 1; x.beginPath();
          const ox = i * pw + rr(2, pw - 2); x.moveTo(ox, 0);
          for (let y = 0; y <= 256; y += 16) x.lineTo(ox + Math.sin(y * 0.05 + k) * 1.5, y);
          x.stroke();
        }
        x.fillStyle = 'rgba(20,10,5,0.6)'; x.fillRect(i * pw, 0, 2, 256);
        const cut = rr(0, 256); x.fillRect(i * pw, cut, pw, 2);
      }
      return finish(c);
    },
    concrete() {
      const c = canvas(256, 256), x = c.getContext('2d');
      x.fillStyle = '#7b7568'; x.fillRect(0, 0, 256, 256);
      blotches(x, 256, 256, 40, 10, 50, () => hsl(40, 8, rr(35, 60), rr(0.1, 0.25)));
      speckle(x, 256, 256, 6000, [1, 2], () => hsl(40, 5, rr(20, 80), rr(0.1, 0.3)));
      x.strokeStyle = 'rgba(40,38,34,0.5)'; x.lineWidth = 2; x.strokeRect(0, 0, 256, 256);
      return finish(c);
    },
    crate() {
      const c = canvas(256, 256), x = c.getContext('2d');
      const ph = 32;
      for (let i = 0; i < 8; i++) {
        x.fillStyle = hsl(rr(28, 34), rr(38, 50), rr(40, 50)); x.fillRect(0, i * ph, 256, ph);
        for (let k = 0; k < 10; k++) {
          x.strokeStyle = hsl(28, 40, rr(25, 55), 0.3); x.beginPath(); const oy = i * ph + rr(2, ph - 2);
          x.moveTo(0, oy); for (let xx = 0; xx <= 256; xx += 16) x.lineTo(xx, oy + Math.sin(xx * 0.04 + k) * 1.2); x.stroke();
        }
        x.fillStyle = 'rgba(30,18,8,0.55)'; x.fillRect(0, i * ph, 256, 2);
      }
      // frame
      x.fillStyle = hsl(28, 45, 32); x.fillRect(0, 0, 256, 22); x.fillRect(0, 234, 256, 22); x.fillRect(0, 0, 22, 256); x.fillRect(234, 0, 22, 256);
      x.save(); x.translate(128, 128); x.rotate(Math.atan2(212, 212)); x.fillRect(-150, -11, 300, 22); x.restore();
      x.strokeStyle = 'rgba(20,10,5,0.7)'; x.lineWidth = 2; x.strokeRect(1, 1, 254, 254); x.strokeRect(22, 22, 212, 212);
      x.fillStyle = '#2a2a2a';
      for (const [px, py] of [[11, 11], [245, 11], [11, 245], [245, 245], [128, 11], [128, 245]]) { x.beginPath(); x.arc(px, py, 2.5, 0, 7); x.fill(); }
      return finish(c, false);
    },
    metal() {
      const c = canvas(128, 128), x = c.getContext('2d');
      x.fillStyle = '#5b6166'; x.fillRect(0, 0, 128, 128);
      blotches(x, 128, 128, 20, 5, 30, () => hsl(25, 40, rr(25, 40), rr(0.1, 0.3)));
      speckle(x, 128, 128, 1500, [1, 2], () => hsl(200, 5, rr(30, 70), 0.2));
      return finish(c);
    },
    rail() {
      const c = canvas(256, 64), x = c.getContext('2d');
      x.fillStyle = '#c8b28a'; x.fillRect(0, 0, 256, 64);
      speckle(x, 256, 64, 2500, [1, 2], () => hsl(35, 25, rr(40, 90), 0.3));
      x.fillStyle = 'rgba(80,60,40,0.3)'; x.fillRect(0, 0, 256, 3); x.fillRect(0, 60, 256, 4);
      return finish(c);
    },
    // decals and details
    window() {
      const c = canvas(128, 192), x = c.getContext('2d');
      x.clearRect(0, 0, 128, 192);
      x.fillStyle = '#8a7358'; x.beginPath(); x.moveTo(8, 190); x.lineTo(8, 60); x.arc(64, 60, 56, Math.PI, 0); x.lineTo(120, 190); x.closePath(); x.fill();
      x.fillStyle = '#1c1a17'; x.beginPath(); x.moveTo(16, 182); x.lineTo(16, 62); x.arc(64, 62, 48, Math.PI, 0); x.lineTo(112, 182); x.closePath(); x.fill();
      const shutter = rnd() < 0.5 ? '#3c6f86' : '#5c7a4a';
      x.fillStyle = shutter; x.fillRect(18, 70, 45, 110); x.fillRect(65, 70, 45, 110);
      x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2;
      for (let y = 76; y < 180; y += 8) { x.beginPath(); x.moveTo(20, y); x.lineTo(61, y); x.moveTo(67, y); x.lineTo(108, y); x.stroke(); }
      x.fillStyle = '#b09a78'; x.fillRect(2, 182, 124, 10);
      return finish(c, false);
    },
    door() {
      const c = canvas(128, 256), x = c.getContext('2d');
      x.fillStyle = '#8a7358'; x.fillRect(0, 0, 128, 256);
      x.fillStyle = rnd() < 0.5 ? '#2f5f78' : '#6b3f24'; x.fillRect(10, 14, 108, 242);
      x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 3;
      for (let px = 10; px < 118; px += 18) { x.beginPath(); x.moveTo(px, 14); x.lineTo(px, 256); x.stroke(); }
      x.fillStyle = '#c9a54a'; x.beginPath(); x.arc(100, 140, 5, 0, 7); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(10, 60, 108, 6); x.fillRect(10, 190, 108, 6);
      return finish(c, false);
    },
    rug() {
      const c = canvas(128, 256), x = c.getContext('2d');
      const pal = [['#8c1f1f', '#d9a441', '#1f3d6b'], ['#1f4d6b', '#e0c070', '#7a2a1a'], ['#6b1f4d', '#e0b060', '#1f5a3a']][Math.floor(rnd() * 3)];
      x.fillStyle = pal[0]; x.fillRect(0, 0, 128, 256);
      x.strokeStyle = pal[1]; x.lineWidth = 6; x.strokeRect(8, 8, 112, 240);
      x.strokeStyle = pal[2]; x.lineWidth = 4; x.strokeRect(18, 18, 92, 220);
      x.fillStyle = pal[1];
      x.save(); x.translate(64, 128); x.rotate(Math.PI / 4); x.fillRect(-30, -30, 60, 60); x.restore();
      x.fillStyle = pal[2]; x.save(); x.translate(64, 128); x.rotate(Math.PI / 4); x.fillRect(-16, -16, 32, 32); x.restore();
      for (let y = 40; y < 230; y += 24) { x.fillStyle = pal[1]; x.fillRect(28, y, 8, 8); x.fillRect(92, y, 8, 8); }
      speckle(x, 128, 256, 1500, [1, 2], () => 'rgba(0,0,0,0.15)');
      return finish(c, false);
    },
    awning() {
      const c = canvas(128, 128), x = c.getContext('2d');
      const cols = rnd() < 0.5 ? ['#b8412e', '#e8dcc0'] : ['#2f6d8a', '#e8dcc0'];
      for (let i = 0; i < 8; i++) { x.fillStyle = cols[i % 2]; x.fillRect(i * 16, 0, 16, 128); }
      speckle(x, 128, 128, 800, [1, 2], () => 'rgba(0,0,0,0.12)');
      return finish(c);
    },
    sky() {
      const c = canvas(16, 512), x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, '#3f78b8'); g.addColorStop(0.35, '#7fb0dc'); g.addColorStop(0.5, '#cfe0ea'); g.addColorStop(0.52, '#e6dccb'); g.addColorStop(1, '#c9b894');
      x.fillStyle = g; x.fillRect(0, 0, 16, 512);
      return finish(c, false);
    },
    soft() {
      const c = canvas(128, 128), x = c.getContext('2d');
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return finish(c, false);
    },
    smoke() {
      const c = canvas(128, 128), x = c.getContext('2d');
      for (let i = 0; i < 34; i++) {
        const a = rnd() * Math.PI * 2, rad = rnd() * 26;
        const px = 64 + Math.cos(a) * rad, py = 64 + Math.sin(a) * rad, r = rr(18, 38);
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        const l = Math.floor(rr(225, 255));
        g.addColorStop(0, `rgba(${l},${l},${l},0.5)`); g.addColorStop(0.6, `rgba(${l},${l},${l},0.22)`); g.addColorStop(1, `rgba(${l},${l},${l},0)`);
        x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
      }
      return finish(c, false);
    },
    flash() {
      const c = canvas(128, 128), x = c.getContext('2d');
      x.translate(64, 64);
      for (let i = 0; i < 7; i++) {
        x.rotate(Math.PI * 2 / 7 + rr(-0.2, 0.2));
        const g = x.createLinearGradient(0, 0, 60, 0);
        g.addColorStop(0, 'rgba(255,240,190,1)'); g.addColorStop(1, 'rgba(255,160,40,0)');
        x.fillStyle = g; x.beginPath(); x.moveTo(0, -7); x.lineTo(rr(40, 62), 0); x.lineTo(0, 7); x.fill();
      }
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 30);
      g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(1, 'rgba(255,190,80,0)');
      x.fillStyle = g; x.fillRect(-30, -30, 60, 60);
      return finish(c, false);
    },
    fire() {
      const c = canvas(64, 128), x = c.getContext('2d');
      const g = x.createRadialGradient(32, 90, 2, 32, 80, 60);
      g.addColorStop(0, 'rgba(255,245,200,1)'); g.addColorStop(0.3, 'rgba(255,170,50,0.9)'); g.addColorStop(0.7, 'rgba(220,60,10,0.5)'); g.addColorStop(1, 'rgba(120,20,0,0)');
      x.fillStyle = g; x.beginPath(); x.moveTo(32, 0); x.bezierCurveTo(60, 50, 64, 100, 32, 128); x.bezierCurveTo(0, 100, 4, 50, 32, 0); x.fill();
      return finish(c, false);
    },
    hole() {
      const c = canvas(32, 32), x = c.getContext('2d');
      const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(10,8,6,1)'); g.addColorStop(0.3, 'rgba(25,20,15,0.95)'); g.addColorStop(0.55, 'rgba(60,50,40,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 32, 32);
      return finish(c, false);
    },
    blood() {
      const c = canvas(64, 64), x = c.getContext('2d');
      for (let i = 0; i < 14; i++) {
        x.fillStyle = `rgba(${Math.floor(rr(90, 140))},0,0,${rr(0.5, 0.9)})`;
        x.beginPath(); x.arc(32 + rr(-18, 18), 32 + rr(-18, 18), rr(2, 9), 0, 7); x.fill();
      }
      return finish(c, false);
    },
    bloodpool() {
      const c = canvas(128, 128), x = c.getContext('2d');
      for (let i = 0; i < 9; i++) {
        const px = 64 + rr(-22, 22), py = 64 + rr(-22, 22), r = rr(16, 34);
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(70,4,4,0.9)'); g.addColorStop(0.7, 'rgba(90,8,8,0.75)'); g.addColorStop(1, 'rgba(90,8,8,0)');
        x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
      }
      return finish(c, false);
    },
    scorch() {
      const c = canvas(128, 128), x = c.getContext('2d');
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(10,8,6,0.85)'); g.addColorStop(0.6, 'rgba(20,15,10,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return finish(c, false);
    },
    grain() {
      const c = canvas(64, 256), x = c.getContext('2d');
      x.fillStyle = '#7a4524'; x.fillRect(0, 0, 64, 256);
      for (let k = 0; k < 30; k++) {
        x.strokeStyle = hsl(22, 50, rr(15, 38), 0.45); x.lineWidth = rr(0.5, 2); x.beginPath();
        const ox = rr(0, 64); x.moveTo(ox, 0);
        for (let y = 0; y <= 256; y += 8) x.lineTo(ox + Math.sin(y * 0.04 + k) * 3, y);
        x.stroke();
      }
      return finish(c);
    },
    camo() {
      const c = canvas(128, 128), x = c.getContext('2d');
      x.fillStyle = '#6b6242'; x.fillRect(0, 0, 128, 128);
      blotches(x, 128, 128, 30, 8, 22, () => ['rgba(80,70,45,0.8)', 'rgba(120,105,75,0.7)', 'rgba(60,55,40,0.7)'][Math.floor(rnd() * 3)]);
      return finish(c);
    },
    frond() {
      const c = canvas(64, 256), x = c.getContext('2d');
      x.strokeStyle = '#5a4a22'; x.lineWidth = 3; x.beginPath(); x.moveTo(32, 0); x.lineTo(32, 256); x.stroke();
      for (let y = 8; y < 250; y += 7) {
        const len = 30 * Math.sin(Math.PI * y / 256) + 4;
        for (const side of [-1, 1]) {
          x.strokeStyle = hsl(rr(85, 105), rr(35, 55), rr(22, 38)); x.lineWidth = 3;
          x.beginPath(); x.moveTo(32, y); x.quadraticCurveTo(32 + side * len * 0.6, y + 4, 32 + side * len, y + 14); x.stroke();
        }
      }
      return finish(c, false);
    },
    bark() {
      const c = canvas(64, 128), x = c.getContext('2d');
      x.fillStyle = '#7a6448'; x.fillRect(0, 0, 64, 128);
      for (let y = 0; y < 128; y += 10) {
        x.fillStyle = hsl(30, 25, rr(25, 40), 0.8);
        x.beginPath(); x.moveTo(0, y); x.lineTo(32, y + 6); x.lineTo(64, y); x.lineTo(64, y + 4); x.lineTo(32, y + 10); x.lineTo(0, y + 4); x.fill();
      }
      speckle(x, 64, 128, 600, [1, 2], () => hsl(30, 20, rr(20, 60), 0.4));
      return finish(c);
    },
    ao() {
      const c = canvas(8, 64), x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.35, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 8, 64);
      const t = finish(c, false); t.wrapS = THREE.RepeatWrapping; return t;
    },
    pane() {
      const c = canvas(128, 192), x = c.getContext('2d');
      x.fillStyle = '#15130f'; x.fillRect(0, 0, 128, 192);
      const g = x.createLinearGradient(0, 0, 128, 192);
      g.addColorStop(0, 'rgba(120,150,170,0.25)'); g.addColorStop(0.5, 'rgba(40,50,60,0.05)'); g.addColorStop(1, 'rgba(120,150,170,0.18)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 192);
      if (rnd() < 0.6) { x.fillStyle = rnd() < 0.5 ? 'rgba(170,60,40,0.55)' : 'rgba(210,190,150,0.5)'; x.fillRect(4, 4, 44, 184); x.fillRect(80, 4, 44, 184); }
      x.fillStyle = '#6b5a45'; x.fillRect(60, 0, 8, 192); x.fillRect(0, 90, 128, 7);
      return finish(c, false);
    },
    scope() {
      const c = canvas(512, 512), x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512);
      x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(256, 256, 250, 0, 7); x.fill();
      return finish(c, false);
    },
  };

  function get(name) {
    if (!cache[name]) cache[name] = makers[name]();
    return cache[name];
  }
  // several independent variants (e.g. differently coloured rugs)
  function variant(name, i) {
    const key = name + '#' + i;
    if (!cache[key]) cache[key] = makers[name]();
    return cache[key];
  }
  return { get, variant, rnd };
})();
