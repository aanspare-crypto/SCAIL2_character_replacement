#!/usr/bin/env node
// Blackdamp LAN server.
// Serves the game from this folder and relays multiplayer messages between players on the same network.
// Uses only Node's built-in modules, so there is nothing to install: run `node server.js` (optional port argument).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = parseInt(process.env.PORT || process.argv[2] || '8090', 10);
const ROOT = __dirname;
const MAX_PLAYERS = 4;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.css':'text/css', '.json':'application/json', '.md':'text/plain; charset=utf-8' };

const clients = new Map();
let nextId = 1, hostId = null, started = false, diff = 'miner';

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || path.basename(file) === 'server.js') { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type':'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-store' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url !== '/ws' || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  if (clients.size >= MAX_PLAYERS) { frame(socket, Buffer.from(JSON.stringify({ t:'full' }))); setTimeout(() => socket.destroy(), 200); return; }
  const c = { id: nextId++, name: 'Miner', socket, buf: Buffer.alloc(0) };
  clients.set(c.id, c);
  if (hostId === null) hostId = c.id;
  send(c, { t:'welcome', id:c.id, hostId, started, diff, players:roster() });
  broadcast({ t:'roster', hostId, started, diff, players:roster() }, c.id);
  log(`player ${c.id} connected (${clients.size}/${MAX_PLAYERS})`);
  socket.on('data', d => { c.buf = Buffer.concat([c.buf, d]); parse(c); });
  socket.on('close', () => drop(c));
  socket.on('error', () => drop(c));
});

function roster() { return [...clients.values()].map(c => ({ id:c.id, name:c.name })); }

function parse(c) {
  for (;;) {
    const b = c.buf;
    if (b.length < 2) return;
    const op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const start = off + (masked ? 4 : 0), end = start + len;
    if (b.length < end) return;
    let payload = Buffer.from(b.subarray(start, end));
    if (masked) { const m = b.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
    c.buf = b.subarray(end);
    if (op === 8) { drop(c); return; }
    if (op === 9) { frame(c.socket, payload, 10); continue; }
    if (op !== 1) continue;
    let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
    onMessage(c, msg);
  }
}

function frame(socket, data, op = 1) {
  const len = data.length; let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  try { socket.write(Buffer.concat([head, data])); } catch (e) { /* socket already gone */ }
}
function send(c, msg) { frame(c.socket, Buffer.from(JSON.stringify(msg))); }
function broadcast(msg, except) { const data = Buffer.from(JSON.stringify(msg)); for (const c of clients.values()) if (c.id !== except) frame(c.socket, data); }

function onMessage(c, m) {
  switch (m.t) {
    case 'hello': c.name = String(m.name || 'Miner').replace(/[^\w .'-]/g, '').slice(0, 16) || 'Miner'; broadcast({ t:'roster', hostId, started, diff, players:roster() }); return;
    case 'diff': if (c.id === hostId && !started) { diff = m.diff === 'nightmare' ? 'nightmare' : 'miner'; broadcast({ t:'roster', hostId, started, diff, players:roster() }); } return;
    case 'start': if (c.id === hostId) { started = true; diff = m.diff === 'nightmare' ? 'nightmare' : 'miner'; broadcast({ t:'start', diff }, c.id); log('game started'); } return;
    case 'menu': if (c.id === hostId) { started = false; broadcast({ t:'menu' }, c.id); } return;
    default: m.from = c.id; broadcast(m, c.id);
  }
}

function drop(c) {
  if (!clients.has(c.id)) return;
  clients.delete(c.id);
  try { c.socket.destroy(); } catch (e) { /* ignore */ }
  if (hostId === c.id) hostId = clients.size ? [...clients.keys()][0] : null;
  if (!clients.size) started = false;
  broadcast({ t:'leave', id:c.id, hostId, started, diff, players:roster() });
  log(`player ${c.id} left (${clients.size}/${MAX_PLAYERS})`);
}

function log(s) { console.log(new Date().toTimeString().slice(0, 8) + '  ' + s); }

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Try: node server.js ${PORT + 1}`);
  else console.error(e.message);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) addrs.push(a.address);
  console.log('\n  BLACKDAMP LAN server is running.\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  addrs.forEach(a => console.log(`  Friends on your network open:   http://${a}:${PORT}`));
  if (!addrs.length) console.log('  (No network address found. Are you connected to Wi-Fi or a cable?)');
  console.log('\n  Up to 4 players. Keep this window open while you play. Press Ctrl+C to stop.\n');
});
