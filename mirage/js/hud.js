'use strict';
// HUD: radar, score bar, vitals, ammo, kill feed, buy menu, scoreboard and messages.

const HUD = (() => {
  const H = {};
  const $ = id => document.getElementById(id);
  const TEAMNAME = { CT: 'Counter-Terrorists', T: 'Terrorists' };
  let radarMap = null, radarCtx = null;
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
  H.buyOpen = false;
  H.buyCat = -1;
  H.settings = { crosshair: '#4cff4c', dynamic: true };

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- radar ----------
  const RS = 8; // world units per radar-map pixel
  function buildRadarMap() {
    const w = Math.ceil(World.width / RS), h = Math.ceil(World.depth / RS);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, w, h);
    const img = x.createImageData(w, h);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const wx = (px + 0.5) * RS, wz = (py + 0.5) * RS;
      const o = World.cellAt(wx, wz);
      const i = (py * w + px) * 4;
      if (!o || o.kind === 'wall') { img.data[i + 3] = 0; continue; }
      let hgt = o.kind === 'floor' ? World.regionHeight(o.ch, wx, wz) : o.fh;
      let l = 118 + hgt * 0.32;
      if (o.kind !== 'floor') l = 70;
      if (o.roofY) l -= 18;
      img.data[i] = l * 0.93; img.data[i + 1] = l * 0.9; img.data[i + 2] = l * 0.82; img.data[i + 3] = 235;
    }
    x.putImageData(img, 0, 0);
    // props
    x.fillStyle = 'rgba(40,36,30,0.85)';
    for (const b of World.props) x.fillRect(b.x0 / RS, b.z0 / RS, (b.x1 - b.x0) / RS, (b.z1 - b.z0) / RS);
    // outlines of walkable space
    x.globalCompositeOperation = 'destination-over';
    x.fillStyle = 'rgba(20,20,20,0.9)';
    for (let py = 0; py < h; py += 1) for (let px = 0; px < w; px += 1) {
      const o = World.cellAt((px + 0.5) * RS, (py + 0.5) * RS);
      if (!o || o.kind === 'wall') {
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const q = World.cellAt((px + dx + 0.5) * RS, (py + dy + 0.5) * RS); return q && q.kind !== 'wall'; });
        if (n) x.fillRect(px - 1, py - 1, 3, 3);
      }
    }
    x.globalCompositeOperation = 'source-over';
    // bombsites
    for (const k in BOMBSITES) {
      const S = BOMBSITES[k];
      x.fillStyle = 'rgba(200,60,40,0.14)'; x.fillRect(S.x0 / RS, S.z0 / RS, (S.x1 - S.x0) / RS, (S.z1 - S.z0) / RS);
    }
    radarMap = c;
  }
  H.init = () => {
    buildRadarMap();
    const rc = $('radar');
    radarCtx = rc.getContext('2d');
    const r = () => { const d = DPR(); rc.width = rc.clientWidth * d; rc.height = rc.clientHeight * d; };
    r(); window.addEventListener('resize', r);
    buildBuyMenu();
    setCrosshair();
  };

  function drawRadar(view, spotter) {
    const rc = radarCtx.canvas, dd = DPR();
    if (rc.clientWidth && (rc.width !== Math.round(rc.clientWidth * dd))) { rc.width = Math.round(rc.clientWidth * dd); rc.height = Math.round(rc.clientHeight * dd); }
    const ctx = radarCtx, cw = ctx.canvas.width, ch = ctx.canvas.height, d = DPR();
    ctx.clearRect(0, 0, cw, ch);
    if (!view) return;
    const R = cw / 2;
    const scale = (cw / 2) / 1500; // px per unit (radius 1500 units)
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
    ctx.fillStyle = 'rgba(12,14,16,0.55)'; ctx.fillRect(0, 0, cw, ch);
    ctx.translate(R, R);
    ctx.rotate(view.yaw);
    ctx.scale(scale, scale);
    ctx.translate(-view.x, -view.z);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(radarMap, 0, 0, radarMap.width * RS, radarMap.height * RS);
    // site letters
    ctx.save();
    for (const k in BOMBSITES) {
      const S = BOMBSITES[k];
      ctx.save(); ctx.translate(S.label[0], S.label[1]); ctx.rotate(-view.yaw);
      ctx.fillStyle = 'rgba(230,80,60,0.9)'; ctx.font = `bold ${60}px "Barlow Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(k, 0, 0); ctx.restore();
    }
    ctx.restore();
    const dot = (x, z, col, rad, yaw, label, outline) => {
      ctx.save(); ctx.translate(x, z);
      ctx.rotate(-view.yaw);
      const s = rad / scale;
      if (yaw !== undefined && yaw !== null) {
        ctx.save(); ctx.rotate(view.yaw - yaw);
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -s * 2.1); ctx.lineTo(s * 0.9, -s * 0.4); ctx.lineTo(-s * 0.9, -s * 0.4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, s, 0, 7); ctx.fill();
      if (outline) { ctx.lineWidth = s * 0.35; ctx.strokeStyle = outline; ctx.stroke(); }
      if (label) { ctx.fillStyle = '#101010'; ctx.font = `bold ${s * 1.3}px "Barlow Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, s * 0.1); }
      ctx.restore();
    };
    const team = spotter;
    const now = Game.time;
    // bomb
    const B = Game.bomb;
    if (B && (B.state === 'dropped' || B.state === 'planted' || (B.state === 'carried' && team === 'T'))) {
      if (team === 'T' || B.spottedByCT || B.state === 'planted') {
        ctx.save(); ctx.translate(B.x, B.z); ctx.rotate(-view.yaw);
        const s = 7 * d / scale;
        const blink = B.state === 'planted' ? (Math.floor(now * 3) % 2 ? 1 : 0.4) : 1;
        ctx.globalAlpha = blink;
        ctx.fillStyle = '#e03a2a'; ctx.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
        ctx.fillStyle = '#fff'; ctx.font = `bold ${s}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('C4', 0, 0);
        ctx.restore();
      }
    }
    let n = 0;
    for (const p of Game.players) {
      if (p.team !== team) continue;
      n++;
      if (!p.alive) {
        ctx.save(); ctx.translate(p.body.x, p.body.z); ctx.rotate(-view.yaw);
        const s = 4 * d / scale; ctx.strokeStyle = p.color; ctx.lineWidth = s * 0.5;
        ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.moveTo(s, -s); ctx.lineTo(-s, s); ctx.stroke(); ctx.restore();
        continue;
      }
      if (p === view.p) continue;
      dot(p.body.x, p.body.z, p.color, 5 * d, p.yaw, null, '#111');
    }
    for (const p of Game.players) {
      if (p.team === team || !p.alive) continue;
      if (p.spottedUntil > now) dot(p.body.x, p.body.z, '#e8412c', 5 * d, null, null, '#200');
    }
    if (view.p && view.p.alive) dot(view.x, view.z, view.p.color, 5.5 * d, view.yaw, null, '#fff');
    ctx.restore();
    // frame
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = d; ctx.strokeRect(0.5, 0.5, cw - 1, ch - 1);
  }

  // ---------- crosshair ----------
  function setCrosshair() {
    const c = $('crosshair');
    c.style.setProperty('--xh', H.settings.crosshair);
  }
  H.setCrosshairColor = (col) => { H.settings.crosshair = col; setCrosshair(); };

  // ---------- kill feed ----------
  const ICON = {
    hs: '<svg viewBox="0 0 16 16" class="ic"><circle cx="8" cy="7" r="5.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 0v4M8 10v6M0 7h4M12 7h4" stroke="currentColor" stroke-width="1.6"/></svg>',
    wb: '<svg viewBox="0 0 16 16" class="ic"><path d="M6 1h4v14H6z" fill="currentColor" opacity=".5"/><path d="M0 8h16M12 5l4 3-4 3" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
    smoke: '<svg viewBox="0 0 16 16" class="ic"><circle cx="5" cy="9" r="4" fill="currentColor"/><circle cx="10" cy="7" r="5" fill="currentColor" opacity=".8"/></svg>',
    blind: '<svg viewBox="0 0 16 16" class="ic"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 14L14 2" stroke="currentColor" stroke-width="1.6"/></svg>',
  };
  H.killfeed = (d) => {
    const el = document.createElement('div');
    const local = Game.local;
    const involved = local && (d.killer === local || d.victim === local || d.assister === local);
    el.className = 'kf' + (involved ? ' mine' : '');
    const nm = p => p ? `<b class="${p.team.toLowerCase()}">${esc(p.name)}</b>` : '';
    const wname = WEAPONS[d.weapon] ? WEAPONS[d.weapon].name : d.weapon === 'bomb' ? 'C4' : d.weapon === 'fall' ? 'Fall' : d.weapon;
    let s = '';
    if (d.killer && d.killer !== d.victim) s += nm(d.killer) + (d.assister ? ` + ${nm(d.assister)}` : '') + ' ';
    if (d.flashed) s += ICON.blind;
    s += `<span class="wpn">${esc(wname)}</span>`;
    if (d.smoke) s += ICON.smoke;
    if (d.wallbang) s += ICON.wb;
    if (d.headshot) s += ICON.hs;
    s += ' ' + nm(d.victim);
    el.innerHTML = s;
    const kf = $('killfeed');
    kf.appendChild(el);
    while (kf.children.length > 6) kf.removeChild(kf.firstChild);
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 600); }, 7000);
  };

  // ---------- chat / radio ----------
  H.radio = (p, text) => {
    const el = document.createElement('div');
    el.className = 'chat';
    const where = World.calloutAt(p.body.x, p.body.z);
    el.innerHTML = `<b class="${p.team.toLowerCase()}">${esc(p.name)}</b>${where ? ` <i>@ ${esc(where)}</i>` : ''}: ${esc(text)}`;
    const c = $('chat'); c.appendChild(el);
    while (c.children.length > 5) c.removeChild(c.firstChild);
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 600); }, 6000);
  };

  // ---------- messages ----------
  let msgT = null;
  H.message = (text, dur = 2.5, cls = '') => {
    const m = $('centermsg');
    m.textContent = text; m.className = cls; m.hidden = false;
    clearTimeout(msgT); msgT = setTimeout(() => { m.hidden = true; }, dur * 1000);
  };
  let bannerT = null;
  H.banner = (title, sub, team, dur = 5) => {
    const b = $('banner');
    b.innerHTML = `<div class="bt ${team ? team.toLowerCase() : ''}">${esc(title)}</div>${sub ? `<div class="bs">${sub}</div>` : ''}`;
    b.hidden = false; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, dur * 1000);
  };
  H.moneyPop = (amt) => {
    const el = document.createElement('div');
    el.className = 'mpop ' + (amt >= 0 ? 'plus' : 'minus');
    el.textContent = (amt >= 0 ? '+$' : '-$') + Math.abs(amt);
    $('moneywrap').appendChild(el);
    setTimeout(() => el.remove(), 2400);
  };

  // damage direction indicator
  H.damageFrom = (angle) => {
    const el = document.createElement('div');
    el.className = 'dmgarc';
    el.style.transform = `translate(-50%,-50%) rotate(${angle}rad)`;
    $('dmgind').appendChild(el);
    setTimeout(() => el.remove(), 1100);
  };

  // ---------- top bar ----------
  function fmtTime(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  function avatars(team) {
    return Game.teamOf(team).map(p => `<span class="av ${team.toLowerCase()} ${p.alive ? '' : 'dead'}" style="--c:${p.color}">${p.alive ? '' : '✕'}</span>`).join('');
  }

  // ---------- per-frame ----------
  let lastSlotsKey = '', slotsShowT = 0;
  H.update = (view, dt) => {
    const G = Game;
    const local = G.local;
    const p = view.p;
    // top bar
    let timer;
    if (G.phase === 'freeze') timer = fmtTime(G.phaseT);
    else if (G.phase === 'live') timer = fmtTime(G.roundTime - G.roundClock);
    else if (G.phase === 'planted') timer = '<span class="c4ico">C4</span>';
    else timer = fmtTime(G.phaseT);
    const lt = local ? local.team : 'CT';
    const left = lt, right = G.other(lt);
    $('tb-left').innerHTML = avatars(left);
    $('tb-right').innerHTML = avatars(right);
    $('tb-sl').textContent = G.score[left]; $('tb-sl').className = 'sc ' + left.toLowerCase();
    $('tb-sr').textContent = G.score[right]; $('tb-sr').className = 'sc ' + right.toLowerCase();
    $('tb-time').innerHTML = timer;
    $('tb-time').className = 'time' + (G.phase === 'planted' ? ' planted' : G.phase === 'freeze' ? ' freeze' : '');
    $('tb-round').textContent = G.phase === 'freeze' ? 'Buy time' : `Round ${G.round} / ${G.mode.maxRounds}`;
    // radar
    drawRadar(p ? { x: p.body.x, z: p.body.z, yaw: view.yaw, p } : { x: view.x, z: view.z, yaw: view.yaw, p: null }, lt);
    $('loc').textContent = p ? World.calloutAt(p.body.x, p.body.z) : '';
    // money (always the local player's)
    if (local) { $('money').textContent = '$' + local.money; $('buyhint').hidden = !(G.canBuy(local) && local.alive); }
    // vitals for the viewed player
    $('vitals').style.visibility = p ? '' : 'hidden';
    $('weapon').style.visibility = p ? '' : 'hidden';
    if (p) {
      $('hp').textContent = Math.max(0, p.hp);
      $('hpbar').style.transform = `scaleX(${Math.max(0, p.hp) / 100})`;
      $('vitals').classList.toggle('low', p.hp <= 20);
      $('ar').textContent = p.armor;
      $('arbar').style.transform = `scaleX(${p.armor / 100})`;
      $('helm').hidden = !p.helmet;
      $('kit').hidden = !p.defuser;
      $('c4ico').hidden = !p.slots[5];
      const w = G.curDef(p), inst = G.curInst(p);
      $('wname').textContent = w.name;
      if (inst && w.mag) { $('ammo').innerHTML = `<b class="${inst.ammo <= w.mag * 0.2 ? 'low' : ''}">${inst.ammo}</b><span>/ ${inst.reserve}</span>`; }
      else if (w.type === 'grenade') $('ammo').innerHTML = `<b>${p.nades.filter(x => x === w.id).length}</b>`;
      else $('ammo').innerHTML = '';
      $('nades').innerHTML = p.nades.map((n, i) => `<span class="nd ${p.cur === 4 && p.nadeIdx === i ? 'on' : ''}">${WEAPONS[n].name.replace(' Grenade', '').replace('Incendiary', 'Incendiary')}</span>`).join('');
      // slot list, shown briefly after switching
      const key = [p.cur, p.nadeIdx, p.slots[1] && p.slots[1].id, p.slots[2] && p.slots[2].id, p.nades.join(), !!p.slots[5]].join('|');
      if (key !== lastSlotsKey) { lastSlotsKey = key; slotsShowT = 2.2; renderSlots(p); }
      slotsShowT -= dt;
      $('slots').classList.toggle('show', slotsShowT > 0);
    }
    // crosshair gap follows inaccuracy
    if (p && H.settings.dynamic) {
      const w = G.curDef(p);
      let gap = 4;
      if (w.inStand !== undefined) gap = 3 + Math.min(40, G.inaccuracy(p, w) * 0.22);
      $('crosshair').style.setProperty('--gap', gap.toFixed(1) + 'px');
    }
    $('crosshair').hidden = !p || !p.alive || G.curDef(p).type === 'sniper' || (G.curDef(p).scope && p.ws.zoom > 0);
    $('crossdot').hidden = !(p && p.alive && G.curDef(p).type === 'sniper' && p.ws.zoom === 0);
    // plant / defuse progress
    const prog = $('progress');
    if (p && p.plantT > 0) { prog.hidden = false; $('progbar').style.transform = `scaleX(${Math.min(1, p.plantT / G.cfg.plantTime)})`; $('proglabel').textContent = 'Planting the bomb'; }
    else if (p && G.bomb.defuser === p) { prog.hidden = false; $('progbar').style.transform = `scaleX(${Math.min(1, p.defuseT / G.bombDefuseTime(p))})`; $('proglabel').textContent = p.defuser ? 'Defusing with kit' : 'Defusing the bomb'; }
    else prog.hidden = true;
    // spectator label
    const spec = $('spec');
    if (local && !local.alive && p && p !== local) { spec.hidden = false; spec.innerHTML = `Spectating <b class="${p.team.toLowerCase()}">${esc(p.name)}</b> · <kbd>Click</kbd> next player · <kbd>Space</kbd> ${view.third ? 'first person' : 'third person'}`; }
    else spec.hidden = true;
    if (H.buyOpen) updateBuyMenu();
    if (H.scoreOpen) renderScoreboard();
  };

  function renderSlots(p) {
    const row = (n, id, extra = '') => `<div class="sl ${p.cur === n ? 'on' : ''}"><i>${n}</i><span>${id ? esc(WEAPONS[id].name) : ''}${extra}</span></div>`;
    let h = '';
    if (p.slots[1]) h += row(1, p.slots[1].id);
    if (p.slots[2]) h += row(2, p.slots[2].id);
    h += row(3, 'knife');
    if (p.nades.length) h += row(4, p.nades[p.cur === 4 ? p.nadeIdx : 0], p.nades.length > 1 ? ` <small>+${p.nades.length - 1}</small>` : '');
    if (p.slots[5]) h += row(5, 'c4');
    $('slots').innerHTML = h;
  }

  // ---------- buy menu ----------
  function buildBuyMenu() {
    const m = $('buymenu');
    m.innerHTML = `<div class="bm-head"><div><span class="eyebrow">Buy menu</span><h3>Loadout</h3></div><div class="bm-money"><span class="eyebrow">Money</span><b id="bm-money">$0</b></div><div class="bm-time"><span class="eyebrow">Buy time left</span><b id="bm-time">0</b></div></div><div class="bm-grid" id="bm-grid"></div><p class="bm-foot">Press a number for the category, then a number for the item. <kbd>B</kbd> or <kbd>Esc</kbd> to close. Click with the mouse.</p>`;
  }
  function itemInfo(id) {
    if (WEAPONS[id]) { const w = WEAPONS[id]; return { name: w.name, price: w.price, stat: w.dmg ? `${w.dmg} dmg · ${w.rpm} rpm · ${w.mag}/${w.reserve}` : w.type === 'grenade' ? 'Utility' : '' }; }
    const e = EQUIPMENT[id]; return { name: e.name, price: e.price, stat: id === 'defuser' ? 'Defuse in 5 s' : id === 'vesthelm' ? 'Armor + head protection' : 'Body armor' };
  }
  let buyKey = '';
  function updateBuyMenu() {
    const p = Game.local; if (!p) return;
    $('bm-money').textContent = '$' + p.money;
    const left = Game.phase === 'freeze' ? Game.phaseT + Game.cfg.buyTime : Math.max(0, Game.cfg.buyTime - Game.roundClock);
    $('bm-time').textContent = Math.ceil(left) + 's';
    const key = p.team + p.money + H.buyCat + p.armor + p.helmet + p.defuser + p.nades.join() + (p.slots[1] && p.slots[1].id) + (p.slots[2] && p.slots[2].id);
    if (key === buyKey) return;
    buyKey = key;
    let h = '';
    BUY_MENU.forEach((cat, ci) => {
      h += `<div class="bm-cat ${H.buyCat === ci ? 'on' : ''}"><div class="bm-cn"><i>${ci + 1}</i>${cat.name}</div><div class="bm-items">`;
      cat.items[p.team].forEach((id, ii) => {
        const inf = itemInfo(id);
        const err = Game.buyCheck(p, id);
        const price = Game.buyPrice(p, id);
        const owned = err && /already|carry/.test(err);
        h += `<button class="bm-item ${err ? 'no' : ''} ${owned ? 'owned' : ''}" data-id="${id}"><i>${H.buyCat === ci ? ii + 1 : ''}</i><b>${esc(inf.name)}</b><span class="pr">$${price}</span><small>${esc(inf.stat)}</small></button>`;
      });
      h += '</div></div>';
    });
    $('bm-grid').innerHTML = h;
  }
  H.openBuy = (open) => {
    H.buyOpen = open; H.buyCat = -1; buyKey = '';
    $('buymenu').hidden = !open;
    $('vcursor').hidden = !open;
    if (open) { H.cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 }; moveCursor(0, 0); updateBuyMenu(); }
  };
  function moveCursor(dx, dy) {
    const c = H.cursor;
    c.x = Math.max(0, Math.min(window.innerWidth - 2, c.x + dx)); c.y = Math.max(0, Math.min(window.innerHeight - 2, c.y + dy));
    const el = $('vcursor'); el.style.transform = `translate(${c.x}px,${c.y}px)`;
    document.querySelectorAll('.bm-item.hover').forEach(e => e.classList.remove('hover'));
    const t = document.elementFromPoint(c.x, c.y);
    const it = t && t.closest && t.closest('.bm-item'); if (it) it.classList.add('hover');
  }
  H.moveCursor = moveCursor;
  H.cursorClick = () => {
    const c = H.cursor;
    const t = document.elementFromPoint(c.x, c.y);
    const it = t && t.closest && t.closest('.bm-item');
    if (it) return it.dataset.id;
    return null;
  };
  H.buyKey = (n) => {
    const p = Game.local;
    if (H.buyCat < 0) { if (n >= 1 && n <= BUY_MENU.length) { H.buyCat = n - 1; buyKey = ''; } return null; }
    const list = BUY_MENU[H.buyCat].items[p.team];
    const id = list[n - 1];
    H.buyCat = -1; buyKey = '';
    return id || null;
  };

  // ---------- scoreboard ----------
  H.scoreOpen = false;
  let sbT = 0;
  function renderScoreboard() {
    if (performance.now() - sbT < 250) return;
    sbT = performance.now();
    const G = Game, local = G.local;
    const lt = local ? local.team : 'CT';
    const table = (team) => {
      const ps = G.teamOf(team).slice().sort((a, b) => b.st.score - a.st.score || b.st.k - a.st.k);
      let h = `<div class="sb-team ${team.toLowerCase()}"><div class="sb-th"><b>${TEAMNAME[team]}</b><span class="sb-score">${G.score[team]}</span></div><table><thead><tr><th class="nm">Player</th><th>Money</th><th>K</th><th>A</th><th>D</th><th>HS%</th><th>ADR</th><th>MVP</th><th>Score</th></tr></thead><tbody>`;
      for (const p of ps) {
        const showMoney = p.team === lt;
        const adr = G.round > 0 ? Math.round(p.st.dmg / Math.max(1, G.round - (G.phase === 'over' ? 0 : 1) || 1)) : 0;
        const hs = p.st.k > 0 ? Math.round(p.st.hs / p.st.k * 100) : 0;
        h += `<tr class="${p.alive ? '' : 'dead'} ${p === local ? 'me' : ''}"><td class="nm"><span class="dotc" style="background:${p.color}"></span>${esc(p.name)}${p.isBot ? ' <small>BOT</small>' : ''}${p.slots[5] && p.team === lt ? ' <em class="tag">C4</em>' : ''}${p.defuser && p.team === lt ? ' <em class="tag">KIT</em>' : ''}</td><td>${showMoney ? '$' + p.money : ''}</td><td>${p.st.k}</td><td>${p.st.a}</td><td>${p.st.d}</td><td>${hs}%</td><td>${adr}</td><td>${p.st.mvp ? '★' + p.st.mvp : ''}</td><td>${p.st.score}</td></tr>`;
      }
      return h + '</tbody></table></div>';
    };
    const hist = G.history.map((r, i) => `<span class="hr ${r.winner.toLowerCase()}" title="Round ${i + 1}: ${r.winner} ${r.reason}">${{ elim: '☠', bomb: '✹', defuse: '✂', time: '⏱' }[r.reason]}</span>`).join('');
    $('scoreboard').innerHTML = `<div class="sb-head"><span class="eyebrow">Competitive · Mirage</span><b>Round ${G.round}</b></div>${table(lt)}<div class="sb-hist">${hist}</div>${table(G.other(lt))}`;
  }
  H.showScore = (open) => { H.scoreOpen = open; $('scoreboard').hidden = !open; sbT = 0; if (open) renderScoreboard(); };
  H.renderScoreboardNow = () => { sbT = 0; renderScoreboard(); };

  // ---------- death panel ----------
  H.deathPanel = (d) => {
    const v = d.victim, k = d.killer;
    const el = $('deathpanel');
    if (!v) { el.hidden = true; return; }
    const wname = WEAPONS[d.weapon] ? WEAPONS[d.weapon].name : d.weapon === 'bomb' ? 'the bomb' : d.weapon;
    let h = `<div class="dp-t">${k && k !== v ? `Killed by <b class="${k.team.toLowerCase()}">${esc(k.name)}</b>` : 'You died'}</div>`;
    if (k && k !== v) h += `<div class="dp-w">${esc(wname)}${d.headshot ? ' · headshot' : ''}${d.wallbang ? ' · wallbang' : ''} · ${Math.max(0, k.hp)} HP left</div>`;
    const rows = [];
    for (const q of Game.players) {
      if (q.team === v.team) continue;
      const given = v.dmgGiven[q.id] || 0, taken = v.dmgTaken[q.id] || 0;
      if (!given && !taken) continue;
      rows.push(`<tr><td>${esc(q.name)}</td><td class="g">${given} in ${v.hitsGiven[q.id] || 0}</td><td class="t">${taken} in ${v.hitsTaken[q.id] || 0}</td></tr>`);
    }
    if (rows.length) h += `<table><thead><tr><th>Enemy</th><th>Given</th><th>Taken</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    el.innerHTML = h; el.hidden = false;
  };
  H.hideDeath = () => { $('deathpanel').hidden = true; };

  return H;
})();
