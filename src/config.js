// Static game data: every number the sim, UI and tests share lives here.
// Source of truth is docs/Steelreach_Brief_v1.md (§4-§8); tune balance in BAL/RECIPES/TIERS only.

export const MAP = 160;
export const TPS = 20;
export const HUB = { x: 78, y: 78, w: 4, h: 4 };
// Ring distance is measured from the geometric middle of the hub, not its top-left tile.
export const CENTER = { x: 80, y: 80 };
// Directions: 0=N, 1=E, 2=S, 3=W.
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const TILE = 44;
export const ZOOM_MIN_PX = 16;
export const ZOOM_MAX_PX = 72;

// Colors are mid-lightness so they read on both #eef2ea (light) and #121815 (dark);
// shape is the second channel so color-blind players can still tell items apart.
export const ITEMS = {
  iron_ore:       { name: 'Iron ore',       color: '#8a6a5a', shape: 'circle' },
  copper_ore:     { name: 'Copper ore',     color: '#c8743c', shape: 'circle' },
  stone:          { name: 'Stone',          color: '#8e9096', shape: 'circle' },
  coal:           { name: 'Coal',           color: '#4a4f57', shape: 'circle' },
  quartz:         { name: 'Quartz',         color: '#c58fd8', shape: 'diamond' },
  crude_oil:      { name: 'Crude oil',      color: '#5b4a8a', shape: 'circle' },
  titanium_ore:   { name: 'Titanium ore',   color: '#4f93a8', shape: 'circle' },
  uranium_ore:    { name: 'Uranium ore',    color: '#6fc23a', shape: 'circle' },
  iron_plate:     { name: 'Iron plate',     color: '#9aa7b4', shape: 'square' },
  copper_plate:   { name: 'Copper plate',   color: '#e0894a', shape: 'square' },
  gear:           { name: 'Gear',           color: '#7c8794', shape: 'gear' },
  wire:           { name: 'Wire',           color: '#d9a21b', shape: 'rect' },
  brick:          { name: 'Brick',          color: '#b5523b', shape: 'rect' },
  circuit:        { name: 'Circuit',        color: '#2f9e6e', shape: 'chip' },
  steel:          { name: 'Steel',          color: '#5d6f86', shape: 'square' },
  motor:          { name: 'Motor',          color: '#d65a5a', shape: 'hex' },
  glass:          { name: 'Glass',          color: '#7fd0e0', shape: 'diamond' },
  silicon:        { name: 'Silicon',        color: '#6a7bd0', shape: 'chip' },
  frame:          { name: 'Frame',          color: '#a38a5c', shape: 'ring' },
  processor:      { name: 'Processor',      color: '#2d7fd6', shape: 'chip' },
  plastic:        { name: 'Plastic',        color: '#e8c9a0', shape: 'rect' },
  cable:          { name: 'Cable',          color: '#e06aa8', shape: 'cross' },
  robot_arm:      { name: 'Robot arm',      color: '#e0a030', shape: 'bolt' },
  titanium_plate: { name: 'Titanium plate', color: '#3fb6b0', shape: 'square' },
  turbine:        { name: 'Turbine',        color: '#8a5fd6', shape: 'star' },
  fuel_cell:      { name: 'Fuel cell',      color: '#8fd13f', shape: 'triangle' },
  fusion_core:    { name: 'Fusion core',    color: '#f0584c', shape: 'star' },
};

// `in` keeps the order of brief §5: status text names the first missing ingredient in this order.
export const RECIPES = {
  iron_plate:     { machine: 'furnace',    in: { iron_ore: 1 },                                          out: 1, sec: 1.6,  tier: 1 },
  copper_plate:   { machine: 'furnace',    in: { copper_ore: 1 },                                        out: 1, sec: 1.6,  tier: 1 },
  gear:           { machine: 'assembler',  in: { iron_plate: 2 },                                        out: 1, sec: 1.0,  tier: 2 },
  wire:           { machine: 'assembler',  in: { copper_plate: 1 },                                      out: 2, sec: 0.8,  tier: 2 },
  brick:          { machine: 'furnace',    in: { stone: 2 },                                             out: 1, sec: 2.0,  tier: 3 },
  circuit:        { machine: 'assembler',  in: { iron_plate: 1, wire: 3 },                               out: 1, sec: 2.0,  tier: 3 },
  steel:          { machine: 'assembler',  in: { iron_plate: 2, coal: 1 },                               out: 1, sec: 2.5,  tier: 4 },
  motor:          { machine: 'fabricator', in: { steel: 1, gear: 2, wire: 2 },                           out: 1, sec: 3.5,  tier: 4 },
  glass:          { machine: 'furnace',    in: { quartz: 2 },                                            out: 1, sec: 2.0,  tier: 5 },
  silicon:        { machine: 'foundry',    in: { quartz: 2, coal: 1 },                                   out: 1, sec: 3.0,  tier: 5 },
  frame:          { machine: 'assembler',  in: { steel: 2, brick: 3 },                                   out: 1, sec: 3.0,  tier: 6 },
  processor:      { machine: 'fabricator', in: { circuit: 2, silicon: 1, wire: 4 },                      out: 1, sec: 4.0,  tier: 6 },
  plastic:        { machine: 'refinery',   in: { crude_oil: 3 },                                         out: 2, sec: 3.0,  tier: 7 },
  cable:          { machine: 'assembler',  in: { wire: 2, plastic: 1 },                                  out: 1, sec: 1.5,  tier: 7 },
  robot_arm:      { machine: 'fabricator', in: { motor: 1, processor: 1, plastic: 2, steel: 1 },         out: 1, sec: 6.0,  tier: 8 },
  titanium_plate: { machine: 'foundry',    in: { titanium_ore: 2, coal: 1 },                             out: 1, sec: 3.0,  tier: 9 },
  turbine:        { machine: 'fabricator', in: { titanium_plate: 3, motor: 2, cable: 2, frame: 1 },      out: 1, sec: 8.0,  tier: 10 },
  fuel_cell:      { machine: 'fabricator', in: { uranium_ore: 4, titanium_plate: 1, glass: 1, processor: 1 }, out: 1, sec: 8.0, tier: 11 },
  fusion_core:    { machine: 'fabricator', in: { fuel_cell: 2, turbine: 1, robot_arm: 1, processor: 2 }, out: 1, sec: 15.0, tier: 12 },
};

// `dir` marks pieces the player rotates; machines never rotate.
export const BUILDINGS = {
  belt:       { name: 'Belt',        w: 1, h: 1, tier: 1, power: 0, dir: true },
  bridge:     { name: 'Bridge',      w: 1, h: 1, tier: 3, power: 0, dir: true },
  tunnel:     { name: 'Tunnel',      w: 1, h: 1, tier: 3, power: 0, dir: true },
  splitter:   { name: 'Splitter',    w: 1, h: 1, tier: 2, power: 0, dir: true },
  merger:     { name: 'Merger',      w: 1, h: 1, tier: 2, power: 0, dir: true },
  storage:    { name: 'Storage box', w: 2, h: 2, tier: 4, power: 0, dir: false },
  miner:      { name: 'Miner',       w: 2, h: 2, tier: 1, power: 0, dir: false },
  furnace:    { name: 'Furnace',     w: 2, h: 2, tier: 1, power: 0, dir: false },
  assembler:  { name: 'Assembler',   w: 2, h: 2, tier: 2, power: 0, dir: false },
  fabricator: { name: 'Fabricator',  w: 3, h: 3, tier: 4, power: 0, dir: false },
  foundry:    { name: 'Foundry',     w: 2, h: 2, tier: 5, power: 4, dir: false },
  refinery:   { name: 'Refinery',    w: 3, h: 3, tier: 7, power: 8, dir: false },
  generator:  { name: 'Generator',   w: 2, h: 2, tier: 5, power: 0, dir: false },
  pole:       { name: 'Power pole',  w: 1, h: 1, tier: 5, power: 0, dir: false },
  // Not placeable: it exists from tier 0 and is never offered in the build bar.
  hub:        { name: 'Hub',         w: 4, h: 4, tier: 0, power: 0, dir: false },
};

export const ORE_TIER = { iron_ore: 1, copper_ore: 1, stone: 1, coal: 1, quartz: 5, crude_oil: 7, titanium_ore: 9, uranium_ore: 11 };

export const RINGS = [
  { r0: 0,  r1: 28,       ore: null },
  { r0: 28, r1: 48,       ore: 'quartz' },
  { r0: 48, r1: 66,       ore: 'crude_oil' },
  { r0: 66, r1: 84,       ore: 'titanium_ore' },
  { r0: 84, r1: Infinity, ore: 'uranium_ore' },
];

const T = (name, buildings, recipes, ores, goals) => ({ name, unlocks: { buildings, recipes, ores }, goals });
export const TIERS = [
  T('Ignition',    ['belt', 'miner', 'furnace'], ['iron_plate', 'copper_plate'], ['iron_ore', 'copper_ore', 'stone', 'coal'], { iron_plate: 40, copper_plate: 30 }),
  T('Parts',       ['assembler', 'splitter', 'merger'], ['gear', 'wire'], [], { gear: 50, wire: 80 }),
  T('Circuits',    ['tunnel', 'bridge'], ['brick', 'circuit'], [], { circuit: 60, brick: 40 }),
  T('Steel',       ['fabricator', 'storage'], ['steel', 'motor'], [], { steel: 60, motor: 30 }),
  T('Power',       ['generator', 'pole', 'foundry'], ['glass', 'silicon'], ['quartz'], { silicon: 60, glass: 60 }),
  T('Electronics', [], ['frame', 'processor'], [], { processor: 50, frame: 40 }),
  T('Oil',         ['refinery'], ['plastic', 'cable'], ['crude_oil'], { plastic: 120, cable: 100 }),
  T('Automation',  [], ['robot_arm'], [], { robot_arm: 40, processor: 100 }),
  T('Titanium',    [], ['titanium_plate'], ['titanium_ore'], { titanium_plate: 150, robot_arm: 60 }),
  T('Aerospace',   [], ['turbine'], [], { turbine: 40, titanium_plate: 200 }),
  T('Nuclear',     [], ['fuel_cell'], ['uranium_ore'], { fuel_cell: 40, turbine: 40 }),
  T('Fusion',      [], ['fusion_core'], [], { fusion_core: 20 }),
];

export const RESEARCH = [
  { id: 'miner1', name: 'Faster Miners I',   desc: 'Miners work 40% faster.', tier: 1, cost: { iron_plate: 30 }, effect: { minerMult: 0.4 } },
  { id: 'miner2', name: 'Faster Miners II',  desc: 'Miners work another 40% faster.', tier: 4, req: 'miner1', cost: { steel: 40, gear: 40 }, effect: { minerMult: 0.4 } },
  { id: 'miner3', name: 'Faster Miners III', desc: 'Miners work another 40% faster.', tier: 8, req: 'miner2', cost: { robot_arm: 15, steel: 80 }, effect: { minerMult: 0.4 } },
  { id: 'belt1',  name: 'Faster Belts I',    desc: 'Belts move 3 tiles per second.', tier: 1, cost: { copper_plate: 30, iron_plate: 20 }, effect: { beltLevel: 1 } },
  { id: 'belt2',  name: 'Faster Belts II',   desc: 'Belts move 4 tiles per second.', tier: 4, req: 'belt1', cost: { steel: 40, gear: 30 }, effect: { beltLevel: 1 } },
  { id: 'belt3',  name: 'Faster Belts III',  desc: 'Belts move 5 tiles per second.', tier: 9, req: 'belt2', cost: { titanium_plate: 60, motor: 20 }, effect: { beltLevel: 1 } },
  { id: 'smelt1', name: 'Hot Furnaces I',    desc: 'Furnaces work 40% faster.', tier: 2, cost: { gear: 40 }, effect: { furnaceMult: 0.4 } },
  { id: 'smelt2', name: 'Hot Furnaces II',   desc: 'Furnaces work another 40% faster.', tier: 6, req: 'smelt1', cost: { frame: 20 }, effect: { furnaceMult: 0.4 } },
  { id: 'asm1',   name: 'Quick Assembly I',  desc: 'Assemblers and fabricators work 35% faster.', tier: 3, cost: { circuit: 30 }, effect: { asmMult: 0.35 } },
  { id: 'asm2',   name: 'Quick Assembly II', desc: 'Assemblers and fabricators work another 35% faster.', tier: 7, req: 'asm1', cost: { processor: 30 }, effect: { asmMult: 0.35 } },
  { id: 'longTunnels', name: 'Long Tunnels', desc: 'Tunnels can span 8 tiles of gap.', tier: 4, cost: { steel: 30, circuit: 30 }, effect: { tunnelGap: 8 } },
  { id: 'bigBoxes',    name: 'Big Boxes',    desc: 'Storage boxes hold 500 items.', tier: 6, cost: { frame: 20 }, effect: { storageCap: 500 } },
  { id: 'effGen',      name: 'Efficient Generators', desc: 'Generators give 50% more power per coal.', tier: 6, cost: { processor: 20, silicon: 40 }, effect: { genMult: 1.5 } },
  { id: 'widePoles',   name: 'Wide Poles',   desc: 'Poles reach 12 tiles and cover 11x11.', tier: 7, cost: { cable: 60 }, effect: { poleReach: 12, coverHalf: 5 } },
  { id: 'deepDrills',  name: 'Deep Drills',  desc: 'Miners yield 2 items per cycle.', tier: 10, cost: { turbine: 10 }, effect: { minerYield: 2 } },
];

export const BAL = {
  beltTilesPerSec: [2, 3, 4, 5], spacing: 0.25, waitPos: 0.875, ingBatches: 2, outMax: 4, overstock: 99,
  storageCap: 200, tunnelGap: 4, minerSecFull: 1.0, genFuelMax: 10, coalSec: 4, coalPower: 20,
  cellSec: 60, cellPower: 200, poleReach: 8, coverHalf: 3, unpowered: 0.25, undoMax: 20, autosaveMs: 10000,
};
