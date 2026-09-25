'use strict';
// Kasbah: an original map. A walled desert town with a souk street to the A terrace, a well plaza in mid,
// and a cistern tunnel under the town to the B courtyard. Same grid conventions as mirage.js.
(() => {
  const CELL = 64;
  const cx = (col, f = 0.5) => (col + f) * CELL, cz = (row, f = 0.5) => (row + f) * CELL;

  const LEGEND = {
    T: { name: 'T Spawn', h: 64, mat: 'sand' },
    k: { name: 'T Alley', h: 64, mat: 'sand' },
    X: { name: 'Souk', h: 64, mat: 'pave' },
    a: { name: 'A Gate', ramp: ['z', 128, 64], mat: 'slab' },
    j: { name: 'A Arch', h: 128, mat: 'slab' },
    A: { name: 'A Site', h: 128, mat: 'slab' },
    b: { name: 'Bazaar', ramp: ['z', 64, 32], roofY: 216, mat: 'tile' },
    n: { name: 'T Mid', ramp: ['x', 64, 32], mat: 'sand' },
    M: { name: 'Mid', h: 32, mat: 'pave' },
    W: { name: 'Well', h: 32, mat: 'pave' },
    Y: { name: 'Short Stairs', ramp: ['x', 32, 128], stairs: true, mat: 'slab' },
    Q: { name: 'Short', h: 128, mat: 'slab' },
    O: { name: 'Tower', h: 128, roofY: 280, mat: 'wood' },
    c: { name: 'CT Mid', ramp: ['x', 32, 64], mat: 'pave' },
    K: { name: 'CT Spawn', h: 64, mat: 'pave' },
    r: { name: 'CT Ramp', ramp: ['z', 128, 64], stairs: true, mat: 'slab' },
    l: { name: 'CT Walk', h: 128, mat: 'slab' },
    L: { name: 'Alley', h: 32, mat: 'pave' },
    S: { name: 'B Short', ramp: ['z', 32, 0], mat: 'pave' },
    B: { name: 'B Site', h: 0, mat: 'slab' },
    g: { name: 'Garden', ramp: ['z', 64, 0], mat: 'sand' },
    G: { name: 'Garden', h: 0, mat: 'sand' },
    z: { name: 'Lower T', h: 64, mat: 'sand' },
    d: { name: 'Cistern', ramp: ['z', 64, -64], stairs: true, roofY: 192, mat: 'concrete' },
    U: { name: 'Cistern', h: -64, roofY: 80, mat: 'concrete' },
    V: { name: 'Channel', h: -64, mat: 'concrete' },
    u: { name: 'Cistern', ramp: ['x', -64, 0], stairs: true, roofY: 144, mat: 'concrete' },
    e: { name: 'Cistern Exit', h: 0, roofY: 144, mat: 'tile' },
  };

  const PAINT = [
    // T spawn and the souk street to A
    ['T', 2, 20, 11, 32],
    ['k', 5, 15, 8, 19],
    ['X', 3, 11, 31, 14],
    ['a', 28, 8, 31, 10],
    ['j', 28, 4, 35, 7],
    ['#', 35, 4, 35, 4],
    ['#', 35, 7, 35, 7],
    ['A', 36, 4, 47, 15],
    ['b', 18, 15, 20, 26],
    // mid
    ['n', 12, 27, 16, 31],
    ['M', 17, 27, 23, 31],
    ['W', 24, 20, 31, 32],
    ['W', 26, 17, 31, 19],
    ['#', 27, 25, 28, 26],
    ['Y', 32, 17, 35, 19],
    ['Q', 36, 16, 39, 19],
    ['#', 36, 16, 36, 16],
    ['#', 39, 16, 39, 16],
    ['O', 40, 17, 43, 20],
    ['%', 41, 21, 42, 21],
    ['c', 32, 22, 49, 26],
    ['#', 44, 24, 44, 26],
    ['#', 48, 22, 49, 23],
    // CT side
    ['K', 50, 22, 57, 33],
    ['r', 49, 16, 52, 21],
    ['l', 48, 12, 52, 15],
    ['%', 48, 12, 48, 13],
    ['g', 51, 34, 54, 39],
    ['G', 49, 40, 54, 46],
    ['%', 49, 40, 49, 43],
    // B
    ['L', 32, 29, 46, 32],
    ['S', 43, 33, 46, 36],
    ['#', 43, 36, 43, 36],
    ['#', 46, 36, 46, 36],
    ['B', 37, 37, 48, 49],
    // cistern
    ['z', 8, 33, 13, 38],
    ['d', 9, 39, 12, 43],
    ['U', 8, 44, 29, 47],
    ['U', 26, 41, 29, 43],
    ['V', 16, 44, 22, 47],
    ['u', 30, 41, 33, 43],
    ['e', 34, 41, 36, 43],
    ['#', 36, 43, 36, 43],
  ];

  const BOMBSITES = {
    A: { x0: cx(37, 0), z0: cz(5, 0), x1: cx(46, 1), z1: cz(14, 1), label: [cx(41.5), cz(9.5)] },
    B: { x0: cx(38, 0), z0: cz(38, 0), x1: cx(47, 1), z1: cz(48, 1), label: [cx(42.5), cz(43)] },
  };

  const BUY_ZONES = {
    T: { x0: cx(2, 0), z0: cz(20, 0), x1: cx(12, 0), z1: cz(33, 0) },
    CT: { x0: cx(50, 0), z0: cz(22, 0), x1: cx(58, 0), z1: cz(34, 0) },
  };

  const SPAWNS = {
    T: [[cx(6), cz(25)], [cx(7.5), cz(26.5)], [cx(5), cz(27.5)], [cx(8), cz(24)], [cx(6.5), cz(29)]],
    CT: [[cx(53), cz(26)], [cx(52), cz(27.5)], [cx(53.5), cz(29)], [cx(51.5), cz(24.5)], [cx(52.5), cz(30.5)]],
  };

  const PROPS = [
    // T spawn
    { n: 'T cart', x: cx(3.8), z: cz(23.5), w: 90, d: 150, h: 60, mat: 'wood' },
    { n: 'T crates', x: cx(9.8), z: cz(31.3), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'T crates', x: cx(9.9), z: cz(31.3), w: 48, d: 48, h: 44, mat: 'crate', stack: 64 },
    // Souk street
    { n: 'Stall', x: cx(11), z: cz(11.1), w: 150, d: 52, h: 40, mat: 'wood' },
    { n: 'Stall', x: cx(15.6), z: cz(13.9), w: 120, d: 52, h: 40, mat: 'wood' },
    { n: 'Stall', x: cx(24.4), z: cz(11.1), w: 150, d: 52, h: 40, mat: 'wood' },
    { n: 'Souk pillar', x: cx(13), z: cz(12.5), w: 44, d: 44, h: 220, mat: 'stone' },
    { n: 'Souk crates', x: cx(21.6), z: cz(12.6), w: 60, d: 60, h: 60, mat: 'crate' },
    { n: 'Souk crates', x: cx(3.7), z: cz(11.8), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'Souk crates', x: cx(26.6), z: cz(13.8), w: 52, d: 52, h: 48, mat: 'crate' },
    { n: 'Arch boxes', x: cx(33), z: cz(4.4), w: 56, d: 56, h: 56, mat: 'crate' },
    // A site
    { n: 'A big box', x: cx(38.5), z: cz(10.5), w: 72, d: 72, h: 72, mat: 'crate' },
    { n: 'A default', x: cx(42), z: cz(8.5), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'A default', x: cx(42.1), z: cz(8.4), w: 50, d: 50, h: 44, mat: 'crate', stack: 64 },
    { n: 'A crates', x: cx(45.5), z: cz(13.5), w: 64, d: 64, h: 60, mat: 'crate' },
    { n: 'A planter', x: cx(44), z: cz(5), w: 150, d: 56, h: 36, mat: 'stone' },
    { n: 'A barrels', x: cx(36.2), z: cz(12.6), w: 48, d: 48, h: 48, mat: 'crate' },
    { n: 'A pillar', x: cx(44.5), z: cz(8), w: 40, d: 40, h: 200, mat: 'stone' },
    { n: 'A pillar', x: cx(40.5), z: cz(13.4), w: 40, d: 40, h: 200, mat: 'stone' },
    // Short and tower
    { n: 'Short box', x: cx(38.6), z: cz(18.6), w: 56, d: 56, h: 52, mat: 'crate' },
    { n: 'Tower table', x: cx(42.6), z: cz(17.8), w: 80, d: 50, h: 36, mat: 'wood' },
    // Mid
    { n: 'Well', x: cx(25.6), z: cz(24.4), w: 110, d: 110, h: 40, mat: 'stone' },
    { n: 'Mid crates', x: cx(24.8), z: cz(20.4), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'Mid crates', x: cx(30.5), z: cz(31.4), w: 64, d: 64, h: 56, mat: 'crate' },
    { n: 'Mid cart', x: cx(20), z: cz(30.8), w: 150, d: 56, h: 48, mat: 'wood' },
    { n: 'CT mid car', x: cx(37), z: cz(25.6), w: 200, d: 84, h: 70, mat: 'car' },
    { n: 'CT mid boxes', x: cx(41), z: cz(22.5), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'Bazaar crates', x: cx(18.3), z: cz(21), w: 44, d: 44, h: 44, mat: 'crate' },
    { n: 'Alley crates', x: cx(34.5), z: cz(29.4), w: 56, d: 56, h: 56, mat: 'crate' },
    // B site
    { n: 'Fountain', x: cx(42.5), z: cz(43), w: 160, d: 160, h: 32, mat: 'stone' },
    { n: 'Fountain', x: cx(42.5), z: cz(43), w: 40, d: 40, h: 70, mat: 'stone', stack: 32 },
    { n: 'B pillar', x: cx(39), z: cz(39), w: 48, d: 48, h: 220, mat: 'stone' },
    { n: 'B pillar', x: cx(46), z: cz(47), w: 48, d: 48, h: 220, mat: 'stone' },
    { n: 'B double', x: cx(38.5), z: cz(47.5), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'B double', x: cx(38.4), z: cz(47.6), w: 52, d: 52, h: 44, mat: 'crate', stack: 64 },
    { n: 'B cart', x: cx(45), z: cz(40), w: 60, d: 140, h: 44, mat: 'wood' },
    { n: 'B crates', x: cx(47.4), z: cz(38.6), w: 56, d: 56, h: 56, mat: 'crate' },
    { n: 'B planter', x: cx(41.5), z: cz(49.1), w: 150, d: 48, h: 36, mat: 'stone' },
    // Garden, CT spawn, CT walk
    { n: 'Garden crates', x: cx(52), z: cz(41), w: 64, d: 64, h: 60, mat: 'crate' },
    { n: 'Garden bench', x: cx(54.1), z: cz(44.6), w: 36, d: 130, h: 22, mat: 'wood' },
    { n: 'CT truck', x: cx(55.5), z: cz(27), w: 110, d: 230, h: 100, mat: 'van' },
    { n: 'CT crates', x: cx(56.5), z: cz(32.5), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'CT walk crates', x: cx(51.9), z: cz(12.1), w: 56, d: 56, h: 56, mat: 'crate' },
    // Cistern
    { n: 'Lower crates', x: cx(12.5), z: cz(36), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'Cistern barrels', x: cx(14), z: cz(44.6), w: 48, d: 48, h: 48, mat: 'crate' },
    { n: 'Cistern crates', x: cx(26), z: cz(46.4), w: 56, d: 56, h: 56, mat: 'crate' },
    // Palms
    { n: 'Palm', x: cx(2.6), z: cz(31.4), w: 22, d: 22, h: 360, mat: 'palm' },
    { n: 'Palm', x: cx(10.4), z: cz(20.6), w: 22, d: 22, h: 340, mat: 'palm' },
    { n: 'Palm', x: cx(25), z: cz(31.6), w: 22, d: 22, h: 380, mat: 'palm' },
    { n: 'Palm', x: cx(47.6), z: cz(48.6), w: 22, d: 22, h: 360, mat: 'palm' },
    { n: 'Palm', x: cx(41.8), z: cz(37.4), w: 22, d: 22, h: 340, mat: 'palm' },
    { n: 'Palm', x: cx(49.6), z: cz(42.6), w: 22, d: 22, h: 380, mat: 'palm' },
    { n: 'Palm', x: cx(57.2), z: cz(22.8), w: 22, d: 22, h: 360, mat: 'palm' },
    { n: 'Palm', x: cx(46.6), z: cz(4.6), w: 22, d: 22, h: 340, mat: 'palm' },
  ];

  const SPOTS = {
    // CT holds
    ct_a_walk: { p: [cx(49.5), cz(12.8)], look: [cx(36), cz(6)], zone: 'A' },
    ct_a_box: { p: [cx(39.4), cz(12)], look: [cx(37.5), cz(16.5)], zone: 'A' },
    ct_a_default: { p: [cx(43.6), cz(10.4)], look: [cx(36), cz(6)], zone: 'A' },
    ct_a_short: { p: [cx(44), cz(12.5)], look: [cx(37.5), cz(16.5)], zone: 'A' },
    ct_a_back: { p: [cx(46.6), cz(6.2)], look: [cx(35), cz(5.8)], zone: 'A' },
    ct_tower: { p: [cx(41.5), cz(20.3)], look: [cx(32), cz(24)], zone: 'MID' },
    ct_mid_car: { p: [cx(38.5), cz(24)], look: [cx(28), cz(26)], zone: 'MID' },
    ct_mid_arch: { p: [cx(45.6), cz(22.8)], look: [cx(30), cz(22.5)], zone: 'MID' },
    ct_b_fountain: { p: [cx(44.8), cz(43.5)], look: [cx(44.5), cz(35)], zone: 'B' },
    ct_b_pillar: { p: [cx(40.2), cz(40.4)], look: [cx(35), cz(42)], zone: 'B' },
    ct_b_garden: { p: [cx(50.4), cz(41.5)], look: [cx(39), cz(42)], zone: 'B' },
    ct_b_double: { p: [cx(40.4), cz(46.2)], look: [cx(35), cz(42)], zone: 'B' },
    ct_b_cart: { p: [cx(46), cz(40.5)], look: [cx(36), cz(42)], zone: 'B' },
    ct_rt_a: { p: [cx(50.5), cz(17)], look: [cx(44), cz(12)], zone: 'A' },
    ct_rt_a2: { p: [cx(50), cz(14)], look: [cx(40), cz(9)], zone: 'A' },
    ct_rt_b: { p: [cx(52.5), cz(36)], look: [cx(44), cz(42)], zone: 'B' },
    ct_rt_b2: { p: [cx(50), cz(45)], look: [cx(40), cz(44)], zone: 'B' },
    // T staging spots
    t_gate_low: { p: [cx(25), cz(12.4)], look: [cx(29.5), cz(9)], zone: 'A' },
    t_gate: { p: [cx(29.5), cz(9.5)], look: [cx(36), cz(5.5)], zone: 'A' },
    t_gate2: { p: [cx(29), cz(11.5)], look: [cx(30), cz(6)], zone: 'A' },
    t_short_low: { p: [cx(29), cz(18.5)], look: [cx(36), cz(18)], zone: 'A' },
    t_short: { p: [cx(31.2), cz(18)], look: [cx(38), cz(15)], zone: 'A' },
    t_bazaar: { p: [cx(19.5), cz(16.5)], look: [cx(25), cz(12.5)], zone: 'MID' },
    t_mid: { p: [cx(22), cz(28.5)], look: [cx(40), cz(24)], zone: 'MID' },
    t_plaza: { p: [cx(25.3), cz(29)], look: [cx(40), cz(24.5)], zone: 'MID' },
    t_alley: { p: [cx(41), cz(30.5)], look: [cx(44.5), cz(36)], zone: 'B' },
    t_bshort: { p: [cx(43.5), cz(30.8)], look: [cx(44.5), cz(34)], zone: 'B' },
    t_tunnel: { p: [cx(27.5), cz(45.5)], look: [cx(28), cz(41)], zone: 'B' },
    t_tunnel2: { p: [cx(31.5), cz(42)], look: [cx(40), cz(42)], zone: 'B' },
    t_lower: { p: [cx(10.5), cz(35.5)], look: [cx(10.5), cz(42)], zone: 'B' },
    // Post-plant spots
    pp_a_gate: { p: [cx(34), cz(6)], look: [cx(42), cz(10)], zone: 'A' },
    pp_a_short: { p: [cx(37.5), cz(17.5)], look: [cx(41.5), cz(11)], zone: 'A' },
    pp_a_box: { p: [cx(38.5), cz(6.6)], look: [cx(48), cz(13)], zone: 'A' },
    pp_a_default: { p: [cx(40.2), cz(9.8)], look: [cx(48), cz(13.5)], zone: 'A' },
    pp_b_short: { p: [cx(44.5), cz(35)], look: [cx(47), cz(44)], zone: 'B' },
    pp_b_tunnel: { p: [cx(35.5), cz(42)], look: [cx(44), cz(44)], zone: 'B' },
    pp_b_double: { p: [cx(38.3), cz(46.1)], look: [cx(48), cz(41)], zone: 'B' },
    pp_b_site: { p: [cx(40.5), cz(44.2)], look: [cx(48), cz(41)], zone: 'B' },
    // Plant spots
    plant_a: { p: [cx(41), cz(11.8)], zone: 'A' },
    plant_a2: { p: [cx(44), cz(6.9)], zone: 'A' },
    plant_b: { p: [cx(40.2), cz(41.8)], zone: 'B' },
    plant_b2: { p: [cx(45.4), cz(45.6)], zone: 'B' },
  };

  const LINEUPS = {
    A: [
      { type: 'smoke', from: 't_gate', to: [cx(48.5), cz(13.5)] },     // CT walk
      { type: 'smoke', from: 't_short', to: [cx(44.5), cz(9)] },       // A default
      { type: 'flash', from: 't_gate2', to: [cx(40), cz(10)] },
      { type: 'molotov', from: 't_short_low', to: [cx(38.5), cz(5.5)] }, // big box
    ],
    B: [
      { type: 'smoke', from: 't_alley', to: [cx(48.5), cz(43)] },      // garden
      { type: 'smoke', from: 't_bshort', to: [cx(45.5), cz(44)] },     // fountain
      { type: 'flash', from: 't_tunnel2', to: [cx(40), cz(42)] },
      { type: 'molotov', from: 't_bshort', to: [cx(40.4), cz(46.2)] }, // double stack
    ],
  };

  const CT_UTILITY = {
    A: [
      { type: 'incgrenade', to: [cx(33), cz(5.5)] },     // arch
      { type: 'he', to: [cx(37.5), cz(17)] },            // short
      { type: 'flash', to: [cx(34), cz(6)] },
      { type: 'smoke', to: [cx(32), cz(6)] },
    ],
    B: [
      { type: 'incgrenade', to: [cx(44.5), cz(34.5)] },  // B short
      { type: 'he', to: [cx(35.5), cz(42)] },            // cistern exit
      { type: 'flash', to: [cx(44.5), cz(35)] },
      { type: 'smoke', to: [cx(44.5), cz(33.5)] },
    ],
  };

  const BOT = {
    zones: {
      A: ['A Site', 'A Arch', 'A Gate', 'Short', 'Tower', 'CT Walk'],
      B: ['B Site', 'B Short', 'Alley', 'Cistern Exit', 'Cistern', 'Garden'],
    },
    routes: {
      A: { gate: ['t_gate', 't_gate2'], short: ['t_short', 't_short_low'] },
      B: { tunnel: ['t_tunnel', 't_tunnel2'], alley: ['t_alley', 't_bshort'] },
    },
    mainRoutes: { A: ['gate', 'gate', 'short'], B: ['tunnel', 'alley', 'alley'] },
    defaultT: ['t_mid', 't_gate_low', 't_tunnel', 't_plaza', 't_bazaar'],
    lurk: { A: ['t_tunnel', 't_alley', 't_lower'], B: ['t_gate_low', 't_bazaar', 't_short_low'] },
    fallback: 't_mid',
    ctHolds: {
      A: ['ct_a_walk', 'ct_a_box', 'ct_a_default', 'ct_a_short', 'ct_a_back'],
      MID: ['ct_mid_arch', 'ct_mid_car', 'ct_tower'],
      B: ['ct_b_fountain', 'ct_b_pillar', 'ct_b_garden', 'ct_b_double', 'ct_b_cart'],
    },
    awpSpots: { MID: 'ct_mid_arch', A: 'ct_a_walk', B: 'ct_b_garden' },
    retake: { A: ['ct_rt_a2', 'ct_rt_a', 'ct_a_walk'], B: ['ct_rt_b2', 'ct_rt_b', 'ct_b_garden'] },
    postplant: { A: ['pp_a_gate', 'pp_a_short', 'pp_a_box', 'pp_a_default'], B: ['pp_b_short', 'pp_b_tunnel', 'pp_b_double', 'pp_b_site'] },
    plants: { A: ['plant_a', 'plant_a2'], B: ['plant_b', 'plant_b2'] },
    splitWord: { A: 'short', B: 'cistern' },
  };

  (globalThis.MAPS = globalThis.MAPS || {}).kasbah = {
    name: 'Kasbah', blurb: 'Terracotta walls at sunset: souk street, well plaza, cistern tunnel, a terrace A and a courtyard B.',
    W: 60, H: 52, legend: LEGEND, paint: PAINT, bombsites: BOMBSITES, buyZones: BUY_ZONES, spawns: SPAWNS,
    props: PROPS, spots: SPOTS, lineups: LINEUPS, ctUtility: CT_UTILITY, bot: BOT,
    spawnLook: { T: [cx(20), cz(28)], CT: [cx(40), cz(24)] },
    menuPath: [
      [[300, 480, 1650], [1300, 100, 1800]],
      [[1350, 460, 1650], [2200, 60, 1500]],
      [[2250, 470, 1250], [3100, 90, 1550]],
      [[1900, 520, 800], [2700, 150, 600]],
      [[2600, 600, 250], [2900, 140, 800]],
      [[3400, 520, 1000], [3300, 80, 1800]],
      [[3300, 480, 2300], [2700, 20, 2800]],
      [[1400, 420, 2750], [900, -40, 2950]],
    ],
    theme: {
      wallTint: [1.05, 0.9, 0.78],
      wallMix: [0.5, 0.82],
      sunDir: [-0.55, 0.55, 0.45],
      sunColor: '#ffd2a0',
      sunIntensity: 2.4,
      hemiSky: '#e6cdb0',
      hemiGround: '#8a5f40',
      fog: '#dcb896',
      sky: '#e6b98f',
    },
  };
})();
