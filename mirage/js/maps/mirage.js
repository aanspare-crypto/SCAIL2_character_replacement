'use strict';
// Mirage-style map. Painted onto a grid of 64-unit cells; x runs east, z runs south, row 0 is the north edge.
(() => {
  const CELL = 64;
  const cx = (col, f = 0.5) => (col + f) * CELL, cz = (row, f = 0.5) => (row + f) * CELL;

  // Region legend. h = flat floor height. ramp = [axis, heightAtMinEdge, heightAtMaxEdge].
  // roofY = absolute ceiling height for indoor areas. stairs draws steps instead of a slope.
  const LEGEND = {
    T: { name: 'T Spawn', h: 96, mat: 'sand' },
    O: { name: 'T Apps', h: 96, mat: 'sand' },
    n: { name: 'Apartments', ramp: ['x', 160, 96], stairs: true, roofY: 304, mat: 'wood' },
    N: { name: 'Apartments', h: 160, roofY: 304, mat: 'wood' },
    q: { name: 'B Apps', ramp: ['x', 0, 160], stairs: true, roofY: 304, mat: 'wood' },
    B: { name: 'B Site', h: 0, mat: 'slab' },
    G: { name: 'B Short', h: 0, mat: 'pave' },
    V: { name: 'Underpass', ramp: ['x', 0, -96], stairs: true, roofY: 128, mat: 'concrete' },
    U: { name: 'Underpass', h: -96, roofY: 32, mat: 'concrete' },
    v: { name: 'Underpass', ramp: ['z', -96, 0], stairs: true, roofY: 128, mat: 'concrete' },
    j: { name: 'Catwalk', ramp: ['x', 0, 96], stairs: true, mat: 'pave' },
    S: { name: 'Short', h: 96, mat: 'pave' },
    h: { name: 'Short', ramp: ['z', 96, 0], stairs: true, mat: 'pave' },
    M: { name: 'Mid', h: 0, mat: 'pave' },
    m: { name: 'Top Mid', ramp: ['x', 0, 96], mat: 'sand' },
    W: { name: 'Window', h: 160, roofY: 304, mat: 'wood' },
    y: { name: 'Window', ramp: ['z', 160, 128], roofY: 304, mat: 'wood' },
    C: { name: 'Connector', ramp: ['z', 0, 128], mat: 'slab' },
    J: { name: 'Jungle', h: 128, mat: 'slab' },
    Y: { name: 'Stairs', ramp: ['z', 128, 32], stairs: true, mat: 'slab' },
    g: { name: 'Jungle', ramp: ['z', 128, 32], stairs: true, mat: 'slab' },
    A: { name: 'A Site', h: 32, mat: 'slab' },
    c: { name: 'CT', h: 32, mat: 'pave' },
    k: { name: 'Ticket Booth', h: 32, mat: 'pave' },
    K: { name: 'CT Spawn', h: 32, mat: 'pave' },
    Z: { name: 'Back Alley', ramp: ['z', 0, 32], mat: 'pave' },
    x: { name: 'Arch', h: 0, mat: 'pave' },
    e: { name: 'Arch', h: 0, roofY: 176, mat: 'pave' },
    X: { name: 'Market', h: 0, roofY: 144, mat: 'tile' },
    Q: { name: 'Kitchen', h: 0, roofY: 144, mat: 'tile' },
    R: { name: 'T Ramp', ramp: ['z', 96, 0], mat: 'sand' },
    r: { name: 'T Ramp', h: 0, mat: 'sand' },
    a: { name: 'A Ramp', ramp: ['x', 32, 0], mat: 'slab' },
    p: { name: 'Palace', ramp: ['z', 0, 128], stairs: true, mat: 'slab' },
    P: { name: 'Palace', h: 128, roofY: 288, mat: 'tile' },
    l: { name: 'Palace', ramp: ['x', 32, 128], stairs: true, mat: 'slab' },
  };

  // [char, col0, row0, col1, row1] inclusive, applied in order onto a grid of '#'.
  const PAINT = [
    // T side
    ['T', 53, 19, 61, 34],
    ['O', 53, 11, 59, 18],
    ['n', 48, 11, 52, 12],
    ['N', 38, 9, 47, 12],
    ['N', 32, 5, 37, 11],
    ['N', 18, 4, 31, 7],
    ['q', 14, 5, 17, 6],
    // B
    ['B', 3, 3, 13, 16],
    ['G', 14, 12, 16, 14],
    ['G', 15, 15, 16, 18],
    ['V', 17, 13, 19, 14],
    ['U', 20, 13, 35, 14],
    ['U', 36, 13, 37, 17],
    ['v', 36, 18, 37, 22],
    ['j', 17, 16, 19, 17],
    ['S', 20, 16, 31, 17],
    ['h', 30, 18, 31, 22],
    // mid
    ['M', 25, 23, 44, 28],
    ['m', 45, 22, 52, 29],
    ['W', 19, 22, 23, 28],
    ['%', 24, 23, 24, 27],
    ['y', 20, 29, 21, 34],
    ['C', 27, 29, 29, 34],
    ['J', 20, 35, 29, 38],
    // A
    ['A', 24, 40, 38, 54],
    ['=', 24, 39, 25, 39],
    ['=', 29, 39, 29, 39],
    ['Y', 26, 39, 28, 41],
    ['g', 20, 39, 21, 41],
    ['K', 5, 40, 16, 53],
    ['c', 17, 42, 23, 46],
    ['k', 17, 50, 23, 53],
    // CT to B
    ['Z', 8, 23, 11, 39],
    ['x', 9, 17, 11, 22],
    ['e', 9, 19, 11, 20],
    ['X', 2, 18, 6, 26],
    ['X', 5, 17, 6, 17],
    ['%', 3, 17, 4, 17],
    ['X', 7, 24, 7, 25],
    ['Q', 13, 20, 16, 23],
    ['Q', 15, 19, 15, 19],
    ['Q', 12, 22, 12, 22],
    // T ramp and palace
    ['R', 55, 35, 60, 41],
    ['r', 51, 42, 60, 47],
    ['a', 39, 42, 50, 46],
    ['p', 56, 48, 58, 51],
    ['P', 42, 52, 58, 56],
    ['l', 39, 52, 41, 54],
    // interior walls
    ['#', 50, 52, 50, 53],
    ['#', 50, 56, 50, 56],
    ['#', 46, 52, 46, 52],
    ['#', 37, 9, 37, 9],
    ['#', 32, 9, 33, 11],
  ];


  // Bombsite plant zones (world units).
  const BOMBSITES = {
    A: { x0: cx(26, 0), z0: cz(42, 0), x1: cx(37, 1), z1: cz(53, 1), label: [cx(31), cz(47)] },
    B: { x0: cx(3, 0), z0: cz(3, 0), x1: cx(13, 1), z1: cz(14, 1), label: [cx(8), cz(9)] },
  };

  const BUY_ZONES = {
    T: { x0: cx(52, 0), z0: cz(18, 0), x1: cx(62, 0), z1: cz(35, 0) },
    CT: { x0: cx(4, 0), z0: cz(39, 0), x1: cx(17, 0), z1: cz(54, 0) },
  };

  const SPAWNS = {
    T: [[cx(57), cz(26)], [cx(58.5), cz(27.5)], [cx(56), cz(28.5)], [cx(59), cz(25)], [cx(55.5), cz(25.5)]],
    CT: [[cx(10), cz(42.5)], [cx(12), cz(43.5)], [cx(9.5), cz(44.5)], [cx(13.5), cz(42)], [cx(11.5), cz(45.5)]],
  };

  // Solid props: [x, z, width(x), depth(z), height, material, opts]. x,z = centre. Base is the floor below.
  // mat: crate, wood, stone, metal, plaster, car.
  const PROPS = [
    // A site
    { n: 'Triple', x: cx(31), z: cz(48), w: 112, d: 64, h: 64, mat: 'crate' },
    { n: 'Triple', x: cx(31.4), z: cz(48), w: 56, d: 56, h: 56, mat: 'crate', stack: 64 },
    { n: 'Firebox', x: cx(35.5), z: cz(51.2), w: 64, d: 64, h: 56, mat: 'crate' },
    { n: 'Default', x: cx(33.3), z: cz(45.6), w: 96, d: 56, h: 60, mat: 'crate' },
    { n: 'Sandwich', x: cx(29.8), z: cz(42.2), w: 60, d: 60, h: 64, mat: 'crate' },
    { n: 'Sandwich', x: cx(30.7), z: cz(42.2), w: 48, d: 48, h: 44, mat: 'crate' },
    { n: 'Tetris', x: cx(39.4), z: cz(42.4), w: 60, d: 60, h: 60, mat: 'crate' },
    { n: 'Tetris', x: cx(40.3), z: cz(42.3), w: 56, d: 56, h: 100, mat: 'crate' },
    { n: 'Tetris', x: cx(41.8), z: cz(46.4), w: 72, d: 48, h: 44, mat: 'crate' },
    { n: 'Ticket', x: cx(20), z: cz(51.2), w: 120, d: 64, h: 110, mat: 'booth' },
    { n: 'Ninja', x: cx(37.8), z: cz(54.2), w: 44, d: 44, h: 40, mat: 'crate' },
    { n: 'A planter', x: cx(25.6), z: cz(47), w: 72, d: 150, h: 36, mat: 'stone' },
    { n: 'A pillar', x: cx(24.6), z: cz(41.2), w: 40, d: 40, h: 200, mat: 'stone' },
    // Jungle / connector
    { n: 'Jungle box', x: cx(24.5), z: cz(36.5), w: 56, d: 56, h: 56, mat: 'crate' },
    { n: 'Connector box', x: cx(27.4), z: cz(31.5), w: 44, d: 60, h: 48, mat: 'crate' },
    // Mid
    { n: 'Top mid box', x: cx(46.3), z: cz(23.4), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'Top mid box', x: cx(47.3), z: cz(23.3), w: 52, d: 52, h: 44, mat: 'crate' },
    { n: 'Mid car', x: cx(40), z: cz(27.8), w: 200, d: 84, h: 70, mat: 'car' },
    { n: 'Chair', x: cx(25.6), z: cz(27.9), w: 56, d: 56, h: 52, mat: 'crate' },
    { n: 'Mid boxes', x: cx(33.8), z: cz(23.4), w: 64, d: 56, h: 56, mat: 'crate' },
    // B site
    { n: 'Van', x: cx(10.8), z: cz(11.6), w: 110, d: 232, h: 100, mat: 'van' },
    { n: 'Bench', x: cx(4.2), z: cz(9), w: 36, d: 140, h: 22, mat: 'wood' },
    { n: 'B pillar', x: cx(8.5), z: cz(4.5), w: 48, d: 48, h: 220, mat: 'stone' },
    { n: 'B pillar', x: cx(6.5), z: cz(13.5), w: 48, d: 48, h: 220, mat: 'stone' },
    { n: 'B boxes', x: cx(12.4), z: cz(4.5), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'B boxes', x: cx(12.4), z: cz(5.5), w: 48, d: 48, h: 48, mat: 'crate' },
    { n: 'B default', x: cx(7), z: cz(9), w: 56, d: 56, h: 52, mat: 'crate' },
    { n: 'B short box', x: cx(15.6), z: cz(17.4), w: 48, d: 48, h: 48, mat: 'crate' },
    // Market / kitchen
    { n: 'Market stall', x: cx(3.2), z: cz(21.5), w: 64, d: 150, h: 40, mat: 'wood' },
    { n: 'Market stall', x: cx(5.6), z: cz(25.2), w: 110, d: 48, h: 40, mat: 'wood' },
    { n: 'Kitchen table', x: cx(14.3), z: cz(21.8), w: 90, d: 50, h: 36, mat: 'wood' },
    // CT spawn
    { n: 'CT truck', x: cx(7.2), z: cz(43.5), w: 110, d: 230, h: 104, mat: 'van' },
    { n: 'CT boxes', x: cx(15.4), z: cz(51.5), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'CT boxes', x: cx(14.4), z: cz(52.4), w: 56, d: 56, h: 48, mat: 'crate' },
    { n: 'Back alley box', x: cx(10.4), z: cz(31), w: 50, d: 50, h: 50, mat: 'crate' },
    // T side
    { n: 'T cart', x: cx(55), z: cz(21), w: 90, d: 160, h: 60, mat: 'wood' },
    { n: 'T boxes', x: cx(60.5), z: cz(31.5), w: 64, d: 64, h: 64, mat: 'crate' },
    { n: 'T boxes', x: cx(60.4), z: cz(30.5), w: 52, d: 52, h: 44, mat: 'crate' },
    { n: 'Apps boxes', x: cx(57.8), z: cz(12), w: 64, d: 64, h: 60, mat: 'crate' },
    { n: 'Ramp boxes', x: cx(52.6), z: cz(46.5), w: 64, d: 64, h: 56, mat: 'crate' },
    { n: 'Ramp boxes', x: cx(59.5), z: cz(43), w: 60, d: 60, h: 64, mat: 'crate' },
    // Palace
    { n: 'Palace pillar', x: cx(50), z: cz(53.5), w: 48, d: 48, h: 160, mat: 'stone' },
    { n: 'Palace pillar', x: cx(46), z: cz(55), w: 48, d: 48, h: 160, mat: 'stone' },
    { n: 'Palace box', x: cx(54), z: cz(55.6), w: 56, d: 56, h: 52, mat: 'crate' },
    // Apartments
    { n: 'Apps table', x: cx(42), z: cz(10.2), w: 90, d: 56, h: 36, mat: 'wood' },
    { n: 'Apps wall', x: cx(44), z: cz(11.8), w: 20, d: 80, h: 144, mat: 'plaster' },
    { n: 'Apps boxes', x: cx(33), z: cz(5.6), w: 60, d: 60, h: 60, mat: 'crate' },
    { n: 'Apps bed', x: cx(36.6), z: cz(5.5), w: 60, d: 100, h: 28, mat: 'wood' },
    { n: 'Apps boxes', x: cx(24), z: cz(4.6), w: 56, d: 56, h: 52, mat: 'crate' },
    { n: 'Apps wall', x: cx(28), z: cz(6.9), w: 20, d: 70, h: 144, mat: 'plaster' },
    // Underpass
    { n: 'Underpass box', x: cx(28), z: cz(14.5), w: 48, d: 48, h: 48, mat: 'crate' },
    // Palms
    { n: 'Palm', x: cx(60.4), z: cz(20.4), w: 22, d: 22, h: 360, mat: 'palm' },
    { n: 'Palm', x: cx(5.6), z: cz(51.6), w: 22, d: 22, h: 340, mat: 'palm' },
    { n: 'Palm', x: cx(16.2), z: cz(40.6), w: 22, d: 22, h: 380, mat: 'palm' },
    { n: 'Palm', x: cx(37.6), z: cz(40.6), w: 22, d: 22, h: 360, mat: 'palm' },
    { n: 'Palm', x: cx(3.6), z: cz(3.6), w: 22, d: 22, h: 340, mat: 'palm' },
  ];

  // Positions bots use. Each spot: [x, z] plus the point it watches.
  const SPOTS = {
    // CT holds
    ct_a_ticket: { p: [cx(21.5), cz(52.8)], look: [cx(38), cz(53)], zone: 'A' },
    ct_a_jungle: { p: [cx(23.2), cz(37)], look: [cx(38), cz(44)], zone: 'A' },
    ct_a_stairs: { p: [cx(27.5), cz(38)], look: [cx(39), cz(44)], zone: 'A' },
    ct_a_ct: { p: [cx(21), cz(44.5)], look: [cx(39), cz(45)], zone: 'A' },
    ct_a_firebox: { p: [cx(34.5), cz(52.8)], look: [cx(41), cz(53)], zone: 'A' },
    ct_a_triple: { p: [cx(30.2), cz(49.5)], look: [cx(39), cz(44)], zone: 'A' },
    ct_window: { p: [cx(21.5), cz(25.5)], look: [cx(50), cz(25.5)], zone: 'MID' },
    ct_connector: { p: [cx(28), cz(33)], look: [cx(28), cz(25)], zone: 'MID' },
    ct_short: { p: [cx(22), cz(16.5)], look: [cx(31), cz(17)], zone: 'MID' },
    ct_b_van: { p: [cx(9), cz(13.2)], look: [cx(16), cz(6)], zone: 'B' },
    ct_b_bench: { p: [cx(4.3), cz(11)], look: [cx(14), cz(6)], zone: 'B' },
    ct_b_market: { p: [cx(4.5), cz(19.5)], look: [cx(12), cz(6)], zone: 'B' },
    ct_b_kitchen: { p: [cx(15.5), cz(21.5)], look: [cx(15.5), cz(13)], zone: 'B' },
    ct_b_arch: { p: [cx(10), cz(18.5)], look: [cx(15), cz(5.5)], zone: 'B' },
    // T staging spots, before an execute
    t_ramp_top: { p: [cx(44), cz(44)], look: [cx(36), cz(46)], zone: 'A' },
    t_ramp_low: { p: [cx(48), cz(45)], look: [cx(38), cz(44)], zone: 'A' },
    t_palace: { p: [cx(45), cz(53.5)], look: [cx(36), cz(53)], zone: 'A' },
    t_palace2: { p: [cx(48), cz(54.5)], look: [cx(36), cz(53)], zone: 'A' },
    t_connector_low: { p: [cx(28.2), cz(26.5)], look: [cx(28), cz(35)], zone: 'MID' },
    t_top_mid: { p: [cx(49), cz(25)], look: [cx(25), cz(25)], zone: 'MID' },
    t_apps: { p: [cx(22), cz(5.5)], look: [cx(14), cz(6)], zone: 'B' },
    t_apps2: { p: [cx(26), cz(6)], look: [cx(14), cz(6)], zone: 'B' },
    t_underpass: { p: [cx(22), cz(13.8)], look: [cx(16), cz(13.5)], zone: 'B' },
    t_short: { p: [cx(26), cz(16.8)], look: [cx(17), cz(17)], zone: 'B' },
    // Post-plant spots
    pp_a_ramp: { p: [cx(41.5), cz(44.8)], look: [cx(26), cz(46)], zone: 'A' },
    pp_a_palace: { p: [cx(40.5), cz(53)], look: [cx(25), cz(47)], zone: 'A' },
    pp_a_sandwich: { p: [cx(29.5), cz(43.4)], look: [cx(22), cz(44)], zone: 'A' },
    pp_a_triple: { p: [cx(32.5), cz(49.4)], look: [cx(22), cz(52)], zone: 'A' },
    pp_b_apps: { p: [cx(15.2), cz(5.6)], look: [cx(6), cz(14)], zone: 'B' },
    pp_b_short: { p: [cx(15.5), cz(13)], look: [cx(9), cz(17)], zone: 'B' },
    pp_b_van: { p: [cx(12.5), cz(13.5)], look: [cx(5), cz(18)], zone: 'B' },
    pp_b_site: { p: [cx(10), cz(7)], look: [cx(10), cz(18)], zone: 'B' },
    // Plant spots
    plant_a: { p: [cx(32.5), cz(46.5)], zone: 'A' },
    plant_a2: { p: [cx(34.5), cz(50.3)], zone: 'A' },
    plant_b: { p: [cx(8), cz(8.3)], zone: 'B' },
    plant_b2: { p: [cx(5.5), cz(6)], zone: 'B' },
  };

  // Grenade lineups: from a spot, a throw lands on target. Used during executes.
  const LINEUPS = {
    A: [
      { type: 'smoke', from: 't_ramp_top', to: [cx(21), cz(44.5)] },   // CT
      { type: 'smoke', from: 't_palace', to: [cx(24), cz(37)] },        // Jungle
      { type: 'flash', from: 't_ramp_low', to: [cx(33), cz(44)] },
      { type: 'molotov', from: 't_palace2', to: [cx(35.5), cz(52.8)] }, // Firebox
    ],
    B: [
      { type: 'smoke', from: 't_apps', to: [cx(4.5), cz(18.5)] },       // Market window
      { type: 'smoke', from: 't_apps2', to: [cx(10), cz(18.5)] },       // Arch
      { type: 'flash', from: 't_underpass', to: [cx(9), cz(9)] },
      { type: 'molotov', from: 't_apps', to: [cx(9.5), cz(13.5)] },     // Van
    ],
  };

  // Utility the CT side throws at chokepoints when attackers push a site.
  const CT_UTILITY = {
    A: [
      { type: 'incgrenade', to: [cx(41), cz(44.3)] },   // top of A ramp
      { type: 'he', to: [cx(40), cz(53)] },             // palace exit
      { type: 'flash', to: [cx(42), cz(44.5)] },
      { type: 'smoke', to: [cx(43), cz(44.5)] },
    ],
    B: [
      { type: 'incgrenade', to: [cx(15.2), cz(5.8)] },  // apps exit
      { type: 'he', to: [cx(15.5), cz(13.5)] },         // B short
      { type: 'flash', to: [cx(14.5), cz(6.5)] },
      { type: 'smoke', to: [cx(16), cz(6)] },
    ],
  };

  // Named spots the bot tactics use.
  const BOT = {
    zones: {
      A: ['A Site', 'A Ramp', 'Palace', 'Stairs'],
      B: ['B Site', 'B Apps', 'B Short', 'Kitchen', 'Market', 'Arch'],
    },
    routes: {
      A: { ramp: ['t_ramp_low', 't_ramp_top'], palace: ['t_palace', 't_palace2'], mid: ['t_connector_low'] },
      B: { apps: ['t_apps', 't_apps2'], short: ['t_short'], underpass: ['t_underpass'] },
    },
    mainRoutes: { A: ['ramp', 'ramp', 'palace'], B: ['apps', 'apps', 'short'] },
    defaultT: ['t_top_mid', 't_ramp_low', 't_palace', 't_apps', 't_underpass'],
    lurk: { A: ['t_apps', 't_underpass', 't_top_mid'], B: ['t_top_mid', 't_palace', 't_ramp_low'] },
    fallback: 't_top_mid',
    ctHolds: { A: ['ct_a_ticket', 'ct_a_jungle', 'ct_a_stairs', 'ct_a_ct', 'ct_a_firebox', 'ct_a_triple'], MID: ['ct_window', 'ct_connector', 'ct_short'], B: ['ct_b_van', 'ct_b_bench', 'ct_b_market', 'ct_b_kitchen', 'ct_b_arch'] },
    awpSpots: { MID: 'ct_window', A: 'ct_a_jungle', B: 'ct_b_market' },
    retake: { A: ['ct_a_ct', 'ct_a_jungle', 'ct_a_ticket'], B: ['ct_b_market', 'ct_b_arch', 'ct_b_kitchen'] },
    postplant: { A: ['pp_a_ramp', 'pp_a_palace', 'pp_a_sandwich', 'pp_a_triple'], B: ['pp_b_apps', 'pp_b_short', 'pp_b_van', 'pp_b_site'] },
    plants: { A: ['plant_a', 'plant_a2'], B: ['plant_b', 'plant_b2'] },
    splitWord: { A: 'palace', B: 'short' },
  };

  (globalThis.MAPS = globalThis.MAPS || {}).mirage = {
    name: 'Mirage', blurb: 'Sun-bleached streets: ramp, palace, mid, apartments and two bombsites.',
    W: 64, H: 58, legend: LEGEND, paint: PAINT, bombsites: BOMBSITES, buyZones: BUY_ZONES, spawns: SPAWNS,
    props: PROPS, spots: SPOTS, lineups: LINEUPS, ctUtility: CT_UTILITY, bot: BOT,
    spawnLook: { T: [cx(30), cz(27)], CT: [cx(30), cz(46)] },
    menuPath: [
      [[3660, 330, 1500], [2600, 120, 1650]],
      [[2450, 260, 1700], [1500, 150, 1700]],
      [[1900, 420, 2500], [2100, 60, 3000]],
      [[2500, 300, 3400], [1800, 60, 2900]],
      [[1300, 380, 2900], [700, 60, 2800]],
      [[700, 360, 1400], [550, 40, 700]],
      [[1100, 380, 400], [500, 40, 600]],
      [[3300, 420, 1000], [3600, 100, 1700]],
    ],
    theme: {},
  };
})();
