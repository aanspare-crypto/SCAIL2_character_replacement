'use strict';
// Picks the active map and exposes its data as globals for the rest of the game.
// Maps live in js/maps/*.js and register themselves on globalThis.MAPS.
// World units follow Source conventions: 1 unit ~ 1 inch, a player is 72 units tall.
// x runs east, z runs south, y is up. Row 0 is the north edge of the map.
if (typeof module !== 'undefined') { require('./maps/mirage.js'); require('./maps/kasbah.js'); }

const CELL = 64;
const FLOOR_BOTTOM = -256;

const MAP_ID = (() => {
  const maps = globalThis.MAPS;
  let id = null;
  try {
    if (typeof location !== 'undefined') id = new URLSearchParams(location.search).get('map');
    if (!maps[id] && typeof localStorage !== 'undefined') id = JSON.parse(localStorage.getItem('mirage5v5') || '{}').map;
  } catch (e) { id = null; }
  if (!maps[id] && typeof process !== 'undefined' && process.env && process.env.MAP) id = process.env.MAP;
  return maps[id] ? id : 'mirage';
})();
const MAPDEF = globalThis.MAPS[MAP_ID];
const MAP_NAME = MAPDEF.name;
const MAP_W = MAPDEF.W;
const MAP_H = MAPDEF.H;
const LEGEND = MAPDEF.legend;
const PAINT = MAPDEF.paint;
const BOMBSITES = MAPDEF.bombsites;
const BUY_ZONES = MAPDEF.buyZones;
const SPAWNS = MAPDEF.spawns;
const PROPS = MAPDEF.props;
const SPOTS = MAPDEF.spots;
const LINEUPS = MAPDEF.lineups;
const CT_UTILITY = MAPDEF.ctUtility;
const BOT_PLAN = MAPDEF.bot;

// Cell coordinates to world units (cell centre by default).
function cx(col, f = 0.5) { return (col + f) * CELL; }
function cz(row, f = 0.5) { return (row + f) * CELL; }

function buildGrid() {
  const grid = [];
  for (let r = 0; r < MAP_H; r++) grid.push(new Array(MAP_W).fill('#'));
  for (const [ch, c0, r0, c1, r1] of PAINT) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r][c] = ch;
  }
  return grid;
}

if (typeof module !== 'undefined') {
  module.exports = { CELL, MAP_ID, MAPDEF, MAP_NAME, MAP_W, MAP_H, FLOOR_BOTTOM, LEGEND, PAINT, BOMBSITES, BUY_ZONES, SPAWNS, PROPS, SPOTS, LINEUPS, CT_UTILITY, BOT_PLAN, buildGrid, cx, cz };
}
