'use strict';
// Procedural positional audio. Every sound is synthesised with Web Audio at runtime.

const Sound = (() => {
  const S = { enabled: false, volume: 0.7 };
  let ctx, master, sfx, muffle, ui, noise, amb;
  let lx = 0, ly = 0, lz = 0;
  let occlusion = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = S.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;
    muffle.connect(master);
    sfx = ctx.createGain(); sfx.connect(muffle);
    ui = ctx.createGain(); ui.connect(master);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    S.enabled = true;
    startAmbience();
  }
  S.init = init;
  S.setVolume = v => { S.volume = v; if (master) master.gain.value = v; };
  S.setOcclusion = fn => { occlusion = fn; };

  S.setListener = (x, y, z, yaw, pitch) => {
    if (!ctx) return;
    lx = x; ly = y; lz = z;
    const L = ctx.listener;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
  };

  // Destination chain for a sound at a world position (or null for 2D).
  function dest(pos, o = {}) {
    const g = ctx.createGain();
    g.gain.value = o.gain === undefined ? 1 : o.gain;
    if (!pos) { g.connect(o.ui ? ui : sfx); return g; }
    const dx = pos[0] - lx, dy = pos[1] - ly, dz = pos[2] - lz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > (o.maxDist || 9000)) return null;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    let cut = Math.max(1400, 20000 * Math.exp(-dist / (o.air || 2600)));
    if (occlusion && dist > 60 && occlusion(pos)) { cut *= 0.28; g.gain.value *= 0.55; }
    lp.frequency.value = cut;
    const p = ctx.createPanner();
    p.panningModel = dist < 3000 ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref || 180;
    p.rolloffFactor = o.roll || 1.1;
    p.maxDistance = 20000;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
    else p.setPosition(pos[0], pos[1], pos[2]);
    g.connect(lp); lp.connect(p); p.connect(sfx);
    return g;
  }

  function nz(out, t, dur, type, freq, q, gain, attack = 0.001, rate = 1) {
    const src = ctx.createBufferSource(); src.buffer = noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return f;
  }
  function tone(out, t, dur, type, f0, f1, gain, attack = 0.002) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const GUN = {
    ak47: { crack: 1700, body: 950, bodyDur: 0.24, thump: [115, 42], tail: 0.9, gain: 1.0 },
    m4a4: { crack: 2600, body: 1300, bodyDur: 0.2, thump: [135, 55], tail: 0.8, gain: 0.95 },
    galil: { crack: 2100, body: 1150, bodyDur: 0.2, thump: [125, 50], tail: 0.8, gain: 0.9 },
    famas: { crack: 2800, body: 1350, bodyDur: 0.18, thump: [140, 60], tail: 0.75, gain: 0.9 },
    smg: { crack: 3000, body: 1500, bodyDur: 0.12, thump: [150, 70], tail: 0.55, gain: 0.8 },
    glock: { crack: 3200, body: 1700, bodyDur: 0.11, thump: [160, 75], tail: 0.5, gain: 0.75 },
    p250: { crack: 2700, body: 1400, bodyDur: 0.13, thump: [140, 60], tail: 0.55, gain: 0.8 },
    deagle: { crack: 1400, body: 800, bodyDur: 0.32, thump: [95, 38], tail: 1.0, gain: 1.1 },
    awp: { crack: 1200, body: 700, bodyDur: 0.45, thump: [75, 30], tail: 1.6, gain: 1.25 },
    ssg: { crack: 1900, body: 1000, bodyDur: 0.3, thump: [105, 45], tail: 1.1, gain: 1.0 },
  };
  S.shot = (snd, pos, silenced, local) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (silenced) {
      const out = dest(pos, { gain: local ? 0.8 : 0.9, ref: 120, roll: 1.6, maxDist: 3000 }); if (!out) return;
      nz(out, t, 0.07, 'bandpass', 950 * (0.9 + Math.random() * 0.2), 1.1, 0.9);
      nz(out, t, 0.025, 'highpass', 4200, 0, 0.35);
      tone(out, t, 0.05, 'sine', 220, 90, 0.25);
      nz(out, t + 0.03, 0.12, 'bandpass', 2600, 3, 0.12);
      return;
    }
    const G = GUN[snd] || GUN.ak47;
    const out = dest(pos, { gain: G.gain * (local ? 0.75 : 1), ref: 220, roll: 1.0, maxDist: 12000, air: 3200 }); if (!out) return;
    const v = 0.92 + Math.random() * 0.16;
    nz(out, t, 0.09, 'bandpass', G.crack * v, 0.8, 1.2);
    nz(out, t, G.bodyDur, 'lowpass', G.body * v, 0.7, 1.0);
    tone(out, t, 0.13, 'sine', G.thump[0] * v, G.thump[1], 0.9);
    nz(out, t + 0.012, G.tail, 'lowpass', 520, 0.5, 0.28, 0.02);
    if (pos) {
      // slap-back echo off buildings
      const d = Math.hypot(pos[0] - lx, pos[2] - lz);
      nz(out, t + 0.09 + d / 13000, G.tail * 0.6, 'bandpass', 700, 0.6, 0.12, 0.01);
    }
  };

  S.step = (pos, surface, local, loud = 1) => {
    if (!ctx) return;
    const out = dest(pos, { gain: (local ? 0.28 : 0.85) * loud, ref: 70, roll: 1.35, maxDist: 2200 }); if (!out) return;
    const t = ctx.currentTime;
    const r = 0.85 + Math.random() * 0.3;
    if (surface === 'wood' || surface === 'tile') {
      nz(out, t, 0.07, 'bandpass', 700 * r, 1.4, 0.8);
      tone(out, t, 0.06, 'sine', 140 * r, 90, 0.35);
    } else if (surface === 'sand') {
      nz(out, t, 0.09, 'highpass', 2600 * r, 0.5, 0.45);
      nz(out, t, 0.05, 'bandpass', 900 * r, 1, 0.3);
    } else if (surface === 'metal') {
      nz(out, t, 0.06, 'bandpass', 2500 * r, 2, 0.6);
      tone(out, t, 0.12, 'triangle', 620 * r, 600, 0.12);
    } else {
      nz(out, t, 0.06, 'bandpass', 1900 * r, 1.2, 0.7);
      nz(out, t, 0.03, 'lowpass', 500, 0.5, 0.35);
    }
  };
  S.land = (pos, local) => {
    if (!ctx) return;
    const out = dest(pos, { gain: local ? 0.5 : 1, ref: 80, roll: 1.3, maxDist: 2400 }); if (!out) return;
    const t = ctx.currentTime;
    nz(out, t, 0.12, 'lowpass', 700, 0.7, 0.9); nz(out, t, 0.07, 'bandpass', 1800, 1, 0.5);
  };
  S.impact = (pos, mat) => {
    if (!ctx) return;
    const out = dest(pos, { gain: 0.55, ref: 90, roll: 1.4, maxDist: 2500 }); if (!out) return;
    const t = ctx.currentTime, r = 0.8 + Math.random() * 0.4;
    if (mat === 'crate' || mat === 'wood' || mat === 'booth') { nz(out, t, 0.08, 'bandpass', 650 * r, 1.5, 0.9); tone(out, t, 0.07, 'sine', 190 * r, 120, 0.3); }
    else if (mat === 'van' || mat === 'car' || mat === 'metal') { tone(out, t, 0.25, 'triangle', 2400 * r, 2300, 0.25); tone(out, t, 0.2, 'sine', 3700 * r, 3600, 0.15); nz(out, t, 0.03, 'highpass', 3000, 0, 0.5); }
    else { nz(out, t, 0.05, 'highpass', 2200 * r, 0.5, 0.8); nz(out, t, 0.05, 'bandpass', 900 * r, 1, 0.35); }
  };
  S.flesh = (pos, head, helmet) => {
    if (!ctx) return;
    const out = dest(pos, { gain: 0.9, ref: 120, roll: 1.2, maxDist: 4000 }); if (!out) return;
    const t = ctx.currentTime;
    if (head && helmet) { tone(out, t, 0.35, 'sine', 3150, 3100, 0.45); tone(out, t, 0.28, 'sine', 4700, 4650, 0.25); nz(out, t, 0.03, 'highpass', 5000, 0, 0.4); }
    else if (head) { nz(out, t, 0.1, 'lowpass', 1100, 0.8, 1.0); nz(out, t, 0.05, 'bandpass', 2800, 2, 0.4); }
    else { nz(out, t, 0.09, 'lowpass', 520, 0.8, 1.0); tone(out, t, 0.08, 'sine', 90, 60, 0.4); }
  };
  S.hurt = () => {
    if (!ctx) return;
    const out = dest(null, { gain: 0.7 }); const t = ctx.currentTime;
    nz(out, t, 0.12, 'lowpass', 400, 0.8, 1.0); tone(out, t, 0.14, 'sine', 80, 50, 0.6);
  };
  S.mech = (kind, pos, local) => {
    if (!ctx) return;
    const out = dest(pos, { gain: local ? 0.45 : 0.6, ref: 60, roll: 1.5, maxDist: 1500 }); if (!out) return;
    const t = ctx.currentTime;
    switch (kind) {
      case 'magout': nz(out, t, 0.04, 'bandpass', 2200, 2, 0.8); tone(out, t, 0.03, 'square', 900, 700, 0.12); nz(out, t + 0.05, 0.06, 'lowpass', 900, 1, 0.3); break;
      case 'magin': nz(out, t, 0.05, 'bandpass', 1500, 1.5, 1.0); tone(out, t, 0.03, 'square', 700, 500, 0.15); nz(out, t + 0.06, 0.03, 'highpass', 3000, 0, 0.5); break;
      case 'bolt': nz(out, t, 0.04, 'bandpass', 2600, 2, 0.8); nz(out, t + 0.14, 0.05, 'bandpass', 1900, 2, 0.9); tone(out, t + 0.14, 0.03, 'square', 1000, 800, 0.1); break;
      case 'empty': nz(out, t, 0.02, 'highpass', 3500, 0, 0.7); tone(out, t, 0.02, 'square', 1500, 1500, 0.08); break;
      case 'deploy': nz(out, t, 0.18, 'bandpass', 1200, 0.6, 0.35, 0.05); nz(out, t + 0.2, 0.03, 'bandpass', 2400, 2, 0.6); break;
      case 'knife': { const f = nz(out, t, 0.2, 'bandpass', 900, 2, 0.6, 0.03); f.frequency.exponentialRampToValueAtTime(3500, t + 0.18); break; }
      case 'pin': tone(out, t, 0.05, 'triangle', 3000, 2800, 0.2); nz(out, t, 0.03, 'highpass', 4000, 0, 0.4); break;
      case 'throw': { const f = nz(out, t, 0.25, 'bandpass', 600, 1.5, 0.5, 0.05); f.frequency.exponentialRampToValueAtTime(2000, t + 0.22); break; }
      case 'bounce': nz(out, t, 0.05, 'bandpass', 1600, 2, 0.7); tone(out, t, 0.08, 'triangle', 900, 700, 0.15); break;
      case 'pickup': nz(out, t, 0.05, 'bandpass', 1800, 2, 0.6); tone(out, t + 0.03, 0.03, 'square', 1200, 1000, 0.1); break;
      case 'scope': nz(out, t, 0.04, 'bandpass', 3000, 3, 0.5); break;
      case 'kevlar': nz(out, t, 0.2, 'bandpass', 700, 0.8, 0.6, 0.03); break;
    }
  };
  S.beep = (pos, hi) => {
    if (!ctx) return;
    const out = dest(pos, { gain: 0.7, ref: 200, roll: 0.9, maxDist: 6000 }); if (!out) return;
    const t = ctx.currentTime;
    tone(out, t, 0.11, 'square', hi ? 2600 : 2200, hi ? 2600 : 2200, 0.18);
    tone(out, t, 0.11, 'sine', hi ? 2600 : 2200, hi ? 2600 : 2200, 0.25);
  };
  S.keypad = (pos) => {
    if (!ctx) return;
    const out = dest(pos, { gain: 0.5, ref: 80, roll: 1.2, maxDist: 2000 }); if (!out) return;
    const t = ctx.currentTime;
    tone(out, t, 0.07, 'sine', 1300 + Math.random() * 500, 1300, 0.3);
  };
  S.defuseTick = (pos) => {
    if (!ctx) return;
    const out = dest(pos, { gain: 0.45, ref: 70, roll: 1.4, maxDist: 1600 }); if (!out) return;
    const t = ctx.currentTime;
    nz(out, t, 0.03, 'highpass', 3000, 0, 0.6); tone(out, t, 0.02, 'square', 1800, 1800, 0.05);
  };
  S.explosion = (pos, big) => {
    if (!ctx) return;
    const out = dest(pos, { gain: big ? 1.6 : 1.1, ref: big ? 800 : 300, roll: 0.8, maxDist: 20000, air: 6000 }); if (!out) return;
    const t = ctx.currentTime;
    nz(out, t, big ? 3.2 : 1.6, 'lowpass', big ? 700 : 1000, 0.6, 1.2, 0.005);
    nz(out, t, 0.25, 'bandpass', 1400, 0.6, 0.9);
    tone(out, t, big ? 1.4 : 0.6, 'sine', big ? 70 : 90, 25, 1.2, 0.004);
    nz(out, t + 0.1, big ? 2.5 : 1.2, 'lowpass', 300, 0.5, 0.6, 0.05);
  };
  S.flashbang = (pos) => {
    if (!ctx) return;
    const out = dest(pos, { gain: 1.0, ref: 250, roll: 0.9, maxDist: 8000 }); if (!out) return;
    const t = ctx.currentTime;
    nz(out, t, 0.15, 'highpass', 1500, 0.5, 1.2); tone(out, t, 0.2, 'sine', 120, 50, 0.8);
  };
  S.ring = (dur) => {
    if (!ctx || dur < 0.3) return;
    const t = ctx.currentTime;
    const g = ctx.createGain(); g.connect(ui);
    tone(g, t, dur, 'sine', 3500, 3400, 0.08 * Math.min(1, dur / 2), 0.05);
    muffle.frequency.cancelScheduledValues(t);
    muffle.frequency.setValueAtTime(500, t);
    muffle.frequency.exponentialRampToValueAtTime(20000, t + dur);
  };
  S.smoke = (pos) => {
    if (!ctx) return;
    const out = dest(pos, { gain: 0.6, ref: 120, roll: 1.2, maxDist: 4000 }); if (!out) return;
    const t = ctx.currentTime;
    nz(out, t, 2.2, 'highpass', 3200, 0.5, 0.45, 0.1);
    nz(out, t, 1.5, 'bandpass', 900, 0.5, 0.3, 0.2);
  };
  S.glass = (pos) => {
    if (!ctx) return;
    const out = dest(pos, { gain: 0.9, ref: 150, roll: 1.1, maxDist: 5000 }); if (!out) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) nz(out, t + i * 0.02 + Math.random() * 0.02, 0.08, 'highpass', 3500 + Math.random() * 3000, 1, 0.5);
    const f = nz(out, t, 0.8, 'lowpass', 400, 0.7, 0.9, 0.05); f.frequency.exponentialRampToValueAtTime(1800, t + 0.3);
  };
  // Looping fire; returns a stop function.
  S.fire = (pos, dur) => {
    if (!ctx) return () => {};
    const out = dest(pos, { gain: 0.55, ref: 120, roll: 1.2, maxDist: 4000 }); if (!out) return () => {};
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 0.2);
    g.gain.setValueAtTime(1, t + dur - 0.6); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t); src.stop(t + dur + 0.1);
    for (let i = 0; i < dur * 6; i++) nz(out, t + Math.random() * dur, 0.03, 'highpass', 2000 + Math.random() * 3000, 0.5, 0.25);
    return () => { try { g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.3); src.stop(ctx.currentTime + 0.35); } catch (e) { /* already stopped */ } };
  };
  S.ui = (kind) => {
    if (!ctx) return;
    const out = dest(null, { gain: 0.5, ui: true }); const t = ctx.currentTime;
    switch (kind) {
      case 'click': tone(out, t, 0.04, 'square', 1400, 1400, 0.08); break;
      case 'buy': tone(out, t, 0.06, 'triangle', 1200, 1200, 0.3); tone(out, t + 0.06, 0.1, 'triangle', 1800, 1800, 0.3); break;
      case 'deny': tone(out, t, 0.15, 'square', 220, 200, 0.12); break;
      case 'round': tone(out, t, 0.15, 'triangle', 660, 660, 0.3); tone(out, t + 0.16, 0.25, 'triangle', 990, 990, 0.3); break;
      case 'win': [523, 659, 784].forEach((f, i) => tone(out, t + i * 0.12, 0.4, 'triangle', f, f, 0.3)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => tone(out, t + i * 0.14, 0.45, 'triangle', f, f, 0.3)); break;
      case 'kill': tone(out, t, 0.08, 'sine', 900, 900, 0.18); break;
      case 'tick': tone(out, t, 0.03, 'square', 2000, 2000, 0.06); break;
      case 'radio': nz(out, t, 0.06, 'bandpass', 2500, 2, 0.25); tone(out, t, 0.05, 'square', 1600, 1600, 0.05); break;
    }
  };

  function startAmbience() {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    amb = ctx.createGain(); amb.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(amb.gain);
    src.connect(f); f.connect(amb); amb.connect(sfx);
    src.start(); lfo.start();
    const bird = () => {
      if (!ctx) return;
      const t = ctx.currentTime;
      const g = ctx.createGain(); g.gain.value = 0.03; g.connect(sfx);
      const n = 2 + Math.floor(Math.random() * 4), base = 2800 + Math.random() * 1800;
      for (let i = 0; i < n; i++) tone(g, t + i * 0.13, 0.09, 'sine', base, base * 1.3, 0.5);
      setTimeout(bird, 5000 + Math.random() * 12000);
    };
    setTimeout(bird, 4000);
  }

  // Announcer lines through speech synthesis where available.
  S.voice = true;
  S.say = (text) => {
    if (!S.voice || typeof speechSynthesis === 'undefined') return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 0.75; u.volume = Math.min(1, S.volume * 1.2);
      const vs = speechSynthesis.getVoices();
      const v = vs.find(v => /en[-_]US/i.test(v.lang) && /male|david|alex|daniel/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* speech not available */ }
  };
  return S;
})();
