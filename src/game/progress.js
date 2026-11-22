// Unlock lookups and the baseline upgrade multipliers research later modifies.
import { BUILDINGS, RECIPES, ORE_TIER, TIERS, RESEARCH } from '../config.js';

export const SANDBOX = 13;

const TABLES = {
  buildings: (id) => BUILDINGS[id]?.tier,
  recipes: (id) => RECIPES[id]?.tier,
  ores: (id) => ORE_TIER[id],
};

// Unlocks are purely tier-driven, so an unknown id is locked rather than an error.
export function isUnlocked(game, kind, id) {
  const tier = TABLES[kind](id);
  if (tier === undefined) return false;
  return game.tier >= SANDBOX || tier <= game.tier;
}

export function defaultMods() {
  return { beltLevel: 0, minerMult: 1, furnaceMult: 1, asmMult: 1, tunnelGap: 4, storageCap: 200, genMult: 1, poleReach: 8, coverHalf: 3, minerYield: 1 };
}

// Advances when every goal of the current tier is met. The empty-goals guard stops a
// tier with no goals (or sandbox) from advancing on `every()` being vacuously true; prog is
// reset on advance so a second call in the same tick sees the new tier's empty progress.
export function checkTier(game) {
  const goals = TIERS[game.tier - 1]?.goals;
  if (!goals) return;
  const entries = Object.entries(goals);
  if (entries.length === 0 || !entries.every(([k, n]) => (game.prog[k] ?? 0) >= n)) return;
  game.prog = {};
  if (game.tier >= TIERS.length) {
    game.tier = SANDBOX;
    game.completedAt = game.stats.playTicks;
    game.events.push({ type: 'complete' });
  } else {
    game.tier++;
    game.events.push({ type: 'tierUp', tier: game.tier });
  }
}

const findResearch = (id) => RESEARCH.find((r) => r.id === id);
const affords = (game, cost) => Object.entries(cost).every(([k, n]) => (game.stock[k] ?? 0) >= n);

export function researchState(game, id) {
  const r = findResearch(id);
  if (!r) return { can: false, reason: 'Unknown research' };
  if (game.research[id]) return { can: false, reason: 'Already researched' };
  if (game.tier < r.tier) return { can: false, reason: `Unlocks at Tier ${r.tier}` };
  if (r.req && !game.research[r.req]) return { can: false, reason: `Needs ${findResearch(r.req).name}` };
  if (!affords(game, r.cost)) return { can: false, reason: 'Not enough items' };
  return { can: true, reason: null };
}

// Rebuilt from scratch each time so effects never double-apply after a load.
export function recalcMods(game) {
  const mods = defaultMods();
  for (const r of RESEARCH) {
    if (!game.research[r.id]) continue;
    for (const [k, v] of Object.entries(r.effect)) {
      // Multipliers and belt level stack; every other key is an absolute replacement.
      mods[k] = ADDITIVE.has(k) ? mods[k] + v : v;
    }
  }
  game.mods = mods;
  // Power rebuild reads poleReach/coverHalf, and tunnel pairing reads tunnelGap.
  game.powerDirty = game.topoDirty = true;
}
const ADDITIVE = new Set(['minerMult', 'beltLevel', 'furnaceMult', 'asmMult']);

export function buyResearch(game, id) {
  const st = researchState(game, id);
  if (!st.can) return { ok: false, reason: st.reason };
  for (const [k, n] of Object.entries(findResearch(id).cost)) game.stock[k] -= n;
  game.research[id] = true;
  recalcMods(game);
  game.events.push({ type: 'research', id });
  return { ok: true, reason: null };
}

export function anyResearchAffordable(game) {
  return RESEARCH.some((r) => researchState(game, r.id).can);
}
