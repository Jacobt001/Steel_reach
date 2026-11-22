// Unlock lookups and the baseline upgrade multipliers research later modifies.
import { BUILDINGS, RECIPES, ORE_TIER } from '../config.js';

const TABLES = {
  buildings: (id) => BUILDINGS[id]?.tier,
  recipes: (id) => RECIPES[id]?.tier,
  ores: (id) => ORE_TIER[id],
};

// Unlocks are purely tier-driven, so an unknown id is locked rather than an error.
export function isUnlocked(game, kind, id) {
  const tier = TABLES[kind](id);
  return tier !== undefined && tier <= game.tier;
}

export function defaultMods() {
  return { beltLevel: 0, minerMult: 1, furnaceMult: 1, asmMult: 1, tunnelGap: 4, storageCap: 200, genMult: 1, poleReach: 8, coverHalf: 3, minerYield: 1 };
}
