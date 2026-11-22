import { test } from 'node:test'; import assert from 'node:assert/strict';
import { goalLines, tierLabel, formatDuration, topMade } from '../src/ui/format.js'; import { testGame } from './helpers.js'; import { TIERS } from '../src/config.js';
import {
  createRateMeter, BUILD_TOOLS, toolState, markSeen, chipRecipe, recipesFor, recipeText, unlocksAt, ingredientRows,
  minerRate, netOf, netSupply, conveyorInfo, storageCounts, costLines, fmtInt, itemsMade, showsHint,
} from '../src/ui/format.js';
import { place } from '../src/game/place.js'; import { rebuildPower } from '../src/sim/power.js';

test('format helpers', () => {
  const g = testGame({tier:3}); g.prog.circuit = 12;
  assert.deepEqual(goalLines(g).find(l => l.item === 'circuit'), {item:'circuit', name:'Circuit', have:12, need:TIERS[2].goals.circuit});
  assert.equal(tierLabel(g), 'Tier 3 · Circuits'); g.tier = 13; assert.equal(tierLabel(g), 'Sandbox mode');
  assert.equal(formatDuration(20 * 60 * 312), '5h 12m'); assert.equal(formatDuration(20 * 59), '0m');
  assert.deepEqual(topMade({made:{gear:5, wire:9}}), {item:'wire', name:'Wire', count:9}); assert.equal(topMade({made:{}}), null);
});

test('sandbox has no goal lines; totals and thousands separators', () => {
  const g = testGame({tier:13}); assert.deepEqual(goalLines(g), []);
  assert.equal(itemsMade({made:{gear:5, wire:9}}), 14); assert.equal(itemsMade({made:{}}), 0);
  assert.equal(fmtInt(1234567), '1,234,567'); assert.equal(fmtInt(999), '999'); assert.equal(fmtInt(12.6), '13');
});

test('rate meter: items per game-minute over a rolling 60 s window, reset on rewind', () => {
  const m = createRateMeter();
  assert.equal(m.rate('gear'), 0);
  for (let s = 0; s <= 60; s++) m.sample(s * 20, { gear: s * 2 }); // 2 per second
  assert.equal(m.rate('gear'), 120);
  for (let s = 61; s <= 120; s++) m.sample(s * 20, { gear: 120 }); // stopped for a whole window
  assert.equal(m.rate('gear'), 0);
  assert.equal(m.rate('wire'), 0); // never counted reads as zero, not NaN
  m.sample(10, { gear: 500 }); // tick went backwards: a different game, so old samples are dropped
  assert.equal(m.rate('gear'), 0);
  // A short history is divided by at least 10 s so one early item doesn't read as 60/min.
  const n = createRateMeter(); n.sample(0, { wire: 0 }); n.sample(20, { wire: 1 }); assert.equal(n.rate('wire'), 6);
});

test('build bar: fixed order, tier locks, new dot until first selected', () => {
  assert.deepEqual(BUILD_TOOLS, ['pan', 'belt', 'bridge', 'tunnel', 'splitter', 'merger', 'storage', 'miner', 'furnace', 'assembler', 'fabricator', 'foundry', 'refinery', 'generator', 'pole', 'erase']);
  const g = testGame({tier:2});
  assert.deepEqual(toolState(g, 'bridge'), {locked:true, tier:3, fresh:false});
  assert.deepEqual(toolState(g, 'splitter'), {locked:false, tier:2, fresh:true});
  assert.deepEqual(toolState(g, 'belt'), {locked:false, tier:1, fresh:false}); // starting tools are never "new"
  assert.deepEqual(toolState(g, 'erase'), {locked:false, tier:0, fresh:false});
  markSeen(g, 'splitter'); assert.equal(toolState(g, 'splitter').fresh, false);
  g.settings.seenTools = 'junk'; markSeen(g, 'merger'); assert.deepEqual(g.settings.seenTools, {merger:true});
  g.tier = 13; assert.equal(toolState(g, 'refinery').locked, false);
});

test('recipe chip mirrors place(): remembered recipe, else the first unlocked one', () => {
  const g = testGame({tier:3});
  assert.equal(chipRecipe(g, 'assembler'), 'gear');
  g.settings.lastRecipe.assembler = 'circuit'; assert.equal(chipRecipe(g, 'assembler'), 'circuit');
  assert.equal(chipRecipe(g, 'fabricator'), null);
  assert.deepEqual(recipesFor(g, 'assembler').map(r => [r.id, r.unlocked, r.tier]),
    [['gear', true, 2], ['wire', true, 2], ['circuit', true, 3], ['steel', false, 4], ['frame', false, 6], ['cable', false, 7]]);
  assert.equal(recipeText('steel'), '2 Iron plate + 1 Coal → 1 Steel');
});

test('tier-up sheet lists what the tier unlocked', () => {
  assert.deepEqual(unlocksAt(5), {buildings:['Generator', 'Power pole', 'Foundry'], recipes:['Glass', 'Silicon'], ores:['Quartz'], research:[], extra:[]});
  assert.deepEqual(unlocksAt(2).research, ['Hot Furnaces I']);
  assert.deepEqual(unlocksAt(11).extra, ['Generators accept fuel cells']);
});

test('inspector rows flag overstock past the normal two batches', () => {
  assert.deepEqual(ingredientRows({recipe:'circuit', buf:{iron_plate:5, wire:2}}), [
    {item:'iron_plate', name:'Iron plate', have:5, need:1, cap:2, over:true},
    {item:'wire', name:'Wire', have:2, need:3, cap:6, over:false}]);
  assert.deepEqual(ingredientRows({recipe:null, buf:{}}), []);
});

test('miner rate follows ore tiles, research and yield', () => {
  const g = testGame();
  assert.equal(minerRate(g, {tiles:4}), 60);
  assert.equal(Math.round(minerRate(g, {tiles:3})), 44); // period rounds to 27 ticks, as the sim does
  g.mods.minerYield = 2; assert.equal(minerRate(g, {tiles:4}), 120);
  assert.equal(minerRate(g, {tiles:0}), 0);
});

test('generator inspector finds its network through nets[].gens', () => {
  const g = testGame(); const gen = place(g, 'generator', 10, 10); place(g, 'foundry', 13, 10, {recipe:'silicon'});
  const lone = place(g, 'generator', 60, 60);
  rebuildPower(g);
  const net = netOf(g, gen); assert.equal(net.demand, 4); assert.equal(netSupply(net), 0);
  gen.burn = 5; gen.burnPower = 20; assert.equal(netSupply(net), 20);
  assert.notEqual(netOf(g, lone), net); g.nets = []; assert.equal(netOf(g, gen), null);
});

test('conveyor inspector: items front to back and the blocked reason', () => {
  assert.deepEqual(conveyorInfo({type:'belt', items:[{item:'coal', pos:0.875}, {item:'iron_ore', pos:0.6}], blocked:"Furnace can't use Coal"}),
    {lanes:[{label:null, items:['coal', 'iron_ore']}], blocked:"Furnace can't use Coal"});
  assert.deepEqual(conveyorInfo({type:'bridge', laneH:[{item:'gear', pos:0.2}], laneV:[], blocked:null}),
    {lanes:[{label:'Horizontal', items:['gear']}, {label:'Vertical', items:[]}], blocked:null});
  assert.deepEqual(conveyorInfo({type:'splitter', hold:{item:'wire', pos:0.5}, blocked:null}).lanes, [{label:null, items:['wire']}]);
  assert.deepEqual(conveyorInfo({type:'merger', hold:null, blocked:'x'}), {lanes:[{label:null, items:[]}], blocked:'x'});
  assert.deepEqual(conveyorInfo({type:'tunnel_in', under:[{item:'gear', left:3}]}), {lanes:[{label:'Underground', items:['gear']}], blocked:null});
});

test('storage contents, research costs and the first-run hint', () => {
  assert.deepEqual(storageCounts(['coal', 'gear', 'coal']), [{item:'coal', name:'Coal', count:2}, {item:'gear', name:'Gear', count:1}]);
  const g = testGame({tier:1}); g.stock.iron_plate = 12;
  assert.deepEqual(costLines(g, {iron_plate:30}), [{item:'iron_plate', name:'Iron plate', have:12, need:30, ok:false}]);
  assert.equal(showsHint(g), true);
  g.settings.hintDone = true; assert.equal(showsHint(g), false); g.settings.hintDone = false;
  place(g, 'belt', 10, 10, {dir:1}); assert.equal(showsHint(g), false); // a started factory is not a new game
});
